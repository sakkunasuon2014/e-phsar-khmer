import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  notInArray,
} from 'drizzle-orm';
import { DRIZZLE } from '../../db/drizzle.provider';
import type { DbClient } from '../../db/drizzle.provider';
import { OutboxService } from '../../outbox/outbox.service';
import { subscriptionPurchases } from '../../db/schema/subscriptions.schema';
import { SubscriptionActivationService } from '../../subscriptions/subscription-activation.service';
import { paymentAttempts, paymentTransactions } from '../entity';
import { PAYMENT_ISSUED_EVENT } from '../payment.constants';
import { PaymentGatewayRegistry } from '../providers/payment-gateway.registry';
import { RECOVERABLE_FAILURE_CODES, nextTickDelayMs } from './reconcile-policy';
import { runExpireAttempt, runReconcileAttempt } from './run-reconcile-attempt';
import type { ReconcileAttemptResult } from './run-reconcile-attempt';

/** Tick spacing right after a checkout is issued, while the payer is scanning. */
const FAST_INTERVAL_MS = 5 * 1000;
/** How long after issue the fast spacing applies before relaxing to the base one. */
const FAST_WINDOW_MS = 60 * 1000;
/**
 * How often attempts we gave up on (`POLL_EXPIRED` / `POLL_GATEWAY_ERROR`) are
 * re-asked about. They are not a payer watching a screen, so they never ride
 * the tight loop: late money is picked up within this, not within seconds.
 */
const RECOVERABLE_INTERVAL_MS = 5 * 60 * 1000;
/** Most attempts looked at per tick — bounds provider calls per cycle. */
const BATCH_LIMIT = 100;
/**
 * Most recoverable-failed attempts (we gave up waiting, money may still land)
 * re-checked per pass, on top of the pending ones, so they cannot starve them.
 */
const RECOVERABLE_LIMIT = 50;
/**
 * Slack past a checkout's expiry before failing it, so a payer at the deadline
 * or a callback already in flight lands first. Kept under the web page's 60 s
 * grace.
 */
const EXPIRY_GRACE_MS = 30 * 1000;

export interface ReconcileSummary {
  /** Unresolved attempts in view this pass. Zero means an empty system. */
  candidates: number;
  checked: number;
  settled: number;
  /** Purchases activated for a payment that had already settled. */
  activated: number;
  abandoned: number;
  errors: number;
  /** Pending attempts that are still unpaid after this pass (they keep the loop tight). */
  pending: number;
  /** Age of the newest of those, `null` when none. */
  newestPendingAgeMs: number | null;
}

/**
 * The one poller for a provider with no webhook (Bakong), and the guarantee
 * behind "money taken ⇒ plan activated", whatever the app was doing when the
 * payer paid.
 *
 * Demand-driven: issuing a checkout emits `payment.issued`, which `arm()`s the
 * loop at once (tight spacing while the payer is scanning, relaxing as the
 * checkout ages). With nothing pending it falls back to a slow safety sweep
 * rather than a fixed 15 s timer. It reads every unresolved attempt straight
 * from Postgres, asks the provider, and settles through one idempotent path —
 * there is no self-rescheduling BullMQ chain whose one lost link could strand
 * an attempt `pending` while the provider already holds the money.
 *
 * Why this is safe to run on every instance: settlement is version-guarded
 * (`upsertPayment`), the ledger post is keyed on the transaction id, and the
 * `payment.succeeded` event has a dedupe key — a racing second pass loses with
 * a conflict and rolls back whole. The worst case of two instances is one
 * redundant provider call. The event is local and advisory: a checkout issued
 * on another instance is found by this one's next safety sweep.
 *
 * It also revisits attempts we ourselves failed by timeout (`POLL_EXPIRED` /
 * `POLL_GATEWAY_ERROR`) for a grace window, on the slow
 * `RECOVERABLE_INTERVAL_MS` cadence, so money that arrives late still counts —
 * an attempt is never failed *because* we couldn't see the payment.
 */
@Injectable()
export class PaymentReconciler
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(PaymentReconciler.name);
  private timer: NodeJS.Timeout | undefined;
  /** Epoch ms the timer is set to fire, so `arm()` never pushes a tick later. */
  private nextTickAt = 0;
  private enabled = false;
  private stopped = false;
  private running = false;
  /** `arm()` arrived mid-pass, whose scan may predate the new attempt. */
  private rearmRequested = false;
  /** When the recoverable-failed tail was last re-asked about. */
  private lastRecoverableCheckAt = 0;

  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly registry: PaymentGatewayRegistry,
    private readonly outbox: OutboxService,
    private readonly activation: SubscriptionActivationService,
    private readonly configService: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (
      this.configService.get<boolean>('payment.reconcilerEnabled') === false
    ) {
      this.logger.log('Payment reconciler disabled by configuration');
      return;
    }

    this.enabled = true;
    this.stopped = false;
    this.logger.log(
      `Payment reconciler started (armed by ${PAYMENT_ISSUED_EVENT}: every ${FAST_INTERVAL_MS}ms for a fresh checkout, ` +
        `${this.intervalMs()}ms while one stays pending, ${this.idleIntervalMs()}ms safety sweep otherwise, ` +
        `providers: ${this.providers().join(', ') || 'none'})`,
    );
    // Don't wait a full interval after boot: a payment made while the app was
    // down is picked up as soon as it is back.
    void this.tick();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  @OnEvent(PAYMENT_ISSUED_EVENT)
  handlePaymentIssued(): void {
    this.arm();
  }

  /**
   * A checkout was just issued: look soon instead of waiting out a slow safety
   * sweep. Never pushes the next pass later, and a pass already in flight is
   * told to come back quickly — its scan may predate the new attempt.
   */
  arm(): void {
    if (!this.enabled || this.stopped) return;
    if (this.running) {
      this.rearmRequested = true;
      return;
    }
    this.schedule(FAST_INTERVAL_MS, { onlyIfSooner: true });
  }

  private schedule(
    delayMs: number,
    options: { onlyIfSooner?: boolean } = {},
  ): void {
    const at = Date.now() + delayMs;
    if (options.onlyIfSooner && this.timer && this.nextTickAt <= at) return;
    if (this.timer) clearTimeout(this.timer);
    this.nextTickAt = at;
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  /**
   * One timer tick, then re-arms the timer. Never throws, and never overlaps
   * a still-running one.
   *
   * The delay to the next tick comes from what this pass saw
   * (`nextTickDelayMs`): tight while a payer has just been issued a checkout,
   * the base interval while any stays pending, and the slow safety sweep when
   * nothing is. The boot tick above covers downtime, and `arm()` covers a new
   * checkout, so the idle gap only delays the backstop.
   */
  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let nextDelayMs = this.intervalMs();
    try {
      const summary = await this.runOnce();
      const didWork = Boolean(
        summary.settled ||
        summary.activated ||
        summary.abandoned ||
        summary.errors,
      );
      nextDelayMs = nextTickDelayMs(
        {
          pending: summary.pending,
          newestPendingAgeMs: summary.newestPendingAgeMs,
          didWork,
        },
        {
          fastIntervalMs: FAST_INTERVAL_MS,
          fastWindowMs: FAST_WINDOW_MS,
          baseIntervalMs: this.intervalMs(),
          idleIntervalMs: this.idleIntervalMs(),
        },
      );
      if (didWork) {
        this.logger.log(
          `Reconcile: checked ${summary.checked}, settled ${summary.settled}, activated ${summary.activated}, abandoned ${summary.abandoned}, errors ${summary.errors}`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Reconcile tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
      if (this.rearmRequested) {
        this.rearmRequested = false;
        nextDelayMs = Math.min(nextDelayMs, FAST_INTERVAL_MS);
      }
      if (!this.stopped) this.schedule(nextDelayMs);
    }
  }

  /**
   * One pass over every unresolved attempt: pending ones every time, the
   * recoverable-failed tail only when `RECOVERABLE_INTERVAL_MS` has passed.
   * Exposed for tests and for an operator-triggered run; the timer is just
   * this on a loop.
   */
  async runOnce(): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = {
      candidates: 0,
      checked: 0,
      settled: 0,
      activated: 0,
      abandoned: 0,
      errors: 0,
      pending: 0,
      newestPendingAgeMs: null,
    };

    // Last hop first: a payment that already settled but whose purchase never
    // activated (the `payment.succeeded` event was consumed by an instance
    // that only notified, or lost) is finished here, with no provider call.
    summary.activated = await this.activateSettledPurchases();
    summary.abandoned += await this.expireWebhookAttempts();

    const providers = this.providers();
    if (providers.length === 0) return summary;

    const now = Date.now();
    const since = new Date(now - this.latePaymentGraceMs());
    const candidateColumns = {
      id: paymentAttempts.id,
      createdAt: paymentAttempts.createdAt,
    };
    const baseFilter = and(
      inArray(paymentAttempts.provider, providers),
      isNotNull(paymentAttempts.providerAttemptId),
      gte(paymentAttempts.createdAt, since),
    );

    // Two queries, each newest-first with its own cap. One shared
    // oldest-first LIMIT let a pile of abandoned checkouts (they stay
    // re-checkable for the whole grace window) push the attempt a payer is
    // watching right now past the cut, so the backstop never reached it.
    const pending = await this.db
      .select(candidateColumns)
      .from(paymentAttempts)
      .where(and(baseFilter, eq(paymentAttempts.status, 'pending')))
      .orderBy(desc(paymentAttempts.createdAt))
      .limit(BATCH_LIMIT);

    // Attempts we gave up on are not a payer watching a screen: ask about them
    // on a slow clock of their own, and skip the query entirely in between.
    let recoverable: typeof pending = [];
    if (now - this.lastRecoverableCheckAt >= RECOVERABLE_INTERVAL_MS) {
      this.lastRecoverableCheckAt = now;
      recoverable = await this.db
        .select(candidateColumns)
        .from(paymentAttempts)
        .where(
          and(
            baseFilter,
            eq(paymentAttempts.status, 'failed'),
            inArray(paymentAttempts.failureCode, [
              ...RECOVERABLE_FAILURE_CODES,
            ]),
          ),
        )
        .orderBy(desc(paymentAttempts.createdAt))
        .limit(RECOVERABLE_LIMIT);
    }

    summary.candidates = pending.length + recoverable.length;

    // Pending first: those are the payers still waiting.
    for (const candidate of pending) {
      const outcome = await this.reconcileCandidate(candidate.id, summary);
      // Still unpaid (or the provider hiccuped): keep the loop tight.
      if (outcome === 'still_pending' || outcome === 'error') {
        const ageMs = now - candidate.createdAt.getTime();
        summary.pending += 1;
        summary.newestPendingAgeMs = Math.min(
          summary.newestPendingAgeMs ?? ageMs,
          ageMs,
        );
      }
    }
    for (const candidate of recoverable) {
      await this.reconcileCandidate(candidate.id, summary);
    }

    // Settling enqueued `payment.succeeded` rows (activation + notification);
    // wake the outbox rather than leave them to its poll fallback.
    if (summary.settled > 0) this.outbox.wakeupAfterCommit();

    return summary;
  }

  private async reconcileCandidate(
    paymentAttemptId: string,
    summary: ReconcileSummary,
  ): Promise<ReconcileAttemptResult> {
    summary.checked += 1;
    const outcome = await runReconcileAttempt(
      {
        db: this.db,
        registry: this.registry,
        outbox: this.outbox,
        logger: this.logger,
      },
      {
        paymentAttemptId,
        abandonPendingAfterMs: this.pendingAbandonMs(),
        expiryGraceMs: EXPIRY_GRACE_MS,
      },
    );
    if (outcome === 'succeeded') summary.settled += 1;
    else if (outcome === 'abandoned') summary.abandoned += 1;
    else if (outcome === 'error') summary.errors += 1;
    return outcome;
  }

  /**
   * Activates every subscription purchase whose payment has already settled
   * but which is still `pending`. `activatePaidPurchase` re-verifies owner,
   * amount and currency and is a no-op once the purchase is paid, so this is
   * safe to repeat every tick and to race with the outbox handler.
   */
  private async activateSettledPurchases(): Promise<number> {
    const stuck = await this.db
      .select({
        purchaseId: subscriptionPurchases.id,
        paymentTransactionId: paymentTransactions.id,
        customerId: paymentTransactions.customerId,
        amount: paymentTransactions.amount,
        currency: paymentTransactions.currency,
      })
      .from(subscriptionPurchases)
      .innerJoin(
        paymentTransactions,
        eq(paymentTransactions.id, subscriptionPurchases.paymentTransactionId),
      )
      .where(
        and(
          eq(subscriptionPurchases.status, 'pending'),
          eq(paymentTransactions.status, 'succeeded'),
        ),
      )
      .limit(BATCH_LIMIT);

    let activated = 0;
    for (const row of stuck) {
      try {
        const result = await this.activation.activatePaidPurchase(row);
        if (result.status === 'activated') {
          activated += 1;
          this.logger.log(
            `Activated purchase ${row.purchaseId} for settled payment ${row.paymentTransactionId}`,
          );
        } else if (
          result.status === 'payment_mismatch' ||
          result.status === 'needs_refund' ||
          result.status === 'not_found'
        ) {
          this.logger.warn(
            `Settled payment ${row.paymentTransactionId} cannot activate purchase ${row.purchaseId} (${result.status}) — needs manual review`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `Activation of purchase ${row.purchaseId} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return activated;
  }

  /**
   * Fails pending attempts whose stored `expiresAt` has passed, for providers
   * that are NOT polled (webhook-only, i.e. ABA): the provider refuses payment
   * after its lifetime, so there is nothing to ask — this only closes our side.
   * Database only, never a provider call.
   */
  private async expireWebhookAttempts(): Promise<number> {
    const polled = this.providers();
    const cutoff = new Date(Date.now() - EXPIRY_GRACE_MS);
    const expired = await this.db
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .innerJoin(
        paymentTransactions,
        eq(paymentTransactions.id, paymentAttempts.paymentTransactionId),
      )
      .where(
        and(
          eq(paymentAttempts.status, 'pending'),
          isNotNull(paymentTransactions.expiresAt),
          lt(paymentTransactions.expiresAt, cutoff),
          polled.length > 0
            ? notInArray(paymentAttempts.provider, polled)
            : undefined,
        ),
      )
      .orderBy(asc(paymentTransactions.expiresAt))
      .limit(BATCH_LIMIT);

    let count = 0;
    for (const row of expired) {
      const outcome = await runExpireAttempt(
        { db: this.db, logger: this.logger },
        row.id,
      );
      if (outcome === 'expired') count += 1;
    }
    return count;
  }

  private providers(): string[] {
    return this.configService.get<string[]>('payment.reconcileProviders') ?? [];
  }

  private intervalMs(): number {
    return (
      this.configService.get<number>('payment.reconcileIntervalMs') ?? 15_000
    );
  }

  private idleIntervalMs(): number {
    return (
      this.configService.get<number>('payment.reconcileIdleIntervalMs') ??
      60_000
    );
  }

  private pendingAbandonMs(): number {
    return (
      this.configService.get<number>('payment.pendingAbandonMs') ??
      15 * 60 * 1000
    );
  }

  private latePaymentGraceMs(): number {
    return (
      this.configService.get<number>('payment.latePaymentGraceMs') ??
      24 * 60 * 60 * 1000
    );
  }
}

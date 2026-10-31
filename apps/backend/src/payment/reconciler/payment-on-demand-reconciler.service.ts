import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { DRIZZLE } from '../../db/drizzle.provider';
import type { DbClient } from '../../db/drizzle.provider';
import { OutboxService } from '../../outbox/outbox.service';
import { paymentAttempts } from '../entity';
import { PaymentGatewayRegistry } from '../providers/payment-gateway.registry';
import { runReconcileAttempt } from './run-reconcile-attempt';
import { ThrottleGate } from './throttle-gate';

/** At most one provider call per attempt per this window, however often the page reads. */
const ON_DEMAND_WINDOW_MS = 5 * 1000;
/** Longest a page read waits on the provider before answering from the database. */
const ON_DEMAND_TIMEOUT_MS = 4 * 1000;
/** Same slack the background reconciler allows past a checkout's expiry. */
const EXPIRY_GRACE_MS = 30 * 1000;

/**
 * - `none`: no open polled attempt on this transaction, nothing to ask.
 * - `throttled`: asked within the window already; answer from the database.
 * - `unchanged`: asked, still unpaid (or the provider was slow).
 * - `changed`: asked, and the attempt resolved (or someone else resolved it):
 *   re-read the transaction.
 * - `error`: the check failed; the background reconciler remains the backstop.
 */
export type OnDemandRefresh =
  | 'none'
  | 'throttled'
  | 'unchanged'
  | 'changed'
  | 'error';

/**
 * Lets a payer's own status read nudge a settle along: `GET /payments/:id`
 * asks the provider about that transaction's open attempt — at most once per
 * `ON_DEMAND_WINDOW_MS` — through the same idempotent path the background
 * reconciler uses.
 *
 * Strictly additive and server-side: the response still comes from the
 * database, and nothing about durability depends on the page being open or on
 * this call succeeding. On a serverless instance it is also what runs the
 * check while a payer is watching, since the request keeps an instance alive
 * that a timer alone would not. The caller must have proved ownership first —
 * this never decides who may ask.
 */
@Injectable()
export class PaymentOnDemandReconciler {
  private readonly logger = new Logger(PaymentOnDemandReconciler.name);
  private readonly gate = new ThrottleGate(ON_DEMAND_WINDOW_MS);

  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly registry: PaymentGatewayRegistry,
    private readonly outbox: OutboxService,
    private readonly configService: ConfigService,
  ) {}

  /** Never throws. */
  async refresh(paymentTransactionId: string): Promise<OnDemandRefresh> {
    try {
      const providers = this.providers();
      if (providers.length === 0) return 'none';

      const [attempt] = await this.db
        .select({ id: paymentAttempts.id })
        .from(paymentAttempts)
        .where(
          and(
            eq(paymentAttempts.paymentTransactionId, paymentTransactionId),
            eq(paymentAttempts.status, 'pending'),
            inArray(paymentAttempts.provider, providers),
            isNotNull(paymentAttempts.providerAttemptId),
          ),
        )
        .orderBy(desc(paymentAttempts.createdAt))
        .limit(1);
      if (!attempt) return 'none';

      if (!this.gate.tryAcquire(attempt.id, Date.now())) return 'throttled';

      const outcome = await this.withTimeout(
        runReconcileAttempt(
          {
            db: this.db,
            registry: this.registry,
            outbox: this.outbox,
            logger: this.logger,
          },
          {
            paymentAttemptId: attempt.id,
            abandonPendingAfterMs: this.pendingAbandonMs(),
            expiryGraceMs: EXPIRY_GRACE_MS,
          },
        ),
      );

      if (outcome === 'error') return 'error';
      if (outcome === 'succeeded') {
        // Settling enqueued `payment.succeeded` (activation + notification).
        this.outbox.wakeupAfterCommit();
      }
      return outcome === 'succeeded' ||
        outcome === 'abandoned' ||
        outcome === 'failed' ||
        outcome === 'skipped'
        ? 'changed'
        : 'unchanged';
    } catch (err) {
      this.logger.warn(
        `On-demand check of ${paymentTransactionId} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'error';
    }
  }

  /** Resolves `'timeout'`-equivalent (`still_pending`) rather than holding the page read. */
  private async withTimeout<T extends string>(
    work: Promise<T>,
  ): Promise<T | 'still_pending'> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'still_pending'>((resolve) => {
      timer = setTimeout(() => resolve('still_pending'), ON_DEMAND_TIMEOUT_MS);
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private providers(): string[] {
    return this.configService.get<string[]>('payment.reconcileProviders') ?? [];
  }

  private pendingAbandonMs(): number {
    return (
      this.configService.get<number>('payment.pendingAbandonMs') ??
      15 * 60 * 1000
    );
  }
}

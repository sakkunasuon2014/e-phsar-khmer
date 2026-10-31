import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient, DbExecutor } from '../db/drizzle.provider';
import {
  subscriptionPackages,
  subscriptionPurchases,
  subscriptionTerms,
  userSubscriptions,
} from '../db/schema/subscriptions.schema';
import { users } from '../db/schema/users.schema';
import { EntitlementsService } from './entitlements.service';
import type { SupersededReason } from './subscription-status';

export interface PaidPurchaseSettlement {
  purchaseId: string;
  paymentTransactionId: string;
  customerId: string | null;
  amount: string;
  currency: string;
}

export type SubscriptionActivationResult =
  | { status: 'activated'; subscriptionId: string }
  | {
      status:
        | 'already_paid'
        | 'needs_refund'
        | 'not_found'
        | 'not_pending'
        | 'payment_link_pending'
        | 'payment_mismatch';
    };

interface OfferSnapshot {
  durationValue?: unknown;
  durationUnit?: unknown;
  subscriptionCategoryId?: unknown;
}

export function addDuration(
  from: Date,
  value: number,
  unit: 'day' | 'month' | 'year',
): Date {
  const result = new Date(from);
  if (unit === 'day') result.setDate(result.getDate() + value);
  else if (unit === 'month') result.setMonth(result.getMonth() + value);
  else result.setFullYear(result.getFullYear() + value);
  return result;
}

function toMinorUnits(value: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

function matchesSettlement(
  purchase: {
    userId: string;
    paymentTransactionId: string | null;
    amountUsd: string;
    currency: string;
  },
  settlement: PaidPurchaseSettlement,
): boolean {
  const expectedAmount = toMinorUnits(purchase.amountUsd);
  const settledAmount = toMinorUnits(settlement.amount);

  return (
    purchase.paymentTransactionId === settlement.paymentTransactionId &&
    settlement.customerId === purchase.userId &&
    expectedAmount !== null &&
    settledAmount !== null &&
    expectedAmount === settledAmount &&
    purchase.currency === settlement.currency
  );
}

function durationFromSnapshot(snapshot: unknown): {
  value: number;
  unit: 'day' | 'month' | 'year';
} {
  const offer = snapshot as OfferSnapshot | null;
  const value = offer?.durationValue;
  const unit = offer?.durationUnit;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    (unit !== 'day' && unit !== 'month' && unit !== 'year')
  ) {
    throw new BadRequestException(
      'Subscription purchase has invalid offer snapshot',
    );
  }
  return { value, unit };
}

export interface ActivationPlan {
  /** `null` = nothing left to grant; the payment needs a refund. */
  expiresAt: Date | null;
  supersede: { id: string; reason: SupersededReason }[];
  /** The purchase was priced against a subscription that has since changed. */
  needsReview: boolean;
}

/**
 * Decides what a settled purchase grants and which rows it retires. A user
 * holds at most one current (non-superseded) row per group, and `current` is
 * that group's rows only, so every one of them is superseded by the new one —
 * history stays as superseded rows, never deletes. Other groups are untouched.
 */
export function planActivation(input: {
  kind: 'initial' | 'upgrade' | 'manual_comp';
  replacesSubscriptionId: string | null;
  fullTermEnd: Date;
  current: { id: string; expiresAt: Date }[];
  baseExpiresAt: Date | null;
  now: Date;
}): ActivationPlan {
  const { kind, now, current } = input;
  const active = current
    .filter((row) => row.expiresAt > now)
    .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0];

  let expiresAt: Date | null;
  let needsReview = false;
  if (kind === 'manual_comp') {
    // An admin comp is a fresh grant, so it always starts a full term.
    expiresAt = input.fullTermEnd;
  } else if (kind === 'upgrade') {
    // Checkout prorated the price to the base's remaining time, so the
    // upgrade keeps that boundary.
    const fresh = !!active && active.id === input.replacesSubscriptionId;
    const base = input.baseExpiresAt;
    expiresAt = active?.expiresAt ?? (base && base > now ? base : null);
    needsReview = !fresh;
  } else {
    // Charged full price, so a full term — even if another plan became
    // active after checkout; that plan's remaining time is up for review.
    expiresAt = input.fullTermEnd;
    needsReview = !!active;
  }

  if (expiresAt === null) return { expiresAt, supersede: [], needsReview };
  return {
    expiresAt,
    supersede: current.map((row) => ({
      id: row.id,
      reason:
        row.expiresAt <= now
          ? 'expired'
          : kind === 'upgrade'
            ? 'upgrade'
            : 'replaced',
    })),
    needsReview,
  };
}

@Injectable()
export class SubscriptionActivationService {
  private readonly logger = new Logger(SubscriptionActivationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly entitlements: EntitlementsService,
  ) {}

  async activatePaidPurchase(
    settlement: PaidPurchaseSettlement,
  ): Promise<SubscriptionActivationResult> {
    const result = await this.db.transaction((tx) =>
      this.activatePurchaseInTx(tx, settlement.purchaseId, settlement),
    );
    if (result.status === 'activated' && settlement.customerId) {
      await this.entitlements.reconcileListingsSafely(settlement.customerId);
    }
    return result;
  }

  private async activatePurchaseInTx(
    tx: DbExecutor,
    purchaseId: string,
    settlement?: PaidPurchaseSettlement,
  ): Promise<SubscriptionActivationResult> {
    const [purchase] = await tx
      .select()
      .from(subscriptionPurchases)
      .where(eq(subscriptionPurchases.id, purchaseId))
      .for('update')
      .limit(1);

    if (!purchase) return { status: 'not_found' };
    if (purchase.status === 'paid') return { status: 'already_paid' };
    if (purchase.status !== 'pending') return { status: 'not_pending' };

    if (settlement) {
      if (!purchase.paymentTransactionId) {
        return { status: 'payment_link_pending' };
      }
      if (!matchesSettlement(purchase, settlement)) {
        return { status: 'payment_mismatch' };
      }
    } else if (purchase.kind !== 'manual_comp') {
      return { status: 'payment_mismatch' };
    }

    // Serialize activation of different purchases for one user, so concurrent
    // upgrades cannot both replace the same active subscription.
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, purchase.userId))
      .for('update');

    const duration = durationFromSnapshot(purchase.offerSnapshot);
    const groupId = await this.groupOf(tx, purchase);
    const now = new Date();
    // Only this group's current row is replaced; Auto and Property coexist.
    const current = await tx
      .select({
        id: userSubscriptions.id,
        expiresAt: userSubscriptions.expiresAt,
      })
      .from(userSubscriptions)
      .where(
        and(
          eq(userSubscriptions.userId, purchase.userId),
          isNull(userSubscriptions.supersededAt),
          groupId
            ? eq(userSubscriptions.subscriptionCategoryId, groupId)
            : isNull(userSubscriptions.subscriptionCategoryId),
        ),
      );

    // A stale upgrade whose base is no longer current (revoked, or replaced
    // by another purchase) still owes the payer the period it was priced on.
    let baseExpiresAt: Date | null = null;
    if (
      purchase.replacesSubscriptionId &&
      !current.some((row) => row.id === purchase.replacesSubscriptionId)
    ) {
      const [base] = await tx
        .select({ expiresAt: userSubscriptions.expiresAt })
        .from(userSubscriptions)
        .where(eq(userSubscriptions.id, purchase.replacesSubscriptionId))
        .limit(1);
      baseExpiresAt = base?.expiresAt ?? null;
    }

    const plan = planActivation({
      kind: purchase.kind,
      replacesSubscriptionId: purchase.replacesSubscriptionId,
      fullTermEnd: addDuration(now, duration.value, duration.unit),
      current,
      baseExpiresAt,
      now,
    });

    if (plan.expiresAt === null) {
      // Nothing is left to grant for what was paid; keep the money visible
      // for a refund instead of inventing a period nobody priced.
      await tx
        .update(subscriptionPurchases)
        .set({ status: 'paid', paidAt: now, refundRequestedAt: now })
        .where(eq(subscriptionPurchases.id, purchase.id));
      this.logger.warn(
        `Purchase ${purchase.id} settled after its upgrade base lapsed — flagged for refund`,
      );
      return { status: 'needs_refund' };
    }

    for (const row of plan.supersede) {
      await tx
        .update(userSubscriptions)
        .set({ supersededAt: now, supersededReason: row.reason })
        .where(
          and(
            eq(userSubscriptions.id, row.id),
            isNull(userSubscriptions.supersededAt),
          ),
        );
    }

    const [subscription] = await tx
      .insert(userSubscriptions)
      .values({
        userId: purchase.userId,
        termId: purchase.termId,
        subscriptionCategoryId: groupId,
        priceUsd: purchase.amountUsd,
        paymentMethod: purchase.kind === 'manual_comp' ? 'comp' : 'bakong',
        subscribedAt: now,
        expiresAt: plan.expiresAt,
      })
      .returning({ id: userSubscriptions.id });

    await tx
      .update(subscriptionPurchases)
      .set({
        status: 'paid',
        paidAt: now,
        subscriptionId: subscription.id,
        ...(plan.needsReview ? { refundRequestedAt: now } : {}),
      })
      .where(eq(subscriptionPurchases.id, purchase.id));

    if (plan.needsReview) {
      this.logger.warn(
        `Purchase ${purchase.id} settled against a subscription that changed since checkout — flagged for review`,
      );
    }

    return { status: 'activated', subscriptionId: subscription.id };
  }

  /**
   * The group a purchase belongs to: frozen in its offer snapshot at checkout,
   * else (older purchases) derived through its term. Null only when neither
   * survives — that subscription then covers no subcategory.
   */
  private async groupOf(
    tx: DbExecutor,
    purchase: { offerSnapshot: unknown; termId: string | null },
  ): Promise<string | null> {
    const frozen = (purchase.offerSnapshot as OfferSnapshot | null)
      ?.subscriptionCategoryId;
    if (typeof frozen === 'string') return frozen;
    if (!purchase.termId) return null;
    const [row] = await tx
      .select({ groupId: subscriptionPackages.categoryId })
      .from(subscriptionTerms)
      .innerJoin(
        subscriptionPackages,
        eq(subscriptionPackages.id, subscriptionTerms.packageId),
      )
      .where(eq(subscriptionTerms.id, purchase.termId))
      .limit(1);
    return row?.groupId ?? null;
  }

  async grantManual(input: {
    userId: string;
    termId: string;
    reason: string;
  }): Promise<{ id: string }> {
    const granted = await this.db.transaction(async (tx) => {
      const [term] = await tx
        .select()
        .from(subscriptionTerms)
        .where(eq(subscriptionTerms.id, input.termId))
        .limit(1);
      if (!term) throw new NotFoundException('Subscription term not found');

      const [pkg] = await tx
        .select({
          id: subscriptionPackages.id,
          name: subscriptionPackages.name,
          photos: subscriptionPackages.photos,
          ads: subscriptionPackages.ads,
          renews: subscriptionPackages.renews,
          autoRenews: subscriptionPackages.autoRenews,
          videos: subscriptionPackages.videos,
          subscriptionCategoryId: subscriptionPackages.categoryId,
        })
        .from(subscriptionPackages)
        .where(eq(subscriptionPackages.id, term.packageId))
        .limit(1);
      if (!pkg) throw new NotFoundException('Subscription package not found');

      const [purchase] = await tx
        .insert(subscriptionPurchases)
        .values({
          userId: input.userId,
          termId: term.id,
          kind: 'manual_comp',
          status: 'pending',
          amountUsd: '0',
          currency: 'USD',
          offerSnapshot: {
            termId: term.id,
            termName: term.name,
            durationValue: term.durationValue,
            durationUnit: term.durationUnit,
            packageId: pkg.id,
            packageName: pkg.name,
            subscriptionCategoryId: pkg.subscriptionCategoryId,
            photos: pkg.photos,
            ads: pkg.ads,
            renews: pkg.renews,
            autoRenews: pkg.autoRenews,
            videos: pkg.videos,
            reason: input.reason,
          },
        })
        .returning({ id: subscriptionPurchases.id });

      const activation = await this.activatePurchaseInTx(tx, purchase.id);
      if (activation.status !== 'activated') {
        throw new Error(
          `Manual subscription grant failed: ${activation.status}`,
        );
      }
      return { id: activation.subscriptionId };
    });
    await this.entitlements.reconcileListingsSafely(input.userId);
    return granted;
  }
}

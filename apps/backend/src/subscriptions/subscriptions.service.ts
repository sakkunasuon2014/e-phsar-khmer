import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gt, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../db/drizzle.provider';
import type { DbClient } from '../db/drizzle.provider';
import {
  subscriptionCategories,
  subscriptionPackages,
  subscriptionPurchases,
  subscriptionTerms,
  userSubscriptions,
} from '../db/schema/subscriptions.schema';
import { paymentTransactions } from '../payment/entity/payment-transaction';
import { PaymentEffectRunner } from '../payment/payment-effect-runner.service';
import { PaymentGatewayRegistry } from '../payment/providers';
import { createPaymentTransaction } from '../payment/use-cases';
import { CreateSubscriptionCheckoutDto } from './dto/create-subscription-checkout.dto';
import { addDuration } from './subscription-activation.service';
import { subscriptionStatus } from './subscription-status';

function calculatePrice(
  price: string,
  discount: string,
  discountType: 'percent' | 'amount',
): string {
  const base = Number(price);
  const value = Number(discount);
  const result =
    discountType === 'percent' ? base * (1 - value / 100) : base - value;
  return Math.max(0, Math.round(result * 100) / 100).toFixed(2);
}

function calculateUpgradeCredit(
  subscription: {
    priceUsd: string;
    subscribedAt: Date;
    expiresAt: Date;
  },
  now: Date,
): string {
  const total =
    subscription.expiresAt.getTime() - subscription.subscribedAt.getTime();
  const remaining = Math.max(
    0,
    subscription.expiresAt.getTime() - now.getTime(),
  );
  if (total <= 0 || remaining <= 0) return '0.00';
  return Math.max(
    0,
    Math.round(((Number(subscription.priceUsd) * remaining) / total) * 100) /
      100,
  ).toFixed(2);
}

// An upgrade keeps the current expiry, so the target plan is only charged for
// the time that is left: its full term price scaled by remaining / term length.
function prorateToRemaining(
  fullPrice: string,
  term: { durationValue: number; durationUnit: 'day' | 'month' | 'year' },
  expiresAt: Date,
  now: Date,
): string {
  const termMs =
    addDuration(now, term.durationValue, term.durationUnit).getTime() -
    now.getTime();
  const remainingMs = expiresAt.getTime() - now.getTime();
  if (termMs <= 0 || remainingMs >= termMs) return fullPrice;
  return Math.max(
    0,
    Math.round(((Number(fullPrice) * remainingMs) / termMs) * 100) / 100,
  ).toFixed(2);
}

@Injectable()
export class SubscriptionsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly paymentRunner: PaymentEffectRunner,
    private readonly gateways: PaymentGatewayRegistry,
  ) {}

  async catalog() {
    return this.db
      .select({
        groupId: subscriptionCategories.id,
        groupName: subscriptionCategories.name,
        groupSlug: subscriptionCategories.slug,
        groupDescription: subscriptionCategories.description,
        packageId: subscriptionPackages.id,
        packageName: subscriptionPackages.name,
        termId: subscriptionTerms.id,
        termName: subscriptionTerms.name,
        durationValue: subscriptionTerms.durationValue,
        durationUnit: subscriptionTerms.durationUnit,
        price: subscriptionTerms.price,
        discount: subscriptionTerms.discount,
        discountType: subscriptionTerms.discountType,
        photos: subscriptionPackages.photos,
        ads: subscriptionPackages.ads,
        renews: subscriptionPackages.renews,
        autoRenews: subscriptionPackages.autoRenews,
        videos: subscriptionPackages.videos,
      })
      .from(subscriptionCategories)
      .innerJoin(
        subscriptionPackages,
        and(
          eq(subscriptionPackages.categoryId, subscriptionCategories.id),
          eq(subscriptionPackages.isActive, true),
        ),
      )
      .innerJoin(
        subscriptionTerms,
        and(
          eq(subscriptionTerms.packageId, subscriptionPackages.id),
          eq(subscriptionTerms.isActive, true),
        ),
      )
      .where(eq(subscriptionCategories.isActive, true))
      .orderBy(
        asc(subscriptionCategories.sortOrder),
        asc(subscriptionPackages.sortOrder),
        asc(subscriptionTerms.sortOrder),
      );
  }

  async mine(userId: string) {
    const rows = await this.db
      .select({
        id: userSubscriptions.id,
        termId: userSubscriptions.termId,
        termName: subscriptionTerms.name,
        groupId: userSubscriptions.subscriptionCategoryId,
        groupName: subscriptionCategories.name,
        packageName: subscriptionPackages.name,
        photos: subscriptionPackages.photos,
        ads: subscriptionPackages.ads,
        renews: subscriptionPackages.renews,
        autoRenews: subscriptionPackages.autoRenews,
        videos: subscriptionPackages.videos,
        priceUsd: userSubscriptions.priceUsd,
        subscribedAt: userSubscriptions.subscribedAt,
        expiresAt: userSubscriptions.expiresAt,
        supersededAt: userSubscriptions.supersededAt,
        supersededReason: userSubscriptions.supersededReason,
        purchaseId: subscriptionPurchases.id,
        offerSnapshot: subscriptionPurchases.offerSnapshot,
      })
      .from(userSubscriptions)
      .leftJoin(
        subscriptionTerms,
        eq(subscriptionTerms.id, userSubscriptions.termId),
      )
      .leftJoin(
        subscriptionPackages,
        eq(subscriptionPackages.id, subscriptionTerms.packageId),
      )
      .leftJoin(
        subscriptionCategories,
        eq(subscriptionCategories.id, userSubscriptions.subscriptionCategoryId),
      )
      .leftJoin(
        subscriptionPurchases,
        eq(subscriptionPurchases.subscriptionId, userSubscriptions.id),
      )
      .where(eq(userSubscriptions.userId, userId))
      .orderBy(desc(userSubscriptions.subscribedAt));

    const now = Date.now();
    return rows.map((row) => {
      const snapshot = row.offerSnapshot as Record<string, unknown> | null;
      const snapshotNumber = (key: string, fallback: number | null) =>
        typeof snapshot?.[key] === 'number' ? snapshot[key] : (fallback ?? 0);
      const snapshotString = (key: string, fallback: string | null) =>
        typeof snapshot?.[key] === 'string' ? snapshot[key] : fallback;

      return {
        id: row.id,
        purchaseId: row.purchaseId,
        termId: row.termId,
        termName: snapshotString('termName', row.termName),
        groupId: row.groupId,
        groupName: row.groupName,
        packageName: snapshotString('packageName', row.packageName),
        photos: snapshotNumber('photos', row.photos),
        ads: snapshotNumber('ads', row.ads),
        renews: snapshotNumber('renews', row.renews),
        autoRenews: snapshotNumber('autoRenews', row.autoRenews),
        videos: snapshotNumber('videos', row.videos),
        priceUsd: row.priceUsd,
        subscribedAt: row.subscribedAt,
        expiresAt: row.expiresAt,
        status: subscriptionStatus(row, now),
      };
    });
  }

  async checkout(
    userId: string,
    dto: CreateSubscriptionCheckoutDto,
  ): Promise<{
    purchaseId: string;
    paymentTransactionId: string;
    amount: string;
    currency: string;
  }> {
    // Refuse up front: an unconfigured provider's charge() only fails later,
    // inside the queue, leaving the payer watching a QR that never comes.
    const provider = dto.provider ?? 'bakong';
    if (!this.gateways.isAvailable(provider)) {
      throw new BadRequestException(
        'This payment method is not available right now',
      );
    }

    let purchase = await this.findPurchaseByIdempotencyKey(
      userId,
      dto.idempotencyKey,
    );

    if (!purchase) {
      const [term] = await this.db
        .select({
          id: subscriptionTerms.id,
          name: subscriptionTerms.name,
          durationValue: subscriptionTerms.durationValue,
          durationUnit: subscriptionTerms.durationUnit,
          price: subscriptionTerms.price,
          discount: subscriptionTerms.discount,
          discountType: subscriptionTerms.discountType,
          packageId: subscriptionPackages.id,
          packageName: subscriptionPackages.name,
          photos: subscriptionPackages.photos,
          ads: subscriptionPackages.ads,
          renews: subscriptionPackages.renews,
          autoRenews: subscriptionPackages.autoRenews,
          videos: subscriptionPackages.videos,
          subscriptionCategoryId: subscriptionPackages.categoryId,
        })
        .from(subscriptionTerms)
        .innerJoin(
          subscriptionPackages,
          eq(subscriptionPackages.id, subscriptionTerms.packageId),
        )
        .innerJoin(
          subscriptionCategories,
          eq(subscriptionCategories.id, subscriptionPackages.categoryId),
        )
        .where(
          and(
            eq(subscriptionTerms.id, dto.termId),
            eq(subscriptionTerms.isActive, true),
            eq(subscriptionPackages.isActive, true),
            eq(subscriptionCategories.isActive, true),
          ),
        )
        .limit(1);
      if (!term) throw new NotFoundException('Subscription term not found');

      const targetPrice = calculatePrice(
        term.price,
        term.discount,
        term.discountType,
      );
      const now = new Date();
      // Buying in a group you already hold is an upgrade of that group's
      // subscription; any other group is a fresh, side-by-side purchase.
      const [active] = await this.db
        .select()
        .from(userSubscriptions)
        .where(
          and(
            eq(userSubscriptions.userId, userId),
            eq(
              userSubscriptions.subscriptionCategoryId,
              term.subscriptionCategoryId,
            ),
            isNull(userSubscriptions.supersededAt),
            gt(userSubscriptions.expiresAt, now),
          ),
        )
        .orderBy(desc(userSubscriptions.expiresAt))
        .limit(1);
      const credit = active ? calculateUpgradeCredit(active, now) : '0.00';
      const dueBeforeCredit = active
        ? prorateToRemaining(targetPrice, term, active.expiresAt, now)
        : targetPrice;
      const amount = Math.max(
        0,
        Number(dueBeforeCredit) - Number(credit),
      ).toFixed(2);
      if (Number(amount) <= 0) {
        throw new BadRequestException(
          'The upgrade has no positive balance to collect',
        );
      }

      try {
        const [created] = await this.db
          .insert(subscriptionPurchases)
          .values({
            userId,
            termId: term.id,
            kind: active ? 'upgrade' : 'initial',
            amountUsd: amount,
            creditUsd: credit,
            currency: 'USD',
            offerSnapshot: {
              ...term,
              targetPrice,
              proratedPrice: dueBeforeCredit,
              creditUsd: credit,
              calculatedAt: now.toISOString(),
            },
            idempotencyKey: dto.idempotencyKey,
            replacesSubscriptionId: active?.id ?? null,
          })
          .returning({ id: subscriptionPurchases.id });
        purchase = await this.findPurchase(created.id);
      } catch (error) {
        if (!this.isUniqueViolation(error)) throw error;
        purchase = await this.findPurchaseByIdempotencyKey(
          userId,
          dto.idempotencyKey,
        );
        if (!purchase) {
          throw new ConflictException('Idempotency key is already in use');
        }
      }
    }

    if (!purchase) throw new ConflictException('Checkout could not be created');
    if (purchase.termId !== dto.termId) {
      throw new ConflictException('Idempotency key was used for another offer');
    }
    if (purchase.status !== 'pending' && !purchase.paymentTransactionId) {
      throw new ConflictException('Checkout is no longer retryable');
    }

    const paymentTransactionId =
      purchase.paymentTransactionId ??
      (await this.reservePaymentTransactionId(purchase.id));
    const existingPayment =
      await this.findPaymentTransaction(paymentTransactionId);
    if (existingPayment) {
      // A dead payment can never settle, so close the purchase instead of
      // leaving it pending forever; the client starts over with a new key.
      if (['failed', 'cancelled', 'expired'].includes(existingPayment.status)) {
        await this.db
          .update(subscriptionPurchases)
          .set({ status: 'failed' })
          .where(
            and(
              eq(subscriptionPurchases.id, purchase.id),
              eq(subscriptionPurchases.status, 'pending'),
            ),
          );
        throw new ConflictException(
          'This payment did not complete. Start a new checkout.',
        );
      }
      return {
        purchaseId: purchase.id,
        paymentTransactionId,
        amount: purchase.amountUsd,
        currency: purchase.currency,
      };
    }

    try {
      const payment = await this.paymentRunner.runDurably((outbox) =>
        createPaymentTransaction(outbox, {
          transactionId: paymentTransactionId,
          reference: `subscription:${purchase.id}`,
          idempotencyKey: `subscription-payment:${dto.idempotencyKey}`,
          amount: purchase.amountUsd,
          currency: purchase.currency,
          customerId: userId,
          orderId: purchase.id,
          description: `Subscription purchase ${purchase.id}`,
          provider,
          method: dto.method ?? 'bank',
        }),
      );

      return {
        purchaseId: purchase.id,
        paymentTransactionId: payment.transaction.id,
        amount: purchase.amountUsd,
        currency: purchase.currency,
      };
    } catch (error) {
      // A retry can observe a committed transaction even if the first request
      // lost its response after commit. Reuse it instead of creating a second
      // payment or stranding the purchase.
      try {
        if (await this.findPaymentTransaction(paymentTransactionId)) {
          return {
            purchaseId: purchase.id,
            paymentTransactionId,
            amount: purchase.amountUsd,
            currency: purchase.currency,
          };
        }
      } catch {
        // Keep the original failure; the next idempotent request can recover.
      }
      throw error;
    }
  }

  private async findPurchaseByIdempotencyKey(userId: string, key: string) {
    const [purchase] = await this.db
      .select({
        id: subscriptionPurchases.id,
        termId: subscriptionPurchases.termId,
        paymentTransactionId: subscriptionPurchases.paymentTransactionId,
        status: subscriptionPurchases.status,
        amountUsd: subscriptionPurchases.amountUsd,
        currency: subscriptionPurchases.currency,
      })
      .from(subscriptionPurchases)
      .where(
        and(
          eq(subscriptionPurchases.userId, userId),
          eq(subscriptionPurchases.idempotencyKey, key),
        ),
      )
      .limit(1);
    return purchase;
  }

  private async findPurchase(id: string) {
    const [purchase] = await this.db
      .select({
        id: subscriptionPurchases.id,
        termId: subscriptionPurchases.termId,
        paymentTransactionId: subscriptionPurchases.paymentTransactionId,
        status: subscriptionPurchases.status,
        amountUsd: subscriptionPurchases.amountUsd,
        currency: subscriptionPurchases.currency,
      })
      .from(subscriptionPurchases)
      .where(eq(subscriptionPurchases.id, id))
      .limit(1);
    return purchase;
  }

  private async reservePaymentTransactionId(purchaseId: string) {
    const candidate = randomUUID();
    const [updated] = await this.db
      .update(subscriptionPurchases)
      .set({ paymentTransactionId: candidate })
      .where(
        and(
          eq(subscriptionPurchases.id, purchaseId),
          eq(subscriptionPurchases.status, 'pending'),
          isNull(subscriptionPurchases.paymentTransactionId),
        ),
      )
      .returning({
        paymentTransactionId: subscriptionPurchases.paymentTransactionId,
      });
    if (updated?.paymentTransactionId) return updated.paymentTransactionId;

    const current = await this.findPurchase(purchaseId);
    if (current?.paymentTransactionId) return current.paymentTransactionId;
    throw new ConflictException('Checkout is already processing');
  }

  private async findPaymentTransaction(id: string) {
    const [transaction] = await this.db
      .select({
        id: paymentTransactions.id,
        status: paymentTransactions.status,
      })
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, id))
      .limit(1);
    return transaction;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
    );
  }
}

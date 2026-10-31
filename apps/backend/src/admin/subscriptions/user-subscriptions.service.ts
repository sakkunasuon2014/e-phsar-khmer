import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE } from '../../db/drizzle.provider';
import type { DbClient } from '../../db/drizzle.provider';
import { users } from '../../db/schema/users.schema';
import {
  subscriptionCategories,
  subscriptionPackages,
  subscriptionTerms,
  userSubscriptions,
} from '../../db/schema/subscriptions.schema';
import type { GrantSubscriptionDto } from './dto/grant-subscription.dto';
import { EntitlementsService } from '../../subscriptions/entitlements.service';
import { SubscriptionActivationService } from '../../subscriptions/subscription-activation.service';
import { subscriptionStatus } from '../../subscriptions/subscription-status';
import type {
  SubscriptionStatus,
  SupersededReason,
} from '../../subscriptions/subscription-status';

export interface UserSubscriptionView {
  id: string;
  userId: string;
  accountId: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** The subscription category row this plan belongs to (the tab key). */
  subscriptionCategoryId: string | null;
  group: string | null;
  totalAds: number;
  totalRenew: number;
  autoRenew: number;
  /** The purchased duration (e.g. "6 Months"). */
  term: string | null;
  price: string;
  paymentMethod: string | null;
  subscribedAt: Date;
  expiresAt: Date;
  supersededAt: Date | null;
  supersededReason: SupersededReason | null;
  status: SubscriptionStatus;
}

@Injectable()
export class UserSubscriptionsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DbClient,
    private readonly activation: SubscriptionActivationService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /**
   * Current rows only (one per user per group) unless `history` is set, which adds
   * every superseded row — upgrades, replacements, revokes.
   */
  async list(history = false): Promise<UserSubscriptionView[]> {
    const rows = await this.db
      .select({
        id: userSubscriptions.id,
        userId: userSubscriptions.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        username: users.username,
        email: users.email,
        phone: users.primaryPhone,
        subscriptionCategoryId: userSubscriptions.subscriptionCategoryId,
        group: subscriptionCategories.name,
        ads: subscriptionPackages.ads,
        renews: subscriptionPackages.renews,
        autoRenews: subscriptionPackages.autoRenews,
        termName: subscriptionTerms.name,
        price: userSubscriptions.priceUsd,
        paymentMethod: userSubscriptions.paymentMethod,
        subscribedAt: userSubscriptions.subscribedAt,
        expiresAt: userSubscriptions.expiresAt,
        supersededAt: userSubscriptions.supersededAt,
        supersededReason: userSubscriptions.supersededReason,
      })
      .from(userSubscriptions)
      .innerJoin(users, eq(users.id, userSubscriptions.userId))
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
      .where(history ? undefined : isNull(userSubscriptions.supersededAt))
      .orderBy(desc(userSubscriptions.subscribedAt));

    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      accountId: r.userId.slice(0, 8),
      name:
        [r.firstName, r.lastName].filter(Boolean).join(' ') ||
        r.username ||
        'Unknown',
      email: r.email,
      phone: r.phone,
      subscriptionCategoryId: r.subscriptionCategoryId,
      group: r.group,
      totalAds: r.ads ?? 0,
      totalRenew: r.renews ?? 0,
      autoRenew: r.autoRenews ?? 0,
      term: r.termName,
      price: r.price,
      paymentMethod: r.paymentMethod,
      subscribedAt: r.subscribedAt,
      expiresAt: r.expiresAt,
      supersededAt: r.supersededAt,
      supersededReason: r.supersededReason,
      status: subscriptionStatus(r, now),
    }));
  }

  async grant(dto: GrantSubscriptionDto): Promise<{ id: string }> {
    const [term] = await this.db
      .select()
      .from(subscriptionTerms)
      .where(eq(subscriptionTerms.id, dto.termId))
      .limit(1);
    if (!term) throw new NotFoundException('Term not found');
    if (!term.isActive) {
      throw new BadRequestException(
        'This term is retired. Pick an active 3, 6 or 12-month term.',
      );
    }

    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, dto.userId))
      .limit(1);
    if (!user) throw new NotFoundException('User not found');

    return this.activation.grantManual({
      userId: dto.userId,
      termId: dto.termId,
      reason: dto.paymentMethod ?? 'Admin grant',
    });
  }

  /**
   * Ends a user's current subscription without deleting it: the row stays as
   * history (and keeps its purchase link), marked `revoked`.
   */
  async revoke(id: string): Promise<{ id: string }> {
    const [row] = await this.db
      .update(userSubscriptions)
      .set({ supersededAt: new Date(), supersededReason: 'revoked' })
      .where(
        and(
          eq(userSubscriptions.id, id),
          isNull(userSubscriptions.supersededAt),
        ),
      )
      .returning({ userId: userSubscriptions.userId });
    if (!row) {
      const [exists] = await this.db
        .select({ id: userSubscriptions.id })
        .from(userSubscriptions)
        .where(eq(userSubscriptions.id, id))
        .limit(1);
      if (!exists) throw new NotFoundException('Subscription not found');
      throw new ConflictException('Subscription is no longer current');
    }
    // The plan just changed under the user's ads.
    await this.entitlements.reconcileListingsSafely(row.userId);
    return { id };
  }
}

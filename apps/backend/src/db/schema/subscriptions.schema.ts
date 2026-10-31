import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.schema';
import { discountTypeEnum, listings } from './listings.schema';
import { categories, subcategories } from './categories.schema';

/** Why a `user_subscriptions` row stopped being current (TS-only column type). */
export type SupersededReason = 'upgrade' | 'replaced' | 'expired' | 'revoked';

export const subscriptionDurationUnitEnum = pgEnum(
  'subscription_duration_unit',
  ['day', 'month', 'year'],
);

/**
 * The fixed package tiers a group can sell. The label is global; the limits
 * (photos/ads/renews/…) live on the (group, tier) package row.
 */
export const subscriptionTierEnum = pgEnum('subscription_tier', [
  'bronze',
  'silver',
  'gold',
]);

export const subscriptionPurchaseStatusEnum = pgEnum(
  'subscription_purchase_status',
  ['pending', 'paid', 'failed', 'cancelled', 'refunded'],
);

export const subscriptionPurchaseKindEnum = pgEnum(
  'subscription_purchase_kind',
  ['initial', 'upgrade', 'manual_comp'],
);

export const subscriptionCategories = pgTable('subscription_categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  slug: varchar('slug', { length: 120 }).unique().notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/**
 * What a subscription category (a "group" — General, Property, Auto…) covers:
 * the listing subcategories whose ads count against that group's allowance.
 * Admin-managed. A subcategory sits in at most one group, so every ad has
 * exactly one allowance; a subcategory in no group falls to the free plan.
 */
export const subscriptionCategorySubcategories = pgTable(
  'subscription_category_subcategories',
  {
    subscriptionCategoryId: uuid('subscription_category_id')
      .notNull()
      .references(() => subscriptionCategories.id, { onDelete: 'cascade' }),
    subcategoryId: uuid('subcategory_id')
      .notNull()
      .references(() => subcategories.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.subscriptionCategoryId, t.subcategoryId] }),
    uniqueIndex('subscription_category_subcategories_subcategory_uq').on(
      t.subcategoryId,
    ),
  ],
);

export const subscriptionPackages = pgTable(
  'subscription_packages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // The group this tier belongs to; deleting the group removes its offers.
    categoryId: uuid('category_id')
      .notNull()
      .references(() => subscriptionCategories.id, { onDelete: 'cascade' }),
    tier: subscriptionTierEnum('tier').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    photos: integer('photos').default(0).notNull(),
    ads: integer('ads').default(0).notNull(),
    renews: integer('renews').default(0).notNull(),
    autoRenews: integer('auto_renews').default(0).notNull(),
    videos: integer('videos').default(0).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('subscription_packages_category_id_idx').on(t.categoryId),
    // One package per tier per group: a group sells at most one Bronze.
    uniqueIndex('subscription_packages_category_tier_uq').on(
      t.categoryId,
      t.tier,
    ),
  ],
);

export const subscriptionTerms = pgTable(
  'subscription_terms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    packageId: uuid('package_id')
      .notNull()
      .references(() => subscriptionPackages.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    durationValue: integer('duration_value').default(1).notNull(),
    durationUnit: subscriptionDurationUnitEnum('duration_unit')
      .default('month')
      .notNull(),
    price: numeric('price', { precision: 10, scale: 2 }).default('0').notNull(),
    discount: numeric('discount', { precision: 10, scale: 2 })
      .default('0')
      .notNull(),
    discountType: discountTypeEnum('discount_type').default('amount').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('subscription_terms_package_id_idx').on(t.packageId)],
);

export const userSubscriptions = pgTable(
  'user_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    termId: uuid('term_id').references(() => subscriptionTerms.id, {
      onDelete: 'set null',
    }),
    // The group this subscription belongs to, fixed at activation. Stored
    // rather than derived through the term, which goes null if deleted.
    subscriptionCategoryId: uuid('subscription_category_id').references(
      () => subscriptionCategories.id,
      { onDelete: 'set null' },
    ),
    priceUsd: numeric('price_usd', { precision: 10, scale: 2 })
      .default('0')
      .notNull(),
    paymentMethod: varchar('payment_method', { length: 40 }),
    subscribedAt: timestamp('subscribed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    supersededReason: varchar('superseded_reason', {
      length: 40,
    }).$type<SupersededReason>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('user_subscriptions_user_id_idx').on(t.userId),
    index('user_subscriptions_expires_at_idx').on(t.expiresAt),
    index('user_subscriptions_active_idx')
      .on(t.userId, t.expiresAt)
      .where(sql`${t.supersededAt} is null`),
    // At most one current row per user per group: an upgrade, renewal or
    // revoke supersedes the old row (history) instead of adding a second live
    // one. Different groups (Auto and Property) are held side by side.
    uniqueIndex('user_subscriptions_one_current_per_group_uq')
      .on(t.userId, t.subscriptionCategoryId)
      .where(sql`${t.supersededAt} is null`),
  ],
);

/** The free plan's account-wide limits. Exactly one row (id = 1). */
export const freePlanSettings = pgTable(
  'free_plan_settings',
  {
    id: integer('id').primaryKey().default(1),
    photos: integer('photos').default(0).notNull(),
    renews: integer('renews').default(0).notNull(),
    autoRenews: integer('auto_renews').default(0).notNull(),
    videos: integer('videos').default(0).notNull(),
    /** Ads allowed across every subcategory with no group or cap of its own. */
    otherAds: integer('other_ads').default(0).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [check('free_plan_settings_singleton', sql`${t.id} = 1`)],
);

/**
 * Free-plan ad caps for one listing category or one subcategory ("Cars for
 * sale: 2", "Foods: 50"). A subcategory cap beats its category's cap; ads
 * matching neither share `free_plan_settings.other_ads`.
 */
export const freePlanAdLimits = pgTable(
  'free_plan_ad_limits',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    categoryId: uuid('category_id').references(() => categories.id, {
      onDelete: 'cascade',
    }),
    subcategoryId: uuid('subcategory_id').references(() => subcategories.id, {
      onDelete: 'cascade',
    }),
    ads: integer('ads').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check(
      'free_plan_ad_limits_one_scope',
      sql`(${t.categoryId} is null) <> (${t.subcategoryId} is null)`,
    ),
    check('free_plan_ad_limits_ads_nonnegative', sql`${t.ads} >= 0`),
    uniqueIndex('free_plan_ad_limits_category_uq')
      .on(t.categoryId)
      .where(sql`${t.categoryId} is not null`),
    uniqueIndex('free_plan_ad_limits_subcategory_uq')
      .on(t.subcategoryId)
      .where(sql`${t.subcategoryId} is not null`),
  ],
);

export const subscriptionPurchases = pgTable(
  'subscription_purchases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    termId: uuid('term_id').references(() => subscriptionTerms.id, {
      onDelete: 'set null',
    }),
    paymentTransactionId: uuid('payment_transaction_id').unique(),
    kind: subscriptionPurchaseKindEnum('kind').default('initial').notNull(),
    status: subscriptionPurchaseStatusEnum('status')
      .default('pending')
      .notNull(),
    amountUsd: numeric('amount_usd', { precision: 10, scale: 2 }).notNull(),
    creditUsd: numeric('credit_usd', { precision: 10, scale: 2 })
      .default('0')
      .notNull(),
    currency: varchar('currency', { length: 3 }).default('USD').notNull(),
    offerSnapshot: jsonb('offer_snapshot').notNull(),
    replacesSubscriptionId: uuid('replaces_subscription_id').references(
      () => userSubscriptions.id,
      { onDelete: 'set null' },
    ),
    subscriptionId: uuid('subscription_id').references(
      () => userSubscriptions.id,
      { onDelete: 'set null' },
    ),
    idempotencyKey: varchar('idempotency_key', { length: 200 }).unique(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    refundRequestedAt: timestamp('refund_requested_at', {
      withTimezone: true,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('subscription_purchases_user_idx').on(t.userId, t.createdAt),
    index('subscription_purchases_status_idx').on(t.status, t.createdAt),
  ],
);

/**
 * One row per renewal spent. `listings.renew_count` is the ad's lifetime
 * count; a plan's renews reset on a rolling window, so the allowance reads
 * this log instead. Cascades with the listing (a deleted ad's renewals stop
 * counting, matching the live-inventory model) and with the user.
 */
export const listingRenewals = pgTable(
  'listing_renewals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    renewedAt: timestamp('renewed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('listing_renewals_user_window_idx').on(t.userId, t.renewedAt)],
);

export type SubscriptionCategoryRow =
  typeof subscriptionCategories.$inferSelect;
export type SubscriptionPackageRow = typeof subscriptionPackages.$inferSelect;
export type SubscriptionTermRow = typeof subscriptionTerms.$inferSelect;
export type UserSubscriptionRow = typeof userSubscriptions.$inferSelect;
export type SubscriptionPurchaseRow = typeof subscriptionPurchases.$inferSelect;
export type FreePlanSettingsRow = typeof freePlanSettings.$inferSelect;
export type FreePlanAdLimitRow = typeof freePlanAdLimits.$inferSelect;
export type ListingRenewalRow = typeof listingRenewals.$inferSelect;

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { categories, subcategories } from './categories.schema';
import { models } from './brands.schema';
import { communes, districts, provinces, users } from './users.schema';

export const listingStatusEnum = pgEnum('listing_status', [
  'draft',
  'active',
  'expired',
  'deleted',
  // Hidden from public browsing because the owner is over their plan's ad
  // limit (e.g. the subscription lapsed). Reversible: reconciliation flips it
  // back to 'active' once the owner's allowance covers it again.
  'restricted',
]);
export const discountTypeEnum = pgEnum('discount_type', ['percent', 'amount']);
export const listingConditionEnum = pgEnum('listing_condition', [
  'new',
  'used',
]);

export const listings = pgTable(
  'listings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id),
    subcategoryId: uuid('subcategory_id')
      .notNull()
      .references(() => subcategories.id),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    price: numeric('price', { precision: 14, scale: 2 }),
    currency: varchar('currency', { length: 3 }).default('USD').notNull(),
    discountValue: numeric('discount_value', { precision: 14, scale: 2 }),
    discountType: discountTypeEnum('discount_type'),
    condition: listingConditionEnum('condition'),
    attributes: jsonb('attributes')
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    location: varchar('location', { length: 150 }),
    address: text('address'),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    // RESTRICT, not SET NULL/CASCADE: location is a search-critical field, and
    // silently nulling a listing's geo reference on a geography re-seed would
    // quietly drop it out of province/district filters. A blocked delete is a
    // loud, fixable failure; silent data loss is not. (Companion change to the
    // 0017 geography seed.)
    provinceId: uuid('province_id').references(() => provinces.id, {
      onDelete: 'restrict',
    }),
    districtId: uuid('district_id').references(() => districts.id, {
      onDelete: 'restrict',
    }),
    communeId: uuid('commune_id').references(() => communes.id, {
      onDelete: 'restrict',
    }),
    // The trusted spec page this ad renders ("View full specs"). Nullable:
    // every pre-existing listing has none, and the link is optional at the DB
    // level — the phones form is what makes it required. SET NULL on model
    // deletion so a catalogue cleanup never blocks on live ads.
    productModelId: uuid('product_model_id').references(() => models.id, {
      onDelete: 'set null',
    }),
    deliveryFree: boolean('delivery_free').default(false).notNull(),
    contactName: varchar('contact_name', { length: 150 }),
    contactPhones: jsonb('contact_phones')
      .$type<string[]>()
      .default([])
      .notNull(),
    contactEmail: varchar('contact_email', { length: 255 }),
    status: listingStatusEnum('status').default('draft').notNull(),
    viewsCount: integer('views_count').default(0).notNull(),
    // Times this ad was re-published after its first publish — what the
    // plan's `renews` allowance is spent against.
    renewCount: integer('renew_count').default(0).notNull(),
    // The price a buyer actually pays — what cards show and what price
    // filters/sorts must use. MUST stay equal to `applyDiscount` in
    // apps/web/lib/utils.ts (v <= 0 → no discount, percent >= 100 → 0, amount
    // floors at 0, rounded to cents). Null price ("Negotiable") stays null.
    effectivePrice: numeric('effective_price', {
      precision: 14,
      scale: 2,
    }).generatedAlwaysAs(
      sql`CASE
        WHEN price IS NULL THEN NULL
        WHEN discount_value IS NULL OR discount_type IS NULL OR discount_value <= 0 THEN price
        WHEN discount_type = 'percent' THEN
          CASE WHEN discount_value >= 100 THEN 0
               ELSE round(price * (1 - discount_value / 100), 2) END
        ELSE GREATEST(round(price - discount_value, 2), 0)
      END`,
    ),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // Set when staff take the ad down (directly or by approving a report).
    // Separate from `status`, which the owner and plan reconciliation both
    // drive: a moderated ad stays 'deleted' and the owner cannot republish or
    // edit it until staff restore it (which clears these three).
    moderatedAt: timestamp('moderated_at', { withTimezone: true }),
    moderatedById: uuid('moderated_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    moderationReason: varchar('moderation_reason', { length: 500 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('listings_status_idx').on(t.status),
    index('listings_category_id_idx').on(t.categoryId),
    index('listings_subcategory_id_idx').on(t.subcategoryId),
    index('listings_user_id_idx').on(t.userId),
    index('listings_created_at_idx').on(t.createdAt),
    // Matches the (createdAt, id) cursor tie-break used by the public feed
    index('listings_status_created_at_idx').on(t.status, t.createdAt, t.id),
    index('listings_province_id_idx').on(t.provinceId),
    index('listings_district_id_idx').on(t.districtId),
    index('listings_commune_id_idx').on(t.communeId),
    index('listings_product_model_id_idx').on(t.productModelId),
    // Price sorts/filters on the final price (see effectivePrice).
    index('listings_status_effective_price_idx').on(
      t.status,
      t.effectivePrice,
      t.id,
    ),
    // Trigram indexes let the keyword search's leading-% ILIKE use an index
    // (pg_trgm, created in migration 0031). Substring matching rather than
    // tsvector because Khmer has no word spaces.
    index('listings_title_trgm_idx').using('gin', t.title.op('gin_trgm_ops')),
    index('listings_description_trgm_idx').using(
      'gin',
      t.description.op('gin_trgm_ops'),
    ),
    check('listings_price_nonnegative', sql`price >= 0`),
    check('listings_discount_value_nonnegative', sql`discount_value >= 0`),
    check(
      'listings_discount_pair',
      sql`(discount_value is null) = (discount_type is null)`,
    ),
    check(
      'listings_discount_percent_max',
      sql`discount_type <> 'percent' or discount_value <= 100`,
    ),
  ],
);

export type ListingRow = typeof listings.$inferSelect;
export type NewListing = typeof listings.$inferInsert;

export const listingPhotos = pgTable(
  'listing_photos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    listingId: uuid('listing_id')
      .notNull()
      .references(() => listings.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    path: text('path').notNull(),
    sort: integer('sort').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index('listing_photos_listing_id_idx').on(t.listingId)],
);

export type ListingPhotoRow = typeof listingPhotos.$inferSelect;
export type NewListingPhoto = typeof listingPhotos.$inferInsert;

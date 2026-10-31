import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from './users.schema';

/**
 * Promotional banners on the storefront. One row is one banner in one
 * placement; a placement holding several active rows is rotated on the site.
 * `imagePath` is a Storage object path in the default bucket, uploaded through
 * the staff-only `advertisement` sign scope, so replacing or removing a banner
 * can delete the object it no longer references.
 */
export const advertisementPlacementEnum = pgEnum('advertisement_placement', [
  'home',
  'all_ads',
  'category',
  'subcategory',
  'listing_detail',
]);

export const advertisements = pgTable(
  'advertisements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    placement: advertisementPlacementEnum('placement').notNull(),
    imagePath: text('image_path').notNull(),
    linkUrl: text('link_url'),
    altText: varchar('alt_text', { length: 200 }).default('').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    // The banner outlives the staff account that created it.
    createdById: uuid('created_by_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    // The storefront read: active rows for one placement, in display order.
    index('advertisements_placement_idx').on(
      t.placement,
      t.isActive,
      t.sortOrder,
    ),
  ],
);

export type AdvertisementRow = typeof advertisements.$inferSelect;
export type AdvertisementPlacement = AdvertisementRow['placement'];

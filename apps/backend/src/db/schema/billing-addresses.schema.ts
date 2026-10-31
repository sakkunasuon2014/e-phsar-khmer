import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { communes, districts, provinces, users } from './users.schema';

/**
 * One saved billing address on an account.
 *
 * `label` is what the account sees ("Home", "Work", or the free text typed
 * into "Save As"); `category` is the picker button it came from, kept so the
 * UI can re-tick the right button when the row is edited.
 *
 * `isDefault` is the address the checkout preselects. At most one row per
 * account may carry it — the partial unique index enforces that in the
 * database, and the service clears the previous default in the same
 * transaction rather than trusting the index to reject a second one.
 *
 * The geography FKs are RESTRICT for the same reason `users` uses it: a
 * geography re-seed must never silently wipe an address. The user FK is
 * CASCADE so `AccountPurgeService`'s hard delete takes these rows along.
 */
export const billingAddresses = pgTable(
  'billing_addresses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 80 }).notNull(),
    category: varchar('category', { length: 16 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    company: varchar('company', { length: 200 }),
    email: varchar('email', { length: 254 }),
    /** Stored as typed — this is a contact number, not a login identifier. */
    phone: varchar('phone', { length: 32 }).notNull(),
    address: text('address').notNull(),
    provinceId: uuid('province_id').references(() => provinces.id, {
      onDelete: 'restrict',
    }),
    districtId: uuid('district_id').references(() => districts.id, {
      onDelete: 'restrict',
    }),
    communeId: uuid('commune_id').references(() => communes.id, {
      onDelete: 'restrict',
    }),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    taxId: varchar('tax_id', { length: 60 }),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('billing_addresses_user_id_idx').on(t.userId),
    uniqueIndex('billing_addresses_default_uq')
      .on(t.userId)
      .where(sql`${t.isDefault}`),
    check(
      'billing_addresses_category_check',
      sql`${t.category} in ('home', 'work', 'other')`,
    ),
  ],
);

export type BillingAddressRow = typeof billingAddresses.$inferSelect;

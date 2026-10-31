import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { models } from './brands.schema';

/** The five product families that own a spec page (2026-10-30). */
export const PRODUCT_SPEC_FAMILIES = [
  'car',
  'motorcycle',
  'phone',
  'tablet',
  'smartwatch',
] as const;

export type ProductSpecFamily = (typeof PRODUCT_SPEC_FAMILIES)[number];

export const productSpecFamilyEnum = pgEnum(
  'product_spec_family',
  PRODUCT_SPEC_FAMILIES,
);

/**
 * One label/value row inside a spec group ("Size" → "6.1\"").
 */
export interface ProductSpecItem {
  label: string;
  value: string;
}

/**
 * A GSMArena-style spec section ("Display", "Camera", …). Array order is the
 * display order — Postgres preserves JSONB array order, so no sort columns.
 */
export interface ProductSpecGroup {
  title: string;
  rows: ProductSpecItem[];
}

/**
 * The trusted product-spec page. Identity is the existing `models` row (brand +
 * model name/slug/image); this table only adds the admin-entered spec data, so
 * a listing, the brand/model pickers and the spec page can never disagree
 * about what "iPhone 16" is. One spec page per model (`model_id` unique).
 */
export const productSpecs = pgTable(
  'product_specs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id, { onDelete: 'cascade' }),
    // Which family template the page was built from; pinned at create.
    family: productSpecFamilyEnum('family').notNull(),
    // Staff-uploaded product image (Storage public URL). Null falls back to
    // the model's own image.
    image: varchar('image', { length: 500 }),
    specGroups: jsonb('spec_groups')
      .$type<ProductSpecGroup[]>()
      .default([])
      .notNull(),
    // Draft pages are invisible to the public API and to the post form picker;
    // creating one defaults to draft so an admin can build it before posters
    // can attach to it.
    isPublished: boolean('is_published').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('product_specs_model_id_uq').on(t.modelId),
    index('product_specs_is_published_idx').on(t.isPublished),
  ],
);

export type ProductSpecRow = typeof productSpecs.$inferSelect;
export type NewProductSpec = typeof productSpecs.$inferInsert;

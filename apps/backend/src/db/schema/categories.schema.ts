import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const localeEnum = pgEnum('locale', ['en', 'km', 'zh']);

export const categories = pgTable('categories', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 80 }).unique().notNull(),
  icon: varchar('icon', { length: 500 }),
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

export const subcategories = pgTable(
  'subcategories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 100 }).notNull(),
    icon: varchar('icon', { length: 500 }),
    fieldSchema: jsonb('field_schema').$type<FieldDef[]>(),
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
    uniqueIndex('subcategories_category_slug_uq').on(t.categoryId, t.slug),
    index('subcategories_category_id_idx').on(t.categoryId),
  ],
);

export const categoryTranslations = pgTable(
  'category_translations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    locale: localeEnum('locale').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
  },
  (t) => [
    uniqueIndex('category_translations_category_locale_uq').on(
      t.categoryId,
      t.locale,
    ),
    index('category_translations_category_id_idx').on(t.categoryId),
  ],
);

export const subcategoryTranslations = pgTable(
  'subcategory_translations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    subcategoryId: uuid('subcategory_id')
      .notNull()
      .references(() => subcategories.id, { onDelete: 'cascade' }),
    locale: localeEnum('locale').notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    description: text('description'),
  },
  (t) => [
    uniqueIndex('subcategory_translations_subcategory_locale_uq').on(
      t.subcategoryId,
      t.locale,
    ),
    index('subcategory_translations_subcategory_id_idx').on(t.subcategoryId),
  ],
);

export type CategoryRow = typeof categories.$inferSelect;
export type SubcategoryRow = typeof subcategories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type NewSubcategory = typeof subcategories.$inferInsert;

export type CategoryTranslationRow = typeof categoryTranslations.$inferSelect;
export type SubcategoryTranslationRow =
  typeof subcategoryTranslations.$inferSelect;
export type NewCategoryTranslation = typeof categoryTranslations.$inferInsert;
export type NewSubcategoryTranslation =
  typeof subcategoryTranslations.$inferInsert;

export type I18nName = { en: string; km?: string; zh?: string };

export type FieldDef = {
  key: string;
  label: I18nName;
  type:
    | 'text'
    | 'number'
    | 'select'
    | 'boolean'
    | 'price'
    | 'discount'
    | 'photos'
    | 'location'
    | 'contact'
    | 'product';
  required: boolean;
  options?: string[];
  max?: number;
};

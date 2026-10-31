import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  categories,
  subcategories,
  categoryTranslations,
  subcategoryTranslations,
} from './schema/categories.schema';
import { categoriesSeed } from '../categories/seeds/categories.seed';
import { seedGeography } from './seeds/cambodia-geography.seed';
import { seedBrands, seedModels } from '../brands/seeds/brands.seed';
import { seedAttributes } from '../attributes/seeds/attributes.seed';
import { seedAdmin } from './seeds/admin.seed';
import { seedReports } from './seeds/reports.seed';
import { seedListings } from '../listings/seeds/listings.seed';
import { seedSubscriptions } from '../subscriptions/seeds/subscriptions.seed';
import * as schema from './schema';

async function seed() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');

  const client = postgres(url, { prepare: false });
  const db = drizzle(client, { schema, casing: 'snake_case' });

  console.log('Seeding geography...');
  await seedGeography(db);

  console.log('Seeding categories...');

  for (const cat of categoriesSeed) {
    const [insertedCat] = await db
      .insert(categories)
      .values({
        slug: cat.slug,
        icon: cat.icon ?? null,
        sortOrder: cat.sortOrder,
      })
      .onConflictDoUpdate({
        target: categories.slug,
        set: { sortOrder: cat.sortOrder },
      })
      .returning({ id: categories.id });

    for (const locale of ['en', 'km', 'zh'] as const) {
      const value = cat.name[locale];
      if (!value) continue;
      await db
        .insert(categoryTranslations)
        .values({ categoryId: insertedCat.id, locale, name: value })
        .onConflictDoUpdate({
          target: [
            categoryTranslations.categoryId,
            categoryTranslations.locale,
          ],
          set: { name: value },
        });
    }

    for (let i = 0; i < cat.subcategories.length; i++) {
      const sub = cat.subcategories[i];
      const [insertedSub] = await db
        .insert(subcategories)
        .values({
          categoryId: insertedCat.id,
          slug: sub.slug,
          fieldSchema: sub.fieldSchema ?? null,
          sortOrder: sub.sortOrder ?? i,
        })
        .onConflictDoUpdate({
          target: [subcategories.categoryId, subcategories.slug],
          set: {
            fieldSchema: sub.fieldSchema ?? null,
            sortOrder: sub.sortOrder ?? i,
          },
        })
        .returning({ id: subcategories.id });

      for (const locale of ['en', 'km', 'zh'] as const) {
        const value = sub.name[locale];
        if (!value) continue;
        await db
          .insert(subcategoryTranslations)
          .values({ subcategoryId: insertedSub.id, locale, name: value })
          .onConflictDoUpdate({
            target: [
              subcategoryTranslations.subcategoryId,
              subcategoryTranslations.locale,
            ],
            set: { name: value },
          });
      }
    }

    console.log(`  ✓ ${cat.slug} (${cat.subcategories.length} subcategories)`);
  }

  console.log('Seeding brands...');
  await seedBrands(db);

  console.log('Seeding models...');
  await seedModels(db);

  console.log('Seeding attributes...');
  await seedAttributes(db);

  console.log('Seeding admin...');
  await seedAdmin(db);

  console.log('Seeding reports...');
  await seedReports(db);

  console.log('Seeding subscriptions...');
  await seedSubscriptions(db);

  console.log('Seeding demo listings...');
  await seedListings(db);

  console.log('Seed complete.');
  await client.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

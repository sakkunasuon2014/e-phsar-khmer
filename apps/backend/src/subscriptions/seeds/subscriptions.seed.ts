import { eq, inArray } from 'drizzle-orm';
import type { DbClient, DbExecutor } from '../../db/drizzle.provider';
import { categories, subcategories } from '../../db/schema/categories.schema';
import {
  freePlanAdLimits,
  freePlanSettings,
  subscriptionCategories,
  subscriptionCategorySubcategories,
  subscriptionPackages,
  subscriptionTerms,
} from '../../db/schema/subscriptions.schema';
import {
  DEFAULT_FREE_AD_CAPS,
  DEFAULT_FREE_PLAN,
} from '../entitlements.constants';

type Tier = 'bronze' | 'silver' | 'gold';

const TIER_LABEL: Record<Tier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
};

interface TermSeed {
  name: string;
  durationMonths: number;
  price: number;
  /** Percent off `price`. */
  discount?: number;
}

interface TierSeed {
  tier: Tier;
  photos: number;
  ads: number;
  renews: number;
  autoRenews: number;
  videos: number;
  terms: TermSeed[];
}

interface GroupSeed {
  name: string;
  slug: string;
  description: string;
  /** Listing categories whose every subcategory the group covers. */
  categorySlugs: string[];
  tiers: TierSeed[];
}

const year = (price: number, discount?: number): TermSeed => ({
  name: '1 Year',
  durationMonths: 12,
  price,
  discount,
});
const months = (n: number, price: number, discount?: number): TermSeed => ({
  name: `${n} Months`,
  durationMonths: n,
  price,
  discount,
});

const bronze200 = {
  tier: 'bronze' as const,
  photos: 24,
  ads: 200,
  renews: 20,
  autoRenews: 20,
  videos: 20,
};
const bronze30 = {
  tier: 'bronze' as const,
  photos: 24,
  ads: 30,
  renews: 10,
  autoRenews: 20,
  videos: 10,
};

/**
 * Khmer24's Premium Account catalog as captured on 2026-10-21
 * (`docs/subs/`). Limits and the Bronze prices are read off the screenshots;
 * Property's Silver and Gold show only "from $420 / $900 for 6 months", so
 * their 3-month and 1-year prices are scaled from that at Bronze's ratios
 * (3 mo = half, 1 yr = double) — an inference, edit in the admin.
 *
 * Which listing categories each group covers is our reading of Khmer24's
 * blurbs ("cars, motor, bike & rental" → all of Cars & Vehicles). Jobs, Pets
 * and Books/Sports/Hobbies are in no Khmer24 group, so they stay on the free
 * plan.
 */
const GROUPS: GroupSeed[] = [
  {
    name: 'General',
    slug: 'general',
    description:
      'Up to 200 ads, 20 renews & 20 auto-renews in phones, tablets, computers, electronics, furniture, decor & fashion.',
    categorySlugs: [
      'phones-and-tablets',
      'computers-and-accessories',
      'electronics-and-appliances',
      'furniture-and-decor',
      'fashion-and-beauty',
    ],
    tiers: [{ ...bronze200, terms: [months(6, 60), year(100, 20)] }],
  },
  {
    name: 'Property',
    slug: 'property',
    description:
      'Up to 1000 ads, 75 renews & 75 auto-renews in house, land, condo, apartment & rental.',
    categorySlugs: ['home-and-land'],
    tiers: [
      {
        ...bronze200,
        terms: [months(3, 90), months(6, 180, 5), year(360, 15)],
      },
      {
        tier: 'silver',
        photos: 24,
        ads: 800,
        renews: 50,
        autoRenews: 50,
        videos: 50,
        terms: [months(3, 210), months(6, 420, 5), year(840, 15)],
      },
      {
        tier: 'gold',
        photos: 24,
        ads: 1000,
        renews: 75,
        autoRenews: 75,
        videos: 75,
        terms: [months(3, 450), months(6, 900, 5), year(1800, 15)],
      },
    ],
  },
  {
    name: 'Auto',
    slug: 'auto',
    description:
      'Up to 30 ads, 10 renews & 20 auto-renews in cars, motorcycles, bicycles & rentals.',
    categorySlugs: ['cars-and-vehicles'],
    tiers: [
      {
        ...bronze30,
        terms: [months(3, 30), months(6, 60), year(100, 20)],
      },
    ],
  },
  {
    name: 'Service',
    slug: 'service',
    description: 'Up to 30 ads, 10 renews & 20 auto-renews in services.',
    categorySlugs: ['services'],
    tiers: [{ ...bronze30, terms: [months(6, 60), year(100)] }],
  },
  {
    name: 'Food',
    slug: 'food',
    description: 'Up to 200 ads, 20 renews & 20 auto-renews in foods.',
    categorySlugs: ['foods'],
    tiers: [{ ...bronze200, terms: [months(6, 60), year(100, 20)] }],
  },
];

/**
 * Insert-only, like the attributes seed: admin edits always survive a re-run.
 * The free plan row and caps are inserted only if missing; a group that
 * already exists (by slug) is skipped whole — its scope, tiers and prices
 * belong to the admin from then on.
 */
export async function seedSubscriptions(db: DbClient): Promise<void> {
  await db
    .insert(freePlanSettings)
    .values({ id: 1, ...DEFAULT_FREE_PLAN })
    .onConflictDoNothing();

  const subRows = await db
    .select({
      id: subcategories.id,
      slug: subcategories.slug,
      categoryId: subcategories.categoryId,
    })
    .from(subcategories);
  const catRows = await db
    .select({ id: categories.id, slug: categories.slug })
    .from(categories);
  const subBySlug = new Map(subRows.map((s) => [s.slug, s.id]));
  const catBySlug = new Map(catRows.map((c) => [c.slug, c.id]));

  let caps = 0;
  for (const cap of DEFAULT_FREE_AD_CAPS) {
    const subcategoryId = cap.subcategorySlug
      ? subBySlug.get(cap.subcategorySlug)
      : undefined;
    const categoryId = cap.categorySlug
      ? catBySlug.get(cap.categorySlug)
      : undefined;
    if (!subcategoryId && !categoryId) {
      console.warn(
        `  ! free cap skipped: ${cap.subcategorySlug ?? cap.categorySlug} not found`,
      );
      continue;
    }
    const inserted = await db
      .insert(freePlanAdLimits)
      .values({
        subcategoryId: subcategoryId ?? null,
        categoryId: subcategoryId ? null : (categoryId ?? null),
        ads: cap.ads,
      })
      .onConflictDoNothing()
      .returning({ id: freePlanAdLimits.id });
    caps += inserted.length;
  }

  let created = 0;
  for (const [i, group] of GROUPS.entries()) {
    // One transaction per group, so a failed run never leaves a group that
    // exists (and is therefore skipped next time) without its tiers.
    const isNew = await db.transaction((tx) =>
      seedGroup(tx, group, i, subRows, catBySlug),
    );
    if (isNew) created++;
  }

  const scoped = await db
    .select({ id: subscriptionCategorySubcategories.subcategoryId })
    .from(subscriptionCategorySubcategories)
    .innerJoin(
      subscriptionCategories,
      eq(
        subscriptionCategories.id,
        subscriptionCategorySubcategories.subscriptionCategoryId,
      ),
    )
    .where(
      inArray(
        subscriptionCategories.slug,
        GROUPS.map((g) => g.slug),
      ),
    );
  console.log(
    `  ✓ free plan (${caps} new caps), ${created} new groups, ${scoped.length} subcategories covered`,
  );
}

/** Creates one group with its scope, tiers and terms. False if it already existed. */
async function seedGroup(
  db: DbExecutor,
  group: GroupSeed,
  sortOrder: number,
  subRows: { id: string; categoryId: string }[],
  catBySlug: ReadonlyMap<string, string>,
): Promise<boolean> {
  const [row] = await db
    .insert(subscriptionCategories)
    .values({
      name: group.name,
      slug: group.slug,
      description: group.description,
      sortOrder,
    })
    .onConflictDoNothing({ target: subscriptionCategories.slug })
    .returning({ id: subscriptionCategories.id });
  if (!row) return false;

  const categoryIds = group.categorySlugs.flatMap((slug) => {
    const id = catBySlug.get(slug);
    if (!id) console.warn(`  ! ${group.slug}: category ${slug} not found`);
    return id ? [id] : [];
  });
  const covered = subRows.filter((s) => categoryIds.includes(s.categoryId));
  if (covered.length > 0) {
    // A subcategory an admin already put in another group stays there.
    await db
      .insert(subscriptionCategorySubcategories)
      .values(
        covered.map((s) => ({
          subscriptionCategoryId: row.id,
          subcategoryId: s.id,
        })),
      )
      .onConflictDoNothing();
  }

  for (const [p, tier] of group.tiers.entries()) {
    const [pkg] = await db
      .insert(subscriptionPackages)
      .values({
        categoryId: row.id,
        tier: tier.tier,
        name: TIER_LABEL[tier.tier],
        photos: tier.photos,
        ads: tier.ads,
        renews: tier.renews,
        autoRenews: tier.autoRenews,
        videos: tier.videos,
        sortOrder: p,
      })
      .returning({ id: subscriptionPackages.id });
    await db.insert(subscriptionTerms).values(
      tier.terms.map((term, t) => ({
        packageId: pkg.id,
        name: term.name,
        durationValue: term.durationMonths,
        durationUnit: 'month' as const,
        price: term.price.toFixed(2),
        discount: (term.discount ?? 0).toFixed(2),
        discountType: 'percent' as const,
        sortOrder: t,
      })),
    );
  }
  return true;
}

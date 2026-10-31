"use server";

import { getAllCategories } from "@/lib/api/categories";
import type { Category, Subcategory } from "@/types/post-form";

/**
 * Step 1 of the post-an-ad flow ("Choose a category") reads the real category
 * tree from the backend (the `lib/post-ad.ts` mock was deleted in the
 * 2026-10-30 mock-data cleanup).
 *
 * The picker's local `Category`/`Subcategory` types predate the backend and
 * carry optional option lists (brands, years, colours, …) that the legacy
 * `DynamicForm` fallback calls `.map()` on unguarded — so those are normalised
 * to empty arrays here. Only name/slug/icon are real; every seeded subcategory
 * reaches the real `ListingPostForm`, and `DynamicForm` survives only for a
 * subcategory created through the admin UI.
 */
const EMPTY_OPTION_LISTS = {
  brands: [],
  accessories: [],
  network: [],
  storages: [],
  screen_size: [],
  ram: [],
  cpus: [],
  vgas: [],
  years: [],
  bedrooms: [],
  bathrooms: [],
  facing: [],
  experience: [],
  tax_types: [],
  condition: [],
  Types: [],
  engine_types: [],
  transmission: [],
  colors: [],
  discount: [],
} satisfies Partial<Subcategory>;

export async function getPostCategories(locale: string): Promise<Category[]> {
  const categories = await getAllCategories(locale);
  if (!categories) return [];

  return categories.map((category) => ({
    name: category.name,
    slug: category.slug,
    cateIcon: category.icon ?? "",
    subcategories: category.subcategories.map((sub) => ({
      ...EMPTY_OPTION_LISTS,
      name: sub.name,
      slug: sub.slug,
      subcate: sub.icon ?? "",
    })),
  }));
}

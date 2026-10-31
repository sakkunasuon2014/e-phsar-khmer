import type { ProductSpecFamily, ProductSpecTemplate } from "@/types/product";

/**
 * The five admin family pages, in sidebar order. `family` is the backend enum
 * value; `subcategorySlug` is the listing form the family serves.
 */
export const FAMILY_PAGES = [
  {
    slug: "cars",
    family: "car",
    label: "Cars",
    subcategorySlug: "cars-for-sale",
  },
  {
    slug: "motorcycles",
    family: "motorcycle",
    label: "Motorcycles",
    subcategorySlug: "motorcycles-for-sale",
  },
  {
    slug: "phones",
    family: "phone",
    label: "Phones",
    subcategorySlug: "phones",
  },
  {
    slug: "tablets",
    family: "tablet",
    label: "Tablets",
    subcategorySlug: "tablets",
  },
  {
    slug: "smart-watches",
    family: "smartwatch",
    label: "Smart Watches",
    subcategorySlug: "smart-watches",
  },
] as const;

export type FamilyPage = (typeof FAMILY_PAGES)[number];

/** Resolve a route slug ("cars", "smart-watches") to its family page. */
export function familyPage(slug: string): FamilyPage | null {
  return FAMILY_PAGES.find((page) => page.slug === slug) ?? null;
}

/** The family a listing subcategory belongs to (null for every other form). */
export function familyForSubcategory(slug: string): ProductSpecFamily | null {
  return (
    FAMILY_PAGES.find((page) => page.subcategorySlug === slug)?.family ?? null
  );
}

/**
 * True when a stored group is a filled subset of one template section: the
 * title matches and every label belongs to that section. A label may repeat —
 * a template field can carry several values (a phone's per-model band lists),
 * and the public page folds them under one label. Anything else is legacy
 * content the edit dialog keeps in Additional details.
 */
export function matchTemplateGroup(
  template: ProductSpecTemplate,
  group: { title: string; rows: { label: string }[] },
): boolean {
  if (group.rows.length === 0) return false;
  const section = template.sections.find(
    (candidate) => candidate.title === group.title,
  );
  if (!section) return false;
  const allowed = new Set(section.fields.map((field) => field.label));
  return group.rows.every((row) => allowed.has(row.label));
}

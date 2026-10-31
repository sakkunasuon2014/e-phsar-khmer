"use server";

import { serverFetch } from "@/lib/api/client";
import type { Model } from "@/types/model";

interface BackendModel {
  id: string;
  brandId: string;
  slug: string;
  name: string;
  image: string | null;
  /** The model's OWN subcategory links (added 2026-09-22). */
  subcategoryIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface BackendSubcategory {
  id: string;
  categoryId: string;
}

export async function getAdminModels(): Promise<Model[]> {
  const [{ data: models }, { data: subcategories }] = await Promise.all([
    serverFetch<BackendModel[]>("/admin/models"),
    serverFetch<BackendSubcategory[]>("/admin/subcategories"),
  ]);

  // A model's category comes from its subcategory rows, never from the brand:
  // a brand's `categoryId` is only the FIRST category among its links, so any
  // brand spanning two main categories (Apple, Sony…) used to relabel every
  // shared subcategory — phones rendered under "Computers & Accessories".
  // The subcategory's own categoryId is the only unambiguous source.
  const subToCategory = new Map(
    subcategories.map((sub) => [sub.id, sub.categoryId]),
  );

  return models.map((m) => {
    const subs = m.subcategoryIds ?? [];
    return {
      modelId: m.id,
      name: m.name,
      slug: m.slug,
      brandId: m.brandId,
      // A model's subcategories all sit in one category by construction.
      categoryId: subs.map((id) => subToCategory.get(id)).find(Boolean) ?? "",
      subcategories: subs,
      createdAt: m.createdAt.slice(0, 10),
      updatedAt: m.updatedAt.slice(0, 10),
    };
  });
}

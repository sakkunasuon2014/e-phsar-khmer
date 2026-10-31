"use server";

import { serverFetch } from "@/lib/api/client";
import type { AdminProduct, ProductSpecFamily } from "@/types/product";

/**
 * Admin catalogue rows (published + drafts). The backend returns the joined
 * brand/model names, slugs and spec groups directly — no adapter needed beyond
 * typing. Pass a family to scope the list to one admin page.
 */
export async function getAdminProducts(
  family?: ProductSpecFamily,
): Promise<AdminProduct[]> {
  const qs = family ? `?family=${encodeURIComponent(family)}` : "";
  const { data } = await serverFetch<AdminProduct[]>(`/admin/products${qs}`);
  return data;
}

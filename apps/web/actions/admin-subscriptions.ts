"use server";

import { serverFetch, ApiError } from "@/lib/api/client";

// ── Row shapes (backend returns numeric price/discount as strings) ──
export interface SubCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** Listing subcategories this group covers (empty on plans). */
  subcategoryIds?: string[];
}
export interface SubPackage {
  id: string;
  categoryId: string;
  tier: "bronze" | "silver" | "gold";
  name: string;
  photos: number;
  ads: number;
  renews: number;
  autoRenews: number;
  videos: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface SubTerm {
  id: string;
  packageId: string;
  name: string;
  durationValue: number;
  durationUnit: "day" | "month" | "year";
  price: string;
  discount: string;
  discountType: "percent" | "amount";
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

type Result = { success: true } | { success: false; error: string };

async function mutate(
  path: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  bodyObj?: unknown,
): Promise<Result> {
  try {
    await serverFetch(path, {
      method,
      body: bodyObj ? JSON.stringify(bodyObj) : undefined,
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ApiError ? err.message : "Request failed",
    };
  }
}

// ── Categories ──────────────────────────────────────────────
export async function getSubCategories(): Promise<SubCategory[]> {
  const { data } = await serverFetch<SubCategory[]>(
    "/admin/subscriptions/categories",
  );
  return data;
}
export async function createSubCategory(b: unknown) {
  return mutate("/admin/subscriptions/categories", "POST", b);
}
export async function updateSubCategory(id: string, b: unknown) {
  return mutate(`/admin/subscriptions/categories/${id}`, "PATCH", b);
}
export async function deleteSubCategory(id: string) {
  return mutate(`/admin/subscriptions/categories/${id}`, "DELETE");
}

// ── Packages (a group's fixed tier) ─────────────────────────
export async function getSubPackages(
  categoryId?: string,
): Promise<SubPackage[]> {
  const qs = categoryId ? `?categoryId=${categoryId}` : "";
  const { data } = await serverFetch<SubPackage[]>(
    `/admin/subscriptions/packages${qs}`,
  );
  return data;
}
export async function createSubPackage(b: unknown) {
  return mutate("/admin/subscriptions/packages", "POST", b);
}
export async function updateSubPackage(id: string, b: unknown) {
  return mutate(`/admin/subscriptions/packages/${id}`, "PATCH", b);
}
export async function deleteSubPackage(id: string) {
  return mutate(`/admin/subscriptions/packages/${id}`, "DELETE");
}

// ── Terms ───────────────────────────────────────────────────
export async function getSubTerms(packageId?: string): Promise<SubTerm[]> {
  const qs = packageId ? `?packageId=${packageId}` : "";
  const { data } = await serverFetch<SubTerm[]>(
    `/admin/subscriptions/terms${qs}`,
  );
  return data;
}
export async function createSubTerm(b: unknown) {
  return mutate("/admin/subscriptions/terms", "POST", b);
}
export async function updateSubTerm(id: string, b: unknown) {
  return mutate(`/admin/subscriptions/terms/${id}`, "PATCH", b);
}
export async function deleteSubTerm(id: string) {
  return mutate(`/admin/subscriptions/terms/${id}`, "DELETE");
}

// ── Group scope ─────────────────────────────────────────────
/** Which listing subcategories a subscription category (group) covers. */
export async function updateSubCategoryScope(
  id: string,
  subcategoryIds: string[],
) {
  return mutate(`/admin/subscriptions/categories/${id}/scope`, "PUT", {
    subcategoryIds,
  });
}

// ── Free plan ───────────────────────────────────────────────
export interface FreePlanAdLimit {
  categoryId: string | null;
  subcategoryId: string | null;
  ads: number;
}
export interface FreePlan {
  photos: number;
  renews: number;
  autoRenews: number;
  videos: number;
  /** Ads across every category with no group or cap of its own. */
  otherAds: number;
  adLimits: FreePlanAdLimit[];
}

export async function getFreePlan(): Promise<FreePlan> {
  const { data } = await serverFetch<FreePlan>(
    "/admin/subscriptions/free-plan",
  );
  return data;
}
export async function updateFreePlan(plan: FreePlan) {
  return mutate("/admin/subscriptions/free-plan", "PUT", {
    ...plan,
    adLimits: plan.adLimits.map((limit) =>
      limit.subcategoryId
        ? { subcategoryId: limit.subcategoryId, ads: limit.ads }
        : { categoryId: limit.categoryId, ads: limit.ads },
    ),
  });
}

"use server";

import { serverFetch, ApiError } from "@/lib/api/client";

export type AdminListingStatus =
  | "draft"
  | "active"
  | "expired"
  | "deleted"
  | "restricted";

export interface AdminListingRow {
  id: string;
  title: string;
  status: AdminListingStatus;
  price: string | null;
  currency: string;
  userId: string;
  sellerUsername: string | null;
  categorySlug: string | null;
  subcategorySlug: string | null;
  coverPhotoUrl: string | null;
  pendingReports: number;
  createdAt: string;
  publishedAt: string | null;
  expiresAt: string | null;
  moderatedAt: string | null;
  moderationReason: string | null;
}

export interface AdminListingsQuery {
  q?: string;
  status?: AdminListingStatus;
  moderated?: boolean;
  categorySlug?: string;
  subcategorySlug?: string;
  page?: number;
  pageSize?: number;
}

export interface AdminListingsPage {
  rows: AdminListingRow[];
  total: number;
}

export async function getAdminListings(
  query: AdminListingsQuery,
): Promise<AdminListingsPage> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  if (query.moderated !== undefined)
    params.set("moderated", String(query.moderated));
  if (query.categorySlug) params.set("categorySlug", query.categorySlug);
  if (query.subcategorySlug)
    params.set("subcategorySlug", query.subcategorySlug);
  params.set("page", String(query.page ?? 1));
  params.set("pageSize", String(query.pageSize ?? 20));

  const { data, meta } = await serverFetch<AdminListingRow[]>(
    `/admin/listings?${params.toString()}`,
  );
  return { rows: data, total: meta?.total ?? data.length };
}

export async function removeListing(id: string, reason?: string) {
  try {
    await serverFetch(`/admin/listings/${id}/remove`, {
      method: "POST",
      body: JSON.stringify({ reason: reason?.trim() || undefined }),
    });
    return { success: true as const };
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof ApiError ? err.message : "Failed to remove listing",
    };
  }
}

export async function restoreListing(id: string) {
  try {
    await serverFetch(`/admin/listings/${id}/restore`, { method: "POST" });
    return { success: true as const };
  } catch (err) {
    return {
      success: false as const,
      error:
        err instanceof ApiError ? err.message : "Failed to restore listing",
    };
  }
}

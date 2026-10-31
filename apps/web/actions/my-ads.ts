"use server";

import { ApiError, userServerFetch } from "@/lib/api/user-client";
import { getMyAdsPage } from "@/lib/api/my-ads";
import type { MyAdsTab } from "@/lib/api/my-ads";
import { getMyEntitlements } from "@/actions/subscriptions";
import type { PlanEntitlements } from "@/types/subscription";
import type { Post } from "@/lib/posts";

export interface MyAdsPageResult {
  items: Post[];
  hasMore: boolean;
  counts: Partial<Record<MyAdsTab, number>>;
  /** Plan limits + live usage; null when unavailable (fail-soft). */
  plan?: PlanEntitlements | null;
  error?: string;
}

export interface MyAdActionResult {
  success: boolean;
  error?: string;
}

/**
 * Renew = re-publish. The backend extends the ad by 30 days, and an ad that
 * already went live spends one renewal from the owner's plan — refused with
 * `PLAN_LIMIT_RENEWS` / `PLAN_LIMIT_ADS` when the plan says no.
 */
export async function renewMyListing(id: string): Promise<MyAdActionResult> {
  try {
    await userServerFetch(`/listings/${id}/publish`, { method: "POST" });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ApiError ? err.message : "Network error",
    };
  }
}

/** Soft-delete: the ad leaves the feed and both Manage Ads tabs. */
export async function deleteMyListing(id: string): Promise<MyAdActionResult> {
  try {
    await userServerFetch(`/listings/${id}`, { method: "DELETE" });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ApiError ? err.message : "Network error",
    };
  }
}

/**
 * One page of the viewer's own ads for `/me` → Manage Ads. The list is
 * JWT-scoped, so it has to be read where the session cookies are. An empty
 * list and a failure both come back as `items: []`; only `error` tells them
 * apart, so the UI never paints a failed load as "No Result!".
 */
export async function loadMyAds(
  tab: MyAdsTab,
  page: number,
): Promise<MyAdsPageResult> {
  try {
    const [result, plan] = await Promise.all([
      getMyAdsPage(tab, page),
      page === 1 ? getMyEntitlements().catch(() => null) : undefined,
    ]);
    return { ...result, plan };
  } catch (err) {
    return {
      items: [],
      hasMore: false,
      counts: {},
      error: err instanceof ApiError ? err.message : "Network error",
    };
  }
}

"use server";

import type {
  SubscriptionStatus,
  SupersededReason,
} from "@/types/subscription";
import { serverFetch, ApiError } from "@/lib/api/client";

export interface UserSubscriptionRow {
  id: string;
  userId: string;
  accountId: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** The subscription category row this subscription belongs to (the tab key). */
  subscriptionCategoryId: string | null;
  group: string | null;
  totalAds: number;
  totalRenew: number;
  autoRenew: number;
  /** The purchased duration (e.g. "6 Months"). */
  term: string | null;
  price: string;
  paymentMethod: string | null;
  subscribedAt: string;
  expiresAt: string;
  supersededAt: string | null;
  supersededReason: SupersededReason | null;
  status: SubscriptionStatus;
}

/** Current subscriptions (one per user); `history` adds superseded rows. */
export async function getUserSubscriptions(
  history = false,
): Promise<UserSubscriptionRow[]> {
  const { data } = await serverFetch<UserSubscriptionRow[]>(
    `/admin/user-subscriptions${history ? "?history=true" : ""}`,
  );
  return data;
}

export async function grantSubscription(input: {
  userId: string;
  termId: string;
  paymentMethod?: string;
}) {
  try {
    await serverFetch("/admin/user-subscriptions", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ApiError ? err.message : "Failed to grant",
    };
  }
}

/** Ends a current subscription; the row is kept as history, never deleted. */
export async function revokeUserSubscription(id: string) {
  try {
    await serverFetch(`/admin/user-subscriptions/${id}/revoke`, {
      method: "POST",
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ApiError ? err.message : "Failed to revoke",
    };
  }
}

"use server";

/**
 * Saved billing addresses for the signed-in user. Every call goes through
 * `userServerFetch` (the `user_access_token` cookie).
 */

import { userServerFetch } from "@/lib/api/user-client";

export type BillingAddressCategory = "home" | "work" | "other";

/** A saved address as `GET /users/me/billing-addresses` returns it. */
export interface BillingAddress {
  id: string;
  label: string;
  category: BillingAddressCategory;
  name: string;
  company: string | null;
  email: string | null;
  phone: string;
  address: string;
  provinceId: string | null;
  districtId: string | null;
  communeId: string | null;
  /** `numeric` columns serialise as strings. */
  latitude: string | null;
  longitude: string | null;
  taxId: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BillingAddressInput {
  label: string;
  category: BillingAddressCategory;
  name: string;
  company?: string;
  email?: string;
  phone: string;
  address: string;
  provinceId?: string;
  districtId?: string;
  communeId?: string;
  latitude?: number;
  longitude?: number;
  taxId?: string;
  isDefault?: boolean;
}

export interface BillingAddressResult {
  success: boolean;
  error?: string;
}

/** Fail-soft read: the checkout renders its empty state rather than failing. */
export async function getBillingAddresses(): Promise<BillingAddress[]> {
  try {
    const { data } = await userServerFetch<BillingAddress[]>(
      "/users/me/billing-addresses",
    );
    return data;
  } catch {
    return [];
  }
}

export async function createBillingAddress(
  input: BillingAddressInput,
): Promise<BillingAddressResult> {
  try {
    await userServerFetch("/users/me/billing-addresses", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: describe(err) };
  }
}

export async function updateBillingAddress(
  id: string,
  input: Partial<BillingAddressInput>,
): Promise<BillingAddressResult> {
  try {
    await userServerFetch(`/users/me/billing-addresses/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: describe(err) };
  }
}

export async function deleteBillingAddress(
  id: string,
): Promise<BillingAddressResult> {
  try {
    await userServerFetch(`/users/me/billing-addresses/${id}`, {
      method: "DELETE",
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: describe(err) };
  }
}

/** The envelope carries a code on the error body; the message is the detail. */
function describe(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    const message = String((err as { message?: unknown }).message ?? "");
    if (message && message !== "UNAUTHORIZED") return message;
  }
  return "Something went wrong. Please try again.";
}

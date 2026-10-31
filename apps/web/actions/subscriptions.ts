"use server";

import type {
  PaymentProvider,
  PaymentTransactionStatus,
  PlanEntitlements,
  PublicFreePlan,
  SubscriptionCatalogItem,
  UserSubscription,
} from "@/types/subscription";
import { ApiError, userServerFetch } from "@/lib/api/client";

export async function getPaymentProviders(): Promise<PaymentProvider[]> {
  const { data } = await userServerFetch<PaymentProvider[]>(
    "/payments/providers",
  );
  return data;
}

/** Pass the subcategory being posted to for the limits that apply there. */
export async function getMyEntitlements(
  subcategoryId?: string,
): Promise<PlanEntitlements> {
  const query = subcategoryId
    ? `?subcategoryId=${encodeURIComponent(subcategoryId)}`
    : "";
  const { data } = await userServerFetch<PlanEntitlements>(
    `/subscriptions/entitlements${query}`,
  );
  return data;
}

export async function getSubscriptionCatalog(): Promise<
  SubscriptionCatalogItem[]
> {
  const { data } = await userServerFetch<SubscriptionCatalogItem[]>(
    "/subscriptions/catalog",
  );
  return data;
}

export async function getMySubscriptions(): Promise<UserSubscription[]> {
  const { data } =
    await userServerFetch<UserSubscription[]>("/subscriptions/me");
  return data;
}

export async function createSubscriptionCheckout(input: {
  termId: string;
  idempotencyKey: string;
  provider: string;
}) {
  try {
    const { data } = await userServerFetch<{
      purchaseId: string;
      paymentTransactionId: string;
      amount: string;
      currency: string;
    }>("/subscriptions/checkout", {
      method: "POST",
      body: JSON.stringify({ ...input, method: "bank" }),
    });
    return { success: true as const, data };
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof ApiError ? error.message : "Checkout failed",
    };
  }
}

export async function getPaymentTransactionStatus(id: string) {
  try {
    const { data } = await userServerFetch<PaymentTransactionStatus>(
      `/payments/${id}`,
    );
    return { success: true as const, data };
  } catch (error) {
    return {
      success: false as const,
      error:
        error instanceof ApiError ? error.message : "Could not check payment",
    };
  }
}

/** The free plan's public sheet: limits plus every per-category ad cap. */
export async function getPublicFreePlan(): Promise<PublicFreePlan> {
  const { data } = await userServerFetch<PublicFreePlan>(
    "/subscriptions/free-plan",
  );
  return data;
}

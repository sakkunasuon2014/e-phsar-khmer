export type SubscriptionTermDurationUnit = "day" | "month" | "year";

export type SubscriptionTermDiscountType = "percent" | "amount";

export type SupersededReason = "upgrade" | "replaced" | "expired" | "revoked";

export type SubscriptionStatus =
  | "active"
  | "expired"
  | "superseded"
  | "revoked";

/** An allowance pool: a held group, or the free plan's shared pool. */
export type BucketKey = `group:${string}` | "free";

/** A free-plan cap row's key on the public price sheet. */
export type ScopeKey = `sub:${string}` | `cat:${string}`;

export interface SubscriptionCatalogItem {
  groupId: string;
  groupName: string;
  groupSlug: string;
  groupDescription: string | null;
  packageId: string;
  packageName: string;
  termId: string;
  termName: string;
  durationValue: number;
  durationUnit: SubscriptionTermDurationUnit;
  price: string;
  discount: string;
  discountType: SubscriptionTermDiscountType;
  photos: number;
  ads: number;
  renews: number;
  autoRenews: number;
  videos: number;
}

export interface UserSubscription {
  id: string;
  purchaseId: string | null;
  termId: string | null;
  termName: string | null;
  /** The group this subscription belongs to. */
  groupId: string | null;
  groupName: string | null;
  packageName: string | null;
  photos: number;
  ads: number;
  renews: number;
  autoRenews: number;
  videos: number;
  priceUsd: string;
  subscribedAt: string;
  expiresAt: string;
  status: SubscriptionStatus;
}

export interface PaymentTransactionStatus {
  id: string;
  status:
    | "pending"
    | "processing"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "expired"
    | "refund_pending"
    | "refunded";
  amount: string;
  currency: string;
  checkout: {
    redirectUrl: string | null;
    rawResponse: unknown;
  } | null;
}

export interface PaymentProvider {
  name: string;
  displayName: string;
  /** Registered but missing credentials — show it, don't let it be picked. */
  available: boolean;
}

export interface PlanLimits {
  photos: number;
  ads: number;
  renews: number;
  autoRenews: number;
  videos: number;
}

export interface EntitlementBucket {
  key: BucketKey;
  kind: "group" | "free";
  name: string;
  groupId: string | null;
  limits: PlanLimits;
  used: number;
  expiresAt: string | null;
}

export interface PlanEntitlements {
  plan: "free" | "premium";
  limits: PlanLimits;
  expiresAt: string | null;
  /** `ads` = live ads (active + restricted); `hidden` = the restricted subset. */
  usage: { ads: number; renews: number; hidden: number };
  bucket: EntitlementBucket | null;
  buckets: EntitlementBucket[];
}

export interface PublicFreePlan {
  photos: number;
  renews: number;
  autoRenews: number;
  videos: number;
  /** The free plan's account-wide live-ad cap. */
  otherAds: number;
  /** Per-scope sub-limits inside that total. */
  caps: { key: ScopeKey; name: string; ads: number }[];
}

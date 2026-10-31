import type {
  EntitlementBucket,
  SubscriptionCatalogItem,
  UserSubscription,
} from "@/types/subscription";

// Client mirror of the backend checkout math (subscriptions.service.ts:
// calculatePrice / calculateUpgradeCredit / prorateToRemaining). Used only to
// decide which offers to show as buyable and to preview "due today" — the
// backend recomputes the real amount at checkout and stays authoritative.

export function priceFor(item: SubscriptionCatalogItem): number {
  const price = Number(item.price);
  const discount = Number(item.discount);
  const final =
    item.discountType === "percent"
      ? price * (1 - discount / 100)
      : price - discount;
  return Math.max(0, Math.round(final * 100) / 100);
}

/**
 * The subscription checkout treats as "current" for a group (subscription
 * category): active, latest expiry. A user holds one per group side by side,
 * so pass the group being bought into; without one, the latest of any group.
 */
export function currentSubscription(
  subscriptions: UserSubscription[],
  groupId?: string | null,
): UserSubscription | null {
  return (
    subscriptions
      .filter(
        (item) =>
          item.status === "active" &&
          (groupId === undefined || item.groupId === groupId),
      )
      .sort(
        (a, b) =>
          new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime(),
      )[0] ?? null
  );
}

/** Every active subscription, one per group, latest expiry first. */
export function activeSubscriptions(
  subscriptions: UserSubscription[],
): UserSubscription[] {
  const byGroup = new Map<string, UserSubscription>();
  for (const item of subscriptions) {
    if (item.status !== "active") continue;
    const key = item.groupId ?? item.id;
    const kept = byGroup.get(key);
    if (!kept || new Date(item.expiresAt) > new Date(kept.expiresAt)) {
      byGroup.set(key, item);
    }
  }
  return [...byGroup.values()].sort(
    (a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime(),
  );
}

/** Shared plan/scope/CTA wording for subscription allowance buckets. */
export function describeBucket(
  bucket: Pick<EntitlementBucket, "kind" | "name"> | null,
): { planLabel: string; scopeLabel: string; ctaLabel: string } {
  if (bucket?.kind === "group") {
    return {
      planLabel: `${bucket.name} plan`,
      scopeLabel: "in its categories",
      ctaLabel: "See plans",
    };
  }
  return {
    planLabel: "Free plan",
    scopeLabel: bucket ? `in ${bucket.name}` : "in this category",
    ctaLabel: "Upgrade",
  };
}

/** Package id of a subscription, resolved through its term in the catalog. */
export function packageIdOf(
  subscription: UserSubscription | null,
  catalog: SubscriptionCatalogItem[],
): string | null {
  if (!subscription?.termId) return null;
  return (
    catalog.find((item) => item.termId === subscription.termId)?.packageId ??
    null
  );
}

function addDuration(
  from: Date,
  value: number,
  unit: SubscriptionCatalogItem["durationUnit"],
): Date {
  const result = new Date(from);
  if (unit === "day") result.setDate(result.getDate() + value);
  else if (unit === "month") result.setMonth(result.getMonth() + value);
  else result.setFullYear(result.getFullYear() + value);
  return result;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export type OfferState =
  | { kind: "new"; due: number }
  | { kind: "current" }
  | { kind: "upgrade"; due: number; credit: number }
  | { kind: "unavailable" };

/**
 * What buying `offer` means for a user whose current plan is `active`:
 * a fresh purchase, their own package, a paid upgrade (prorated to the
 * current expiry, minus the unused credit), or nothing to collect — the
 * backend rejects that last case with 400, so it must not be offered.
 */
export function offerState(
  offer: SubscriptionCatalogItem,
  active: UserSubscription | null,
  activePackageId: string | null,
  now: number,
): OfferState {
  const target = priceFor(offer);
  if (!active) return { kind: "new", due: target };
  if (activePackageId && offer.packageId === activePackageId) {
    return { kind: "current" };
  }

  const started = new Date(active.subscribedAt).getTime();
  const ends = new Date(active.expiresAt).getTime();
  const total = ends - started;
  const remaining = Math.max(0, ends - now);
  const credit =
    total > 0 && remaining > 0
      ? round2((Number(active.priceUsd) * remaining) / total)
      : 0;

  const termMs =
    addDuration(
      new Date(now),
      offer.durationValue,
      offer.durationUnit,
    ).getTime() - now;
  const prorated =
    termMs <= 0 || remaining >= termMs
      ? target
      : round2((target * remaining) / termMs);
  const due = round2(Math.max(0, prorated - credit));

  return due > 0 ? { kind: "upgrade", due, credit } : { kind: "unavailable" };
}

/** Whole days until `iso`, never negative. */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86_400_000));
}

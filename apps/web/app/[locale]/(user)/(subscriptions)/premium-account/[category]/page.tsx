"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowRight, CircleCheck } from "lucide-react";
import { Link } from "@/i18n/routing";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import {
  getMySubscriptions,
  getSubscriptionCatalog,
} from "@/actions/subscriptions";
import type {
  SubscriptionCatalogItem,
  UserSubscription,
} from "@/types/subscription";
import {
  currentSubscription,
  offerState,
  packageIdOf,
  priceFor,
} from "@/lib/subscription-pricing";

function money(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}

const UNIT: Record<SubscriptionCatalogItem["durationUnit"], [string, string]> =
  {
    day: ["Day", "Days"],
    month: ["Month", "Months"],
    year: ["Year", "Years"],
  };

function unitLabel(item: SubscriptionCatalogItem): string {
  return UNIT[item.durationUnit][item.durationValue === 1 ? 0 : 1];
}

/** 12 stored months display as "1 Year" on the compact term tiles. */
function tileParts(item: SubscriptionCatalogItem): {
  value: number;
  unit: string;
} {
  if (item.durationUnit === "month" && item.durationValue % 12 === 0) {
    return { value: item.durationValue / 12, unit: "Year" };
  }
  return { value: item.durationValue, unit: unitLabel(item) };
}

/** "-20%" for a percent discount, "-$5" for an amount; null when none. */
function discountLabel(item: SubscriptionCatalogItem): string | null {
  const value = Number(item.discount);
  if (!(value > 0)) return null;
  return item.discountType === "percent"
    ? `-${money(value)}%`
    : `-$${money(value)}`;
}

function DiscountBadge({
  item,
  className = "",
}: {
  item: SubscriptionCatalogItem;
  className?: string;
}) {
  const label = discountLabel(item);
  if (!label) return null;
  return (
    <span
      className={`rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-500 ${className}`}
    >
      {label}
    </span>
  );
}

/** Original price struck through (when discounted) next to the final price. */
function Price({ item }: { item: SubscriptionCatalogItem }) {
  const final = priceFor(item);
  const original = Number(item.price);
  return (
    <span className="tabular-nums">
      {final < original && (
        <span className="mr-2 text-base italic text-foreground line-through">
          ${money(original)}
        </span>
      )}
      <span className="font-medium text-sky-600">${money(final)}</span>
    </span>
  );
}

function Benefits({ item }: { item: SubscriptionCatalogItem }) {
  const rows: [string, number][] = [
    ["Photos", item.photos],
    ["Ads", item.ads],
    ["Renews", item.renews],
  ];
  return (
    <ul className="mb-4 grid grid-cols-1 gap-1">
      {rows.map(([label, value]) => (
        <li
          key={label}
          className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400"
        >
          <CircleCheck size={16} className="shrink-0 text-sky-400" />
          <span className="capitalize">
            {label} {value}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The selected plan's terms: one radio row per term, price on the right. */
function TermRows({
  terms,
  selectedTermId,
  onPick,
}: {
  terms: SubscriptionCatalogItem[];
  selectedTermId: string;
  onPick: (termId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-sm border bg-card">
      {terms.map((term, index) => {
        const checked = term.termId === selectedTermId;
        return (
          <div key={term.termId} className={index > 0 ? "border-t" : ""}>
            <label
              className={`flex cursor-pointer items-center justify-between px-4 py-3 transition-all ${
                checked ? "bg-muted" : "hover:bg-muted"
              }`}
            >
              <span className="flex items-center gap-3">
                <input
                  type="radio"
                  checked={checked}
                  onChange={() => onPick(term.termId)}
                  className="h-4 w-4 accent-sky-500"
                />
                <span className="font-semibold">{term.termName}</span>
                <DiscountBadge item={term} />
              </span>
              <Price item={term} />
            </label>
          </div>
        );
      })}
    </div>
  );
}

/** An unselected plan's terms: compact tiles; picking one selects the plan. */
function TermTiles({
  terms,
  onPick,
}: {
  terms: SubscriptionCatalogItem[];
  onPick: (termId: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-4">
      {terms.map((term) => {
        const tile = tileParts(term);
        return (
          <button
            key={term.termId}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPick(term.termId);
            }}
            className="relative flex h-20 w-28 flex-col items-center justify-center rounded-sm border bg-card text-foreground transition-colors hover:border-sky-400"
          >
            <DiscountBadge item={term} className="absolute right-0 top-0" />
            <span className="text-2xl font-bold leading-none">
              {tile.value}
            </span>
            <span className="mt-1 text-sm">{tile.unit}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function PremiumPlanPage() {
  const params = useParams<{ category: string }>();
  const categorySlug = params.category;
  const [catalog, setCatalog] = useState<SubscriptionCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  // The plan being looked at, and the term picked on each plan.
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(
    null,
  );
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;
    // Fail soft: without the user's plan every offer reads as a new purchase,
    // and checkout still re-checks on the server.
    getMySubscriptions()
      .then((items) => {
        if (mounted) setSubscriptions(items);
      })
      .catch(() => {});
    getSubscriptionCatalog()
      .then((items) => {
        if (mounted) setCatalog(items);
      })
      .catch(() => {
        if (mounted) setError("We couldn't load plans. Please try again.");
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const offers = useMemo(
    () => catalog.filter((item) => item.groupSlug === categorySlug),
    [catalog, categorySlug],
  );
  // The catalog arrives in admin sort order (plans, then terms), which is the
  // order the terms are shown in — the first term is the plan's default.
  const packages = useMemo(() => {
    const grouped = new Map<string, SubscriptionCatalogItem[]>();
    for (const offer of offers) {
      const current = grouped.get(offer.packageId) ?? [];
      current.push(offer);
      grouped.set(offer.packageId, current);
    }
    return [...grouped.values()];
  }, [offers]);
  // Only this group's subscription matters here: buying into another
  // group is a separate, side-by-side subscription, never an upgrade.
  const active = currentSubscription(subscriptions, offers[0]?.groupId ?? null);
  const activePackageId = packageIdOf(active, catalog);
  const groupName = offers[0]?.groupName ?? categorySlug;

  const selectedTerms =
    packages.find((terms) => terms[0].packageId === selectedPackageId) ??
    packages[0];
  const selectedTerm = selectedTerms
    ? (selectedTerms.find(
        (term) => term.termId === picked[selectedTerms[0].packageId],
      ) ?? selectedTerms[0])
    : null;

  const pick = (packageId: string, termId?: string) => {
    setSelectedPackageId(packageId);
    if (termId) setPicked((current) => ({ ...current, [packageId]: termId }));
  };

  const state = selectedTerm
    ? offerState(selectedTerm, active, activePackageId, now)
    : null;

  return (
    <div className="min-h-screen bg-muted pb-10 pt-4">
      <div className="mx-auto max-w-7xl px-4">
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Profile", href: "/me" },
            { label: "Membership", href: "/me/membership" },
            { label: "Premium Account", href: "/premium-account" },
            { label: groupName, className: "capitalize" },
          ]}
        />
      </div>

      <main className="mx-auto max-w-4xl px-4">
        <h1 className="mb-4 mt-6 text-xl font-semibold text-foreground">
          Choose the right plan for your business
        </h1>

        {loading && (
          <div className="h-96 animate-pulse rounded-sm border bg-card" />
        )}

        {error && (
          <div
            role="alert"
            className="rounded-sm border bg-card p-5 text-sm text-destructive"
          >
            {error}
          </div>
        )}

        {!loading && !error && packages.length === 0 && (
          <div className="rounded-sm border bg-card p-10 text-center">
            <h2 className="font-semibold text-foreground">
              No plans available
            </h2>
            <p className="mt-1 text-sm text-foreground">
              Browse another category or check back later.
            </p>
            <Link
              href="/premium-account"
              className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#00a0e9] underline"
            >
              Browse categories <ArrowRight className="size-4" />
            </Link>
          </div>
        )}

        {!loading && !error && selectedTerms && selectedTerm && (
          <>
            <div className="space-y-4">
              {packages.map((terms) => {
                const base = terms[0];
                const isSelected =
                  base.packageId === selectedTerms[0].packageId;
                const isCurrent = base.packageId === activePackageId;
                return (
                  <article
                    key={base.packageId}
                    onClick={() => !isSelected && pick(base.packageId)}
                    className={
                      isSelected
                        ? "rounded-md border-2 border-sky-400 bg-card p-6 shadow-sm"
                        : "cursor-pointer rounded-sm border bg-card p-6 hover:border-sky-400"
                    }
                  >
                    <div className="mb-4">
                      <div className="flex flex-wrap items-center gap-3">
                        <h2 className="text-lg font-semibold text-foreground">
                          {base.packageName}
                        </h2>
                        {isCurrent && (
                          <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                            Current plan
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-base font-medium">
                        Start From {money(Number(base.price))} $ For{" "}
                        {base.termName}
                      </p>
                    </div>

                    <Benefits item={base} />

                    <div className="space-y-1">
                      <p className="text-sm">Term</p>
                      {isSelected ? (
                        <TermRows
                          terms={terms}
                          selectedTermId={selectedTerm.termId}
                          onPick={(termId) => pick(base.packageId, termId)}
                        />
                      ) : (
                        <TermTiles
                          terms={terms}
                          onPick={(termId) => pick(base.packageId, termId)}
                        />
                      )}
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="mt-4 rounded-sm border bg-card p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-foreground">
                  {selectedTerms[0].packageName} {selectedTerm.termName}
                  <DiscountBadge item={selectedTerm} />
                </span>
                <span className="text-lg">
                  <Price item={selectedTerm} />
                </span>
              </div>

              {state?.kind === "upgrade" && (
                <p className="mb-3 text-sm text-foreground">
                  Upgrade from your current plan: you pay{" "}
                  <strong>${money(state.due)}</strong> today — prorated to your
                  end date, minus ${money(state.credit)} unused credit.
                </p>
              )}

              {state?.kind === "current" ? (
                <Link
                  href="/me/membership"
                  className="block w-full rounded-sm bg-muted py-2.5 text-center text-sm font-semibold text-gray-500"
                >
                  Your current plan
                  {active &&
                    ` · until ${new Date(
                      active.expiresAt,
                    ).toLocaleDateString()}`}
                </Link>
              ) : state?.kind === "unavailable" ? (
                <span
                  aria-disabled
                  className="block w-full cursor-not-allowed rounded-sm bg-muted py-2.5 text-center text-sm font-semibold text-gray-500"
                >
                  Not an upgrade from your plan
                </span>
              ) : (
                <Link
                  href={{
                    pathname: "/checkout",
                    query: { termId: selectedTerm.termId },
                  }}
                  className="block w-full rounded-sm bg-orange-500 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-orange-600"
                >
                  {state?.kind === "upgrade" ? "Upgrade Now" : "Subscribe Now"}
                </Link>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

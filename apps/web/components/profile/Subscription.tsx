"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, CircleAlert, RefreshCw } from "lucide-react";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { getMySubscriptions, getPublicFreePlan } from "@/actions/subscriptions";
import type { PublicFreePlan, UserSubscription } from "@/types/subscription";
import { activeSubscriptions } from "@/lib/subscription-pricing";

const STATUS_STYLE: Record<UserSubscription["status"], string> = {
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  expired: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  superseded: "bg-muted text-muted-foreground",
  revoked: "bg-red-500/10 text-red-700 dark:text-red-400",
};

const STATUS_LABEL: Record<UserSubscription["status"], string> = {
  active: "Active",
  expired: "Expired",
  superseded: "Upgraded",
  revoked: "Revoked",
};

function money(value: string | number): string {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

/** Zero reads as "None", like an unavailable feature. */
const amount = (value: number) => (value > 0 ? String(value) : "None");

type Row = { label: string; value: string };

/**
 * One plan as the card the old Membership page used: a centred title over
 * label / value rows split by hairlines.
 */
function PlanSheet({
  title,
  subtitle,
  rows,
}: {
  title: string;
  subtitle?: string;
  rows: Row[];
}) {
  return (
    <section
      aria-label={`${title} plan`}
      className="bg-card border rounded-sm overflow-hidden"
    >
      <div className="px-4 py-4">
        <h2 className="text-lg text-center font-medium text-foreground">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-center text-xs text-gray-500">{subtitle}</p>
        )}
      </div>
      <div className="divide-y divide-muted">
        {rows.map((row) => (
          <div
            key={row.label}
            className="px-4 py-4 flex items-start justify-between"
          >
            <h3 className="text-sm font-semibold text-foreground">
              {row.label}
            </h3>
            <div className="text-sm text-foreground tabular-nums">
              {row.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function freeRows(plan: PublicFreePlan): Row[] {
  // Videos and auto-renewals are plan features the free plan doesn't get
  // (both 0 until an admin sets them, and "0" reads as "None"). "Other Ads"
  // is the pool every ad outside a capped category draws from, so it sits
  // after the caps — those rows are sub-limits inside that pool.
  return [
    { label: "Photos", value: amount(plan.photos) },
    { label: "Videos", value: amount(plan.videos) },
    ...plan.caps.map((cap) => ({ label: cap.name, value: amount(cap.ads) })),
    { label: "Other Ads", value: amount(plan.otherAds) },
    { label: "Renews", value: amount(plan.renews) },
    { label: "Auto-Renews", value: amount(plan.autoRenews) },
  ];
}

function subscriptionRows(subscription: UserSubscription): Row[] {
  return [
    { label: "Photos", value: amount(subscription.photos) },
    { label: "Ads", value: amount(subscription.ads) },
    { label: "Renews (30 days)", value: amount(subscription.renews) },
    { label: "Expires", value: formatDate(subscription.expiresAt) },
  ];
}

function HistoryCard({ subscription }: { subscription: UserSubscription }) {
  return (
    <article className="bg-card border rounded-sm p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          {subscription.packageName ?? "Subscription"}
        </p>
        <p className="truncate text-xs text-gray-500">
          {[subscription.groupName, subscription.termName]
            .filter(Boolean)
            .join(" · ")}{" "}
          · {formatDate(subscription.subscribedAt)} –{" "}
          {formatDate(subscription.expiresAt)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-sm font-medium tabular-nums text-foreground">
          ${money(subscription.priceUsd)}
        </span>
        <span
          className={`rounded-sm px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[subscription.status]}`}
        >
          {STATUS_LABEL[subscription.status]}
        </span>
      </div>
    </article>
  );
}

export default function Subscription() {
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [freePlan, setFreePlan] = useState<PublicFreePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(
    ([subs, free]: [
      PromiseSettledResult<UserSubscription[]>,
      PromiseSettledResult<PublicFreePlan>,
    ]) => {
      // Subscriptions decide which sheets render, so only they can fail the
      // page; the free plan degrades to a hidden sheet.
      if (subs.status === "fulfilled") setSubscriptions(subs.value);
      else setError("We couldn't load your membership. Please try again.");
      if (free.status === "fulfilled") setFreePlan(free.value);
      setLoading(false);
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    apply(
      await Promise.allSettled([getMySubscriptions(), getPublicFreePlan()]),
    );
  }, [apply]);

  useEffect(() => {
    let mounted = true;
    Promise.allSettled([getMySubscriptions(), getPublicFreePlan()]).then(
      (results) => {
        if (mounted) apply(results);
      },
    );
    return () => {
      mounted = false;
    };
  }, [apply]);

  // One live subscription per category, held side by side.
  const held = useMemo(
    () => activeSubscriptions(subscriptions),
    [subscriptions],
  );
  const history = useMemo(() => {
    const current = new Set(held.map((item) => item.id));
    return subscriptions.filter((item) => !current.has(item.id));
  }, [subscriptions, held]);

  return (
    <div className="min-h-screen bg-muted pb-12">
      <div className="mx-auto max-w-7xl px-4 pt-4">
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Profile", href: "/me" },
            { label: "Membership" },
          ]}
        />
      </div>

      <main className="mx-auto mt-4 max-w-4xl px-4">
        <h1 className="type-page-title text-foreground mb-4">Membership</h1>

        {loading ? (
          <div className="h-[420px] animate-pulse rounded-sm border bg-card" />
        ) : error ? (
          <div
            role="alert"
            className="rounded-sm border bg-card p-8 text-center"
          >
            <CircleAlert className="mx-auto h-8 w-8 text-amber-600" />
            <p className="mt-3 text-sm text-gray-500">{error}</p>
            <Button
              variant="outline"
              onClick={() => void load()}
              className="mt-4 h-9 rounded-sm"
            >
              <RefreshCw className="mr-2 h-4 w-4" /> Try again
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {held.map((subscription) => (
              <PlanSheet
                key={subscription.id}
                title={subscription.packageName ?? "Premium"}
                subtitle={[subscription.groupName, subscription.termName]
                  .filter(Boolean)
                  .join(" · ")}
                rows={subscriptionRows(subscription)}
              />
            ))}

            {freePlan && (
              <PlanSheet
                title="Free"
                subtitle={
                  held.length > 0
                    ? "For ads in categories your plans don't cover"
                    : undefined
                }
                rows={freeRows(freePlan)}
              />
            )}

            <Link href="/premium-account" className="group block">
              <div className="flex items-center justify-between overflow-hidden rounded-sm border bg-card">
                <div className="space-y-1">
                  <p className="px-4 pt-3 text-lg font-semibold">Need More?</p>
                  <span className="block px-4 pb-3 text-sm">
                    Upgrade to the right plan that better suits your business.
                  </span>
                </div>
                <div className="mr-3 flex items-center justify-center">
                  <ChevronRight
                    size={20}
                    className="text-[#00a0e9] transition-transform group-hover:translate-x-2"
                  />
                </div>
              </div>
            </Link>

            <Link
              href="/premium-account"
              className="mt-4 flex h-9 w-full items-center justify-center rounded-sm bg-[#00a0e9] font-medium text-white transition-colors hover:bg-[#00a0e9]/80"
            >
              Upgrade Now
            </Link>

            {history.length > 0 && (
              <section aria-label="Past plans" className="pt-2">
                <h2 className="mb-2 text-sm font-medium text-gray-500">
                  History
                </h2>
                <div className="space-y-2">
                  {history.map((subscription) => (
                    <HistoryCard
                      key={subscription.id}
                      subscription={subscription}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

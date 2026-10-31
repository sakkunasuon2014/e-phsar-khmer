"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  CircleAlert,
  ImageIcon,
  RefreshCw,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMySubscriptions } from "@/actions/subscriptions";
import type {
  SubscriptionStatus,
  UserSubscription,
} from "@/types/subscription";

/** A live subscription ending this soon reads as "Nearly Expiry". */
const NEARLY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

const STATUS_LABEL_KEY: Record<SubscriptionStatus, string> = {
  active: "active",
  expired: "expired",
  superseded: "superseded",
  revoked: "revoked",
};

const STATUS_TONE: Record<SubscriptionStatus, string> = {
  active: "text-emerald-600",
  expired: "text-red-600",
  superseded: "text-gray-500",
  revoked: "text-red-600",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

/** Whole dollars keep the reference's "$60"; cents only when they exist. */
function money(value: string | number): string {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** "Bronze - 6 Months": the package and the term it was bought for. */
function packageLine(subscription: UserSubscription): string {
  return (
    [subscription.packageName, subscription.termName]
      .filter(Boolean)
      .join(" - ") || "—"
  );
}

/** What the subscription covers: its group. */
function serviceLine(subscription: UserSubscription): string {
  return subscription.groupName ?? "—";
}

function daysLeft(expiresAt: string): number {
  return (new Date(expiresAt).getTime() - Date.now()) / DAY_MS;
}

type StatusFilter = "all" | "expired" | "nearly";
type TypeFilter = string;
type SortOrder = "start-old" | "start-new" | "end-old";

function Card({
  subscription,
  username,
  labels,
}: {
  subscription: UserSubscription;
  username: string;
  labels: {
    service: string;
    accountId: string;
    validUntil: string;
    price: string;
  };
}) {
  const t = useTranslations("Me.subscriptions");
  return (
    <article className="flex items-start gap-4 rounded-sm border bg-card p-3">
      <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-sm bg-muted">
        <ImageIcon className="h-8 w-8 text-muted-foreground" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-1 pt-1">
        <p className="type-body-sm text-foreground">
          {labels.service}: {packageLine(subscription)}
        </p>
        <p className="type-body-sm text-foreground">
          {labels.accountId}: {username || "—"}
        </p>
        <p className="type-body-sm text-foreground">
          {labels.service}: {serviceLine(subscription)}
        </p>
        <p className="type-body-sm text-foreground">
          {labels.validUntil}: {formatDate(subscription.expiresAt)}
        </p>
        <p className="type-body-sm text-foreground">
          {labels.price}: ${money(subscription.priceUsd)}
        </p>
      </div>
      <span
        className={`type-meta shrink-0 self-end ${STATUS_TONE[subscription.status]}`}
      >
        {t(STATUS_LABEL_KEY[subscription.status])}
      </span>
    </article>
  );
}

/**
 * `/me/subscriptions` — the viewer's own subscriptions as the v1 list page
 * (title + Type/Status/Sort bar over cards), backed by `GET /subscriptions/me`
 * instead of the old hardcoded mock. The Membership plan screen moved back to
 * `/me/membership`; this page never renders it.
 */
export default function Subscriptions({ username }: { username: string }) {
  const t = useTranslations("Me.subscriptions");
  const router = useRouter();

  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortOrder>("start-old");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSubscriptions(await getMySubscriptions());
    } catch {
      setError(t("loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let mounted = true;
    // `loading` already starts true — the first paint is the skeleton.
    getMySubscriptions()
      .then((rows) => {
        if (mounted) setSubscriptions(rows);
      })
      .catch(() => {
        if (mounted) setError(t("loadError"));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [t]);

  // "Type" is the real subscription group; the reference's Ads/Addons/Account
  // split has no backing field, and inventing one would misfile every row.
  const groups = useMemo(
    () =>
      Array.from(
        new Set(
          subscriptions
            .map((subscription) => subscription.groupName)
            .filter((name): name is string => Boolean(name)),
        ),
      ),
    [subscriptions],
  );

  const visible = useMemo(() => {
    let rows = subscriptions;
    if (type !== "all") {
      rows = rows.filter((subscription) => subscription.groupName === type);
    }
    if (status === "expired") {
      rows = rows.filter((subscription) => subscription.status === "expired");
    } else if (status === "nearly") {
      rows = rows.filter(
        (subscription) =>
          subscription.status === "active" &&
          daysLeft(subscription.expiresAt) <= NEARLY_DAYS,
      );
    }
    return [...rows].sort((a, b) => {
      if (sort === "start-old") {
        return (
          new Date(a.subscribedAt).getTime() -
          new Date(b.subscribedAt).getTime()
        );
      }
      if (sort === "start-new") {
        return (
          new Date(b.subscribedAt).getTime() -
          new Date(a.subscribedAt).getTime()
        );
      }
      return new Date(a.expiresAt).getTime() - new Date(b.expiresAt).getTime();
    });
  }, [subscriptions, type, status, sort]);

  const labels = {
    service: t("service"),
    accountId: t("accountId"),
    validUntil: t("validUntil"),
    price: t("price"),
  };

  return (
    <div className="min-h-screen bg-muted pb-12 pt-6">
      <div className="mx-auto max-w-7xl px-4">
        <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <h1 className="type-page-title text-foreground">{t("title")}</h1>

          <div className="flex items-center gap-3">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-[160px] bg-card">
                <SelectValue placeholder={t("typeAll")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("typeAll")}</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group} value={group}>
                    {group}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={status}
              onValueChange={(value) => setStatus(value as StatusFilter)}
            >
              <SelectTrigger className="w-[160px] bg-card">
                <SelectValue placeholder={t("statusAll")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("statusAll")}</SelectItem>
                <SelectItem value="expired">{t("expired")}</SelectItem>
                <SelectItem value="nearly">{t("nearly")}</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={sort}
              onValueChange={(value) => setSort(value as SortOrder)}
            >
              <SelectTrigger className="w-[210px] bg-card">
                <SelectValue placeholder={t("sortStart")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="start-old">
                  {t("sortStartOldNew")}
                </SelectItem>
                <SelectItem value="start-new">
                  {t("sortStartNewOld")}
                </SelectItem>
                <SelectItem value="end-old">{t("sortEndOldNew")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <main className="mt-4">
          {loading ? (
            <div className="mx-auto h-[420px] max-w-2xl animate-pulse rounded-sm border bg-card" />
          ) : error ? (
            <div
              role="alert"
              className="mx-auto max-w-2xl rounded-sm border bg-card p-8 text-center"
            >
              <CircleAlert className="mx-auto h-8 w-8 text-amber-600" />
              <p className="mt-3 type-body-sm text-gray-500">{error}</p>
              <Button
                variant="outline"
                onClick={() => void load()}
                className="mt-4 h-9 rounded-sm"
              >
                <RefreshCw className="mr-2 h-4 w-4" /> {t("retry")}
              </Button>
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="mx-auto flex min-h-[450px] max-w-2xl flex-col items-center justify-center rounded-sm border bg-card p-8 shadow-sm">
              <div className="mb-8 flex h-32 w-32 items-center justify-center rounded-full bg-muted">
                <BadgeDollarSign
                  className="h-12 w-12 text-muted-foreground"
                  strokeWidth={1.5}
                />
              </div>
              <div className="text-center">
                <h2 className="type-section-title mb-2 text-foreground">
                  {t("noResult")}
                </h2>
                <p className="mb-8 type-body-sm text-muted-foreground">
                  {t("empty")}
                </p>
                <Button
                  onClick={() =>
                    router.push({
                      pathname: "/premium-account",
                      query: { id: "me" },
                    })
                  }
                  className="h-10 cursor-pointer rounded-sm bg-orange-400 px-8 font-medium text-card transition-colors hover:bg-orange-600"
                >
                  {t("subscribeNow")}
                </Button>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="mx-auto max-w-2xl rounded-sm border bg-card p-8 text-center">
              <h2 className="type-section-title text-foreground">
                {t("noResult")}
              </h2>
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map((subscription) => (
                <Card
                  key={subscription.id}
                  subscription={subscription}
                  username={username}
                  labels={labels}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

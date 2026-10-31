"use client";
import { SearchIcon, ImagePlus, Funnel } from "lucide-react";
import { Field } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/routing";
import { ProfileListingRow } from "@/components/profile/ProfileListingRow";
import { ManageAdActions } from "@/components/profile/ManageAdActions";
import { loadMyAds } from "@/actions/my-ads";
import type { MyAdsTab } from "@/lib/api/my-ads";
import type { PlanEntitlements } from "@/types/subscription";
import type { Post } from "@/lib/posts";

interface TabState {
  tab: MyAdsTab;
  items: Post[];
  page: number;
  hasMore: boolean;
  error: string | null;
}

const TAB_ORDER: MyAdsTab[] = ["active", "expired", "hidden"];

export default function ManageAds() {
  const t = useTranslations("Me.manageAds");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<MyAdsTab>("active");
  // What the last fetch returned, tagged with the tab it belongs to. A result
  // for another tab counts as "still loading" — derived at render, so the
  // effect never has to reset state synchronously when the tab changes.
  const [loaded, setLoaded] = useState<TabState | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [plan, setPlan] = useState<PlanEntitlements | null>(null);
  const [counts, setCounts] = useState<Partial<Record<MyAdsTab, number>>>({});
  /** Bumped after a row action (renew/delete) to reload the current tab. */
  const [reloadKey, setReloadKey] = useState(0);

  const current = loaded?.tab === activeTab ? loaded : null;
  const items = current?.items ?? null;
  const error = current?.error ?? null;
  const hasMore = current?.hasMore ?? false;

  const hiddenCount = counts.hidden ?? 0;
  // The Hidden tab only exists when there is something hidden in it — but a
  // user already standing on it keeps it until they leave.
  const showHidden = hiddenCount > 0 || activeTab === "hidden";
  const tabs = showHidden
    ? TAB_ORDER
    : TAB_ORDER.filter((tab) => tab !== "hidden");

  /**
   * Cards read the account allowance: live ads in the pools the user can use
   * (the free plan's total plus every held group). Restricted ads already
   * count as live, so they are subtracted here and reported separately — the
   * card never reads "13/5".
   */
  const activeAds = plan ? Math.max(0, plan.usage.ads - plan.usage.hidden) : 0;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await loadMyAds(activeTab, 1);
      if (cancelled) return;
      setLoaded({
        tab: activeTab,
        items: result.items,
        page: 1,
        hasMore: result.hasMore,
        error: result.error ?? null,
      });
      setCounts((c) => ({ ...c, ...result.counts }));
      if (result.plan) setPlan(result.plan);
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, reloadKey]);

  const loadMore = () => {
    if (loadingMore || !current) return;
    setLoadingMore(true);
    const tab = activeTab;
    const next = current.page + 1;

    void (async () => {
      const result = await loadMyAds(tab, next);
      setLoadingMore(false);
      setLoaded((prev) => {
        // The user switched tabs while this page was in flight.
        if (!prev || prev.tab !== tab) return prev;
        if (result.error) return { ...prev, error: result.error };
        const seen = new Set(prev.items.map((p) => p.postId));
        return {
          ...prev,
          items: [
            ...prev.items,
            ...result.items.filter((p) => !seen.has(p.postId)),
          ],
          page: next,
          hasMore: result.hasMore,
        };
      });
    })();
  };

  /**
   * Row badge: the Hidden chip on that tab, the Expired chip on its own, and —
   * on Active — a warning once the 30-day window is within three days, so the
   * owner sees it coming before the ad leaves the feed (and gets the matching
   * notification).
   */
  function rowBadge(post: Post) {
    const chip = (label: string) => (
      <span className="rounded-sm bg-amber-500/10 px-1.5 py-0.5 type-discount text-amber-700 dark:text-amber-400">
        {label}
      </span>
    );
    if (activeTab === "hidden") return chip(t("hiddenBadge"));
    if (activeTab === "expired") return chip(t("expired"));
    const days = post.expiresInDays;
    if (days === undefined || days <= 0 || days > 3) return undefined;
    return chip(
      days <= 1 ? t("expiresWithinDay") : t("expiresInDays", { days }),
    );
  }

  return (
    <div className="min-h-screen bg-muted pt-4">
      <div className="max-w-7xl mx-auto">
        {/* Controls card. The ad list is its own section below it (captain,
            2026-10-27): the listings must not share the Active/Expired card. */}
        <div className="bg-card rounded-sm pb-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border">
            <h1 className="text-foreground text-xl py-2 px-4 pt-6">
              {t("title")}
            </h1>
            <hr />
            <div className="flex items-center justify-end gap-3 py-2 pt-6 px-6">
              <Field className="flex-1">
                <InputGroup>
                  <InputGroupInput
                    id="inline-start-input"
                    placeholder={t("searchPlaceholder")}
                    className="h-11 border-gray-200 focus:ring-0"
                  />
                  <InputGroupAddon align="inline-end">
                    <SearchIcon className="text-muted-foreground w-5 h-5 mr-2" />
                  </InputGroupAddon>
                </InputGroup>
              </Field>
              <Button
                variant="outline"
                className="h-10 rounded-sm px-5 border-muted-foreground text-foreground hover:text-foreground font-medium"
              >
                <Funnel className="scale-120" />
                {t("filter")}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4 px-4">
            <div className="bg-muted h-20 w-full rounded-md p-6 text-center text-primary font-medium cursor-pointer hover:bg-muted/80 transition-colors flex flex-col justify-center gap-1">
              {t("totalAds")}
              <p className="text-lg text-foreground">
                {plan ? `${activeAds}/${plan.limits.ads}` : "–"}
              </p>
            </div>
            <div className="bg-muted h-20 w-full text-center p-6 rounded-md text-foreground font-medium cursor-pointer hover:bg-muted/80 transition-colors flex flex-col justify-center gap-1">
              {t("renews")}
              <p className="text-lg text-foreground">
                {plan ? `${plan.usage.renews}/${plan.limits.renews}` : "–"}
              </p>
            </div>
          </div>
          {plan && plan.usage.hidden > 0 ? (
            <div className="mx-4 mb-4">
              <button
                type="button"
                onClick={() => setActiveTab("hidden")}
                className="w-full rounded-sm border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-left type-meta text-amber-700 transition-colors hover:bg-amber-500/15 dark:text-amber-400 cursor-pointer"
              >
                {t("hiddenNote", { count: plan.usage.hidden })}
              </button>
            </div>
          ) : null}
          <div className="mx-4">
            <div
              className={`grid gap-1 rounded-md bg-muted p-1 ${
                showHidden ? "grid-cols-3" : "grid-cols-2"
              }`}
            >
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`h-9 rounded-sm text-base font-semibold transition-colors cursor-pointer ${
                    activeTab === tab
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(tab)}{" "}
                  <span className="text-[#00a0e9]">({counts[tab] ?? 0})</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* The ads live in their own section below the controls card, with
            only the page background between them (captain, 2026-10-27). */}
        <div className="mt-6">
          {error || items === null ? (
            <div className="flex min-h-[300px] items-center justify-center px-4 text-center">
              <p className="text-sm text-muted-foreground">
                {error ?? tCommon("loading")}
              </p>
            </div>
          ) : items.length > 0 ? (
            <div className="pb-8">
              {activeTab === "hidden" ? (
                <div className="mx-4 mb-3 flex flex-col gap-2 rounded-sm border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                  <p className="type-meta text-muted-foreground">
                    {t("hiddenNotice")}
                  </p>
                  <Link
                    href="/premium-account"
                    className="shrink-0 text-sm font-semibold text-[#00a0e9] underline"
                  >
                    {t("upgradePlan")}
                  </Link>
                </div>
              ) : null}
              {/* List rows, not a grid (captain, 2026-10-27): a populated tab
                  fills the column; only the empty state is centred. */}
              <div className="space-y-3">
                {items.map((post) => (
                  <ProfileListingRow
                    key={post.postId}
                    post={post}
                    badge={rowBadge(post)}
                    linkable={activeTab !== "hidden"}
                    action={
                      <ManageAdActions
                        post={post}
                        hidden={activeTab === "hidden"}
                        onChanged={() => setReloadKey((key) => key + 1)}
                      />
                    }
                  />
                ))}
              </div>
              {hasMore && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="rounded-sm border bg-card px-6 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60 cursor-pointer"
                  >
                    {loadingMore ? tCommon("loading") : tCommon("loadMore")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto flex min-h-[450px] max-w-2xl flex-col items-center justify-center rounded-sm border bg-card p-8 text-center shadow-sm">
              <div className="bg-muted w-36 h-36 rounded-full flex items-center justify-center ">
                <ImagePlus className="w-16 h-16 text-muted-foreground stroke-1" />
              </div>

              <h2 className="text-lg font-medium text-foreground mb-3">
                {t("noResult")}
              </h2>

              {activeTab === "active" ? (
                <div className="flex flex-col items-center gap-8">
                  <p className="text-muted-foreground text-sm">
                    {t("noActive")}
                  </p>
                  <Button
                    onClick={() => router.push("/post")}
                    className="bg-[#f28e1c] hover:bg-[#d17a15] text-white font-semibold text-sm px-6 py-5   rounded-sm transition-colors cursor-pointer"
                  >
                    {t("sell")}
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {activeTab === "hidden" ? t("noHidden") : t("noExpired")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

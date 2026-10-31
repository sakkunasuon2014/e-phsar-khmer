"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IconLayoutGridFilled, IconListFilled } from "@tabler/icons-react";
import { GridCardPost } from "@/components/ads/GridCardPost";
import { GridCardSell } from "@/components/ads/GridCardSell";
import { ListCardPost } from "@/components/ads/ListCardPost";
import { ListCardSell } from "@/components/ads/ListCardSell";

// ─── Filter components (URL-param driven; the page reads the same params) ────
import { LocationSelectorFilter } from "@/components/filter/LocationSelectorFilter";
import SortFilter from "@/components/filter/SortFilter";
import PriceFilter from "@/components/filter/PriceFilter";
import MoreFilters from "@/components/filter/MoreFilters";

import { useTranslations } from "next-intl";
import { getAllAdsBatch } from "@/actions/listings";
import type { AllAdsFilters } from "@/lib/all-ads";
import type { Post } from "@/lib/posts";

interface AllAdsFeedProps {
  /** First screen, rendered by the page. */
  initialPosts: Post[];
  /** Where the next screen starts; null = the feed is finished. */
  initialCursor: string | null;
  filters: AllAdsFilters;
  /** Province-scoped heading, e.g. "All Ads in Kandal"; default is Cambodia. */
  heading?: string;
  locale: string;
  /** The category strip — a server component, slotted between the bar and the grid. */
  children?: React.ReactNode;
}

/**
 * The All Ads feed: the whole active catalogue, one screen at a time.
 *
 * The page renders the first screen server-side (with the URL's filters applied
 * there), and this component appends the rest as the visitor reaches the bottom
 * — the backend feed is cursor-paginated, so "the rest" is a cursor, not a page
 * number. A filter change re-renders the page, which re-keys this component, so
 * the accumulated screens reset with it.
 */
export default function AllAdsFeed({
  initialPosts,
  initialCursor,
  filters,
  heading,
  locale,
  children,
}: AllAdsFeedProps) {
  const t = useTranslations("AllAds");
  const [posts, setPosts] = React.useState(initialPosts);
  const [cursor, setCursor] = React.useState(initialCursor);
  const [loading, setLoading] = React.useState(false);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  // One observer per cursor, watching the sentinel rather than the scroll
  // position. The fetch lives in the observer callback — an event, not a
  // render-time effect — and the effect re-runs on every cursor the feed
  // hands back, so a screen that lands while the sentinel is still in sight
  // immediately arms the next one.
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !cursor) return;
    let cancelled = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        // One shot per cursor: the effect below re-observes after each screen.
        observer.disconnect();
        void (async () => {
          setLoading(true);
          try {
            const batch = await getAllAdsBatch(filters, cursor, locale);
            if (cancelled) return;
            setPosts((current) => {
              // A listing posted between two screens can shift the cursor
              // boundary — drop anything already on screen rather than draw it
              // twice.
              const seen = new Set(current.map((post) => post.postId));
              return [
                ...current,
                ...batch.items.filter((p) => !seen.has(p.postId)),
              ];
            });
            setCursor(batch.nextCursor);
          } catch {
            // Keep what is on screen; the next scroll re-arms the sentinel.
          } finally {
            if (!cancelled) setLoading(false);
          }
        })();
      },
      // Start before the visitor actually hits the floor, so the next screen is
      // usually there by the time they arrive.
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cursor, filters, locale]);

  // `parseFeedParams` drops undefined keys, so any key left is an active
  // filter — this must track the whole feed vocabulary, not a subset.
  const hasFilters = Object.keys(filters).length > 0;
  const emptyMessage = hasFilters ? t("emptyFiltered") : t("empty");

  return (
    <Tabs defaultValue="grid" className="max-w-7xl select-none bg-muted">
      {/* Header title */}
      <div className="px-6 py-3 bg-card rounded-t-sm border">
        <h1 className="type-page-title text-card-foreground">
          {heading ?? t("heading")}
        </h1>
      </div>

      {/* Sticky filter bar */}
      <div className="sticky top-16 z-40 flex items-center justify-between bg-card rounded-b-sm border px-4 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <LocationSelectorFilter />
          <SortFilter />
          <PriceFilter />
          <MoreFilters />
        </div>
        <TabsList className="h-9 shrink-0">
          <TabsTrigger value="grid" className="cursor-pointer px-3">
            <IconLayoutGridFilled className="size-4" />
          </TabsTrigger>
          <TabsTrigger value="list" className="cursor-pointer px-3">
            <IconListFilled className="size-4" />
          </TabsTrigger>
        </TabsList>
      </div>

      {/* Category filter */}
      <div>{children}</div>

      {/* Grid view */}
      <TabsContent value="grid" className="mt-4">
        {posts.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            <GridCardSell />
            {posts.map((post) => (
              <GridCardPost key={post.postId} post={post} />
            ))}
          </div>
        )}
      </TabsContent>

      {/* List view */}
      <TabsContent value="list" className="mt-4 space-y-4">
        {posts.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">
            {emptyMessage}
          </p>
        ) : (
          <>
            <ListCardSell />
            {posts.map((post) => (
              <ListCardPost key={post.postId} post={post} />
            ))}
          </>
        )}
      </TabsContent>

      {/* Next-screen sentinel — only while the backend still has a cursor to give. */}
      {cursor && (
        <div
          ref={sentinelRef}
          className="flex min-h-12 items-center justify-center"
        >
          {loading && (
            <p className="type-body-sm text-muted-foreground">
              {t("loadingMore")}
            </p>
          )}
        </div>
      )}
    </Tabs>
  );
}

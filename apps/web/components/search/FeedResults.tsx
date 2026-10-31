"use client";

import { Fragment, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { GridCardPost } from "@/components/ads/GridCardPost";
import { ListCardPost } from "@/components/ads/ListCardPost";
import { loadMoreListings } from "@/actions/listings";
import type { ListingsFeedParams } from "@/lib/api/categories";
import type { Post } from "@/lib/posts";

interface FeedResultsProps {
  initialPosts: Post[];
  initialCursor: string | null;
  /** The query page 1 was fetched with — later pages reuse it verbatim. */
  query: ListingsFeedParams;
  locale: string;
  gridClassName?: string;
  /** Rendered first in each view (e.g. the Sell card on browse pages). */
  gridLead?: React.ReactNode;
  listLead?: React.ReactNode;
}

/**
 * The grid/list result views of a listings feed plus "Load more". Must sit
 * inside the page's `<Tabs>`. The page keys it by the serialized query, so
 * any filter change remounts it and the appended pages reset.
 */
export function FeedResults({
  initialPosts,
  initialCursor,
  query,
  locale,
  gridClassName = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4",
  gridLead,
  listLead,
}: FeedResultsProps) {
  const t = useTranslations("Search");
  const [posts, setPosts] = useState(initialPosts);
  const [cursor, setCursor] = useState(initialCursor);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  const loadMore = () => {
    if (!cursor) return;
    startTransition(async () => {
      try {
        const next = await loadMoreListings(query, cursor, locale);
        setPosts((prev) => {
          // Belt and braces: a row can never appear twice even if a listing
          // changed position between page loads.
          const seen = new Set(prev.map((p) => String(p.postId)));
          return [
            ...prev,
            ...next.posts.filter((p) => !seen.has(String(p.postId))),
          ];
        });
        setCursor(next.nextCursor);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    });
  };

  return (
    <>
      <TabsContent value="grid" className="mt-4">
        <div className={gridClassName}>
          {/* The lead arrives as a prop element rather than a JSX child of
              this component, so React's dev key check sees it sitting in the
              same children array as the mapped posts and warns "Each child in
              a list should have a unique key prop". The explicit key marks
              this single static slot as intentional. */}
          <Fragment key="grid-lead">{gridLead}</Fragment>
          {posts.map((post) => (
            <GridCardPost key={post.postId} post={post} />
          ))}
        </div>
      </TabsContent>
      <TabsContent value="list" className="mt-4">
        <Fragment key="list-lead">{listLead}</Fragment>
        {posts.map((post) => (
          <ListCardPost key={post.postId} post={post} />
        ))}
      </TabsContent>

      {cursor && (
        <div className="flex flex-col items-center gap-2 py-6">
          {failed && (
            <p className="type-body-sm text-destructive" role="alert">
              {t("loadMoreError")}
            </p>
          )}
          <Button
            onClick={loadMore}
            disabled={pending}
            variant="outline"
            className="h-10 min-w-40 rounded-sm cursor-pointer"
          >
            {pending ? t("loading") : t("loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}

"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Bookmark, Heart } from "lucide-react";
import { ProfileListingRow } from "@/components/profile/ProfileListingRow";
import { loadMyReactionPage } from "@/actions/reactions";
import { useReactions } from "@/components/reactions/reactions-provider";
import type { Post } from "@/lib/posts";

/**
 * A liked/saved list for the `/me` pages, fetched in the browser through a
 * server action — those lists are JWT-scoped, so the call has to go out with
 * the session cookies, which only the server has.
 *
 * An empty list and a failed one must not look the same: the error is
 * surfaced rather than rendered as the "no results" design. The empty branch
 * is the design these pages shipped with; only the list branch is new.
 */
const COPY = {
  likes: { titleKey: "liked", Icon: Heart, bodyKey: "likedEmpty" },
  saves: { titleKey: "saved", Icon: Bookmark, bodyKey: "savedEmpty" },
} as const;

export default function ReactionAdsPanel({
  side,
}: {
  side: "likes" | "saves";
}) {
  const t = useTranslations("Me.reactions");
  const tCommon = useTranslations("Common");
  const { titleKey, Icon, bodyKey } = COPY[side];
  const reactions = useReactions();
  const [items, setItems] = React.useState<Post[] | null>(null);
  const [page, setPage] = React.useState(1);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await loadMyReactionPage(side, 1);
      if (cancelled) return;
      setItems(result.items);
      setHasMore(result.hasMore);
      setError(result.error ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [side]);

  const loadMore = () => {
    if (loadingMore) return;
    setLoadingMore(true);

    void (async () => {
      const next = page + 1;
      const result = await loadMyReactionPage(side, next);
      setLoadingMore(false);

      if (result.error) {
        setError(result.error);
        return;
      }
      setItems((current) => {
        // A listing liked/saved between two pages can shift the boundary —
        // drop anything already on screen rather than draw it twice.
        const seen = new Set((current ?? []).map((p) => p.postId));
        return [
          ...(current ?? []),
          ...result.items.filter((p) => !seen.has(p.postId)),
        ];
      });
      setPage(next);
      setHasMore(result.hasMore);
    })();
  };

  // A row toggled off in this session drops out live (the fetched page was
  // read before that click). The test is the toggle, not membership: the
  // provider's seed sets fail soft to empty, and filtering by membership
  // would blank the whole list whenever that seed fetch failed.
  const kind = side === "likes" ? "like" : "save";
  const visible = (items ?? []).filter(
    (post) => !reactions.isToggledOff(kind, String(post.postId)),
  );

  const messageCard = (message: React.ReactNode) => (
    <main className="max-w-2xl mx-auto mt-3">
      <div className="bg-card rounded-xs shadow-sm min-h-[500px] flex items-center justify-center p-6">
        <p className="type-body-sm text-muted-foreground">{message}</p>
      </div>
    </main>
  );

  return (
    <div className="min-w-full bg-muted pb-50 pt-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="type-page-title text-foreground mb-4">{t(titleKey)}</h1>
        {error ? (
          messageCard(error)
        ) : items === null ? (
          messageCard(tCommon("loading"))
        ) : visible.length === 0 ? (
          <main className="max-w-2xl mx-auto mt-3">
            <div className="bg-card rounded-xs shadow-sm  min-h-[500px] flex flex-col items-center justify-center p-6">
              <div className="w-32 h-32 bg-muted rounded-full flex items-center justify-center mb-10 mt-4">
                <Icon className="w-16 h-16 text-gray-500" strokeWidth={2.5} />
              </div>
              <div className="text-center">
                <h2 className="type-section-title text-foreground mb-2">
                  {t("noResult")}
                </h2>
                <p className="text-muted-foreground type-body-sm">
                  {t(bodyKey)}
                </p>
              </div>
            </div>
          </main>
        ) : (
          <>
            {/* List rows, not a grid (captain, 2026-10-27): a populated tab
                fills the column; only the empty state is a centred card. */}
            <div className="mt-3 space-y-3">
              {visible.map((post) => {
                const listingId = String(post.postId);
                return (
                  <ProfileListingRow
                    key={post.postId}
                    post={post}
                    action={
                      <button
                        type="button"
                        disabled={reactions.isPending(listingId)}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          if (kind === "save") reactions.toggleSave(listingId);
                          else reactions.toggleLike(listingId);
                        }}
                        className="cursor-pointer rounded-full p-2 transition-colors hover:bg-muted disabled:opacity-60"
                      >
                        {kind === "save" ? (
                          <Bookmark
                            className={`h-5 w-5 ${
                              reactions.isSaved(listingId)
                                ? "fill-blue-500 text-blue-500"
                                : "text-muted-foreground"
                            }`}
                          />
                        ) : (
                          <Heart
                            className={`h-5 w-5 ${
                              reactions.isLiked(listingId)
                                ? "fill-red-500 text-red-500"
                                : "text-muted-foreground"
                            }`}
                          />
                        )}
                      </button>
                    }
                  />
                );
              })}
            </div>
            {hasMore && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="rounded-sm border bg-card px-6 py-2 type-nav text-foreground transition-colors hover:bg-muted disabled:opacity-60 cursor-pointer"
                >
                  {loadingMore ? tCommon("loading") : tCommon("loadMore")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

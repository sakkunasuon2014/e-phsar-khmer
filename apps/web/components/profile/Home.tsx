"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SearchIcon, MapPin, LayoutGrid, List } from "lucide-react";
import { IconFilterSearch, IconBasketSearch } from "@tabler/icons-react";
import { Field } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GridCardPost } from "@/components/ads/GridCardPost";
import { ListCardPost } from "@/components/ads/ListCardPost";
import SellerCategoryStrip from "@/components/profile/SellerCategoryStrip";
import type {
  StripCategory,
  StripSelection,
} from "@/components/profile/SellerCategoryStrip";
import { getSellerAdsBatch } from "@/actions/listings";
import type { Post } from "@/lib/posts";

interface HomeProfileProps {
  /** The profile being viewed — the seller whose ads this grid shows. */
  userId: string;
  /** The seller's own category tree, already scoped to what they posted in. */
  categories: StripCategory[];
  /** Where a shared link or a reload lands, resolved by the page. */
  initialSelection: StripSelection;
  /** First screen, rendered by the page. */
  initialPosts: Post[];
  /** Where the next screen starts; null = no more ads under this selection. */
  initialCursor: string | null;
  locale: string;
}

/** Identifies a query — everything a response must still match to be rendered. */
function sellerQueryKey(userId: string, selection: StripSelection): string {
  return `${userId}|${selection.category ?? ""}|${selection.subcategory ?? ""}`;
}

/**
 * The seller's post history — the profile's Home tab.
 *
 * This grid used to be a hardcoded empty state that ignored the profile it was
 * rendered for, so every account read "You don't have any post right now" no
 * matter how many ads it had. It now renders that seller's real active ads and
 * lets a visitor drill down through their categories — the panel's third row,
 * under the search and location rows.
 *
 * The drill is deliberately client-side: picking a category or subcategory
 * fetches the next slice from a server action and swaps the grid, so no RSC
 * round trip happens and nothing remounts. Each pick also pushes a URL —
 * not `router.push`, which is a *real* navigation: this page reads
 * `searchParams`, so it would re-render on the server, move the `key`, and
 * throw the drill-down away. Next routes raw history through the router anyway
 * (so `useSearchParams` consumers still see the new URL), but it restores the
 * tree it already has rather than refetching it.
 *
 * Pushing rather than replacing is what gives the Back arrow something to step
 * to, and the listener below replays whichever selection Back restores. The
 * push happens in the click handler and never in an effect: on first mount Next
 * has not patched `history` yet, so an early call lands on the native one with
 * `data === null`, which wipes that entry's state and leaves Back doing
 * nothing.
 *
 * The bar's search box, Filter and Location are still mock controls — wiring
 * them is a separate, larger job than showing the posts was.
 */
export default function HomeProfile({
  userId,
  categories,
  initialSelection,
  initialPosts,
  initialCursor,
  locale,
}: HomeProfileProps) {
  const t = useTranslations("Profile");
  const [selection, setSelection] =
    React.useState<StripSelection>(initialSelection);
  const [posts, setPosts] = React.useState(initialPosts);
  const [cursor, setCursor] = React.useState(initialCursor);
  const [loading, setLoading] = React.useState(false);
  const sentinelRef = React.useRef<HTMLDivElement | null>(null);

  const { category, subcategory } = selection;

  // The query the grid is currently allowed to show. Both fetch sites check it
  // when their response lands, so neither a slow drill-down nor a pagination
  // page that resolves just as the visitor picks something new can write to the
  // grid — and a cursor from the wrong query can never be installed, which
  // matters because the backend cursor is only `{createdAt, id}` and would
  // splice two filters' pages together without erroring.
  const queryKeyRef = React.useRef(sellerQueryKey(userId, initialSelection));

  /**
   * Applies a selection and loads its first screen.
   *
   * `mode` decides whether the choice becomes a step the Back arrow can return
   * to: a tap pushes one, while the popstate handler replays a selection with
   * `"none"` because the browser has already moved the URL itself.
   */
  const runSelection = React.useCallback(
    async (next: StripSelection, mode: "push" | "none") => {
      // Synchronously, before the fetch: an in-flight pagination response must
      // see the new key the moment this click happens, not after React commits.
      const nextKey = sellerQueryKey(userId, next);
      queryKeyRef.current = nextKey;
      setSelection(next);
      // Drop the cursor before the fetch, not after: the sentinel's effect
      // re-runs on the new selection while the old cursor is still in state,
      // and would otherwise ask the new category for "more after the previous
      // category's cursor" and append the wrong slice.
      setCursor(null);
      setLoading(true);

      if (mode === "push") {
        // Raw history, not the router: this must not start a server
        // navigation. Next routes both through the router anyway, but a
        // history entry is restored from the tree it already has instead of
        // being refetched — and it is what gives Back something to step to.
        const url = new URL(window.location.href);
        if (next.category) url.searchParams.set("category", next.category);
        else url.searchParams.delete("category");
        if (next.subcategory)
          url.searchParams.set("subcategory", next.subcategory);
        else url.searchParams.delete("subcategory");
        window.history.pushState(null, "", url);
      }

      try {
        const batch = await getSellerAdsBatch(
          {
            userId,
            categorySlug: next.category,
            subcategorySlug: next.subcategory,
          },
          undefined,
          locale,
        );
        if (queryKeyRef.current !== nextKey) return;
        setPosts(batch.items);
        setCursor(batch.nextCursor);
      } catch {
        // Leave the grid as it was — a thrown action is not an empty result.
      } finally {
        if (queryKeyRef.current === nextKey) setLoading(false);
      }
    },
    [userId, locale],
  );

  const applySelection = React.useCallback(
    (next: StripSelection) => void runSelection(next, "push"),
    [runSelection],
  );

  // The Back arrow walks the drill: every tap pushed an entry, so stepping back
  // just re-reads whichever selection the browser restored into the URL.
  React.useEffect(() => {
    const onPopState = () => {
      const params = new URLSearchParams(window.location.search);
      void runSelection(
        {
          category: params.get("category") ?? undefined,
          subcategory: params.get("subcategory") ?? undefined,
        },
        "none",
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [runSelection]);

  // One observer per cursor, watching a sentinel rather than the scroll
  // position — the same shape `AllAdsFeed` uses for the whole catalogue.
  React.useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !cursor) return;
    let cancelled = false;
    const key = sellerQueryKey(userId, { category, subcategory });

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        // One shot per cursor: the effect below re-observes after each screen.
        observer.disconnect();
        void (async () => {
          setLoading(true);
          try {
            const batch = await getSellerAdsBatch(
              { userId, categorySlug: category, subcategorySlug: subcategory },
              cursor,
              locale,
            );
            // `cancelled` covers the effect's own cleanup; the key covers the
            // window between a drill-down click and React committing it, when
            // this closure is still live but its query is already history.
            if (cancelled || queryKeyRef.current !== key) return;
            setPosts((current) => {
              // An ad posted between two screens can shift the cursor
              // boundary — drop anything already on screen rather than draw
              // it twice.
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
      // Start before the visitor actually hits the floor.
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [cursor, userId, category, subcategory, locale]);

  // The mock card said "You don't have any post right now" — wrong in the
  // second person on someone else's profile, and wrong whenever the empty
  // result is the drill-down's doing rather than the seller's.
  const emptyMessage = subcategory
    ? t("noPostsSub")
    : category
      ? t("noPostsCat")
      : t("noPosts");

  const emptyState = (
    <div className="mt-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex flex-col bg-card rounded-sm items-center p-4 pb-6 shadow-sm">
          <div className="flex items-center justify-center bg-muted rounded-full h-34 w-34 mt-6">
            <IconBasketSearch
              className="text-muted-foreground scale-180"
              stroke={2}
            />
          </div>
          <p className="type-card-heading text-foreground pt-4">
            {t("noResult")}
          </p>
          <p className="text-muted-foreground pt-2">{emptyMessage}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="bg-muted">
      <div className="max-w-7xl mx-auto pb-40 px-4 pt-1">
        <Tabs defaultValue="grid" className="select-none">
          {/* No `mx-auto` here: the Tabs root is a flex column, and an auto
              inline margin on a flex item cancels `stretch`, which collapsed
              this panel to the width of its own contents. The wrapper above
              already centres and caps the page. */}
          <main>
            {/* One panel, three rows: search, then location, then the category
                row — divided by a hairline rather than a gap. The band is
                full-bleed, so only the first two rows take the padding. */}
            <div className="bg-card rounded-sm shadow-sm">
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <Field className="flex-1">
                    <InputGroup className="h-10 rounded-sm">
                      <InputGroupInput
                        id="inline-start-input"
                        placeholder={t("search")}
                        className="h-10 border-gray-200 focus:ring-0"
                      />
                      <InputGroupAddon align="inline-end">
                        <SearchIcon className="text-muted-foreground w-5 h-5 mr-2" />
                      </InputGroupAddon>
                    </InputGroup>
                  </Field>
                  <Button
                    variant="outline"
                    className="h-10 rounded-sm px-5 border-muted-foreground/30 text-foreground hover:text-foreground font-medium"
                  >
                    <IconFilterSearch className="scale-120" />
                    {t("filter")}
                  </Button>
                </div>
                <div className="flex items-center justify-between mt-6 px-1">
                  <div className="flex items-center gap-2 text-[#00a0e9] type-nav cursor-pointer">
                    <MapPin className="w-4 h-4" />
                    <span>{t("location")}</span>
                  </div>
                  {/* Named because the profile header renders its own
                      Home/About tablist — an unnamed second one on the page is
                      ambiguous, and both triggers here are icon-only. */}
                  <TabsList className="h-9 shrink-0" aria-label={t("view")}>
                    <TabsTrigger
                      value="list"
                      className="cursor-pointer px-3"
                      aria-label={t("listView")}
                    >
                      <List className="w-5 h-5" />
                    </TabsTrigger>
                    <TabsTrigger
                      value="grid"
                      className="cursor-pointer px-3"
                      aria-label={t("gridView")}
                    >
                      <LayoutGrid className="w-5 h-5" />
                    </TabsTrigger>
                  </TabsList>
                </div>
              </div>

              <SellerCategoryStrip
                categories={categories}
                category={category}
                subcategory={subcategory}
                onSelect={applySelection}
              />
            </div>
          </main>

          <TabsContent value="grid" className="mt-4">
            {posts.length === 0 ? (
              emptyState
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {posts.map((post) => (
                  <GridCardPost key={post.postId} post={post} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="list" className="mt-4 space-y-4">
            {posts.length === 0
              ? emptyState
              : posts.map((post) => (
                  <ListCardPost key={post.postId} post={post} />
                ))}
          </TabsContent>

          {/* Next-screen sentinel — only while the feed still has a cursor. */}
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
      </div>
    </div>
  );
}

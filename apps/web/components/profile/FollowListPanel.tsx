"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import FollowListCard from "./FollowListCard";
import { loadFollowList } from "@/actions/follows";
import type { FollowRowUser, FollowSide } from "@/lib/api/users";

interface FollowListPanelProps {
  side: FollowSide;
  /** Whose lists these are — the profile being viewed. */
  userId: string;
  /** Signed-in viewer, for each row's toggle state. */
  viewerId: string | null;
  /** Swaps lists in place; the caller owns the `?tab=` URL. */
  onSelectTab: (side: FollowSide) => void;
}

/** The wrapper the shared card sits in, so a loading or error state does not
 *  change the page's shape while the list is on its way. */
const Frame = ({ children }: { children: React.ReactNode }) => (
  <div className="mx-auto w-full max-w-7xl px-6 py-8">
    <div className="rounded-lg bg-card p-6 shadow-sm">{children}</div>
  </div>
);

/**
 * A follower/following list, fetched in the browser through a server action.
 *
 * It cannot fetch the API directly: those lists are JWT-scoped by design (that
 * is what gives every row its viewer-relative `isFollowing` in one request), so
 * the call has to go out with the session cookies — which only the server has.
 *
 * An empty list and a failed one are the same to the API's eye here, so the
 * error is surfaced rather than rendered as "no followers yet": saying someone
 * has none when the request never succeeded is worse than saying nothing.
 */
export default function FollowListPanel({
  side,
  userId,
  viewerId,
  onSelectTab,
}: FollowListPanelProps) {
  const t = useTranslations("Common");
  const [items, setItems] = React.useState<FollowRowUser[] | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // The panel is remounted (keyed on the side) whenever the list changes, so
  // the effect never has to reset state to get back to "loading" — the fresh
  // mount starts there.
  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await loadFollowList(userId, side);
      if (cancelled) return;
      setItems(result.items);
      setHasMore(result.hasMore);
      setError(result.error ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, side]);

  if (error) {
    return (
      <Frame>
        <p className="py-8 text-center type-body-sm text-muted-foreground">
          {error}
        </p>
      </Frame>
    );
  }

  if (items === null) {
    return (
      <Frame>
        <p className="py-8 text-center type-body-sm text-muted-foreground">
          {t("loading")}
        </p>
      </Frame>
    );
  }

  return (
    <FollowListCard
      side={side}
      onSelectTab={onSelectTab}
      items={items}
      viewerId={viewerId}
      hasMore={hasMore}
    />
  );
}

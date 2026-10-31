import "server-only";
import { userServerFetch } from "@/lib/api/user-client";
import { toCardPost } from "@/lib/api/categories";
import type { BackendListing } from "@/lib/api/categories";
import type { Post } from "@/lib/posts";

export type MyAdsTab = "active" | "expired" | "hidden";

const TABS: MyAdsTab[] = ["active", "expired", "hidden"];
const PAGE_SIZE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/** `hidden` is the backend's stored `restricted` status. */
const STATUS_PARAM: Record<MyAdsTab, string> = {
  active: "active",
  expired: "expired",
  hidden: "restricted",
};

async function fetchStatus(tab: MyAdsTab, page: number, size: number) {
  const { data, meta } = await userServerFetch<BackendListing[]>(
    `/listings/me/all?status=${STATUS_PARAM[tab]}&limit=${size}&page=${page}&pageSize=${size}`,
  );
  return {
    rows: data,
    total: meta?.total ?? data.length,
    hasMore: !!meta?.hasMore,
  };
}

/**
 * One page of the signed-in user's own ads for a Manage Ads tab, plus every
 * tab's total (the others are `limit=1` count probes, only on page 1).
 * Authenticated — throws `ApiError` (401) without a session.
 */
export async function getMyAdsPage(
  tab: MyAdsTab,
  page: number,
): Promise<{
  items: Post[];
  hasMore: boolean;
  counts: Partial<Record<MyAdsTab, number>>;
}> {
  const others = TABS.filter((other) => other !== tab);
  const probeTabs = page === 1 ? others : [];
  const [current, ...probes] = await Promise.all([
    fetchStatus(tab, page, PAGE_SIZE),
    ...probeTabs.map((other) => fetchStatus(other, 1, 1)),
  ]);
  const counts: Partial<Record<MyAdsTab, number>> = { [tab]: current.total };
  probeTabs.forEach((other, index) => {
    counts[other] = probes[index].total;
  });
  return {
    items: current.rows.map((row) => {
      // Derived here, not in the client: a React render must not read the
      // clock, and this is where the row was fetched anyway.
      const base = toCardPost(row);
      const left = row.expiresAt
        ? new Date(row.expiresAt).getTime() - Date.now()
        : null;
      return {
        ...base,
        expiresInDays: left === null ? undefined : Math.ceil(left / DAY_MS),
      };
    }),
    hasMore: current.hasMore,
    counts,
  };
}

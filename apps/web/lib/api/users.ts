import "server-only";
import { API_URL } from "@/lib/api/client";
import { userServerFetch } from "@/lib/api/user-client";
import { MONTH_LABELS } from "@/lib/locale-labels";
import type { User } from "@/lib/user";

/**
 * Public profile as the backend serves it (`GET /users/by-username/:username`).
 * A deliberately narrow allow-list — no phone, email or moderation fields.
 */
export interface BackendPublicProfile {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  profilePhotoUrl: string | null;
  coverPhotoUrl: string | null;
  isVerified: boolean;
  /** At least one current, unexpired paid subscription. */
  verifiedAccount: boolean;
  createdAt: string;
  followers: number;
  following: number;
}

/** One row of a followers/following list. `isFollowing` is viewer-relative. */
export interface BackendFollowUser {
  id: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  profilePhotoUrl: string | null;
  isFollowing: boolean;
}

export type FollowSide = "followers" | "following";

/** "Sok Dara" → "Sok Dara"; falls back to the handle, then a neutral word. */
export function displayName(u: {
  firstName: string | null;
  lastName: string | null;
  username: string | null;
}): string {
  return (
    [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
    u.username ||
    "User"
  );
}

/**
 * Map a backend profile onto the `User` shape the profile templates render.
 * An account with no uploaded photo maps to an empty `avatar` — the avatar
 * components render an initials circle for that, so nothing needs a generated
 * third-party image URL (which next/image's optimizer rejects anyway).
 *
 * The mock `User` carries fields the backend has no source for (phone, email,
 * google, userlink, locations). Those stay empty rather than being faked, and
 * every one of those rows already hides itself when it has no data.
 */
export function toProfileUser(p: BackendPublicProfile, locale = "en"): User {
  const name = displayName(p);
  const created = new Date(p.createdAt);
  const month =
    (MONTH_LABELS[locale] ?? MONTH_LABELS.en)[created.getMonth()] ?? "";
  return {
    userId: p.id,
    username: p.username ?? "",
    name,
    avatar: p.profilePhotoUrl ?? "",
    cover: p.coverPhotoUrl ?? "",
    locations: "",
    following: p.following,
    follower: p.followers,
    // Rendered verbatim by the profile header, so it has to be a display
    // string — not the raw `createdAt`, which printed as a full ISO timestamp.
    // Same shape the `/me` header produces, including the active locale's month.
    joinDate: `${created.getDate()} ${month} ${created.getFullYear()}`,
    verified: p.isVerified,
    verifiedAccount: p.verifiedAccount,
  };
}

/**
 * Anonymous read of a public profile. Fail-soft, matching the category hub:
 * `null` on any failure, so the caller renders its not-found boundary instead
 * of throwing a 500 out of a page that a shared link can point at.
 */
export async function getPublicProfile(
  username: string,
): Promise<BackendPublicProfile | null> {
  try {
    const res = await fetch(
      `${API_URL}/users/by-username/${encodeURIComponent(username)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      success: boolean;
      data?: BackendPublicProfile;
    };
    return body.success ? (body.data ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Whether the signed-in viewer follows `userId` — the one piece the anonymous
 * profile read cannot answer. Fail-soft to `false`: for an anonymous visitor
 * that is also the honest answer, and the toggle then bounces to sign-in.
 */
export async function getFollowStatus(userId: string): Promise<boolean> {
  try {
    const { data } = await userServerFetch<{ following: boolean }>(
      `/users/${userId}/follow`,
    );
    return data.following;
  } catch {
    return false;
  }
}

/** Follow counts for the signed-in user — drives the `/me` header. */
export async function getMyFollowCounts(): Promise<{
  followers: number;
  following: number;
} | null> {
  try {
    const { data } = await userServerFetch<{
      followers: number;
      following: number;
    }>("/users/me/follow-counts");
    return data;
  } catch {
    return null;
  }
}

/**
 * One page of a user's followers/following.
 *
 * Authenticated — deliberately, and it is what makes `isFollowing` available
 * per row so each one can offer the right toggle without an N+1. Callers must
 * have checked the session first; this throws `ApiError` (401) otherwise.
 */
export async function getFollowList(
  userId: string,
  side: FollowSide,
  page = 1,
  pageSize = 20,
): Promise<{ data: BackendFollowUser[]; total: number; hasMore: boolean }> {
  const { data, meta } = await userServerFetch<BackendFollowUser[]>(
    `/users/${userId}/${side}?page=${page}&pageSize=${pageSize}`,
  );
  return {
    data,
    total: meta?.total ?? data.length,
    hasMore: meta?.hasMore ?? false,
  };
}

/**
 * One row of the followers/following card: the identity fields the row renders
 * plus the viewer-relative toggle state. A `Pick` of the shared `User` so the
 * card and the profile templates cannot drift apart.
 */
export type FollowRowUser = Pick<
  User,
  "userId" | "username" | "name" | "avatar"
> & {
  isFollowing: boolean;
};

export function toFollowRow(u: BackendFollowUser): FollowRowUser {
  const name = displayName(u);
  return {
    userId: u.id,
    username: u.username ?? "",
    name,
    avatar: u.profilePhotoUrl ?? "",
    isFollowing: u.isFollowing,
  };
}

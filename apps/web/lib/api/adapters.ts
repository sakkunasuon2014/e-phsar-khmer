import type { User } from "@/types/user";

/** Subset of the backend `PublicUser` shape returned by the admin API. */
export interface BackendUser {
  id: string;
  username: string | null;
  primaryPhone: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profilePhotoUrl: string | null;
  coverPhotoUrl: string | null;
  role: "user" | "admin" | "super_admin";
  status: "active" | "suspended" | "deleted";
  preferredLanguage: string;
  isBusiness: boolean;
  /** Settings → Privacy lookup visibility. `true` = Public, `false` = Only Me. */
  discoverableByGender: boolean;
  discoverableByDateOfBirth: boolean;
  discoverableByPhone: boolean;
  discoverableByEmail: boolean;
  discoverableByLocation: boolean;
  /** Profile fields `GET /users/me` returns (PublicUser) — the settings form needs them. */
  gender: "male" | "female" | null;
  /** ISO date (`YYYY-MM-DD`); the settings day picker's value. */
  dateOfBirth: string | null;
  yearOfBirth: number | null;
  company: string | null;
  address: string | null;
  provinceId: string | null;
  districtId: string | null;
  communeId: string | null;
  /** Drizzle `numeric` columns serialise as strings. */
  latitude: string | null;
  longitude: string | null;
  phoneVerifiedAt: string | null;
  emailVerifiedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on the admin users list (derived from active subscriptions). */
  accountType?: "Premium" | "Normal";
  /** Present on `/auth/me` and `/users/me` — the paid-plan badge. */
  verifiedAccount?: boolean;
  /** Present on `/users/me?includeAuthProviders=1` — the settings rows. */
  authProviders?: ("google" | "facebook" | "telegram")[];
}

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

function isOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

/**
 * Map a backend user record onto the UI `User` type the admin components expect.
 * Fields with no backend source yet (accountType, following/followers) get
 * safe defaults — see plan Phase 6 (subscriptions) and the follows gap.
 */
export function toUiUser(u: BackendUser): User {
  const name =
    [u.firstName, u.lastName].filter(Boolean).join(" ") ||
    u.username ||
    "Unknown";

  return {
    userId: u.id,
    username: u.username ?? "",
    name,
    password: "",
    profileImage: u.profilePhotoUrl ?? "",
    coverImage: u.coverPhotoUrl ?? undefined,
    networks: u.primaryPhone ? [u.primaryPhone] : [],
    email: u.email ?? "",
    role: u.role,
    accountType: u.accountType ?? "Normal",
    isVerified: Boolean(u.phoneVerifiedAt || u.emailVerifiedAt),
    following: [],
    followers: [],
    status: isOnline(u.lastSeenAt) ? "Online" : "Offline",
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

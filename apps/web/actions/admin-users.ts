"use server";

import { serverFetch } from "@/lib/api/client";
import { toUiUser, type BackendUser } from "@/lib/api/adapters";
import type { User } from "@/types/user";

export interface AdminUsersResult {
  users: User[];
  total: number;
}

export interface GetAdminUsersParams {
  q?: string;
  role?: "user" | "admin" | "super_admin";
  page?: number;
  pageSize?: number;
}

export async function getAdminUsers(
  params?: GetAdminUsersParams,
): Promise<AdminUsersResult> {
  const sp = new URLSearchParams();
  if (params?.q) sp.set("q", params.q);
  sp.set("role", params?.role ?? "user");
  sp.set("page", String(params?.page ?? 1));
  sp.set("pageSize", String(params?.pageSize ?? 100));

  const { data, meta } = await serverFetch<BackendUser[]>(
    `/admin/users?${sp.toString()}`,
  );
  return { users: data.map(toUiUser), total: meta?.total ?? data.length };
}

/** The staff tiers the Team page lists; customers belong to the Users page. */
const TEAM_ROLES = ["admin", "super_admin"] as const;

/**
 * Team page feed: every staff account, both tiers. The admin endpoint filters
 * by a single role, so fetch each tier and merge — newest first, the same
 * order `listUsers` returns within one role.
 */
export async function getTeamUsers(
  params?: Omit<GetAdminUsersParams, "role">,
): Promise<AdminUsersResult> {
  const results = await Promise.all(
    TEAM_ROLES.map((role) => getAdminUsers({ ...params, role })),
  );
  const users = results
    .flatMap((result) => result.users)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  return { users, total: users.length };
}

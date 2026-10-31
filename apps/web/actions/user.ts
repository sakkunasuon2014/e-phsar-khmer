"use server";

import { deleteUserSchema, editUserSchema, usersSchema } from "@/schemas/user";
import { serverFetch, ApiError } from "@/lib/api/client";
import { userServerFetch } from "@/lib/api/user-client";
import type { BackendUser } from "@/lib/api/adapters";
import z from "zod";

/** Profile fields the dashboard chrome (header avatar chip) needs. */
export type CurrentUser = {
  id: string;
  username: string;
  role: string;
  email: string;
  profileImage: string;
  firstName: string | null;
  lastName: string | null;
  profilePhotoUrl: string | null;
  /** The account's primary number — the checkout contact block shows it. */
  primaryPhone: string | null;
};

/**
 * Server-side read of the logged-in admin's profile. Returns null when there
 * is no valid session — the proxy already guards /dashboard, but a null result
 * keeps the header rendering gracefully on edge cases.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const res = await serverFetch<BackendUser>("/users/me");
    return {
      id: res.data.id,
      username: res.data.username ?? "",
      role: res.data.role,
      email: res.data.email ?? "",
      profileImage: res.data.profilePhotoUrl ?? "",
      firstName: res.data.firstName,
      lastName: res.data.lastName,
      profilePhotoUrl: res.data.profilePhotoUrl,
      primaryPhone: res.data.primaryPhone ?? null,
    };
  } catch {
    /* no valid session — chip stays hidden */
    return null;
  }
}

/**
 * User-facing read of the logged-in user's profile. Uses `userServerFetch`
 * (reads `user_access_token` cookie) — NOT `serverFetch` which reads the admin
 * cookie. Returns null when there is no valid user session.
 */
export async function getUserProfile(): Promise<CurrentUser | null> {
  try {
    const res = await userServerFetch<BackendUser>("/users/me");
    return {
      id: res.data.id,
      username: res.data.username ?? "",
      role: res.data.role,
      email: res.data.email ?? "",
      profileImage: res.data.profilePhotoUrl ?? "",
      firstName: res.data.firstName,
      lastName: res.data.lastName,
      profilePhotoUrl: res.data.profilePhotoUrl,
      primaryPhone: res.data.primaryPhone ?? null,
    };
  } catch {
    return null;
  }
}

function splitName(name: string): {
  firstName: string | null;
  lastName: string | null;
} {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") || null };
}

export async function createUser(unsafeData: z.infer<typeof usersSchema>) {
  const parsed = usersSchema.safeParse(unsafeData);
  if (!parsed.success) return { success: false, error: "Invalid input" };

  const d = parsed.data;
  const { firstName, lastName } = splitName(d.name);
  const body = {
    username: d.username,
    password: d.password,
    role: d.role,
    firstName,
    lastName,
    email: d.email,
    phones: d.phones.map((p) => p.phone).filter(Boolean),
  };

  try {
    await serverFetch("/admin/users", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { success: true };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "Failed to create user";
    return { success: false, error: message };
  }
}

export async function updateUser(
  userId: string,
  unsafeData: z.infer<typeof editUserSchema>,
) {
  const parsed = editUserSchema.safeParse(unsafeData);
  if (!parsed.success) return { success: false, error: "Invalid input" };

  const d = parsed.data;
  const { firstName, lastName } = splitName(d.name);
  const body: Record<string, unknown> = {
    username: d.username,
    role: d.role,
    firstName,
    lastName,
    email: d.email,
    phones: d.phones.map((p) => p.phone).filter(Boolean),
  };
  // Empty password means "keep current" — only send when the admin typed one.
  if (d.password) body.password = d.password;

  try {
    await serverFetch(`/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return { success: true };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "Failed to update user";
    return { success: false, error: message };
  }
}

export async function deleteUser(unsafeData: z.infer<typeof deleteUserSchema>) {
  const data = deleteUserSchema.safeParse(unsafeData);

  if (!data.success) return { success: false, error: "Invalid input" };

  try {
    await serverFetch(`/admin/users/${data.data.userId}`, { method: "DELETE" });
    return { success: true };
  } catch (err) {
    const message =
      err instanceof ApiError ? err.message : "Failed to delete user";
    return { success: false, error: message };
  }
}

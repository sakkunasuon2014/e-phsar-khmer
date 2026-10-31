"use server";

import { ApiError, serverFetch } from "@/lib/api/client";
import type {
  AdminAdvertisement,
  AdvertisementInput,
} from "@/lib/advertisements";

// A "use server" module may only export async functions — the placement list
// and the row types live in `@/lib/advertisements`.

export async function getAdvertisements(): Promise<AdminAdvertisement[]> {
  const { data } = await serverFetch<AdminAdvertisement[]>(
    "/admin/advertisements",
  );
  return data;
}

export async function createAdvertisement(input: AdvertisementInput) {
  try {
    const { data } = await serverFetch<AdminAdvertisement>(
      "/admin/advertisements",
      { method: "POST", body: JSON.stringify(input) },
    );
    return { success: true as const, data };
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof ApiError ? err.message : "Create failed",
    };
  }
}

export async function updateAdvertisement(
  id: string,
  input: Partial<AdvertisementInput>,
) {
  try {
    const { data } = await serverFetch<AdminAdvertisement>(
      `/admin/advertisements/${id}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    return { success: true as const, data };
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof ApiError ? err.message : "Update failed",
    };
  }
}

export async function deleteAdvertisement(id: string) {
  try {
    await serverFetch(`/admin/advertisements/${id}`, { method: "DELETE" });
    return { success: true as const };
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof ApiError ? err.message : "Delete failed",
    };
  }
}

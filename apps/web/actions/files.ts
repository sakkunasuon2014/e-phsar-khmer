"use server";

import { ApiError, serverFetch, userServerFetch } from "@/lib/api/client";

/**
 * Upload scopes accepted by the backend `POST /files/sign` endpoint. Each scope
 * maps to a top-level folder in the shared `listings` Supabase bucket (chat is
 * additionally namespaced per user).
 */
export type UploadScope =
  | "avatar"
  | "cover"
  | "listing"
  | "chat"
  | "resume"
  | "report"
  | "category"
  | "subcategory"
  | "brand"
  | "model"
  | "product"
  | "attribute"
  | "advertisement";

export interface SignUploadResponse {
  signedUrl: string;
  path: string;
  token: string;
  publicUrl: string;
}

/** Shared shape of a sign action — lets a component take `signUpload` (admin
 * session) or `signUploadUser` (user session) interchangeably. */
export type UploadSignFn = (
  filename: string,
  scope: UploadScope,
) => Promise<
  | { success: true; data: SignUploadResponse }
  | { success: false; error: string }
>;

/**
 * Request a Supabase signed upload URL for a file. The client then PUTs the
 * bytes directly to the signed URL and persists the returned `publicUrl`.
 */
export async function signUpload(filename: string, scope: UploadScope) {
  try {
    const { data } = await serverFetch<SignUploadResponse>("/files/sign", {
      method: "POST",
      body: JSON.stringify({ filename, scope }),
    });
    return { success: true as const, data };
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof ApiError ? err.message : "Failed to sign upload",
    };
  }
}

/**
 * User-session twin of {@link signUpload} — same contract, but signs with the
 * USER access token (`userServerFetch`) instead of the admin session. Used by
 * the user-facing post-an-ad photo upload; admin surfaces keep `signUpload`.
 */
export async function signUploadUser(
  filename: string,
  scope: UploadScope,
): Promise<
  | { success: true; data: SignUploadResponse }
  | { success: false; error: string }
> {
  try {
    const { data } = await userServerFetch<SignUploadResponse>("/files/sign", {
      method: "POST",
      body: JSON.stringify({ filename, scope }),
    });
    return { success: true as const, data };
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof ApiError ? err.message : "Failed to sign upload",
    };
  }
}

/**
 * Delete previously-uploaded storage objects (by their storage `path`, as
 * returned by `signUpload`). Used to clean up uploads that never made it into
 * the DB — e.g. when an admin uploads an image and then cancels the dialog, or
 * an image replaced within a session. The backend `DELETE /files` accepts
 * storage paths (not public URLs).
 */
export async function deleteUploaded(
  paths: string[],
): Promise<{ success: boolean; error?: string }> {
  if (paths.length === 0) return { success: true };
  try {
    await serverFetch("/files", {
      method: "DELETE",
      body: JSON.stringify({ paths }),
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ApiError ? err.message : "Failed to delete files",
    };
  }
}

/**
 * User-session twin of {@link deleteUploaded}. The admin-session version would
 * fail (or, worse, act as the wrong principal) from a `/[locale]` surface —
 * the resume photo picker cleans up an upload the user abandoned.
 */
export async function deleteUploadedUser(
  paths: string[],
): Promise<{ success: boolean; error?: string }> {
  if (paths.length === 0) return { success: true };
  try {
    await userServerFetch("/files", {
      method: "DELETE",
      body: JSON.stringify({ paths }),
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ApiError ? err.message : "Failed to delete files",
    };
  }
}

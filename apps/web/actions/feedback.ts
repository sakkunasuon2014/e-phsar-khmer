"use server";

import { API_URL, ApiError, serverFetch } from "@/lib/api/client";
import { getUserAccessToken } from "@/lib/auth/session";

/**
 * Submit the public Feedback form. The backend endpoint is public; when the
 * visitor is signed in, their access token rides along so the submission is
 * linked to the account (an expired token simply submits anonymously).
 */
export async function submitFeedback(
  formData: FormData,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const token = await getUserAccessToken().catch(() => null);
    const res = await fetch(`${API_URL}/feedback`, {
      method: "POST",
      body: formData,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      return {
        success: false,
        error:
          res.status === 429
            ? "Too many submissions — please try again later."
            : (body?.error?.message ?? "Failed to send feedback"),
      };
    }
    return { success: true };
  } catch {
    return { success: false, error: "Failed to send feedback" };
  }
}

export interface AdminFeedbackRow {
  id: string;
  userId: string | null;
  name: string;
  phone: string;
  email: string | null;
  description: string;
  images: string[];
  createdAt: string;
}

export async function getAdminFeedback(): Promise<AdminFeedbackRow[]> {
  // The dashboard filters/paginates client-side (see Page conventions), so
  // pull the newest 100 in one go.
  const { data } = await serverFetch<AdminFeedbackRow[]>(
    "/admin/feedback?pageSize=100",
  );
  return data;
}

export async function deleteFeedback(id: string) {
  try {
    await serverFetch(`/admin/feedback/${id}`, { method: "DELETE" });
    return { success: true as const };
  } catch (err) {
    return {
      success: false as const,
      error: err instanceof ApiError ? err.message : "Delete failed",
    };
  }
}

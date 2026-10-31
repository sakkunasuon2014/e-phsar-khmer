"use server";

import { ApiError, userServerFetch } from "@/lib/api/user-client";

/**
 * POST /chats/e2e/nudge/:userId — the content-free "someone wants to chat"
 * nudge. Called when the sender's browser first HOLDS a message locally
 * because the recipient has no E2E device at all; carries no message text,
 * only (optionally) the id of the listing the sender attached.
 */
export async function nudgeRecipient(
  userId: string,
  listingId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await userServerFetch(`/chats/e2e/nudge/${userId}`, {
      method: "POST",
      body: JSON.stringify(listingId ? { listingId } : {}),
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message };
    return { ok: false, error: "Network error" };
  }
}

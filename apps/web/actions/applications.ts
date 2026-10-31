"use server";

/**
 * Server actions for job applications — the apply write, the two /me lists,
 * the poster's status changes and the CV download. `userServerFetch`, never
 * `serverFetch`: the admin twin would file every application as the logged-in
 * ADMIN account.
 */

import { ApiError, userServerFetch } from "@/lib/api/user-client";
import type {
  ApplicationActionResult,
  ApplicationDetail,
  AppliedJob,
  JobApplicationStatus,
  ReceivedApplication,
} from "@/types/applications";
import type {
  ChatActionResult,
  E2eHeader,
  E2eV2Payload,
  SendMessageResult,
} from "@/types/chat";

/** Backend envelope meta for the offset-paginated lists. */
interface PageMeta {
  hasMore: boolean;
}

/** Normalize any thrown error into the serializable failure branch. */
function toFailure(err: unknown): ApplicationActionResult<never> {
  if (err instanceof ApiError) {
    return {
      ok: false,
      status: err.status,
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    };
  }
  return {
    ok: false,
    status: 0,
    code: "NETWORK_ERROR",
    message: "Network error",
  };
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : "Network error";
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * Apply to a job. Rejections worth surfacing verbatim: 409 `Already applied`
 * (a second application to the same job is refused, not silently swallowed),
 * 403 `Messaging unavailable` (a block in either direction — the application
 * *is* a message), and 400 for a closed job or your own listing.
 *
 * This is the NO-MESSAGE form: the poster has no devices registered for
 * encrypted chat, so there is nobody to encrypt to. The backend still runs
 * the block check and records the application + notification.
 */
export async function applyToJob(input: {
  listingId: string;
  coverNote?: string;
}): Promise<ApplicationActionResult<AppliedJob>> {
  try {
    const { data } = await userServerFetch<AppliedJob>(
      `/listings/${input.listingId}/applications`,
      {
        method: "POST",
        body: JSON.stringify(
          input.coverNote?.trim() ? { coverNote: input.coverNote.trim() } : {},
        ),
      },
    );
    return { ok: true, data };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * Apply WITH the encrypted chat copy. The ciphertext and E2E payload are
 * produced in the applicant's browser (`sendE2eText`); this action only
 * forwards them and returns the delivery ids so the caller can commit its
 * ratchet session. Shaped like `sendChatMessage` so it can be the `send`
 * callback of `sendE2eText`.
 */
export async function applyToJobEncrypted(input: {
  listingId: string;
  coverNote?: string;
  body?: string;
  e2e?: E2eV2Payload;
  e2eHeader?: E2eHeader;
  recipientIdentityKey?: string;
}): Promise<ChatActionResult<SendMessageResult>> {
  try {
    const { data } = await userServerFetch<AppliedJob>(
      `/listings/${input.listingId}/applications`,
      {
        method: "POST",
        body: JSON.stringify({
          ...(input.coverNote?.trim()
            ? { coverNote: input.coverNote.trim() }
            : {}),
          ...(input.body ? { body: input.body } : {}),
          ...(input.e2e ? { e2e: input.e2e } : {}),
          ...(input.e2eHeader ? { e2eHeader: input.e2eHeader } : {}),
          ...(input.recipientIdentityKey
            ? { recipientIdentityKey: input.recipientIdentityKey }
            : {}),
        }),
      },
    );
    if (!data.chat)
      return {
        ok: false,
        status: 0,
        code: "NO_CHAT_DELIVERY",
        message: "The application was saved without a chat message",
      };
    return { ok: true, data: data.chat };
  } catch (err) {
    return toFailure(err);
  }
}

/** The poster's verdict. 404s for the applicant and for strangers alike. */
export async function setApplicationStatus(
  id: string,
  status: Exclude<JobApplicationStatus, "pending">,
): Promise<
  ApplicationActionResult<{ id: string; status: JobApplicationStatus }>
> {
  try {
    const { data } = await userServerFetch<{
      id: string;
      status: JobApplicationStatus;
    }>(`/users/me/applications/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    return { ok: true, data };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * A short-lived URL for the CV an application carried. 409 means the file is
 * gone (`RESUME_CV_REMOVED`) or was never attached (`RESUME_CV_MISSING`) —
 * the card renders both as "no longer available" rather than a dead link.
 */
export async function signApplicationCv(
  id: string,
): Promise<ApplicationActionResult<{ url: string; expiresAt: string }>> {
  try {
    const { data } = await userServerFetch<{ url: string; expiresAt: string }>(
      `/users/me/applications/${id}/cv/sign`,
      { method: "POST" },
    );
    return { ok: true, data };
  } catch (err) {
    return toFailure(err);
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

/**
 * The seeker's list. A failed page and an empty one must not look alike, so
 * the error is returned as text rather than folded into `items: []`.
 */
export async function loadMyAppliedJobs(input: {
  page?: number;
  status?: JobApplicationStatus;
}): Promise<{ items: AppliedJob[]; hasMore: boolean; error?: string }> {
  try {
    const { data, meta } = await userServerFetch<AppliedJob[], PageMeta>(
      `/users/me/applications${queryString(input)}`,
    );
    return { items: data, hasMore: meta?.hasMore ?? false };
  } catch (err) {
    return { items: [], hasMore: false, error: errorText(err) };
  }
}

/** The poster's list. */
export async function loadMyReceivedApplications(input: {
  page?: number;
  status?: JobApplicationStatus;
}): Promise<{
  items: ReceivedApplication[];
  hasMore: boolean;
  error?: string;
}> {
  try {
    const { data, meta } = await userServerFetch<
      ReceivedApplication[],
      PageMeta
    >(`/users/me/applications/received${queryString(input)}`);
    return { items: data, hasMore: meta?.hasMore ?? false };
  } catch (err) {
    return { items: [], hasMore: false, error: errorText(err) };
  }
}

/** One application in full, including the frozen résumé snapshot. */
export async function getApplication(
  id: string,
): Promise<ApplicationActionResult<ApplicationDetail>> {
  try {
    const { data } = await userServerFetch<ApplicationDetail>(
      `/users/me/applications/${id}`,
    );
    return { ok: true, data };
  } catch (err) {
    return toFailure(err);
  }
}

/**
 * "Have I already applied to this listing?" for the detail page's Apply
 * control. Fail-soft like `getFollowStatus`: anonymous visitors and network
 * errors both mean "no application", and the button stays available — the
 * backend is still the guard (a duplicate answers 409).
 */
export async function getMyApplicationForListing(
  listingId: string,
): Promise<AppliedJob | null> {
  try {
    const { data } = await userServerFetch<AppliedJob[]>(
      `/users/me/applications?listingId=${listingId}&pageSize=1`,
    );
    return data[0] ?? null;
  } catch {
    return null;
  }
}

/** Identity for the apply dialog's résumé card (the viewer's own résumé). */
export async function getApplyResumeSummary(): Promise<{
  hasResume: boolean;
  summary: string | null;
  cvFileName: string | null;
} | null> {
  try {
    const { data } = await userServerFetch<{
      exists: boolean;
      summary: string;
      attachment: { fileName: string } | null;
    }>("/resume");
    if (!data.exists)
      return { hasResume: false, summary: null, cvFileName: null };
    return {
      hasResume: true,
      summary: data.summary?.trim() ? data.summary.trim() : null,
      cvFileName: data.attachment?.fileName ?? null,
    };
  } catch {
    return null;
  }
}

function queryString(input: {
  page?: number;
  status?: JobApplicationStatus;
}): string {
  const params = new URLSearchParams();
  if (input.page && input.page > 1) params.set("page", String(input.page));
  if (input.status) params.set("status", input.status);
  const str = params.toString();
  return str ? `?${str}` : "";
}

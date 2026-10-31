"use server";

import { userServerFetch, ApiError } from "@/lib/api/user-client";
import type { ChatActionResult } from "@/types/chat";

/**
 * Server actions for the encrypted chat-history backup
 * (`/chats/e2e/backup`, `/chats/e2e/backup/segments`). Everything crossing this
 * boundary is ciphertext or a passcode-DERIVED auth key — never the passcode or
 * the backup key.
 */

export interface BackupKdfParams {
  alg: "argon2id";
  t: number;
  m: number;
  p: number;
}

export interface BackupStatus {
  exists: boolean;
  keyCheck: string | null;
  hasPasscode: boolean;
  passcodeSalt: string | null;
  passcodeParams: BackupKdfParams | null;
  lockedUntil: string | null;
}

export interface BackupSegmentPage {
  items: { id: string; ciphertext: string; messageCount: number }[];
  nextCursor: string | null;
  latestCursor: string | null;
}

function toFailure(err: unknown): ChatActionResult<never> {
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

async function call<T>(
  path: string,
  init?: RequestInit,
): Promise<ChatActionResult<T>> {
  try {
    const { data } = await userServerFetch<T>(path, init);
    return { ok: true, data };
  } catch (err) {
    return toFailure(err);
  }
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

export async function fetchBackupStatus() {
  return call<BackupStatus>("/chats/e2e/backup");
}

export async function initBackup(
  deviceId: string,
  keyCheck: string,
  keyProof: string,
) {
  return call<BackupStatus & { created: boolean }>(
    "/chats/e2e/backup",
    post({ deviceId, keyCheck, keyProof }),
  );
}

export async function setBackupPasscode(input: {
  keyCheck: string;
  keyProof: string;
  salt: string;
  params: BackupKdfParams;
  wrappedKey: string;
  authKey: string;
}) {
  return call<{ ok: true }>("/chats/e2e/backup/passcode", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function unlockBackup(authKey: string) {
  return call<{ wrappedKey: string }>(
    "/chats/e2e/backup/unlock",
    post({ authKey }),
  );
}

export async function uploadBackupSegment(input: {
  deviceId: string;
  ciphertext: string;
  messageCount: number;
}) {
  return call<{ id: string }>("/chats/e2e/backup/segments", post(input));
}

export async function fetchBackupSegments(deviceId: string, cursor?: string) {
  const params = new URLSearchParams({ deviceId });
  if (cursor) params.set("cursor", cursor);
  return call<BackupSegmentPage>(
    `/chats/e2e/backup/segments?${params.toString()}`,
  );
}

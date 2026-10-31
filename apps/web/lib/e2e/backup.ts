import {
  fetchBackupSegments,
  fetchBackupStatus,
  initBackup,
  setBackupPasscode,
  unlockBackup,
  uploadBackupSegment,
} from "@/actions/e2e-backup";
import type { BackupStatus } from "@/actions/e2e-backup";
import { base64ToBytes, bytesToBase64 } from "./crypto/base64";
import {
  DEFAULT_KDF,
  derivePasscodeKeys,
  keyCheckOf,
  keyProofOf,
  MIN_PASSCODE_LENGTH,
  newBackupKey,
  openSegment,
  randomBytes,
  sealSegment,
  segmentItemBytes,
  unwrapBackupKey,
  wrapBackupKey,
} from "./backup-crypto";
import { openSegments } from "./backup-segments";
import { loadIdentity, saveIdentity } from "./keys";
import {
  listLocalPlaintext,
  listUploadedIds,
  markUploaded,
  saveRestored,
} from "./store";
import type { PlaintextItem } from "./store";

/**
 * Chat-history backup flows (tasks/plan-e2e-multi-device.md, Phase 4/5).
 *
 * One backup key (BK) per account. Every device holding BK keeps uploading
 * its plaintext history as encrypted segments. A device WITHOUT BK (new
 * browser) gets it one of two ways:
 *   1. the account's backup passcode (primary), or
 *   2. an existing device approving it (fallback when the passcode isn't
 *      set or isn't known) — BK then travels over the device-to-device
 *      Double Ratchet session, like any message envelope.
 * Either way it then downloads the segments and history appears.
 */

/** Fired on `window` after restored plaintext lands — decrypt hooks re-run. */
export const E2E_HISTORY_RESTORED = "e2e-history-restored";

/**
 * Fired on `window` after newly decrypted plaintext is cached locally. The
 * backup sync listens so a fresh batch is uploaded right away instead of
 * waiting for the next 60 s tick.
 */
export const E2E_PLAINTEXT_CACHED = "e2e-plaintext-cached";

export type BackupState =
  | { kind: "ready"; hasPasscode: boolean }
  | { kind: "locked"; hasPasscode: boolean; lockedUntil: string | null }
  | { kind: "error"; message: string };

function stateFrom(status: BackupStatus, holdsKey: boolean): BackupState {
  return holdsKey
    ? { kind: "ready", hasPasscode: status.hasPasscode }
    : {
        kind: "locked",
        hasPasscode: status.hasPasscode,
        lockedUntil: status.lockedUntil,
      };
}

async function localBackupKey(userId: string): Promise<Uint8Array | null> {
  const identity = await loadIdentity(userId);
  return identity?.backupKey ? base64ToBytes(identity.backupKey) : null;
}

async function saveBackupKey(userId: string, bk: Uint8Array): Promise<void> {
  const identity = await loadIdentity(userId);
  if (!identity) throw new Error("no local identity");
  await saveIdentity({ ...identity, backupKey: bytesToBase64(bk) });
}

/** Drop the local BK (keeping the rest of the identity) — it is not usable. */
async function clearBackupKey(userId: string): Promise<void> {
  const identity = await loadIdentity(userId);
  if (!identity || identity.backupKey === undefined) return;
  await saveIdentity({ ...identity, backupKey: undefined });
}

/**
 * Cross-tab lock guarding backup creation: two first devices opening at the
 * same time must not both create a key — the loser's BK can never open the
 * account backup, so its uploads would be unreadable forever.
 */
const INIT_LOCK = "e2e-backup-init";
let initChain: Promise<unknown> = Promise.resolve();

function withInitLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    // lib.dom types the callback as returning T, not Promise<T> — it doesn't
    // model the (spec-correct) async-callback case (same note as lock.ts).
    return navigator.locks.request(INIT_LOCK, fn) as unknown as Promise<T>;
  }
  // No Web Locks (older browsers, test environments): serialize this tab.
  const run = initChain.then(fn, fn);
  initChain = run.catch(() => {});
  return run;
}

/**
 * Where does this device stand? Creates the account backup if none exists
 * yet (first device ever → it owns BK). A device that loses the creation
 * race, or any later new device, comes back `locked`.
 *
 * The whole status → create → re-read sequence runs under INIT_LOCK, so the
 * status read always reflects the winner of the race. Any stored BK is then
 * validated against the server's `keyCheck`: on mismatch it is cleared, never
 * used and never kept, and the device reports `locked`.
 */
export async function ensureBackup(
  userId: string,
  deviceId: string,
): Promise<BackupState> {
  return withInitLock(async () => {
    const statusRes = await fetchBackupStatus();
    if (!statusRes.ok) return { kind: "error", message: statusRes.message };
    let status = statusRes.data;

    if (!status.exists) {
      const bk = newBackupKey();
      // Save locally BEFORE telling the server: a crash in between must never
      // leave the server pointing at a key no device holds.
      await saveBackupKey(userId, bk);
      const res = await initBackup(deviceId, keyCheckOf(bk), keyProofOf(bk));
      if (!res.ok) return { kind: "error", message: res.message };
      status = res.data;
      if (!res.data.created) {
        // We lost the creation race: the account already had a BK this device
        // does not hold, so the key just saved can never open it. Drop it and
        // report locked so the device asks for approval instead.
        await clearBackupKey(userId);
        return stateFrom(status, false);
      }
    }

    const bk = await localBackupKey(userId);
    const keyCheck = status.keyCheck;
    if (bk && keyCheck !== null && keyCheckOf(bk) !== keyCheck) {
      // A stale key from an older backup, or another account's: never use it.
      await clearBackupKey(userId);
      return stateFrom(status, false);
    }
    return stateFrom(
      status,
      !!bk && keyCheck !== null && keyCheckOf(bk) === keyCheck,
    );
  });
}

// ── Upload (every device holding BK) ───────────────────────────────────────

const SEGMENT_MAX_ITEMS = 500;
/**
 * Plaintext JSON bytes per segment. Sealed + base64 that is ~4/3 × this
 * (~800 KB), under the backend's 900 KB ciphertext cap, its 1 MB JSON body
 * limit, and Next's 1 MB server-action limit. Counted in UTF-8 bytes, not
 * `.length`: Khmer/Chinese text is 3 bytes per UTF-16 unit, so a char count
 * under-sized segments by up to 3×.
 */
const SEGMENT_MAX_BYTES = 600_000;

let syncInFlight: Promise<number> | null = null;

/**
 * Push every plaintext this device has that isn't in the backup yet.
 * Serialized per tab; safe to call often (a no-op when nothing is new).
 * Returns the number of messages uploaded.
 */
export function syncBackup(userId: string, deviceId: string): Promise<number> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = (async () => {
    const bk = await localBackupKey(userId);
    if (!bk) return 0;
    const [local, uploaded] = await Promise.all([
      listLocalPlaintext(),
      listUploadedIds(),
    ]);
    const pending = local.filter((i) => !uploaded.has(i.messageId));

    let sent = 0;
    let batch: PlaintextItem[] = [];
    let bytes = 0;
    const flush = async () => {
      if (batch.length === 0) return;
      const res = await uploadBackupSegment({
        deviceId,
        ciphertext: sealSegment(bk, batch),
        messageCount: batch.length,
      });
      if (!res.ok) throw new Error(res.message);
      await markUploaded(batch.map((i) => i.messageId));
      sent += batch.length;
      batch = [];
      bytes = 0;
    };
    for (const item of pending) {
      const itemBytes = segmentItemBytes(item);
      if (
        batch.length >= SEGMENT_MAX_ITEMS ||
        bytes + itemBytes > SEGMENT_MAX_BYTES
      )
        await flush();
      batch.push(item);
      bytes += itemBytes;
    }
    await flush();
    return sent;
  })().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

// ── Download (after obtaining BK) ──────────────────────────────────────────

/**
 * Pull segments newer than this device's saved cursor into `restored`.
 * Runs once in full after obtaining BK, then incrementally on every sync —
 * so history another device uploads LATER (e.g. an old browser that joins
 * the backup after this one) still shows up here. Returns messages pulled.
 */
async function pullFromBackup(
  userId: string,
  deviceId: string,
  bk: Uint8Array,
  fromCursor: string | undefined,
): Promise<number> {
  let cursor = fromCursor;
  let restored = 0;
  for (;;) {
    const page = await fetchBackupSegments(deviceId, cursor);
    if (!page.ok) throw new Error(page.message);
    // Callers validated `bk` against the account's keyCheck, so an unopenable
    // segment is skipped, never a reason to stop (see backup-segments.ts).
    const { items, skipped } = openSegments(page.data.items, (ciphertext) =>
      openSegment(bk, ciphertext),
    );
    if (skipped > 0)
      console.warn(
        `[e2e] skipped ${skipped} backup segment(s) this key cannot open`,
      );
    if (items.length > 0) await saveRestored(items);
    restored += items.length;
    cursor = page.data.latestCursor ?? cursor;
    if (!page.data.nextCursor) break;
  }

  const identity = await loadIdentity(userId);
  if (identity && cursor && identity.backupCursor !== cursor)
    await saveIdentity({ ...identity, backupCursor: cursor });

  if (restored > 0 && typeof window !== "undefined")
    window.dispatchEvent(new Event(E2E_HISTORY_RESTORED));
  return restored;
}

/**
 * Incremental pull for a device that already holds BK. The stored key is
 * validated against the account first: a stale/mismatched key is cleared and
 * nothing is pulled (the device is treated as locked on the next status read).
 */
export async function pullBackup(
  userId: string,
  deviceId: string,
): Promise<number> {
  const identity = await loadIdentity(userId);
  if (!identity?.backupKey) return 0;
  const bk = base64ToBytes(identity.backupKey);
  const status = await fetchBackupStatus();
  if (!status.ok) throw new Error(status.message);
  if (!status.data.keyCheck || keyCheckOf(bk) !== status.data.keyCheck) {
    await clearBackupKey(userId);
    return 0;
  }
  return pullFromBackup(userId, deviceId, bk, identity.backupCursor);
}

async function adoptBackupKey(
  userId: string,
  deviceId: string,
  bk: Uint8Array,
): Promise<number> {
  const status = await fetchBackupStatus();
  if (!status.ok) throw new Error(status.message);
  if (!status.data.keyCheck || keyCheckOf(bk) !== status.data.keyCheck)
    throw new Error("backup key does not match this account");
  await saveBackupKey(userId, bk);
  return pullFromBackup(userId, deviceId, bk, undefined); // full pull, from the start
}

// ── Passcode ────────────────────────────────────────────────────────────────

export type PasscodeResult =
  | { ok: true; restored: number }
  | { ok: false; reason: "wrong"; attemptsLeft: number }
  | { ok: false; reason: "locked"; lockedUntil: string | null }
  | { ok: false; reason: "no-passcode" }
  | { ok: false; reason: "error"; message: string };

export async function restoreWithPasscode(
  userId: string,
  deviceId: string,
  passcode: string,
): Promise<PasscodeResult> {
  const status = await fetchBackupStatus();
  if (!status.ok)
    return { ok: false, reason: "error", message: status.message };
  const { passcodeSalt, passcodeParams, hasPasscode } = status.data;
  if (!hasPasscode || !passcodeSalt || !passcodeParams)
    return { ok: false, reason: "no-passcode" };

  const { wrapKey, authKey } = await derivePasscodeKeys(
    passcode,
    passcodeSalt,
    passcodeParams,
  );
  const unlock = await unlockBackup(authKey);
  if (!unlock.ok) {
    const details = (unlock.details ?? {}) as {
      attemptsLeft?: number;
      lockedUntil?: string | null;
    };
    if (unlock.code === "E2E_PASSCODE_WRONG")
      return details.lockedUntil
        ? { ok: false, reason: "locked", lockedUntil: details.lockedUntil }
        : {
            ok: false,
            reason: "wrong",
            attemptsLeft: details.attemptsLeft ?? 0,
          };
    if (unlock.code === "E2E_PASSCODE_LOCKED")
      return {
        ok: false,
        reason: "locked",
        lockedUntil: details.lockedUntil ?? null,
      };
    if (unlock.code === "E2E_NO_PASSCODE")
      return { ok: false, reason: "no-passcode" };
    return { ok: false, reason: "error", message: unlock.message };
  }

  try {
    const bk = unwrapBackupKey(wrapKey, unlock.data.wrappedKey);
    return {
      ok: true,
      restored: await adoptBackupKey(userId, deviceId, bk),
    };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      message: err instanceof Error ? err.message : "restore failed",
    };
  }
}

/** Set or change the passcode. Only a device already holding BK can. */
export async function setPasscode(
  userId: string,
  passcode: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (passcode.length < MIN_PASSCODE_LENGTH)
    return { ok: false, message: "too-short" };
  const bk = await localBackupKey(userId);
  if (!bk) return { ok: false, message: "no-backup-key" };

  const salt = bytesToBase64(randomBytes(16));
  const { wrapKey, authKey } = await derivePasscodeKeys(
    passcode,
    salt,
    DEFAULT_KDF,
  );
  const res = await setBackupPasscode({
    keyCheck: keyCheckOf(bk),
    keyProof: keyProofOf(bk),
    salt,
    params: DEFAULT_KDF,
    wrappedKey: wrapBackupKey(wrapKey, bk),
    authKey,
  });
  return res.ok ? { ok: true } : { ok: false, message: res.message };
}

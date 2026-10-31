"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNotificationEvents } from "@/hooks/use-chat-ws";
import {
  E2E_PLAINTEXT_CACHED,
  ensureBackup,
  pullBackup,
  restoreWithPasscode,
  setPasscode,
  syncBackup,
} from "@/lib/e2e/backup";
import type { BackupState, PasscodeResult } from "@/lib/e2e/backup";
import { actionForPush } from "@/lib/e2e/push-events";
import type { RatchetEngine } from "@/lib/e2e/types";
import { startVisiblePoller } from "@/lib/polling/visible-poller";
import type { VisiblePoller } from "@/lib/polling/visible-poller";

const SYNC_INTERVAL_MS = 60_000;
/**
 * While the realtime socket is up the backend pushes every new segment (see
 * `lib/e2e/push-events.ts`), so this is only a safety net for a push that
 * went missing. Without a socket the interval above applies.
 */
const SAFETY_SYNC_MS = 300_000;
/** A push sent while the socket was down is not replayed: catch up on reconnect. */
const CONNECT_CATCH_UP_MS = 2_000;
/** Backoff before retrying a failed backup-status read. */
const ERROR_RETRY_MS = 30_000;
/** Debounce for the upload kicked off by freshly cached plaintext. */
const CACHED_SYNC_DEBOUNCE_MS = 5_000;

/** Which backup dialog the provider should render. */
export type BackupDialog = "none" | "restore" | "enter";

export interface E2eBackupApi {
  /** The account this backup belongs to (null before the engine boots). */
  userId: string | null;
  state: BackupState | null;
  lastRestoredCount: number | null;
  /** The dialog the provider must render right now. */
  dialog: BackupDialog;
  setDialog(dialog: BackupDialog): void;
  /** Open the restore dialog (the passcode is the only restore path). */
  openRestore(): void;
  /** Retry the backup-status read after a failure. */
  retry(): void;
  enterPasscode(passcode: string): Promise<PasscodeResult>;
  savePasscode(
    passcode: string,
  ): Promise<{ ok: true } | { ok: false; message: string }>;
}

/**
 * Drives the history backup for the signed-in device:
 *   ready  → upload new plaintext and pull new segments every minute (one
 *            visible tab per browser); the provider forces a passcode because
 *            it is the only way any other device can restore the history;
 *   locked → offer the passcode restore; nothing polls in a hidden tab.
 *
 * Every backup route is device-scoped, so nothing runs until the engine has
 * resolved `deviceId` — an account backup can only be used by an active device.
 */
export function useE2eBackup(engine: RatchetEngine | null): E2eBackupApi {
  const [state, setState] = useState<BackupState | null>(null);
  const [lastRestoredCount, setLastRestoredCount] = useState<number | null>(
    null,
  );
  const [dialog, setDialog] = useState<BackupDialog>("none");
  const userId = engine?.userId ?? null;
  const deviceId = engine?.deviceId ?? null;

  // The sync poller registers here so a push (or a socket change) can nudge it;
  // `socketUp` is what the poller reads to pick its cadence.
  const syncPoller = useRef<VisiblePoller | null>(null);
  const socketUp = useRef(false);
  // True once this tab's poller has actually run the periodic sync at least
  // once — i.e. this tab held leadership. Read by the flush-on-hide effect
  // below so a background tab that never led the sync stays silent.
  const isLeaderRef = useRef(false);
  const { isConnected } = useNotificationEvents({
    enabled: Boolean(engine && deviceId),
    onNotification: (notification) => {
      const action = deviceId ? actionForPush(notification, deviceId) : null;
      if (action === "pull-backup") syncPoller.current?.poke();
    },
  });
  useEffect(() => {
    socketUp.current = isConnected;
    const poller = syncPoller.current;
    if (!poller) return;
    if (isConnected) poller.poke({ ifOlderThanMs: CONNECT_CATCH_UP_MS });
    else poller.retime();
  }, [isConnected]);

  const loadState = useCallback(async (): Promise<BackupState | null> => {
    if (!userId || !deviceId) return null;
    try {
      return await ensureBackup(userId, deviceId);
    } catch (err) {
      return {
        kind: "error",
        message: err instanceof Error ? err.message : "backup unavailable",
      };
    }
  }, [userId, deviceId]);

  const refresh = useCallback(async () => {
    const next = await loadState();
    if (next) setState(next);
  }, [loadState]);

  useEffect(() => {
    let cancelled = false;
    void loadState().then((next) => {
      if (!cancelled && next) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [loadState]);

  // A failed status read is transient (offline, deploy): retry with backoff.
  useEffect(() => {
    if (state?.kind !== "error") return;
    const timer = setTimeout(() => void refresh(), ERROR_RETRY_MS);
    return () => clearTimeout(timer);
  }, [state, refresh]);

  // Ready: upload and pull independently, in one visible leader tab per
  // browser. Upload and pull each get their own catch so a failed upload never
  // starves the pull (and vice versa).
  useEffect(() => {
    if (!engine || !userId || !deviceId || state?.kind !== "ready") return;
    const upload = () =>
      syncBackup(userId, deviceId).catch((err: unknown) => {
        console.warn("[e2e] backup upload failed; will retry", err);
      });
    const pull = () =>
      pullBackup(userId, deviceId).catch((err: unknown) => {
        console.warn("[e2e] backup pull failed; will retry", err);
      });
    const poller = startVisiblePoller({
      run: () => {
        isLeaderRef.current = true;
        return Promise.allSettled([upload(), pull()]);
      },
      intervalMs: () => (socketUp.current ? SAFETY_SYNC_MS : SYNC_INTERVAL_MS),
      leaderKey: `e2e-backup-sync:${userId}:${deviceId}`,
    });
    syncPoller.current = poller;
    return () => {
      isLeaderRef.current = false;
      syncPoller.current = null;
      poller();
    };
  }, [engine, userId, deviceId, state?.kind]);

  // Flush the pending upload the moment the tab is hidden or the page starts
  // closing, so a message decrypted just before a tab switch isn't left for
  // the 5 s cached-plaintext debounce or the 60 s/5 min poll above.
  // `visibilitychange` is the reliable signal here — it fires before the tab
  // backgrounds, and `syncBackup` below is an ordinary async server action
  // that keeps running after the handler returns. `pagehide` is best-effort
  // only: on an actual tab close the browser can kill the page mid-request,
  // so it does NOT guarantee the upload lands — it is kept only as a second
  // chance for the case `visibilitychange` misses (e.g. the OS freezing the
  // tab without a visibility transition). Gated on `isLeaderRef` so a
  // background tab that never led the periodic sync stays silent; `syncBackup`
  // also self-serializes and skips plaintext already marked uploaded, so a
  // duplicate call from both events firing is harmless.
  useEffect(() => {
    if (!userId || !deviceId || state?.kind !== "ready") return;
    const flush = () => {
      if (!isLeaderRef.current) return;
      void syncBackup(userId, deviceId).catch((err: unknown) => {
        console.warn("[e2e] backup flush-on-hide failed; will retry", err);
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
    };
  }, [userId, deviceId, state?.kind]);

  // Newly cached plaintext: upload it promptly (debounced — a page of history
  // decrypts in one burst).
  useEffect(() => {
    if (!userId || !deviceId || state?.kind !== "ready") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onCached = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void syncBackup(userId, deviceId).catch((err: unknown) => {
          console.warn("[e2e] backup upload failed; will retry", err);
        });
      }, CACHED_SYNC_DEBOUNCE_MS);
    };
    window.addEventListener(E2E_PLAINTEXT_CACHED, onCached);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener(E2E_PLAINTEXT_CACHED, onCached);
    };
  }, [userId, deviceId, state?.kind]);

  const enterPasscode = useCallback(
    async (passcode: string) => {
      if (!userId || !deviceId)
        return {
          ok: false as const,
          reason: "error" as const,
          message: "not ready",
        };
      const result = await restoreWithPasscode(userId, deviceId, passcode);
      if (result.ok) {
        setLastRestoredCount(result.restored);
        await refresh();
      }
      return result;
    },
    [userId, deviceId, refresh],
  );

  const savePasscode = useCallback(
    async (passcode: string) => {
      if (!userId) return { ok: false as const, message: "not ready" };
      const result = await setPasscode(userId, passcode);
      if (result.ok) await refresh();
      return result;
    },
    [userId, refresh],
  );

  const retry = useCallback(() => {
    void refresh();
  }, [refresh]);

  const openRestore = useCallback(() => setDialog("restore"), []);

  return {
    userId,
    state,
    lastRestoredCount,
    dialog,
    setDialog,
    openRestore,
    retry,
    enterPasscode,
    savePasscode,
  };
}

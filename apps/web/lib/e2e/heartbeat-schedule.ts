/**
 * Pure scheduling helper for the leader tab's device heartbeat (and prekey
 * top-up): re-run every ~6 h, and on becoming visible after a long hidden
 * gap. The backend marks a device stale after 30 days without `last_seen_at`
 * bumps, and today `lastSeenAt` is bumped only at bootstrap (page load) via
 * `heartbeatE2eDevice` / `ensureDevice` (`lib/e2e/engine-provider.ts`), so a
 * long-lived tab ages — this is what re-fires that heartbeat on a schedule
 * instead.
 *
 * Kept free of runtime imports (everything is injected) so it runs under
 * `node --test` like the other `lib/**` units. The last-run time is
 * persisted (localStorage in the browser) so reloads and multiple tabs share
 * the same window. Wiring: `startVisiblePoller` (`lib/polling/visible-poller.ts`)
 * calls `runHeartbeatIfDue` whenever the leader tab's poller ticks.
 */

export const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface HeartbeatScheduleDeps {
  /** ms epoch of the last run, or null if it has never run. */
  getLastRunAt(): number | null;
  setLastRunAt(ms: number): void;
  now(): number;
  /** Default `HEARTBEAT_INTERVAL_MS`. */
  intervalMs?: number;
}

/** True once `intervalMs` has elapsed since the last run (or it never ran). */
export function isHeartbeatDue(deps: HeartbeatScheduleDeps): boolean {
  const last = deps.getLastRunAt();
  if (last === null) return true;
  const interval = deps.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  return deps.now() - last >= interval;
}

/**
 * Runs `fn` if due, recording the run BEFORE awaiting it so a second call
 * landing in the same window — another poller tick, or a concurrent caller —
 * never fires twice. Resolves to whether it ran.
 */
export async function runHeartbeatIfDue(
  deps: HeartbeatScheduleDeps,
  fn: () => Promise<void>,
): Promise<boolean> {
  if (!isHeartbeatDue(deps)) return false;
  deps.setLastRunAt(deps.now());
  await fn();
  return true;
}

const STORAGE_PREFIX = "e2e-heartbeat-last-run";

/**
 * localStorage-backed deps for the browser: persists across reloads and is
 * shared by every tab of the same browser profile. Reads/writes are
 * best-effort (private mode, quota) — failing open (never-run) costs an
 * extra heartbeat, not a missed one.
 */
export function localStorageHeartbeatDeps(
  key: string,
  now: () => number = Date.now,
): HeartbeatScheduleDeps {
  const storageKey = `${STORAGE_PREFIX}:${key}`;
  return {
    getLastRunAt() {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw === null) return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    setLastRunAt(ms) {
      try {
        localStorage.setItem(storageKey, String(ms));
      } catch {
        /* private mode / quota — the next tick just runs again */
      }
    },
    now,
  };
}

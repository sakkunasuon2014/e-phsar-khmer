/**
 * Polling that only runs for a tab somebody is looking at.
 *
 * Why it exists: the backend scales to zero within roughly a minute, and a
 * hidden tab's timers are throttled by the browser to about one call per
 * minute, which is just slow enough that every call boots the whole backend
 * again. A tab nobody can see should not poll at all, and several visible tabs
 * should not all poll the same account-level data.
 *
 * - Hidden (or idle, see `attention.ts`) tab: no timer, no request. Becoming visible catches up at once if
 *   the last run is older than the interval, otherwise it waits out the rest of
 *   the interval, so tab-flicking never fires extra calls.
 * - `leaderKey` (optional): across the visible tabs of one browser only one
 *   polls (Web Locks API). Leadership is held only while visible, so a hidden
 *   tab can never starve a visible one. Browsers without Web Locks fall back
 *   to every tab polling.
 * - `intervalMs` may be a function, re-read every time a run is scheduled, so
 *   the cadence can follow the realtime socket (a slow safety poll while pushes
 *   arrive, the fast one when they cannot). Call `retime()` when it changes.
 * - `poke()` runs the poll soon because something just told us it is worth
 *   it (a realtime push). Pokes are coalesced, and one that lands during a run
 *   schedules another right after it, so a push is never swallowed.
 *
 * Runs are chained with `setTimeout` from the end of the previous run, so a
 * slow request never overlaps the next one, and a failed run never ends the loop.
 */

import { getAttention } from "./attention.ts";

export interface PollerEnv {
  isVisible(): boolean;
  onVisibilityChange(listener: () => void): () => void;
  /**
   * Ask to be the single poller under `key`. `onGranted` fires once that is
   * true. The returned function gives leadership up, or cancels the request.
   */
  requestLeadership(key: string, onGranted: () => void): () => void;
}

export interface VisiblePollerOptions {
  run: () => unknown;
  intervalMs: number | (() => number);
  leaderKey?: string;
  env?: PollerEnv;
  now?: () => number;
}

export interface PokeOptions {
  /** Skip the poke if a run started more recently than this. */
  ifOlderThanMs?: number;
}

export type VisiblePoller = (() => void) & {
  /** Run soon (coalesced). No-op while this tab is hidden or not the leader. */
  poke(options?: PokeOptions): void;
  /** Re-arm the pending timer with the current interval. No extra run. */
  retime(): void;
};

/** Pokes landing within this window share one run. */
const POKE_COALESCE_MS = 250;

export function browserPollerEnv(): PollerEnv {
  return {
    // "Visible" here means somebody is using the tab: shown and not idle.
    isVisible: () =>
      (typeof document === "undefined" ||
        document.visibilityState === "visible") &&
      !getAttention().isIdle(),
    onVisibilityChange: (listener) => {
      document.addEventListener("visibilitychange", listener);
      const offAttention = getAttention().onChange(() => listener());
      return () => {
        document.removeEventListener("visibilitychange", listener);
        offAttention();
      };
    },
    requestLeadership: (key, onGranted) => {
      const locks =
        typeof navigator === "undefined" ? undefined : navigator.locks;
      if (!locks) {
        onGranted();
        return () => {};
      }
      const abort = new AbortController();
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      locks
        .request(`poll:${key}`, { signal: abort.signal }, () => {
          onGranted();
          return held;
        })
        .catch(() => {
          /* aborted while waiting for a turn: nothing to clean up */
        });
      return () => {
        abort.abort();
        release();
      };
    },
  };
}

/** Starts polling; the returned function stops it for good. */
export function startVisiblePoller(
  options: VisiblePollerOptions,
): VisiblePoller {
  const env = options.env ?? browserPollerEnv();
  const now = options.now ?? Date.now;
  const interval = () =>
    typeof options.intervalMs === "function"
      ? options.intervalMs()
      : options.intervalMs;
  let stopped = false;
  let active = false;
  let running = false;
  let pokePending = false;
  let timerIsPoke = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastRunAt = Number.NEGATIVE_INFINITY;
  let releaseLeadership: (() => void) | undefined;
  // Bumped on every deactivation so a run still in flight cannot reschedule.
  let epoch = 0;

  const schedule = (delayMs: number, myEpoch: number, forPoke = false) => {
    timerIsPoke = forPoke;
    timer = setTimeout(() => void tick(myEpoch), delayMs);
  };

  const tick = async (myEpoch: number) => {
    timer = undefined;
    timerIsPoke = false;
    if (myEpoch !== epoch) return;
    running = true;
    pokePending = false;
    lastRunAt = now();
    try {
      await options.run();
    } catch {
      /* a failed poll is retried on the next interval */
    }
    if (myEpoch !== epoch) return;
    running = false;
    if (pokePending) schedule(POKE_COALESCE_MS, myEpoch, true);
    else schedule(interval(), myEpoch);
  };

  const activate = () => {
    if (active || stopped) return;
    active = true;
    const myEpoch = ++epoch;
    schedule(Math.max(0, interval() - (now() - lastRunAt)), myEpoch);
  };

  const deactivate = () => {
    active = false;
    running = false;
    pokePending = false;
    timerIsPoke = false;
    epoch++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const sync = () => {
    if (stopped || !env.isVisible()) {
      deactivate();
      releaseLeadership?.();
      releaseLeadership = undefined;
      return;
    }
    const { leaderKey } = options;
    if (!leaderKey) {
      activate();
      return;
    }
    if (releaseLeadership) return;
    releaseLeadership = env.requestLeadership(leaderKey, () => {
      if (!stopped && env.isVisible()) activate();
    });
  };

  const unsubscribe = env.onVisibilityChange(sync);
  sync();

  const stop = () => {
    stopped = true;
    unsubscribe();
    sync();
  };

  const poke = (pokeOptions?: PokeOptions) => {
    if (!active) return;
    const { ifOlderThanMs } = pokeOptions ?? {};
    if (ifOlderThanMs !== undefined && now() - lastRunAt < ifOlderThanMs)
      return;
    if (running) {
      pokePending = true;
      return;
    }
    if (timer !== undefined) clearTimeout(timer);
    schedule(POKE_COALESCE_MS, epoch, true);
  };

  const retime = () => {
    // A pending poke already wants to run soon; the interval must not push it out.
    if (!active || running || timer === undefined || timerIsPoke) return;
    clearTimeout(timer);
    schedule(Math.max(0, interval() - (now() - lastRunAt)), epoch);
  };

  return Object.assign(stop, { poke, retime });
}

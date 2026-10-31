/**
 * Is anybody actually using this tab? A tab can be visible and still abandoned
 * (left open on a second monitor, a laptop lid half shut). After `idleMs`
 * without input it counts as idle, the same as a hidden tab: the realtime
 * socket closes and the pollers stop. Any input, or the tab coming back to the
 * foreground, ends it, and everything catches up on the spot.
 *
 * The timers only run while somebody listens, and input events only record a
 * timestamp, so tracking costs nothing while the page is in use.
 */

export const ATTENTION_IDLE_MS = 30 * 60_000;

export interface ActivityEnv {
  /** Fires on any sign of use: pointer, key, scroll, touch, tab shown. */
  onActivity(listener: () => void): () => void;
}

export interface AttentionTracker {
  isIdle(): boolean;
  /** `listener(true)` when the tab went idle, `listener(false)` when it came back. */
  onChange(listener: (idle: boolean) => void): () => void;
}

export function createAttentionTracker(options: {
  idleMs: number;
  env: ActivityEnv;
  now?: () => number;
}): AttentionTracker {
  const { idleMs, env } = options;
  const now = options.now ?? Date.now;
  const listeners = new Set<(idle: boolean) => void>();
  let idle = false;
  let lastActivityAt = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopWatching: (() => void) | undefined;

  const emit = () => listeners.forEach((listener) => listener(idle));

  const check = () => {
    timer = undefined;
    const remaining = idleMs - (now() - lastActivityAt);
    if (remaining > 0) {
      timer = setTimeout(check, remaining);
      return;
    }
    idle = true;
    emit();
  };

  const onActivity = () => {
    lastActivityAt = now();
    if (!idle) return;
    idle = false;
    timer = setTimeout(check, idleMs);
    emit();
  };

  const start = () => {
    idle = false;
    lastActivityAt = now();
    stopWatching = env.onActivity(onActivity);
    timer = setTimeout(check, idleMs);
  };

  const stop = () => {
    stopWatching?.();
    stopWatching = undefined;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    idle = false;
  };

  return {
    isIdle: () => idle,
    onChange(listener) {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
}

const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

function browserActivityEnv(): ActivityEnv {
  return {
    onActivity(listener) {
      const onVisible = () => {
        if (document.visibilityState === "visible") listener();
      };
      for (const name of ACTIVITY_EVENTS)
        window.addEventListener(name, listener, {
          passive: true,
          capture: true,
        });
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        for (const name of ACTIVITY_EVENTS)
          window.removeEventListener(name, listener, { capture: true });
        document.removeEventListener("visibilitychange", onVisible);
      };
    },
  };
}

let shared: AttentionTracker | undefined;

/** The one tracker for this tab (created on first use, in the browser only). */
export function getAttention(): AttentionTracker {
  shared ??= createAttentionTracker({
    idleMs: ATTENTION_IDLE_MS,
    env: browserActivityEnv(),
  });
  return shared;
}

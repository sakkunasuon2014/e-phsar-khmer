"use client";

import { useEffect, useState } from "react";
import { getAttention } from "@/lib/polling/attention";

/**
 * True while the tab is both visible and not abandoned (see `attention.ts`).
 *
 * Pollers must gate on this, not on `document.visibilityState` alone: after
 * `ATTENTION_IDLE_MS` without input the realtime socket closes, so a poller
 * whose only condition is "socket down" would start waking the backend once a
 * minute from a tab nobody is looking at — exactly the cost this feature
 * exists to remove.
 */
export function isTabAttending(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && !getAttention().isIdle();
}

export function useTabAttending(): boolean {
  const [attending, setAttending] = useState(isTabAttending);

  useEffect(() => {
    const sync = () => setAttending(isTabAttending());
    document.addEventListener("visibilitychange", sync);
    const offAttention = getAttention().onChange(sync);
    sync();
    return () => {
      document.removeEventListener("visibilitychange", sync);
      offAttention();
    };
  }, []);

  return attending;
}

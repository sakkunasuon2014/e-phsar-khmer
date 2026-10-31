/**
 * Visibility for E2E bootstrap failures. The engine retries a failed
 * bootstrap forever (hooks/use-e2e-engine.ts), which is right for a transient
 * server error but leaves a browser that can never hold keys (IndexedDB
 * missing or blocked, storage full) silently unable to chat. This module
 * counts consecutive failures, keeps the latest reason, and lets the chat
 * surface show one notice once the failure is clearly not a blip.
 *
 * No runtime imports, so it runs under `node --test`.
 */

export type BootstrapFailureKind = "storage" | "server" | "unknown";

export interface BootstrapHealth {
  /** Consecutive failures since the last success (0 = healthy or untried). */
  failures: number;
  kind: BootstrapFailureKind | null;
}

/** Failures in a row before the chat shows a notice (one quick retry is free). */
export const NOTICE_AFTER_FAILURES = 2;

const STORAGE_ERROR_NAMES = new Set([
  "QuotaExceededError",
  "SecurityError",
  "InvalidStateError",
  "UnknownError",
  "NotAllowedError",
  "DataError",
  "VersionError",
]);

/**
 * Storage problems come either as DOMExceptions from IndexedDB (blocked
 * cookies/site data, quota, a broken profile) or as the provider's own
 * "requires IndexedDB" error. Registration failures are E2eBootstrapErrors
 * about the server; anything else is unknown.
 */
export function classifyBootstrapError(err: unknown): BootstrapFailureKind {
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name: unknown }).name)
      : "";
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (STORAGE_ERROR_NAMES.has(name) || /indexeddb/i.test(message))
    return "storage";
  if (name === "E2eBootstrapError") return "server";
  return "unknown";
}

export function shouldShowBootstrapNotice(health: BootstrapHealth): boolean {
  return health.failures >= NOTICE_AFTER_FAILURES;
}

let health: BootstrapHealth = { failures: 0, kind: null };
const listeners = new Set<() => void>();

function set(next: BootstrapHealth): void {
  if (next.failures === health.failures && next.kind === health.kind) return;
  health = next;
  for (const listener of listeners) listener();
}

export function recordBootstrapFailure(err: unknown): BootstrapHealth {
  set({ failures: health.failures + 1, kind: classifyBootstrapError(err) });
  return health;
}

export function recordBootstrapSuccess(): void {
  set({ failures: 0, kind: null });
}

/** Snapshot for useSyncExternalStore; the object identity changes only on change. */
export function getBootstrapHealth(): BootstrapHealth {
  return health;
}

export function subscribeBootstrapHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

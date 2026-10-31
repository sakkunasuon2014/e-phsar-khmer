/**
 * Held-send core: an account that has signed in must always be reachable
 * over E2E chat. When a recipient has NO device yet, the sender's browser
 * holds the message locally — plaintext or attachment ids, never anything
 * sent in the clear (spec decision #6: no plaintext fallback) — and sends it
 * automatically once a device exists.
 *
 * Kept free of runtime imports (everything is injected) so it runs under
 * `node --test` like the other `lib/**` units, the same shape as
 * `lib/e2e/catch-up.ts`. The real store is an IndexedDB adapter
 * (`held-sends-store.ts`); tests use an in-memory fake.
 *
 * Cross-tab safety: `release()` for one recipient runs inside `deps.claim()`
 * (the real implementation is Web Locks, mirroring `lib/e2e/lock.ts`), so two
 * tabs racing the same recipient are serialized rather than both sending. The
 * backend's send is also idempotent on `clientMessageId` — belt and
 * suspenders, not either alone.
 */

/**
 * `sending` is only meaningful while `release()` holds the per-recipient claim.
 * A `sending` row seen by anyone who can take that claim was left behind by a
 * tab that died mid-send, so it is treated as retryable (`isPending`).
 */
export type HeldSendState = "held" | "sending" | "expired";

/** Not expired: still waiting to be delivered (held, or stranded in `sending`). */
export function isPending(state: HeldSendState): boolean {
  return state !== "expired";
}

export interface HeldSendRecord<P> {
  clientMessageId: string;
  recipientId: string;
  payload: P;
  /** ISO timestamp; orders items within a recipient and drives expiry. */
  createdAt: string;
  state: HeldSendState;
}

export interface HeldSendStore<P> {
  put(record: HeldSendRecord<P>): Promise<void>;
  get(clientMessageId: string): Promise<HeldSendRecord<P> | null>;
  delete(clientMessageId: string): Promise<void>;
  /** All records, or only one recipient's when `recipientId` is given. */
  list(recipientId?: string): Promise<HeldSendRecord<P>[]>;
  setState(clientMessageId: string, state: HeldSendState): Promise<void>;
}

/**
 * The existing send path's own result shape (see
 * `lib/e2e/send-encrypt.ts` — `{ ok: false; reason: "no-recipient-keys" }`).
 * Anything else `send()` needs to report is a thrown error, which `release()`
 * surfaces rather than holds.
 */
export type HeldSendOutcome =
  | { ok: true }
  | { ok: false; reason: "no-recipient-keys" };

export interface HeldSendDeps<P> {
  store: HeldSendStore<P>;
  /** Attempt one send. Resolves `no-recipient-keys` on no devices; throws on
   * any other failure (network, server error, …) so it is surfaced, not held. */
  send(item: HeldSendRecord<P>): Promise<HeldSendOutcome>;
  now(): number;
  /** Run `fn` as the single claimant of `key` across tabs (Web Locks in the
   * browser; a no-op pass-through where that API is unavailable). */
  claim<T>(key: string, fn: () => Promise<T>): Promise<T>;
  /** Default 14 days (owner decision D1). */
  lifetimeMs?: number;
}

export interface NewHeldSend<P> {
  clientMessageId: string;
  recipientId: string;
  payload: P;
  /** Defaults to `deps.now()`. */
  createdAt?: string;
}

export interface ReleaseResult {
  sent: string[];
  /** Still held — the recipient is (still) unreachable. */
  stillHeld: string[];
  /** Newly expired during this call. */
  expired: string[];
}

export const DEFAULT_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

const byAge = (a: HeldSendRecord<unknown>, b: HeldSendRecord<unknown>) =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
  (a.clientMessageId < b.clientMessageId
    ? -1
    : a.clientMessageId > b.clientMessageId
      ? 1
      : 0);

function lifetimeOf<P>(deps: HeldSendDeps<P>): number {
  return deps.lifetimeMs ?? DEFAULT_LIFETIME_MS;
}

function isExpired<P>(deps: HeldSendDeps<P>, record: HeldSendRecord<P>) {
  return deps.now() - Date.parse(record.createdAt) > lifetimeOf(deps);
}

/**
 * Store a send the recipient cannot receive yet. Idempotent on
 * `clientMessageId`: holding the same id twice (e.g. a retried UI action)
 * does not duplicate or reset its place in the queue.
 */
export async function hold<P>(
  deps: HeldSendDeps<P>,
  item: NewHeldSend<P>,
): Promise<void> {
  const existing = await deps.store.get(item.clientMessageId);
  if (existing) return;
  await deps.store.put({
    clientMessageId: item.clientMessageId,
    recipientId: item.recipientId,
    payload: item.payload,
    createdAt: item.createdAt ?? new Date(deps.now()).toISOString(),
    state: "held",
  });
}

/**
 * Remove a held send (e.g. the user deleted the draft). No-op if missing.
 *
 * Known race: if another tab is delivering this very item right now, Cancel
 * cannot recall that request, so the message can still arrive (the window is
 * one network round trip).
 */
export async function cancel<P>(
  deps: HeldSendDeps<P>,
  clientMessageId: string,
): Promise<void> {
  await deps.store.delete(clientMessageId);
}

/**
 * Sweeps expired items (held past the lifetime) to the `expired` state —
 * visible as "not sent", never retried — and returns the current items for
 * `recipientId`, oldest first.
 */
export async function list<P>(
  deps: HeldSendDeps<P>,
  recipientId?: string,
): Promise<HeldSendRecord<P>[]> {
  const items = await deps.store.list(recipientId);
  for (const item of items) {
    if (isPending(item.state) && isExpired(deps, item)) {
      await deps.store.setState(item.clientMessageId, "expired");
      item.state = "expired";
    }
  }
  return items.sort(byAge);
}

/**
 * Retry every held item for `recipientId`, in order, exactly once each.
 * Serialized across tabs via `deps.claim()` so two tabs racing the same
 * recipient cannot both send the same item.
 */
export async function release<P>(
  deps: HeldSendDeps<P>,
  recipientId: string,
): Promise<ReleaseResult> {
  return deps.claim(`held-send:${recipientId}`, async () => {
    const result: ReleaseResult = { sent: [], stillHeld: [], expired: [] };
    const items = (await deps.store.list(recipientId))
      .filter((item) => isPending(item.state))
      .sort(byAge);

    for (const item of items) {
      // Another claimant (same lock, re-entered after this snapshot) may
      // already have handled it; re-read before acting.
      const current = await deps.store.get(item.clientMessageId);
      // Under the claim nobody else can be mid-send, so `sending` here is a
      // stranded row, not a live one.
      if (!current || !isPending(current.state)) continue;

      if (isExpired(deps, current)) {
        await deps.store.setState(current.clientMessageId, "expired");
        result.expired.push(current.clientMessageId);
        continue;
      }

      await deps.store.setState(current.clientMessageId, "sending");
      let outcome: HeldSendOutcome;
      try {
        outcome = await deps.send(current);
      } catch (err) {
        // Surfaced, not held: restore visibility and let the caller see the
        // failure instead of silently swallowing it as a hold.
        await deps.store.setState(current.clientMessageId, "held");
        throw err;
      }

      if (outcome.ok) {
        await deps.store.delete(current.clientMessageId);
        result.sent.push(current.clientMessageId);
      } else {
        await deps.store.setState(current.clientMessageId, "held");
        result.stillHeld.push(current.clientMessageId);
      }
    }
    return result;
  });
}

/** Release every recipient that currently has at least one held item. */
export async function releaseAll<P>(
  deps: HeldSendDeps<P>,
): Promise<ReleaseResult> {
  const all = await deps.store.list();
  const recipientIds = [
    ...new Set(
      all.filter((item) => isPending(item.state)).map((i) => i.recipientId),
    ),
  ];
  const combined: ReleaseResult = { sent: [], stillHeld: [], expired: [] };
  for (const recipientId of recipientIds) {
    const r = await release(deps, recipientId);
    combined.sent.push(...r.sent);
    combined.stillHeld.push(...r.stillHeld);
    combined.expired.push(...r.expired);
  }
  return combined;
}

/**
 * Browser `claim`: a single claimant per key via Web Locks, mirroring
 * `withConversationLock` in `lib/e2e/lock.ts`. Falls back to running `fn`
 * directly where Web Locks is unavailable (older browsers, non-browser test
 * environments) — single-tab usage is unaffected; multi-tab races are simply
 * unguarded there.
 */
export function browserClaim<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return fn();
  return navigator.locks.request(key, fn) as unknown as Promise<T>;
}

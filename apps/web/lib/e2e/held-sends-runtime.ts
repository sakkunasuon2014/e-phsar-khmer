import { sendChatMessage } from "@/actions/chat";
import { deleteOutbox, getOutbox } from "./attachments/store";
import { sendOutboxEntry } from "./attachments/send";
import { getE2eEngine } from "./engine-provider";
import {
  browserClaim,
  cancel,
  hold,
  isPending,
  list,
  release,
  releaseAll,
} from "./held-sends";
import type {
  HeldSendDeps,
  HeldSendOutcome,
  HeldSendRecord,
  ReleaseResult,
} from "./held-sends";
import { createIndexedDbHeldSendStore } from "./held-sends-store";
import { sendE2eText } from "./send-encrypt";
import { startVisiblePoller } from "@/lib/polling/visible-poller";

/**
 * Browser wiring for `held-sends.ts`: the store, the real send, change
 * notification across components and tabs, and the retry loop.
 *
 * A message is held when the recipient has no E2E device at all. Nothing is
 * ever sent in the clear; the plaintext sits in this browser's IndexedDB (the
 * same exposure as the decrypted-message cache) until it is sent, cancelled
 * or expires.
 */

export type HeldPayload =
  | {
      kind: "text";
      /** The sealed body: text, or structured location / listing-only content. */
      plaintext: string;
      listingId?: string;
      conversationId: string | null;
    }
  /** An encrypted-attachment send; the entry itself lives in the attachment outbox. */
  | { kind: "outbox" };

export type HeldItem = HeldSendRecord<HeldPayload>;

/** First retry after this long; doubles up to the cap while nothing changes. */
export const RETRY_BASE_MS = 30_000;
export const RETRY_MAX_MS = 120_000;

const store = createIndexedDbHeldSendStore<HeldPayload>();

/** A send failure that retrying cannot fix (blocked, invalid, forbidden). */
class HeldSendError extends Error {
  constructor(
    readonly clientMessageId: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HeldSendError";
  }
  get permanent(): boolean {
    return (
      this.status >= 400 &&
      this.status < 500 &&
      this.status !== 408 &&
      this.status !== 429
    );
  }
}

// ── change notification ─────────────────────────────────────────────────────
const listeners = new Set<() => void>();
const CHANNEL = "npic-held-sends";
let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel =
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel(CHANNEL);
    channel?.addEventListener("message", () => fire());
  } catch {
    channel = null;
  }
  return channel;
}

function fire(): void {
  for (const listener of listeners) listener();
}

/** Tell this tab's listeners and every other tab that the held set changed. */
function emitChange(): void {
  fire();
  try {
    getChannel()?.postMessage("changed");
  } catch {
    /* a closed channel only costs the other tabs a late refresh */
  }
}

export function subscribeHeldSends(listener: () => void): () => void {
  getChannel();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ── store + send ────────────────────────────────────────────────────────────
async function sendHeldItem(
  viewerId: string,
  item: HeldItem,
): Promise<HeldSendOutcome> {
  const engine = await getE2eEngine(viewerId).catch(() => null);
  if (!engine) throw new Error("E2E engine unavailable; will retry");

  if (item.payload.kind === "text") {
    const outcome = await sendE2eText(engine, {
      conversationId: item.payload.conversationId,
      senderId: viewerId,
      recipientId: item.recipientId,
      plaintext: item.payload.plaintext,
      listingId: item.payload.listingId,
      clientMessageId: item.clientMessageId,
      send: sendChatMessage,
    });
    if (outcome.ok) return { ok: true };
    if (outcome.reason === "no-recipient-keys")
      return { ok: false, reason: "no-recipient-keys" };
    throw new HeldSendError(
      item.clientMessageId,
      "message" in outcome ? outcome.message : outcome.reason,
      "status" in outcome ? outcome.status : 0,
    );
  }

  const entry = await getOutbox(item.clientMessageId);
  // Gone from the outbox means it was already delivered or cancelled.
  if (!entry) return { ok: true };
  const outcome = await sendOutboxEntry(engine, entry, {
    senderId: viewerId,
    send: sendChatMessage,
  });
  if (outcome.ok) return { ok: true };
  if (outcome.reason === "no-recipient-keys")
    return { ok: false, reason: "no-recipient-keys" };
  throw new HeldSendError(
    item.clientMessageId,
    "message" in outcome ? outcome.message : outcome.reason,
    "status" in outcome ? outcome.status : 0,
  );
}

function depsFor(viewerId: string): HeldSendDeps<HeldPayload> {
  return {
    store,
    now: () => Date.now(),
    claim: browserClaim,
    send: (item) => sendHeldItem(viewerId, item),
  };
}

// ── public API ──────────────────────────────────────────────────────────────
export function listHeld(
  viewerId: string,
  recipientId?: string,
): Promise<HeldItem[]> {
  return list(depsFor(viewerId), recipientId).catch(() => []);
}

export async function holdSend(
  viewerId: string,
  item: {
    clientMessageId: string;
    recipientId: string;
    payload: HeldPayload;
  },
): Promise<void> {
  await hold(depsFor(viewerId), item);
  emitChange();
}

export async function cancelHeld(
  viewerId: string,
  clientMessageId: string,
): Promise<void> {
  const record = await store.get(clientMessageId);
  await cancel(depsFor(viewerId), clientMessageId);
  // A cancelled attachment send must not be resumed from the outbox either.
  if (record?.payload.kind === "outbox")
    await deleteOutbox(clientMessageId).catch(() => undefined);
  emitChange();
}

/**
 * Try to deliver held sends (one recipient, or all). Never throws: a
 * transient failure leaves the item held for the next tick, a permanent one
 * (blocked, invalid) moves it to the visible "not sent" state.
 */
export async function releaseHeld(
  viewerId: string,
  recipientId?: string,
): Promise<ReleaseResult | null> {
  const deps = depsFor(viewerId);
  try {
    const result = recipientId
      ? await release(deps, recipientId)
      : await releaseAll(deps);
    if (result.sent.length > 0 || result.expired.length > 0) emitChange();
    return result;
  } catch (err) {
    if (err instanceof HeldSendError && err.permanent) {
      await store.setState(err.clientMessageId, "expired").catch(() => {});
      emitChange();
    } else {
      console.warn("[e2e] held send failed; will retry", err);
    }
    return null;
  }
}

// ── retry loop ──────────────────────────────────────────────────────────────
interface Loop {
  userId: string;
  refs: number;
  stop: () => void;
}
let loop: Loop | null = null;

/**
 * Keep trying to deliver held sends for `viewerId`, app-wide (the thread may
 * not be open). Refcounted: every caller gets the same loop. It costs nothing
 * while nothing is held — the poller only exists while at least one item is
 * in the `held` state — and the visible-poller leader lock keeps it to one
 * tab, visible tabs only.
 */
export function startHeldSendsLoop(viewerId: string): () => void {
  if (loop && loop.userId === viewerId) {
    loop.refs += 1;
    return releaseRef(loop);
  }
  loop?.stop();

  let poller: (() => void) | null = null;
  let delay = RETRY_BASE_MS;
  let disposed = false;

  const tick = async () => {
    const result = await releaseHeld(viewerId);
    const progressed = result && result.sent.length + result.expired.length > 0;
    delay = progressed ? RETRY_BASE_MS : Math.min(delay * 2, RETRY_MAX_MS);
  };

  const arm = async () => {
    const items = await listHeld(viewerId);
    if (disposed) return;
    const anyHeld = items.some((i) => isPending(i.state));
    if (anyHeld && !poller) {
      delay = RETRY_BASE_MS;
      poller = startVisiblePoller({
        run: tick,
        intervalMs: () => delay,
        leaderKey: `held-sends:${viewerId}`,
      });
    } else if (!anyHeld && poller) {
      poller();
      poller = null;
    }
  };

  const unsubscribe = subscribeHeldSends(() => void arm());
  void arm();

  const next: Loop = {
    userId: viewerId,
    refs: 1,
    stop: () => {
      disposed = true;
      unsubscribe();
      poller?.();
      poller = null;
      if (loop === next) loop = null;
    },
  };
  loop = next;
  return releaseRef(next);
}

function releaseRef(target: Loop): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    target.refs -= 1;
    if (target.refs <= 0) target.stop();
  };
}

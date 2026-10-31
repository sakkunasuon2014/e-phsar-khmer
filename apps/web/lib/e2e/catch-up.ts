/**
 * Catch-up decrypt: read the messages a signed-in device RECEIVED, not only the
 * ones it happened to DISPLAY.
 *
 * Why: the history backup uploads plaintext this device has cached, and a
 * message is cached only when a thread (or an inbox preview) decrypts it. A
 * message that arrives while the chat page is closed is never cached, so never
 * backed up, and a browser that later goes away takes it along. A new device
 * then has no envelope for it and no backup copy ("Sent before this device
 * was set up"). Walking every conversation in the background closes that gap.
 *
 * Kept free of runtime imports (everything is injected) so it runs under
 * `node --test` like the other `lib/**` units. Wiring lives in
 * `hooks/use-e2e-catch-up.ts`.
 *
 * Rules the Double Ratchet imposes:
 *  - Per conversation, messages are decrypted OLDEST FIRST. The engine can
 *    open a later message first by stashing the skipped keys, but only up to
 *    MAX_SKIP (1000) per chain, so walking forward never depends on that.
 *  - Decrypting is idempotent: a message with cached plaintext is skipped
 *    without touching the ratchet.
 */

export interface CatchUpMessage {
  id: string;
  /** ISO timestamp; orders messages within a conversation. */
  createdAt: string;
}

export interface CatchUpPage<M> {
  items: M[];
  nextCursor: string | null;
}

export type CatchUpOutcome = "ok" | "unavailable" | "failed";

export interface CatchUpDeps<M extends CatchUpMessage> {
  /** One page of history, older than `cursor` (null = newest). Throws on failure. */
  fetchPage(
    conversationId: string,
    cursor: string | null,
  ): Promise<CatchUpPage<M>>;
  /** True for an E2E row this device can attempt. */
  canDecrypt(message: M): boolean;
  /** True when plaintext for this message is already cached locally. */
  hasPlaintext(messageId: string): Promise<boolean>;
  /** Decrypt and cache one message. Must not throw. */
  decrypt(message: M): Promise<CatchUpOutcome>;
  /**
   * Per-conversation progress: the id of the newest message such that it and
   * everything older has been handled. Only ever advanced oldest-first.
   */
  getMark(conversationId: string): Promise<string | null>;
  setMark(conversationId: string, messageId: string): Promise<void>;
}

export interface CatchUpOptions {
  /**
   * How far back to look in one conversation when there is no progress mark
   * yet. Older history is left to the thread view. Default 500.
   */
  maxMessagesPerConversation?: number;
  /** Real decrypts allowed in this run (cached messages are free). Default 200. */
  decryptBudget?: number;
  signal?: AbortSignal;
}

export interface CatchUpResult {
  /** Messages decrypted for real in this run. */
  decrypted: number;
  /** Messages that already had cached plaintext. */
  alreadyCached: number;
  unavailable: number;
  failed: number;
  /** Conversations whose history could not be fetched this run. */
  fetchErrors: number;
  /** False when the budget ran out or the run was aborted before the end. */
  complete: boolean;
}

export const DEFAULT_MAX_MESSAGES = 500;
export const DEFAULT_DECRYPT_BUDGET = 200;

const byAge = (a: CatchUpMessage, b: CatchUpMessage) =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Newest-first pages until the progress mark (or the cap, or the start of the
 * history) is reached; returns what is NEWER than the mark, oldest first.
 */
async function collectUnhandled<M extends CatchUpMessage>(
  conversationId: string,
  deps: CatchUpDeps<M>,
  mark: string | null,
  cap: number,
): Promise<M[]> {
  const collected: M[] = [];
  let cursor: string | null = null;
  let reachedMark = false;
  do {
    const page: CatchUpPage<M> = await deps.fetchPage(conversationId, cursor);
    collected.push(...page.items);
    if (mark !== null && page.items.some((m) => m.id === mark))
      reachedMark = true;
    cursor = page.nextCursor;
  } while (cursor !== null && !reachedMark && collected.length < cap);

  const ordered = collected.sort(byAge);
  if (mark !== null) {
    const at = ordered.findIndex((m) => m.id === mark);
    if (at !== -1) return ordered.slice(at + 1);
  }
  // No mark (first run) or the mark fell out of reach: newest `cap` only.
  return ordered.slice(-cap);
}

export async function catchUpConversations<M extends CatchUpMessage>(
  conversationIds: readonly string[],
  deps: CatchUpDeps<M>,
  options: CatchUpOptions = {},
): Promise<CatchUpResult> {
  const cap = options.maxMessagesPerConversation ?? DEFAULT_MAX_MESSAGES;
  let budget = options.decryptBudget ?? DEFAULT_DECRYPT_BUDGET;
  const result: CatchUpResult = {
    decrypted: 0,
    alreadyCached: 0,
    unavailable: 0,
    failed: 0,
    fetchErrors: 0,
    complete: true,
  };

  for (const conversationId of conversationIds) {
    if (options.signal?.aborted) return { ...result, complete: false };

    let pending: M[];
    try {
      pending = await collectUnhandled(
        conversationId,
        deps,
        await deps.getMark(conversationId),
        cap,
      );
    } catch {
      // Offline / 5xx: leave this conversation for the next run.
      result.fetchErrors += 1;
      continue;
    }

    let handledThrough: string | null = null;
    let stopped = false;
    for (const message of pending) {
      if (options.signal?.aborted || budget <= 0) {
        stopped = true;
        break;
      }
      if (!deps.canDecrypt(message)) {
        handledThrough = message.id;
        continue;
      }
      if (await deps.hasPlaintext(message.id)) {
        result.alreadyCached += 1;
        handledThrough = message.id;
        continue;
      }
      budget -= 1;
      const outcome = await deps.decrypt(message);
      if (outcome === "ok") result.decrypted += 1;
      else if (outcome === "unavailable") result.unavailable += 1;
      else result.failed += 1;
      handledThrough = message.id;
    }

    // Progress only ever moves forward over a contiguous, handled prefix.
    if (handledThrough !== null)
      await deps.setMark(conversationId, handledThrough);
    if (stopped) return { ...result, complete: false };
  }
  return result;
}

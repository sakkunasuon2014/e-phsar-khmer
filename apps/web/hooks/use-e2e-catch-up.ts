"use client";

import { useEffect, useRef } from "react";
import { fetchInbox, fetchMessages } from "@/actions/chat";
import { useChatRealtimeEvents } from "@/hooks/use-chat-ws";
import { E2E_PLAINTEXT_CACHED } from "@/lib/e2e/backup";
import { catchUpConversations } from "@/lib/e2e/catch-up";
import type { CatchUpDeps } from "@/lib/e2e/catch-up";
import { getCatchUpMark, setCatchUpMark } from "@/lib/e2e/catch-up-store";
import { decryptMessage, isDecryptable } from "@/lib/e2e/decrypt-message";
import { createIndexedDbStore } from "@/lib/e2e/store";
import type { RatchetEngine } from "@/lib/e2e/types";
import { startVisiblePoller } from "@/lib/polling/visible-poller";
import type { VisiblePoller } from "@/lib/polling/visible-poller";
import type { ChatMessage } from "@/types/chat";

/**
 * With the notification socket up, a new message pokes the poller; this is
 * only the safety net for a push that went missing.
 */
const SAFETY_MS = 300_000;
/** Without a socket nothing pokes, so look a little more often. */
const NO_SOCKET_MS = 120_000;
const INBOX_PAGE_SIZE = 20;
/** 100 conversations is far past what one person chats with. */
const INBOX_PAGES_MAX = 5;
const MESSAGE_PAGE_SIZE = 100;
const DECRYPT_BUDGET = 200;

/** Conversations whose newest message has not been handled yet, newest first. */
async function conversationsNeedingWork(): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < INBOX_PAGES_MAX; page++) {
    const res = await fetchInbox(cursor, INBOX_PAGE_SIZE);
    if (!res.ok) throw new Error(res.message);
    for (const item of res.data.items) {
      const last = item.lastMessage;
      if (!last) continue;
      if ((await getCatchUpMark(item.id)) !== last.id) ids.push(item.id);
    }
    const { hasMore, nextCursor } = res.data.meta;
    if (!hasMore || !nextCursor) break;
    cursor = nextCursor;
  }
  return ids;
}

function depsFor(engine: RatchetEngine): CatchUpDeps<ChatMessage> {
  const store = createIndexedDbStore();
  return {
    async fetchPage(conversationId, cursor) {
      const res = await fetchMessages(conversationId, {
        cursor: cursor ?? undefined,
        limit: MESSAGE_PAGE_SIZE,
      });
      if (!res.ok) throw new Error(res.message);
      const { hasMore, nextCursor } = res.data.meta;
      return {
        items: res.data.items,
        nextCursor: hasMore ? nextCursor : null,
      };
    },
    canDecrypt: isDecryptable,
    hasPlaintext: async (id) => (await store.getDecrypted(id)) !== null,
    async decrypt(message) {
      try {
        const outcome = await decryptMessage(engine, store, {
          id: message.id,
          conversationId: message.conversationId,
          senderId: message.senderId,
          body: message.body,
          e2eHeader: message.e2eHeader,
          e2eVersion: message.e2eVersion,
          senderDeviceId: message.senderDeviceId,
          envelopes: message.envelopes,
        });
        return outcome.status;
      } catch {
        return "failed";
      }
    },
    getMark: getCatchUpMark,
    setMark: setCatchUpMark,
  };
}

/**
 * Decrypts the messages this device RECEIVED, in every conversation, even with
 * the chat page closed — so they end up in the history backup and a new device
 * can restore them (see lib/e2e/catch-up.ts for why that matters).
 *
 * One visible leader tab per browser. An idle tick costs a single inbox read:
 * a conversation is only fetched when its newest message is past the stored
 * progress mark. Runs whether or not the backup is unlocked: the plaintext is
 * cached locally either way, and uploaded once this device holds the key.
 */
export function useE2eCatchUp(engine: RatchetEngine | null): void {
  const userId = engine?.userId ?? null;
  const deviceId = engine?.deviceId ?? null;
  const poller = useRef<VisiblePoller | null>(null);
  const socketUp = useRef(false);

  const { isConnected } = useChatRealtimeEvents({
    enabled: Boolean(engine && deviceId),
    // A message (or read receipt) arrived: look now instead of at the next tick.
    onEvent: () => poller.current?.poke(),
  });
  useEffect(() => {
    socketUp.current = isConnected;
    poller.current?.retime();
  }, [isConnected]);

  useEffect(() => {
    if (!engine || !userId || !deviceId) return;
    const controller = new AbortController();
    const deps = depsFor(engine);
    const stop = startVisiblePoller({
      run: async () => {
        const conversationIds = await conversationsNeedingWork();
        if (conversationIds.length === 0) return;
        const result = await catchUpConversations(conversationIds, deps, {
          decryptBudget: DECRYPT_BUDGET,
          signal: controller.signal,
        });
        // The backup sync uploads fresh plaintext without waiting for its tick.
        if (result.decrypted > 0)
          window.dispatchEvent(new Event(E2E_PLAINTEXT_CACHED));
        // Out of budget: come back soon for the rest rather than in 5 minutes.
        if (!result.complete && !controller.signal.aborted)
          poller.current?.poke();
      },
      intervalMs: () => (socketUp.current ? SAFETY_MS : NO_SOCKET_MS),
      leaderKey: `e2e-catch-up:${userId}:${deviceId}`,
    });
    poller.current = stop;
    return () => {
      controller.abort();
      poller.current = null;
      stop();
    };
  }, [engine, userId, deviceId]);
}

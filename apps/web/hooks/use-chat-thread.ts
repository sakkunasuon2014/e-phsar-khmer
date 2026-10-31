"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  fetchMessages,
  markConversationRead,
  sendChatMessage,
} from "@/actions/chat";
import { chatKeys, unwrap } from "@/lib/chat/queries";
import { mergeMessages } from "@/lib/chat/format";
import { useAdaptivePolling } from "@/hooks/use-chat-polling";
import { useChatWs } from "@/hooks/use-chat-ws";
import {
  getDraftFile,
  getDraftPreviewUrl,
  removeDraftImage,
} from "@/lib/chat-draft-images";
import { nudgeRecipient } from "@/actions/e2e-nudge";
import { isPending } from "@/lib/e2e/held-sends";
import { getE2eEngine } from "@/lib/e2e/engine-provider";
import {
  cancelHeld,
  holdSend,
  listHeld,
  releaseHeld,
  subscribeHeldSends,
} from "@/lib/e2e/held-sends-runtime";
import type { HeldPayload } from "@/lib/e2e/held-sends-runtime";
import { sendE2eText } from "@/lib/e2e/send-encrypt";
import type { E2eSendOutcome } from "@/lib/e2e/send-encrypt";
import { E2E_ATTACHMENTS_ENABLED } from "@/lib/e2e/config";
import {
  contentFor,
  createOutboxEntry,
  sendOutboxEntry,
} from "@/lib/e2e/attachments/send";
import type { AttachmentSendOutcome } from "@/lib/e2e/attachments/send";
import { getOutbox, listOutbox } from "@/lib/e2e/attachments/store";
import type { OutboxEntry } from "@/lib/e2e/attachments/store";
import {
  encodeListingOnlyContent,
  encodeLocationContent,
} from "@/lib/e2e/chat-content";
import type { SharedLocation } from "@/lib/e2e/chat-content";
import type { ChatMessage, MessagePage, ThreadMessage } from "@/types/chat";

const PAGE_SIZE = 30;
const MARK_READ_DEBOUNCE_MS = 700;
const HISTORY_GC_MS = 30 * 60 * 1000;
/** A delta right after a history fetch would return nothing new. */
const DELTA_FRESH_MS = 5_000;

/** Monotonic max over two ISO timestamps (read receipts). */
function newerIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * Advance the poll watermark. `latestCursor` is an opaque base64 cursor, NOT a
 * timestamp, so it cannot be compared — but the server only ever returns one
 * that is at or ahead of the cursor we sent (empty deltas echo ours back).
 * The only rule that matters: a null must never clobber a stored watermark.
 */
function advanceWatermark(
  current: string | null,
  next: string | null,
): string | null {
  return next ?? current;
}

/**
 * Swap an optimistic echo for the server row. Drops any copy of that row
 * already in `local` too: a v2 send is also pushed over WS to the sender (for
 * their other devices), and that push can land before the HTTP response —
 * appending again would render the same id twice.
 */
function replaceEcho(
  prev: ThreadMessage[],
  tempId: string,
  row: ThreadMessage,
): ThreadMessage[] {
  return [...prev.filter((m) => m.tempId !== tempId && m.id !== row.id), row];
}

/** Optimistic bubble for an encrypted-attachment send (rendered from `body`). */
function outboxEcho(
  entry: OutboxEntry,
  tempId: string,
  senderId: string,
  pending: boolean,
): ThreadMessage {
  return {
    id: tempId,
    tempId,
    clientMessageId: entry.clientMessageId,
    conversationId: entry.conversationId ?? "",
    senderId,
    body: contentFor(entry),
    attachments: entry.attachments.map((a) => ({
      id: a.meta.id,
      kind: a.meta.kind,
    })),
    listingId: entry.listingId ?? null,
    imageUrl: null,
    imagePath: null,
    groupId: null,
    readAt: null,
    createdAt: new Date(entry.createdAt).toISOString(),
    isE2e: false,
    e2eHeader: null,
    pending,
    failed: !pending,
  };
}

export interface SendDraft {
  body?: string;
  /** Draft-image registry keys — uploaded to Supabase at send-time. */
  draftKeys?: string[];
  listingId?: string;
  /** Shared position; encoded into the encrypted body, never sent in clear. */
  location?: SharedLocation;
  /** Recorded voice note; encrypted and uploaded as a v2 attachment. */
  voice?: { file: File; durationMs: number };
}

export interface ChatThread {
  messages: ThreadMessage[];
  peerLastReadAt: string | null;
  isLoading: boolean;
  error: unknown;
  hasOlder: boolean;
  isLoadingOlder: boolean;
  loadOlder: () => void;
  send: (draft: SendDraft) => void;
  retry: (message: ThreadMessage) => void;
  /** Cancel a send held for a recipient with no E2E device yet. */
  cancelHeldSend: (message: ThreadMessage) => void;
  isSending: boolean;
  markActivity: () => void;
  wsConnected: boolean;
}

/**
 * Live thread state: a paginated history page-set, a delta poll on top of it,
 * and the optimistic echoes of anything sent this session.
 *
 * Watermark discipline — the part that breaks subtly if you get it wrong:
 * `meta.latestCursor` is kept in a ref and only ever advanced. The backend's
 * empty-delta fast path echoes the client's own cursor back, and other empty
 * responses can carry `latestCursor: null`; overwriting the stored watermark
 * with null would re-request the whole thread on every subsequent poll.
 */
export function useChatThread({
  conversationId,
  recipientId,
  viewerId,
  enabled = true,
  onConversationCreated,
  onMutated,
  onSendError,
}: {
  conversationId: string | null;
  recipientId: string | null;
  viewerId: string | null;
  enabled?: boolean;
  onConversationCreated?: (conversationId: string) => void;
  onMutated?: () => void;
  onSendError?: (message: string, status: number) => void;
}): ChatThread {
  const queryClient = useQueryClient();
  const polling = useAdaptivePolling(enabled && conversationId !== null);
  const { markActivity, isVisible, refetchInterval } = polling;

  // Refs, not state: these are read inside queryFns, and writing them must
  // never trigger a render on its own.
  const watermarkRef = useRef<string | null>(null);
  const peerReadRef = useRef<string | null>(null);
  const deltaStoreRef = useRef<ChatMessage[]>([]);
  const ackedMessageIdRef = useRef<string | null>(null);

  const [local, setLocal] = useState<ThreadMessage[]>([]);
  const [isSending, setIsSending] = useState(false);
  // Sends held for a recipient with no E2E device yet, as bubbles.
  const [heldEchoes, setHeldEchoes] = useState<ThreadMessage[]>([]);
  const heldIdsRef = useRef<Set<string>>(new Set());

  // ── WebSocket ────────────────────────────────────────────────────────────
  const wsEnabled = enabled && conversationId !== null;
  const handleWsMessage = useCallback(
    (msg: ChatMessage) => {
      if (msg.conversationId !== conversationId) return;
      // Merge into local state — deduped against server messages in `messages`.
      setLocal((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        // Our own send echoed back over WS (v2 also pushes to the sender's
        // other devices) before its HTTP response: the response will swap
        // the echo for this row with the known plaintext. Taking the push
        // would try to decrypt it here, where no envelope exists for the
        // sending device, and pin it as "not available on this device".
        const clientId = msg.clientMessageId;
        if (
          clientId &&
          prev.some((m) => m.tempId && m.clientMessageId === clientId)
        )
          return prev;
        return [...prev, { ...msg, pending: false, failed: false }];
      });
      markActivity();
    },
    [conversationId, markActivity],
  );
  // The delta poll is paused while the socket is up, so a `read` push is the
  // only way the sender's "seen" ticks update live. The delta query is
  // declared below, hence the ref.
  const refetchDeltaRef = useRef<(() => void) | null>(null);
  const handleWsRead = useCallback(
    (readConversationId: string) => {
      if (readConversationId === conversationId) refetchDeltaRef.current?.();
    },
    [conversationId],
  );
  const ws = useChatWs({
    enabled: wsEnabled,
    onMessage: handleWsMessage,
    onRead: handleWsRead,
  });

  // ── History (initial page + upward pagination) ────────────────────────────
  const history = useInfiniteQuery({
    queryKey: chatKeys.thread(conversationId ?? "none"),
    enabled: enabled && conversationId !== null,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<MessagePage> => {
      const page = unwrap(
        await fetchMessages(conversationId as string, {
          cursor: pageParam ?? undefined,
          limit: PAGE_SIZE,
        }),
      );
      // Seed the poll watermark from the newest page only, and only once.
      if (pageParam === null) {
        watermarkRef.current = advanceWatermark(
          watermarkRef.current,
          page.meta.latestCursor,
        );
        peerReadRef.current = newerIso(
          peerReadRef.current,
          page.meta.peerLastReadAt,
        );
      }
      return page;
    },
    getNextPageParam: (last) => last.meta.nextCursor,
    staleTime: Infinity,
    // Switching threads remounts this hook; keep recently opened threads so
    // switching back costs one small `after=` delta, not a full page.
    gcTime: HISTORY_GC_MS,
  });

  // ── Delta poll ────────────────────────────────────────────────────────────
  // While the WebSocket is connected it delivers messages in real-time, so the
  // interval stops. The query itself stays enabled: pushes published while
  // the socket was down (reconnect gap, server restart) are never replayed,
  // so a one-shot delta on every (re)connect and on window focus is what
  // closes that gap — otherwise the thread silently misses messages the
  // inbox already shows.
  const wsConnected = ws.isConnected;
  const delta = useQuery({
    queryKey: [...chatKeys.thread(conversationId ?? "none"), "delta"],
    enabled: enabled && conversationId !== null && history.isSuccess,
    refetchInterval: wsConnected ? false : refetchInterval,
    refetchIntervalInBackground: false,
    // Seeded as fresh as the history it follows: a just-fetched history skips
    // the redundant mount delta, while a thread restored from cache (older
    // history) is stale and catches up once.
    initialData: { messages: [], peerLastReadAt: null },
    initialDataUpdatedAt: history.dataUpdatedAt,
    staleTime: DELTA_FRESH_MS,
    gcTime: 0,
    queryFn: async () => {
      // A remount restores history from cache without running its queryFn,
      // so the refs start empty — seed them from the cached newest page or
      // this delta would re-download a full page instead of `after=`.
      const newest = history.data?.pages[0]?.meta;
      if (watermarkRef.current === null && newest) {
        watermarkRef.current = newest.latestCursor ?? null;
        peerReadRef.current = newerIso(
          peerReadRef.current,
          newest.peerLastReadAt,
        );
      }
      const page = unwrap(
        await fetchMessages(conversationId as string, {
          // No watermark yet (brand-new or empty thread) → fall back to
          // history mode, which also establishes the watermark.
          after: watermarkRef.current ?? undefined,
          limit: PAGE_SIZE,
        }),
      );
      watermarkRef.current = advanceWatermark(
        watermarkRef.current,
        page.meta.latestCursor,
      );
      peerReadRef.current = newerIso(
        peerReadRef.current,
        page.meta.peerLastReadAt,
      );
      if (page.items.length > 0) {
        deltaStoreRef.current = mergeMessages(
          deltaStoreRef.current,
          page.items,
        );
      }
      return {
        messages: deltaStoreRef.current,
        peerLastReadAt: peerReadRef.current,
      };
    },
  });

  const { refetch: refetchDelta } = delta;
  useEffect(() => {
    refetchDeltaRef.current = history.isSuccess
      ? () => void refetchDelta()
      : null;
  }, [history.isSuccess, refetchDelta]);
  // Catch up only on a real (re)connect. The mount case is already covered
  // by the delta's own staleness, so firing here too doubled every switch.
  const wasConnectedRef = useRef(wsConnected);
  useEffect(() => {
    const reconnected = wsConnected && !wasConnectedRef.current;
    wasConnectedRef.current = wsConnected;
    if (reconnected && history.isSuccess) void refetchDelta();
  }, [wsConnected, history.isSuccess, refetchDelta]);

  const serverMessages = useMemo(() => {
    const historyItems = (history.data?.pages ?? []).flatMap((p) => p.items);
    return mergeMessages(historyItems, delta.data?.messages ?? []);
  }, [history.data, delta.data]);

  const messages = useMemo<ThreadMessage[]>(() => {
    const serverIds = new Set(serverMessages.map((m) => m.id));
    // Drop optimistic echoes the server has already handed back to us.
    // Keyed by id so a row that reached `local` twice (WS push + HTTP
    // response) still renders once; the later copy wins.
    const extras = [
      ...new Map(
        local.filter((m) => !serverIds.has(m.id)).map((m) => [m.id, m]),
      ).values(),
    ];
    return [...serverMessages, ...extras, ...heldEchoes];
  }, [serverMessages, local, heldEchoes]);

  const peerLastReadAt =
    delta.data?.peerLastReadAt ??
    history.data?.pages[0]?.meta.peerLastReadAt ??
    null;

  // ── Mark-read (debounced) ─────────────────────────────────────────────────
  // Fires only while the tab is visible and only when the newest inbound
  // message is one we have not acknowledged yet — never on every render.
  const newestInbound = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (viewerId && m.senderId !== viewerId) return m;
    }
    return null;
  }, [messages, viewerId]);

  const ackCandidateId =
    conversationId !== null &&
    isVisible &&
    newestInbound !== null &&
    newestInbound.readAt === null
      ? newestInbound.id
      : null;

  useEffect(() => {
    if (!ackCandidateId || !conversationId) return;
    // The "already acknowledged?" test lives here rather than in the render
    // body: ackedMessageIdRef is a ref, and reading a ref during render is
    // unsafe under concurrent rendering, where a render can be discarded and
    // replayed. Effects see the committed value.
    if (ackedMessageIdRef.current === ackCandidateId) return;
    const timer = window.setTimeout(() => {
      ackedMessageIdRef.current = ackCandidateId;
      void markConversationRead(conversationId).then((res) => {
        if (res.ok && res.data.marked > 0) {
          void queryClient.invalidateQueries({ queryKey: chatKeys.inbox() });
          void queryClient.invalidateQueries({ queryKey: chatKeys.unread() });
        }
      });
    }, MARK_READ_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [ackCandidateId, conversationId, queryClient]);

  // ── Send ──────────────────────────────────────────────────────────────────
  const markFailed = useCallback((tempId: string) => {
    setLocal((prev) =>
      prev.map((m) =>
        m.tempId === tempId ? { ...m, pending: false, failed: true } : m,
      ),
    );
  }, []);

  // ── Held sends (recipient has no E2E device yet) ─────────────────────────
  // Rebuild the held bubbles from the IndexedDB store. When a row that was
  // held is gone (sent by this or another tab, or cancelled) the thread
  // refetches so the delivered message shows up in its place.
  const refreshHeld = useCallback(async () => {
    if (!viewerId || !recipientId) {
      setHeldEchoes([]);
      return;
    }
    const items = await listHeld(viewerId, recipientId);
    const echoes: ThreadMessage[] = [];
    for (const item of items) {
      const tempId = `held-${item.clientMessageId}`;
      let echo: ThreadMessage | null = null;
      if (item.payload.kind === "text") {
        echo = {
          id: tempId,
          tempId,
          clientMessageId: item.clientMessageId,
          conversationId: item.payload.conversationId ?? "",
          senderId: viewerId,
          body: item.payload.plaintext,
          listingId: item.payload.listingId ?? null,
          imageUrl: null,
          imagePath: null,
          groupId: null,
          readAt: null,
          createdAt: item.createdAt,
          isE2e: false,
          e2eHeader: null,
        };
      } else {
        const entry = await getOutbox(item.clientMessageId).catch(() => null);
        if (entry) echo = outboxEcho(entry, tempId, viewerId, false);
      }
      if (!echo) continue;
      echoes.push({
        ...echo,
        id: tempId,
        tempId,
        createdAt: item.createdAt,
        pending: false,
        failed: false,
        held: item.state === "expired" ? "expired" : "held",
      });
    }
    const nowIds = new Set(echoes.map((e) => e.clientMessageId as string));
    const gone = [...heldIdsRef.current].some((id) => !nowIds.has(id));
    heldIdsRef.current = nowIds;
    setHeldEchoes(echoes);
    if (gone) {
      refetchDeltaRef.current?.();
      onMutated?.();
    }
  }, [viewerId, recipientId, onMutated]);

  useEffect(() => {
    let active = true;
    // A different recipient starts from an empty baseline, so its first load
    // is not mistaken for "a held send disappeared".
    heldIdsRef.current = new Set();
    const run = () => {
      if (active) void refreshHeld();
    };
    queueMicrotask(run);
    const unsubscribe = subscribeHeldSends(run);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [refreshHeld]);

  // Opening the thread is one of the moments a held send is retried (the
  // recipient may have signed in since). A no-op when nothing is held.
  useEffect(() => {
    if (viewerId && recipientId) void releaseHeld(viewerId, recipientId);
  }, [viewerId, recipientId]);

  /**
   * Park a send the recipient cannot receive yet. The first held message for
   * a recipient also sends one content-free nudge (rate-limited server-side)
   * so they know someone wants to talk and sign in.
   */
  const holdOutbound = useCallback(
    async (
      clientMessageId: string,
      payload: HeldPayload,
      listingId?: string,
    ) => {
      if (!viewerId || !recipientId) return;
      const first = !(await listHeld(viewerId, recipientId)).some((i) =>
        isPending(i.state),
      );
      await holdSend(viewerId, { clientMessageId, recipientId, payload });
      if (first) void nudgeRecipient(recipientId, listingId);
    },
    [viewerId, recipientId],
  );

  const cancelHeldSend = useCallback(
    (message: ThreadMessage) => {
      if (viewerId && message.clientMessageId)
        void cancelHeld(viewerId, message.clientMessageId);
    },
    [viewerId],
  );

  const reportE2eFailure = useCallback(
    (
      outcome: Exclude<E2eSendOutcome | AttachmentSendOutcome, { ok: true }>,
    ) => {
      if (outcome.reason === "no-recipient-keys")
        onSendError?.("E2E_NO_KEYS", 404);
      else if (outcome.reason === "send-failed")
        onSendError?.(outcome.message, outcome.status);
      else if (outcome.reason === "upload-failed")
        onSendError?.("Attachment upload failed", outcome.status);
      else onSendError?.("E2E_UNAVAILABLE", 0);
    },
    [onSendError],
  );

  /**
   * Encrypted-attachment send: upload what's left, then one E2E message.
   * The outbox entry survives failures, so retry/reload resume it with the
   * same ids (lib/e2e/attachments/send.ts).
   */
  const dispatchOutbox = useCallback(
    async (
      entry: OutboxEntry,
      tempId: string,
      draftKeys: string[] = [],
    ): Promise<string | null> => {
      if (!viewerId) return null;
      setIsSending(true);
      const engine = await getE2eEngine(viewerId).catch(() => null);
      const outcome = await sendOutboxEntry(engine, entry, {
        senderId: viewerId,
        send: sendChatMessage,
      });
      setIsSending(false);
      if (!outcome.ok) {
        if (outcome.reason === "no-recipient-keys") {
          // The recipient has no E2E device yet: keep the entry (it stays in
          // the attachment outbox) and wait, instead of failing.
          setLocal((prev) => prev.filter((m) => m.tempId !== tempId));
          await holdOutbound(
            entry.clientMessageId,
            { kind: "outbox" },
            entry.listingId,
          );
          return null;
        }
        markFailed(tempId);
        reportE2eFailure(outcome);
        return null;
      }
      for (const key of draftKeys) removeDraftImage(key);
      // Same reason as text sends: show the known plaintext, not ciphertext.
      setLocal((prev) =>
        replaceEcho(prev, tempId, {
          ...outcome.result.message,
          body: contentFor(entry),
          pending: false,
          failed: false,
        }),
      );
      if (conversationId === null)
        onConversationCreated?.(outcome.result.conversationId);
      onMutated?.();
      return outcome.result.conversationId;
    },
    [
      viewerId,
      conversationId,
      markFailed,
      holdOutbound,
      reportE2eFailure,
      onConversationCreated,
      onMutated,
    ],
  );

  const dispatch = useCallback(
    async (draft: SendDraft, tempId: string, clientMessageId: string) => {
      if (!recipientId || !viewerId) return;

      // A retry of an encrypted-attachment send resumes its outbox entry.
      const saved = await getOutbox(clientMessageId).catch(() => null);
      if (saved) return dispatchOutbox(saved, tempId);

      const draftKeys = draft.draftKeys ?? [];
      const engine = await getE2eEngine(viewerId).catch(() => null);

      // Images and voice notes ride the v2 encrypted-attachment pipeline, and
      // deliberately have no fallback: the legacy path uploaded plaintext
      // images to a PUBLIC bucket — the exact leak E2E exists to close. A
      // browser without a registered v2 device fails here, visibly.
      if (draftKeys.length > 0 || draft.voice) {
        if (!E2E_ATTACHMENTS_ENABLED || !engine?.deviceId) {
          markFailed(tempId);
          onSendError?.("E2E_UNAVAILABLE", 0);
          return;
        }
        setIsSending(true);
        let entry: OutboxEntry;
        try {
          entry = await createOutboxEntry({
            clientMessageId,
            recipientId,
            conversationId,
            listingId: draft.listingId,
            text: draft.body,
            images: draftKeys
              .map((k) => getDraftFile(k))
              .filter((f): f is File => f !== null),
            ...(draft.voice
              ? {
                  voice: {
                    blob: draft.voice.file,
                    mime: draft.voice.file.type,
                    durationMs: draft.voice.durationMs,
                  },
                }
              : {}),
          });
        } catch (err) {
          setIsSending(false);
          markFailed(tempId);
          onSendError?.(
            err instanceof Error ? err.message : "Attachment upload failed",
            0,
          );
          return;
        }
        // Swap the placeholder bubble for the real encrypted content (caption,
        // voice duration, image previews). Built from the same JSON that will
        // be sealed, so the optimistic render and the recipient's view match.
        const echo = outboxEcho(entry, tempId, viewerId, true);
        setLocal((prev) =>
          prev.some((m) => m.tempId === tempId)
            ? prev.map((m) => (m.tempId === tempId ? echo : m))
            : [...prev, echo],
        );
        const sentConversationId = await dispatchOutbox(
          entry,
          tempId,
          draftKeys,
        );
        // A location staged together with photos/voice cannot ride the same
        // message (its payload is the attachment JSON), so it follows as its
        // own encrypted message rather than being silently dropped. Only sent
        // after the attachment message landed, so a failure never splits the
        // pair into an orphaned location.
        if (sentConversationId && draft.location) {
          const followUp = await sendE2eText(engine, {
            conversationId: sentConversationId,
            senderId: viewerId,
            recipientId,
            plaintext: encodeLocationContent(draft.location),
            clientMessageId: `${clientMessageId}-location`,
            send: sendChatMessage,
          });
          if (followUp.ok) onMutated?.();
          else onSendError?.("E2E_UNAVAILABLE", 0);
        }
        return;
      }

      // Everything else is ONE encrypted body: plain text, a shared location,
      // or a listing-only card (whose body is the structured marker the thread
      // renders as the card). sendE2eText encrypts → sends → commits the
      // ratchet session under one per-conversation lock.
      const plaintext = draft.location
        ? encodeLocationContent(draft.location)
        : (draft.body ?? (draft.listingId ? encodeListingOnlyContent() : null));
      if (!plaintext) {
        markFailed(tempId);
        onSendError?.("E2E_UNAVAILABLE", 0);
        return;
      }

      setIsSending(true);
      const outcome = await sendE2eText(engine, {
        conversationId,
        senderId: viewerId,
        recipientId,
        plaintext,
        listingId: draft.listingId,
        clientMessageId,
        send: sendChatMessage,
      });
      setIsSending(false);

      if (!outcome.ok) {
        if (outcome.reason === "no-recipient-keys") {
          // No E2E device on the other side yet. Hold the sealed body here and
          // send it the moment one registers; nothing leaves in the clear.
          setLocal((prev) => prev.filter((m) => m.tempId !== tempId));
          await holdOutbound(
            clientMessageId,
            {
              kind: "text",
              plaintext,
              listingId: draft.listingId,
              conversationId,
            },
            draft.listingId,
          );
          return;
        }
        setLocal((prev) =>
          prev.map((m) =>
            m.tempId === tempId ? { ...m, pending: false, failed: true } : m,
          ),
        );
        if (outcome.reason === "send-failed") {
          onSendError?.(outcome.message, outcome.status);
        } else {
          onSendError?.("E2E_UNAVAILABLE", 0);
        }
        return;
      }

      // Replace the optimistic echo with the server row, keeping the plaintext
      // we already know: the server copy is ciphertext, and rendering it for a
      // frame would flash base64. History refetches resolve via the decrypt
      // cache committed inside sendE2eText.
      setLocal((prev) =>
        replaceEcho(prev, tempId, {
          ...outcome.result.message,
          body: plaintext,
          pending: false,
          failed: false,
        }),
      );
      if (conversationId === null) {
        onConversationCreated?.(outcome.result.conversationId);
      }
      onMutated?.();
    },
    [
      recipientId,
      viewerId,
      conversationId,
      onConversationCreated,
      onMutated,
      onSendError,
      dispatchOutbox,
      holdOutbound,
      markFailed,
    ],
  );

  // Resume encrypted-attachment sends interrupted by a reload or crash, once
  // per thread mount. Same ids → the server dedups anything already done.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (!recipientId || !viewerId || resumedRef.current) return;
    resumedRef.current = true;
    void listOutbox(recipientId)
      .then((entries) => {
        for (const entry of entries) {
          const tempId = `temp-outbox-${entry.clientMessageId}`;
          setLocal((prev) =>
            prev.some((m) => m.tempId === tempId)
              ? prev
              : [...prev, outboxEcho(entry, tempId, viewerId, true)],
          );
          void dispatchOutbox(entry, tempId);
        }
      })
      .catch(() => undefined);
  }, [recipientId, viewerId, dispatchOutbox]);

  const send = useCallback(
    (draft: SendDraft) => {
      if (!recipientId || !viewerId) return;
      markActivity();
      const tempId = `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      // Minted once per logical send; reused on every retry so a lost
      // response / double-tap replays instead of inserting twice.
      const clientMessageId = crypto.randomUUID();

      // Object URLs from the draft registry for the optimistic preview.
      const previewUrls: string[] = [];
      for (const key of draft.draftKeys ?? []) {
        const url = getDraftPreviewUrl(key);
        if (url) previewUrls.push(url);
      }

      // Create optimistic echo — first image shows preview, text shows body.
      const optimistic: ThreadMessage = {
        id: tempId,
        tempId,
        clientMessageId,
        conversationId: conversationId ?? "",
        senderId: viewerId,
        body:
          draft.body ??
          (draft.location ? encodeLocationContent(draft.location) : null),
        listingId: draft.listingId ?? null,
        imageUrl: previewUrls[0] ?? null,
        imagePath: null,
        groupId: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        isE2e: false,
        e2eHeader: null,
        pending: true,
      };
      setLocal((prev) => [...prev, optimistic]);
      void dispatch(draft, tempId, clientMessageId);
    },
    [recipientId, viewerId, conversationId, dispatch, markActivity],
  );

  const retry = useCallback(
    (message: ThreadMessage) => {
      if (!message.tempId) return;
      const clientMessageId = message.clientMessageId ?? crypto.randomUUID();
      setLocal((prev) =>
        prev.map((m) =>
          m.tempId === message.tempId
            ? { ...m, pending: true, failed: false, clientMessageId }
            : m,
        ),
      );
      // Failed drafts lose their attachment draft keys — retry resends the
      // body/listing only, so the user must re-attach if the upload failed.
      void dispatch(
        {
          body: message.body ?? undefined,
          listingId: message.listingId ?? undefined,
        },
        message.tempId,
        clientMessageId,
      );
    },
    [dispatch],
  );

  return {
    messages,
    peerLastReadAt,
    isLoading: conversationId !== null && history.isPending,
    error: history.error,
    hasOlder: history.hasNextPage,
    isLoadingOlder: history.isFetchingNextPage,
    loadOlder: () => void history.fetchNextPage(),
    send,
    retry,
    cancelHeldSend,
    isSending,
    markActivity,
    wsConnected,
  };
}

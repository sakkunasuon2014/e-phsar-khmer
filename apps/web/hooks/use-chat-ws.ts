"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getChatWsTicket } from "@/actions/chat";
import { getAttention } from "@/lib/polling/attention";
import type { ChatMessage } from "@/types/chat";

const WS_RECONNECT_BASE_MS = 1_000;
const WS_RECONNECT_MAX_MS = 30_000;
const WS_RECONNECT_ATTEMPTS = 10;
/**
 * How long a hidden tab keeps its socket before closing it. Short enough that a
 * forgotten background tab stops pinning a backend instance, long enough that
 * a quick tab switch doesn't churn a reconnect + ticket fetch.
 */
const WS_HIDDEN_GRACE_MS = 60_000;

function isTabHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

/**
 * `API_URL` (`lib/api/client.ts`) is deliberately server-only — this hook
 * runs in the browser and can't read it, so it can't just reuse that value.
 * Default is same-origin: correct in production (Next.js and the backend
 * share an origin), and SAFE in dev even when they don't — a same-origin
 * `/ws/chat` upgrade against the Next.js dev server has no route to match,
 * so it fails to connect rather than guessing a port. A failed connection
 * keeps `isConnected` false, so callers correctly fall back to the REST send
 * path instead of silently losing messages.
 *
 * Set `NEXT_PUBLIC_WS_URL` to the backend's origin (e.g. `ws://localhost:8080`
 * or `https://your-tunnel.example.com`, `http(s)` accepted and normalized to
 * `ws(s)`) whenever it runs on a different origin than the Next.js server —
 * which in this repo's dev setup is the common case, not the exception.
 *
 * The override's own scheme is NOT trusted as the last word: a page loaded
 * over HTTPS (e.g. a tunnel) can never open a plain `ws://` connection —
 * browsers block it outright as mixed content — so an https/wss page always
 * forces `wss:`, even if `NEXT_PUBLIC_WS_URL` was typo'd as `ws://`.
 */
function resolveWsOrigin(): string {
  const pageIsSecure = window.location.protocol === "https:";
  const override = process.env.NEXT_PUBLIC_WS_URL;
  if (override) {
    const url = new URL(override);
    const secure =
      pageIsSecure || url.protocol === "https:" || url.protocol === "wss:";
    return `${secure ? "wss:" : "ws:"}//${url.host}`;
  }

  return `${pageIsSecure ? "wss:" : "ws:"}//${window.location.host}`;
}

export type ChatWsEvent =
  | { type: "message"; payload: ChatMessage }
  | { type: "inbox_update" }
  | { type: "unread_count" }
  /** The peer read my messages in this conversation — refetch receipts. */
  | { type: "read"; payload: { conversationId: string } }
  /**
   * A notification was created for me (e.g. `payment.succeeded`). The
   * socket is the app's one push transport, not only chat's.
   */
  | {
      type: "notification";
      payload: { type: string; data?: Record<string, unknown> };
    }
  /** Reply to our own `send_message` frame. */
  | {
      type: "ack";
      payload: {
        clientMessageId: string | null;
        conversationId: string;
        message: ChatMessage;
      };
    }
  | {
      type: "error";
      payload: {
        clientMessageId: string | null;
        code: string;
        message: string;
        details?: unknown;
      };
    };

type Listener = (event: ChatWsEvent) => void;
type ConnectedListener = (connected: boolean) => void;

/**
 * One physical WebSocket per browser tab, ref-counted across every mounted
 * consumer (nav unread badge, inbox list, an open thread) instead of one
 * socket per component. The badge is mounted on every page, so in practice
 * this keeps a single connection open for the whole session whenever the
 * user is signed in — which is what lets `inbox_update` / `unread_count`
 * replace their flat-interval polls instead of only helping while a thread
 * happens to be open.
 *
 * Bounded reconnect (10 attempts, exponential backoff up to 30s) covers both
 * a real disconnect and a signed-out visitor (no ticket / rejected socket) —
 * it is not tied to auth state, so there is no stale "not authenticated" flag
 * to invalidate after a client-side login. Exhausting the budget is not
 * permanent: coming back online or refocusing the tab starts a fresh round.
 *
 * A tab hidden for `WS_HIDDEN_GRACE_MS` closes its socket and reopens it when
 * it becomes visible again. An open socket keeps a backend instance alive (and
 * billed for provisioned memory) even when nothing is sent, so without this one
 * forgotten background tab pinned an instance for days. Nothing is lost while
 * it's closed: polling pauses in hidden tabs too, and on refocus the thread's
 * `after=` delta poll and the inbox/badge refetch catch up.
 *
 * Every connect fetches a fresh short-lived ticket (`getChatWsTicket`) rather
 * than relying on the auth cookie, which is never sent when the backend is on
 * another origin (e.g. an ngrok tunnel) — and which may hold an expired access
 * token on reconnect, since only server actions refresh it.
 *
 * Handlers of a superseded socket are ignored (`this.ws !== ws`): a torn-down
 * socket's `onclose` fires asynchronously, often after a remount (StrictMode,
 * navigation) already opened its replacement — without the guard it nulled
 * the live socket, leaving `isConnected` true while `send()` dropped frames.
 */
class ChatSocket {
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly connectedListeners = new Set<ConnectedListener>();
  private refCount = 0;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  /** Closed because nobody used the visible tab for a long time (see attention.ts). */
  private idleClosed = false;
  private stopAttention: (() => void) | null = null;
  /** Bumped per connect/teardown so an in-flight ticket fetch can tell it's stale. */
  private generation = 0;
  private connecting = false;
  /** Set after the first open in this tab — later opens are reconnects. */
  private hasConnectedBefore = false;
  isConnected = false;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    this.refCount += 1;
    if (this.refCount === 1) this.addWakeListeners();
    this.ensureConnected();
    return () => {
      this.listeners.delete(listener);
      this.refCount = Math.max(0, this.refCount - 1);
      if (this.refCount === 0) this.teardown();
    };
  }

  onConnectedChange(cb: ConnectedListener): () => void {
    this.connectedListeners.add(cb);
    cb(this.isConnected);
    return () => this.connectedListeners.delete(cb);
  }

  send(envelope: {
    recipientId: string;
    body?: string;
    listingId?: string;
    imagePath?: string;
    groupId?: string | null;
    clientMessageId?: string;
  }) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({ event: "send_message", data: { payload: envelope } }),
    );
  }

  private ensureConnected() {
    if (this.connecting || isTabHidden() || this.idleClosed) return;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    )
      return;
    void this.connect();
  }

  private async connect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connecting = true;
    const generation = ++this.generation;
    const ticket = await getChatWsTicket().catch(() => null);
    this.connecting = false;
    // Torn down (or superseded) while the ticket was in flight.
    if (generation !== this.generation || this.refCount === 0) return;
    // Hidden while the ticket was in flight — `onVisibilityChange` reconnects.
    if (isTabHidden()) return;
    if (!ticket) {
      this.scheduleReconnect();
      return;
    }

    const ws = new WebSocket(
      `${resolveWsOrigin()}/ws/chat?ticket=${encodeURIComponent(ticket)}`,
    );
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.setConnected(true);
      // Pushes sent while we were closed (hidden tab, network drop) are gone,
      // and the badge/inbox stop polling once connected — nudge them to
      // refetch. An open thread catches up on its own (`use-chat-thread.ts`).
      if (this.hasConnectedBefore) {
        for (const listener of this.listeners) {
          listener({ type: "inbox_update" });
          listener({ type: "unread_count" });
        }
      }
      this.hasConnectedBefore = true;
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      let data: ChatWsEvent;
      try {
        data = JSON.parse(event.data) as ChatWsEvent;
      } catch {
        return; // malformed frame — ignore
      }
      for (const listener of this.listeners) listener(data);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded — the live socket is someone else
      this.ws = null;
      this.setConnected(false);
      if (this.refCount > 0) this.scheduleReconnect();
    };

    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.attempt >= WS_RECONNECT_ATTEMPTS) return;
    const delay = Math.min(
      WS_RECONNECT_BASE_MS * 2 ** this.attempt,
      WS_RECONNECT_MAX_MS,
    );
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.refCount > 0 && !isTabHidden() && !this.idleClosed)
        void this.connect();
    }, delay);
  }

  /** Network back / tab refocused: retry now with a fresh backoff budget. */
  private readonly wake = () => {
    if (this.refCount === 0 || isTabHidden() || this.idleClosed) return;
    this.attempt = 0;
    this.ensureConnected();
  };

  private readonly onVisibilityChange = () => {
    if (isTabHidden()) {
      if (this.hiddenTimer) return;
      this.hiddenTimer = setTimeout(() => {
        this.hiddenTimer = null;
        if (isTabHidden()) this.disconnect();
      }, WS_HIDDEN_GRACE_MS);
      return;
    }
    this.clearHiddenTimer();
    this.wake();
  };

  private clearHiddenTimer() {
    if (this.hiddenTimer) clearTimeout(this.hiddenTimer);
    this.hiddenTimer = null;
  }

  private addWakeListeners() {
    window.addEventListener("online", this.wake);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    // An abandoned visible tab is treated like a hidden one: the socket closes,
    // and the first input reopens it (the reconnect refreshes inbox and unread).
    this.stopAttention = getAttention().onChange((idle) => {
      this.idleClosed = idle;
      if (idle) this.disconnect();
      else this.wake();
    });
  }

  private removeWakeListeners() {
    window.removeEventListener("online", this.wake);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.stopAttention?.();
    this.stopAttention = null;
    this.idleClosed = false;
    this.clearHiddenTimer();
  }

  /**
   * Close the socket but keep every subscriber — used when the tab is hidden.
   * `wake` reopens it; `teardown` is the full stop once nobody is subscribed.
   */
  private disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.generation += 1; // invalidates an in-flight ticket fetch
    this.connecting = false;
    const ws = this.ws;
    this.ws = null; // detach first so its async onclose is ignored
    ws?.close();
    this.attempt = 0;
    this.setConnected(false);
  }

  private setConnected(v: boolean) {
    this.isConnected = v;
    for (const cb of this.connectedListeners) cb(v);
  }

  private teardown() {
    this.removeWakeListeners();
    this.disconnect();
  }
}

// Module-scoped singleton — deliberately not created per-hook-call. Every
// `useChatWs`/`useChatRealtime` instance across the app shares this one.
const chatSocket = new ChatSocket();

export interface ChatWsState {
  isConnected: boolean;
  send: (envelope: {
    recipientId: string;
    body?: string;
    listingId?: string;
    imagePath?: string;
    groupId?: string | null;
    /** Stable client dedup key — mirrors `SendMessageInput.clientMessageId`. */
    clientMessageId?: string;
  }) => void;
}

/**
 * Full per-thread hook: message delivery + send, on the shared connection.
 * `enabled` controls this consumer's own subscription — the underlying
 * socket may still be open because the badge or inbox list is also
 * subscribed elsewhere on the page.
 */
export function useChatWs({
  enabled,
  onMessage,
  onRead,
}: {
  enabled: boolean;
  onMessage: (msg: ChatMessage) => void;
  /** The peer read my messages in `conversationId`. */
  onRead?: (conversationId: string) => void;
}): ChatWsState {
  const [isConnected, setIsConnected] = useState(chatSocket.isConnected);
  const onMessageRef = useRef(onMessage);
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onMessageRef.current = onMessage;
    onReadRef.current = onRead;
  });

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = chatSocket.subscribe((event) => {
      if (event.type === "message") onMessageRef.current(event.payload);
      else if (event.type === "read")
        onReadRef.current?.(event.payload.conversationId);
    });
    const unsubscribeConnected = chatSocket.onConnectedChange(setIsConnected);
    return () => {
      unsubscribe();
      unsubscribeConnected();
    };
  }, [enabled]);

  const send = useCallback((envelope: Parameters<ChatWsState["send"]>[0]) => {
    chatSocket.send(envelope);
  }, []);

  return { isConnected: enabled && isConnected, send };
}

/**
 * Lightweight hook for consumers that only care about `inbox_update` /
 * `unread_count` signals and connection state — the nav badge and the inbox
 * list. Also keeps the shared socket's ref count alive, since both of these
 * are typically the only thing mounted outside an open thread.
 */
export function useChatRealtimeEvents({
  enabled,
  onEvent,
}: {
  enabled: boolean;
  onEvent: (
    event: Extract<ChatWsEvent, { type: "inbox_update" | "unread_count" }>,
  ) => void;
}): { isConnected: boolean } {
  const [isConnected, setIsConnected] = useState(chatSocket.isConnected);
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = chatSocket.subscribe((event) => {
      if (event.type === "inbox_update" || event.type === "unread_count")
        onEventRef.current(event);
    });
    const unsubscribeConnected = chatSocket.onConnectedChange(setIsConnected);
    return () => {
      unsubscribe();
      unsubscribeConnected();
    };
  }, [enabled]);

  return { isConnected: enabled && isConnected };
}

/**
 * Notification pushes (`{ type: "notification" }` frames) on the shared
 * socket. A push sent while the socket was down is not replayed, so callers
 * that wait on one should re-read their state whenever `isConnected` flips
 * back to true.
 */
export function useNotificationEvents({
  enabled,
  onNotification,
}: {
  enabled: boolean;
  onNotification: (
    notification: Extract<ChatWsEvent, { type: "notification" }>["payload"],
  ) => void;
}): { isConnected: boolean } {
  const [isConnected, setIsConnected] = useState(chatSocket.isConnected);
  const onNotificationRef = useRef(onNotification);
  useEffect(() => {
    onNotificationRef.current = onNotification;
  });

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = chatSocket.subscribe((event) => {
      if (event.type === "notification")
        onNotificationRef.current(event.payload);
    });
    const unsubscribeConnected = chatSocket.onConnectedChange(setIsConnected);
    return () => {
      unsubscribe();
      unsubscribeConnected();
    };
  }, [enabled]);

  return { isConnected: enabled && isConnected };
}

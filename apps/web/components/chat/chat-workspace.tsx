"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  LogIn,
  MessagesSquare,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import {
  deleteConversation,
  fetchConversationWith,
  fetchInbox,
  getChatViewer,
} from "@/actions/chat";
import { chatKeys, isUnauthenticated, unwrap } from "@/lib/chat/queries";
import { readListingPreview } from "@/lib/chat/listing-handoff";
import { CHAT_POLL } from "@/hooks/use-chat-polling";
import { useTabAttending } from "@/hooks/use-tab-attention";
import { useChatRealtimeEvents } from "@/hooks/use-chat-ws";
import { useE2eEngine } from "@/hooks/use-e2e-engine";
import { ConversationList } from "@/components/chat/conversation-list";
import { MessageThread } from "@/components/chat/message-thread";
import { E2eBackupPanel } from "@/components/chat/e2e-backup-panel";
import { E2eBootstrapNotice } from "@/components/chat/e2e-bootstrap-notice";
import type {
  ConversationWithUser,
  InboxItem,
  ListingContext,
} from "@/types/chat";

const SIDEBAR_COLLAPSED_KEY = "chat_sidebar_collapsed";

// `localStorage.setItem` never fires a `storage` event in the SAME tab that
// wrote it (only OTHER tabs get notified) — so `setSidebarCollapsed` below
// notifies this tiny listener set itself after every write, which is what
// lets `useSyncExternalStore` re-render this tab immediately on toggle.
const sidebarCollapsedListeners = new Set<() => void>();

function getSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false; // private mode / quota
  }
}

function getSidebarCollapsedServerSnapshot(): boolean {
  return false;
}

function setSidebarCollapsed(next: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
  } catch {
    // Private mode / quota — the toggle still works for this render, it
    // just won't survive a reload.
  }
  sidebarCollapsedListeners.forEach((listener) => listener());
}

function subscribeSidebarCollapsed(listener: () => void): () => void {
  sidebarCollapsedListeners.add(listener);
  return () => sidebarCollapsedListeners.delete(listener);
}

// Drag-resizable width (desktop only). `null` = never resized, so the default
// responsive widths (md:300px / lg:340px) apply. Shares the listener set above
// — both prefs live in the same same-tab-notify store.
const SIDEBAR_WIDTH_KEY = "chat_sidebar_width";
const SIDEBAR_MIN_W = 240;
const SIDEBAR_MAX_W = 560;
// The thread column must keep at least this much room whatever the drag says.
const THREAD_MIN_W = 360;

function getSidebarWidth(): number | null {
  try {
    const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    // Stored values are per-browser and may predate the current bounds, so
    // clamp on read too — an out-of-range width would starve the thread.
    return Number.isFinite(raw) && raw >= SIDEBAR_MIN_W
      ? Math.min(raw, SIDEBAR_MAX_W)
      : null;
  } catch {
    return null;
  }
}

function getSidebarWidthServerSnapshot(): number | null {
  return null;
}

function setSidebarWidth(next: number | null): void {
  try {
    if (next === null) localStorage.removeItem(SIDEBAR_WIDTH_KEY);
    else localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(next)));
  } catch {
    // Private mode / quota — width holds for this session's render only.
  }
  sidebarCollapsedListeners.forEach((listener) => listener());
}

function clampSidebarWidth(width: number, panelWidth: number): number {
  const max = Math.min(SIDEBAR_MAX_W, panelWidth - THREAD_MIN_W);
  return Math.max(SIDEBAR_MIN_W, Math.min(width, max));
}

export interface ChatWorkspaceProps {
  /** Deep-link: open (or start) the thread with this user. */
  initialPeerId?: string;
  /** Deep-link: attach this listing to the first message sent. */
  initialListingId?: string;
  /** Optional preview card for `initialListingId` before the first send. */
  initialListing?: ListingContext | null;
}

/**
 * The customer ↔ seller chat surface: inbox on the left, thread on the right.
 * On small screens the two become a single pane — the list until a thread is
 * picked, the thread (with a back arrow) after — because this market is
 * phone-first.
 */
export function ChatWorkspace({
  initialPeerId,
  initialListingId,
  initialListing,
}: ChatWorkspaceProps) {
  const t = useTranslations("Chat");
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();

  const peerFromUrl = initialPeerId ?? searchParams.get("to") ?? null;
  const listingFromUrl =
    initialListingId ?? searchParams.get("listing") ?? null;

  const [selectedPeerId, setSelectedPeerId] = useState<string | null>(
    peerFromUrl,
  );

  // Preview card for `listingFromUrl` before the first message rides it to
  // the server — stashed by ContactSellerButton for this tab (see
  // lib/chat/listing-handoff.ts). Lazy initializer: read once at mount, not
  // in an effect — `listingFromUrl` is a one-shot deep-link param that never
  // changes for the life of this component.
  const [listingPreview] = useState<ListingContext | null>(() => {
    if (initialListing !== undefined) return initialListing ?? null;
    return listingFromUrl ? readListingPreview(listingFromUrl) : null;
  });

  // ── Viewer ────────────────────────────────────────────────────────────────
  const viewer = useQuery({
    queryKey: chatKeys.viewer(),
    queryFn: async () => unwrap(await getChatViewer()),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Warm E2E bootstrap as soon as the viewer is known so key registration
  // races ahead of the first send (fail-closed on send if still pending). The
  // backup panel reads the same engine through E2eBackupProvider.
  //
  // The passcode re-prompt itself now lives in `MessageThread`: it re-opens
  // whenever a thread with unavailable messages loads (not once per browser
  // session — that one-shot version used to live here), because only the
  // thread knows whether the conversation it is showing actually has any.
  useE2eEngine(viewer.isSuccess ? (viewer.data?.id ?? null) : null);

  // ── Inbox ─────────────────────────────────────────────────────────────────
  // The nav badge's own socket subscription keeps the shared connection alive
  // sitewide, but this hook still needs its own subscription here: it is what
  // gates the poll below off, and the badge's connection state isn't visible
  // outside its own component.
  const { isConnected: realtimeConnected } = useChatRealtimeEvents({
    enabled: viewer.isSuccess,
    onEvent: (event) => {
      if (event.type === "inbox_update")
        void queryClient.invalidateQueries({ queryKey: chatKeys.inbox() });
    },
  });

  // Idle counts as "no socket": the socket closes when the tab is abandoned,
  // and the fallback interval must not take over from a tab nobody is using.
  const attending = useTabAttending();
  const inbox = useInfiniteQuery({
    queryKey: chatKeys.inbox(),
    enabled: viewer.isSuccess,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) =>
      unwrap(await fetchInbox(pageParam ?? undefined)),
    getNextPageParam: (last) => last.meta.nextCursor,
    // Realtime push (see the subscription above) replaces the poll once the
    // socket is up; the interval stays as the fallback while it isn't.
    refetchInterval:
      realtimeConnected || !attending ? false : CHAT_POLL.inboxMs,
    refetchIntervalInBackground: false,
  });

  const items: InboxItem[] = useMemo(
    () => (inbox.data?.pages ?? []).flatMap((p) => p.items),
    [inbox.data],
  );

  // ── Selected thread context (peer, block state, conversation id) ──────────
  // `GET /chats/with/:userId` is the only source of block state, and it never
  // creates a conversation — so it is safe to call on every thread open.
  const withPeer = useQuery({
    queryKey: chatKeys.with(selectedPeerId ?? "none"),
    enabled: viewer.isSuccess && selectedPeerId !== null,
    queryFn: async () =>
      unwrap(await fetchConversationWith(selectedPeerId as string)),
    // Resolved on every thread switch, so a short staleTime meant one request
    // per click. Block state rarely changes and a send 403 invalidates this.
    staleTime: 5 * 60 * 1000,
  });

  const handleSelect = useCallback(
    (item: InboxItem) => {
      if (!item.otherUser) return;
      // The inbox row is fresher than a cached `with` lookup (e.g. cached
      // before the peer started this thread) — re-resolve only on mismatch.
      const cached = queryClient.getQueryData<ConversationWithUser>(
        chatKeys.with(item.otherUser.id),
      );
      if (cached && cached.conversation?.id !== item.id)
        void queryClient.invalidateQueries({
          queryKey: chatKeys.with(item.otherUser.id),
        });
      setSelectedPeerId(item.otherUser.id);
    },
    [queryClient],
  );

  const handleBack = useCallback(() => setSelectedPeerId(null), []);

  // Reconcile the SELECTED peer's cached `with` lookup against the inbox.
  // A deep-linked thread (opened before any conversation existed) caches
  // `conversation: null` for 5 minutes; when the peer then sends the first
  // message, the inbox refreshes (socket push or fallback poll) but the stale
  // lookup would keep the pane empty until the row is clicked. This effect
  // covers both paths. It cannot loop: after the refetch the cached id equals
  // `item.id`, so the condition goes false.
  useEffect(() => {
    if (!selectedPeerId) return;
    const item = items.find((i) => i.otherUser?.id === selectedPeerId);
    if (!item) return;
    const cached = queryClient.getQueryData<ConversationWithUser>(
      chatKeys.with(selectedPeerId),
    );
    if (!cached || cached.conversation?.id !== item.id)
      void queryClient.invalidateQueries({
        queryKey: chatKeys.with(selectedPeerId),
      });
  }, [items, selectedPeerId, queryClient]);

  // ── Sidebar collapse (desktop only — mobile already toggles list/thread
  // via threadOpen, so there's no room to also collapse there) ──────────────
  // useSyncExternalStore, not useState+effect: reading localStorage during an
  // effect and then calling setState is the classic hydration-mismatch trap
  // (server has no localStorage, so first paint and the post-mount update
  // disagree). useSyncExternalStore's getServerSnapshot is exactly the
  // sanctioned way to read a browser-only store safely — React renders the
  // server snapshot through hydration, then reconciles to the real one.
  const sidebarCollapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsed,
    getSidebarCollapsedServerSnapshot,
  );
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed(!sidebarCollapsed);
  }, [sidebarCollapsed]);

  // ── Sidebar resize (desktop only) ─────────────────────────────────────────
  // The live drag width stays in component state and is written to storage
  // once on release — no localStorage write per pointermove.
  const storedSidebarWidth = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarWidth,
    getSidebarWidthServerSnapshot,
  );
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const sidebarWidth = dragWidth ?? storedSidebarWidth;
  const asideRef = useRef<HTMLElement>(null);

  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const aside = asideRef.current;
      const panel = aside?.parentElement;
      if (!aside || !panel || e.button !== 0) return;
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = aside.getBoundingClientRect().width;
      const panelW = panel.getBoundingClientRect().width;
      let latest = startW;
      // Keep the col-resize cursor and suppress text selection while the
      // pointer wanders off the 6px handle.
      const prevCursor = document.body.style.cursor;
      const prevSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        latest = clampSidebarWidth(startW + ev.clientX - startX, panelW);
        setDragWidth(latest);
      };
      const onUp = () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevSelect;
        setSidebarWidth(latest);
        setDragWidth(null);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [],
  );

  const handleResizeKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const aside = asideRef.current;
      const panel = aside?.parentElement;
      if (!aside || !panel) return;
      const step = e.shiftKey ? 64 : 16;
      const current = aside.getBoundingClientRect().width;
      const panelW = panel.getBoundingClientRect().width;
      let next: number;
      if (e.key === "ArrowLeft") next = current - step;
      else if (e.key === "ArrowRight") next = current + step;
      else if (e.key === "Home") next = SIDEBAR_MIN_W;
      else if (e.key === "End") next = SIDEBAR_MAX_W;
      else return;
      e.preventDefault();
      setSidebarWidth(clampSidebarWidth(next, panelW));
    },
    [],
  );

  // Double-click the handle to go back to the default responsive width.
  const handleResizeReset = useCallback(() => setSidebarWidth(null), []);

  // ── Delete conversation (per-participant hide, see DELETE /chats/:id) ─────
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const handleDelete = useCallback(
    async (item: InboxItem) => {
      setDeletingId(item.id);
      const res = await deleteConversation(item.id);
      setDeletingId(null);

      if (!res.ok) {
        toast.error(res.message || t("errors.generic"));
        return;
      }

      toast.success(t("inbox.deleteSuccess"));
      void queryClient.invalidateQueries({ queryKey: chatKeys.inbox() });
      // The deleted thread was open — back out to the list rather than
      // leaving a stale/gone conversation on screen.
      if (item.otherUser && selectedPeerId === item.otherUser.id) {
        setSelectedPeerId(null);
      }
    },
    [queryClient, selectedPeerId, t],
  );

  const handleConversationCreated = useCallback(() => {
    // The thread now exists — refresh the inbox and re-resolve `with` so the
    // conversation id lands in cache.
    void queryClient.invalidateQueries({ queryKey: chatKeys.inbox() });
    if (selectedPeerId) {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.with(selectedPeerId),
      });
    }
  }, [queryClient, selectedPeerId]);

  // Keep the URL shareable without a navigation round trip.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedPeerId) url.searchParams.set("to", selectedPeerId);
    else url.searchParams.delete("to");
    window.history.replaceState(null, "", url.toString());
  }, [selectedPeerId]);

  // ── Unauthenticated ───────────────────────────────────────────────────────
  if (viewer.isError && isUnauthenticated(viewer.error)) {
    return (
      <Panel>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-20 text-center">
          <LogIn className="size-8 text-muted-foreground" />
          <p className="text-sm font-medium">{t("auth.requiredTitle")}</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            {t("auth.requiredDescription")}
          </p>
          <Button asChild size="sm">
            <Link href="/login">{t("auth.signIn")}</Link>
          </Button>
        </div>
      </Panel>
    );
  }

  if (viewer.isError) {
    return (
      <Panel>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <p className="text-sm font-medium">{t("errors.loadFailedTitle")}</p>
          <p className="text-xs text-muted-foreground">
            {t("errors.loadFailed")}
          </p>
        </div>
      </Panel>
    );
  }

  const viewerId = viewer.data?.id ?? null;
  const threadOpen = selectedPeerId !== null;
  const peer = withPeer.data?.otherUser ?? null;
  const conversationId = withPeer.data?.conversation?.id ?? null;

  return (
    <Panel>
      {/* Inbox column — full width on mobile until a thread is opened.
          Collapsible to a narrow avatar rail on desktop only (md:). */}
      <aside
        ref={asideRef}
        style={
          sidebarWidth !== null
            ? ({
                "--chat-sidebar-w": `${sidebarWidth}px`,
              } as React.CSSProperties)
            : undefined
        }
        className={cn(
          "relative flex w-full shrink-0 flex-col border-border bg-card md:border-r",
          sidebarCollapsed
            ? "md:w-16"
            : sidebarWidth !== null
              ? // The max-width keeps THREAD_MIN_W (360px) for the thread
                // when the window shrinks after a resize was saved.
                "md:w-[var(--chat-sidebar-w)] md:max-w-[calc(100%-360px)]"
              : "md:w-[300px] lg:w-[340px]",
          threadOpen && "hidden md:flex",
        )}
      >
        {!sidebarCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("inbox.resize")}
            aria-valuemin={SIDEBAR_MIN_W}
            aria-valuemax={SIDEBAR_MAX_W}
            aria-valuenow={sidebarWidth ?? undefined}
            tabIndex={0}
            onPointerDown={handleResizeStart}
            onKeyDown={handleResizeKey}
            onDoubleClick={handleResizeReset}
            className="absolute inset-y-0 -right-[3px] z-10 hidden w-1.5 cursor-col-resize touch-none transition-colors after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 hover:after:bg-primary focus-visible:outline-none focus-visible:after:bg-primary md:block"
          />
        )}
        <div
          className={cn(
            "flex shrink-0 items-center border-b border-border px-4 py-3",
            sidebarCollapsed ? "md:justify-center md:px-2" : "justify-between",
          )}
        >
          <h1
            className={cn(
              "text-sm font-semibold",
              sidebarCollapsed && "md:hidden",
            )}
          >
            {t("inbox.title")}
          </h1>
          <div className="flex items-center gap-1.5">
            {inbox.isFetching && !inbox.isFetchingNextPage && (
              <Loader2
                className={cn(
                  "size-3.5 animate-spin text-muted-foreground",
                  sidebarCollapsed && "md:hidden",
                )}
              />
            )}
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              aria-label={
                sidebarCollapsed ? t("inbox.expand") : t("inbox.collapse")
              }
              className="hidden shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:inline-flex"
            >
              {sidebarCollapsed ? (
                <ChevronRight className="size-4" />
              ) : (
                <ChevronLeft className="size-4" />
              )}
            </button>
          </div>
        </div>
        <ConversationList
          items={items}
          viewerId={viewerId}
          activeId={conversationId}
          onSelect={handleSelect}
          isLoading={inbox.isPending}
          hasMore={inbox.hasNextPage}
          isLoadingMore={inbox.isFetchingNextPage}
          onLoadMore={() => void inbox.fetchNextPage()}
          onDelete={handleDelete}
          deletingId={deletingId}
          collapsed={sidebarCollapsed}
        />
      </aside>

      {/* Thread column */}
      <section
        className={cn(
          "min-w-0 flex-1 flex-col",
          threadOpen ? "flex" : "hidden md:flex",
        )}
      >
        <E2eBootstrapNotice />
        <E2eBackupPanel />
        {!threadOpen && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex size-20 items-center justify-center rounded-full bg-muted">
              <MessagesSquare className="size-8 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("thread.selectPrompt")}
            </p>
          </div>
        )}

        {threadOpen && withPeer.isPending && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {threadOpen && withPeer.isError && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-medium">{t("thread.notFoundTitle")}</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {t("thread.notFoundDescription")}
            </p>
            <Button variant="outline" size="sm" onClick={handleBack}>
              {t("thread.back")}
            </Button>
          </div>
        )}

        {threadOpen && peer && viewerId && (
          <MessageThread
            // Remount on thread switch: watermark, delta store and optimistic
            // echoes are all per-conversation and must not leak across.
            key={`${peer.id}:${conversationId ?? "new"}`}
            conversationId={conversationId}
            peer={peer}
            viewerId={viewerId}
            canMessage={withPeer.data?.canMessage ?? false}
            blockedByMe={withPeer.data?.blockedByMe ?? false}
            listingId={
              peer.id === peerFromUrl && listingFromUrl
                ? listingFromUrl
                : undefined
            }
            listing={
              peer.id === peerFromUrl && listingFromUrl
                ? listingPreview
                : undefined
            }
            onBack={handleBack}
            onConversationCreated={handleConversationCreated}
          />
        )}
      </section>
    </Panel>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    // Chat follows the visitor's theme like the rest of the site: the panel is
    // a card surface and the token-driven children below pick up whichever
    // token set next-themes' `dark` class on <html> selects. Portaled
    // menus/dialogs inherit that same html-level scope.
    // Height is the viewport minus the 3.5rem site navbar and this page's 1rem
    // top padding — the workspace sits inside the normal app shell.
    <div className="flex h-[calc(100dvh-3.5rem-1rem)] min-h-[480px] overflow-hidden rounded-lg border border-border bg-card text-foreground">
      {children}
    </div>
  );
}

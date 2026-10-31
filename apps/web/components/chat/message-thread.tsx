"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  Download,
  ImageOff,
  KeyRound,
  Loader2,
  MessageSquareOff,
  MoreVertical,
  SendHorizonal,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/sonner";
import { Link } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { dayKey, formatPrice } from "@/lib/chat/format";
import { saveFromUrl } from "@/lib/chat/save-file";
import { chatKeys, isNotFound } from "@/lib/chat/queries";
import { useChatThread } from "@/hooks/use-chat-thread";
import { useE2eEngine } from "@/hooks/use-e2e-engine";
import { useDecryptedMessages } from "@/hooks/use-decrypted-messages";
import { isDecryptable } from "@/lib/e2e/decrypt-message";
import { parseAttachmentContent } from "@/lib/e2e/attachments/content";
import { parseStructuredChatContent } from "@/lib/e2e/chat-content";
import { Composer, type ComposerDraft } from "@/components/chat/composer";
import { ListingContextCard } from "@/components/chat/listing-context-card";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ImageGroup } from "@/components/chat/image-group";
import { groupImageMessages } from "@/lib/chat/group-images";
import type { MessageNode } from "@/lib/chat/group-images";
import { groupUnavailable } from "@/lib/chat/group-unavailable";
import {
  E2E_RESTORE_SNOOZE_KEY,
  useE2eBackupContext,
} from "@/components/chat/e2e-backup-provider";
import type {
  ChatUserSummary,
  ListingContext,
  ThreadMessage,
} from "@/types/chat";

/** How long the opening loading block may wait on decryption. */
const DECRYPT_REVEAL_TIMEOUT_MS = 10_000;
const E2E_RELOAD_ATTEMPTED_KEY = "chat:e2e-reload-attempted";

/**
 * Text-only replies offered above the composer. Their label IS the message
 * body, so tapping one sends exactly what the peer reads — through the same
 * encrypted path as typed text.
 */
const QUICK_REPLIES = [
  "hi",
  "available",
  "offer",
  "sold",
  "negotiable",
  "notNegotiable",
] as const;

/**
 * Dismissal memory for the quick-replies row, scoped to one conversation.
 * The row is an empty-thread onboarding aid (see `showQuickReplies`), so the
 * flag only has to survive reloads of a still-empty chat. A brand-new
 * conversation has no stored key — that is what re-introduces the row for
 * every new chat without ever sharing a dismissal across chats.
 */
const QUICK_REPLIES_DISMISSED_KEY = "chat:quick-replies-dismissed";

function readQuickRepliesDismissed(scope: string): boolean {
  try {
    return (
      localStorage.getItem(`${QUICK_REPLIES_DISMISSED_KEY}:${scope}`) === "1"
    );
  } catch {
    return false; // private mode / quota
  }
}

function dismissQuickReplies(scope: string): void {
  try {
    localStorage.setItem(`${QUICK_REPLIES_DISMISSED_KEY}:${scope}`, "1");
  } catch {
    // Private mode / quota — hidden for this mount only.
  }
}

/** One day-bucket's renderable rows: an image group, a single bubble, or a
 * collapsed run of unavailable messages (finding H-5). */
type ThreadNode =
  | MessageNode
  | { kind: "unavailable-notice"; key: string; count: number };

/**
 * Turn a decrypted plaintext into what the bubble renders: attachment JSON
 * (caption + per-file keys), structured content (location / listing-only,
 * which must never surface as raw JSON), or ordinary text. Legacy plaintext
 * strings and old rows simply fall through as `body`.
 */
function withDecryptedContent(
  m: ThreadMessage,
  plaintext: string | null,
): ThreadMessage {
  // Only messages the server lists `attachments` on can carry file metadata.
  if (m.attachments?.length && plaintext !== null) {
    const content = parseAttachmentContent(plaintext);
    if (!content) return { ...m, body: null };
    return { ...m, body: content.text ?? null, e2eFiles: content.attachments };
  }
  if (plaintext === null) return m;
  const structured = parseStructuredChatContent(plaintext);
  if (structured?.kind === "location")
    return { ...m, body: null, sharedLocation: structured.location };
  if (structured?.kind === "listing")
    return { ...m, body: null, listingOnly: true };
  return plaintext === m.body ? m : { ...m, body: plaintext };
}

export function MessageThread({
  conversationId,
  peer,
  viewerId,
  canMessage,
  blockedByMe,
  listingId,
  listing,
  onBack,
  onConversationCreated,
}: {
  conversationId: string | null;
  peer: ChatUserSummary;
  viewerId: string;
  canMessage: boolean;
  blockedByMe: boolean;
  /** Attached to the FIRST message only — the "asking about this ad" card. */
  listingId?: string;
  listing?: ListingContext | null;
  onBack?: () => void;
  onConversationCreated?: (conversationId: string) => void;
}) {
  const t = useTranslations("Chat");
  const format = useFormatter();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [listingSent, setListingSent] = useState(false);
  const [listingDismissed, setListingDismissed] = useState(false);
  // Per-conversation dismissal memory for the quick-replies row. `peer.id` is
  // the scope until the first send creates the conversation (`conversationId`
  // null) — the same logical chat, and still one flag.
  const quickRepliesScope = conversationId
    ? `conversation:${conversationId}`
    : `peer:${peer.id}`;
  const [quickRepliesDismissedNow, setQuickRepliesDismissedNow] =
    useState(false);
  const quickRepliesDismissed =
    quickRepliesDismissedNow || readQuickRepliesDismissed(quickRepliesScope);
  const listingPending =
    Boolean(listingId) && !listingSent && !listingDismissed;

  const peerName = peer.username ?? t("unknownUser");
  const username = peer.username;
  // Read `lastSeenAt` defensively: it is optional on ChatUserSummary, and a
  // missing or null value must simply render no secondary line.
  const lastSeenAt =
    (peer as { lastSeenAt?: string | null }).lastSeenAt ?? null;
  const lastSeen = lastSeenAt ? new Date(lastSeenAt) : null;
  // Formatted once here so a malformed timestamp can never render as
  // "Invalid Date"; the header only decides whether to show the line.
  const lastActiveLabel =
    lastSeen !== null && !Number.isNaN(lastSeen.getTime())
      ? t("thread.lastActive", {
          time: format.relativeTime(lastSeen, new Date()),
        })
      : null;

  const onMutated = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: chatKeys.inbox() });
    void queryClient.invalidateQueries({ queryKey: chatKeys.unread() });
  }, [queryClient]);

  const reloadAfterE2eUnavailable = useCallback(() => {
    try {
      if (sessionStorage.getItem(E2E_RELOAD_ATTEMPTED_KEY) === "1") return;
      sessionStorage.setItem(E2E_RELOAD_ATTEMPTED_KEY, "1");
    } catch {
      // If sessionStorage is unavailable, still honor the requested reload.
    }
    window.location.reload();
  }, []);

  const onSendError = useCallback(
    (message: string, status: number) => {
      // 429: POST /chats/messages is capped at 30/60s server-side (an
      // anti-harassment limit). The raw backend message is not user-facing
      // copy, and the failed send stays on screen with its own retry
      // affordance — so surface the reason and let the person retry manually
      // rather than looping into the same limit.
      if (status === 429) {
        toast.error(t("errors.rateLimited"));
        return;
      }
      // Fail-closed E2E markers from use-chat-thread (spec decision #6).
      if (message === "E2E_NO_KEYS") {
        toast.error(t("errors.e2eNoKeys"));
        return;
      }
      if (message === "E2E_UNAVAILABLE") {
        toast.error(t("errors.e2eUnavailable"));
        reloadAfterE2eUnavailable();
        return;
      }
      // Block state is cached (see `withPeer` in chat-workspace); a 403 means
      // it changed, so re-resolve it to show the blocked banner.
      if (status === 403)
        void queryClient.invalidateQueries({
          queryKey: chatKeys.with(peer.id),
        });
      toast.error(
        status === 403
          ? t("composer.blockedError")
          : message || t("errors.sendFailed"),
      );
    },
    [t, queryClient, peer.id, reloadAfterE2eUnavailable],
  );

  const thread = useChatThread({
    conversationId,
    recipientId: peer.id,
    viewerId,
    onConversationCreated,
    onMutated,
    onSendError,
  });

  const {
    messages,
    peerLastReadAt,
    isLoading,
    error,
    hasOlder,
    isLoadingOlder,
    loadOlder,
    send,
    retry,
    cancelHeldSend,
    isSending,
    markActivity,
  } = thread;

  // True while the listing preview is still pending a decision (send it, or
  // remove it) — gates both render spots below and the attach in handleSend.
  // A message that already carries the listing is proof it rode out: the
  // local flags reset on every remount (the first send creates the
  // conversation, which changes the mount key), the messages never do.
  const showListingAttachment =
    listingPending && !messages.some((m) => m.listingId === listingId);

  // Quick replies are an empty-thread onboarding aid: introduced in every new
  // chat, retired as soon as a message exists (from either side), and hidden
  // once the user dismisses them — a dismissal stored per conversation, so a
  // new chat always gets the introduction again. `!isLoading` keeps the row
  // from flashing while a thread's first page is still in flight.
  const showQuickReplies =
    canMessage && !isLoading && messages.length === 0 && !quickRepliesDismissed;

  // ── E2E decrypt ──────────────────────────────────────────────────────────
  // Own optimistic echoes already carry plaintext; only server rows need
  // resolving. A still-bootstrapping or failed engine yields a null map —
  // we render a neutral placeholder, never the raw ciphertext.
  const e2eEngine = useE2eEngine(viewerId);
  const decrypted = useDecryptedMessages(messages, e2eEngine);
  const backup = useE2eBackupContext();

  useEffect(() => {
    if (!e2eEngine) return;
    try {
      sessionStorage.removeItem(E2E_RELOAD_ATTEMPTED_KEY);
    } catch {
      // Private browsing/storage restrictions do not block E2E itself.
    }
  }, [e2eEngine]);

  // Server E2E rows with no decrypt outcome yet (engine bootstrapping, or
  // the batch is still running).
  const hasUndecrypted = messages.some(
    (m) => !m.tempId && isDecryptable(m) && !decrypted.has(m.id),
  );

  // The thread opens behind one loading block until its first page is fully
  // decrypted, then reveals everything at once — never a wall of per-bubble
  // "Decrypting…". Latched per mount (the thread remounts per conversation).
  // The timeout is the escape hatch for an engine that never comes up
  // (useE2eEngine stays null on bootstrap failure): the thread then opens
  // with per-bubble placeholders rather than a spinner forever.
  const [decryptTimedOut, setDecryptTimedOut] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const initialDecryptDone = !isLoading && !hasUndecrypted;
  if (!revealed && (initialDecryptDone || decryptTimedOut)) setRevealed(true);

  useEffect(() => {
    if (revealed) return;
    const timer = setTimeout(
      () => setDecryptTimedOut(true),
      DECRYPT_REVEAL_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [revealed]);

  // Re-prompt for the passcode whenever a thread with unavailable messages
  // opens on a locked, passcoded device — not once per browser session. The
  // EnterPasscodeDialog's "Not now" button snoozes this for the rest of the
  // session (sessionStorage); reloading (or opening another such thread in a
  // new session) asks again.
  const hasUnavailable = useMemo(
    () => messages.some((m) => decrypted.get(m.id)?.status === "unavailable"),
    [messages, decrypted],
  );
  const backupKind = backup?.state?.kind ?? null;
  const backupHasPasscode =
    backup?.state?.kind === "locked" && backup.state.hasPasscode;
  useEffect(() => {
    if (!backup || !revealed || !hasUnavailable) return;
    if (backupKind !== "locked" || !backupHasPasscode) return;
    try {
      if (sessionStorage.getItem(E2E_RESTORE_SNOOZE_KEY) === "1") return;
    } catch {
      // Private mode — prompting anyway is harmless.
    }
    backup.setDialog("enter");
  }, [backup, revealed, hasUnavailable, backupKind, backupHasPasscode]);

  const displayMessages = useMemo<ThreadMessage[]>(() => {
    // Ordinary plaintext threads need no post-processing. Optimistic echoes
    // are always inspected: a location / listing-only send stores its
    // structured JSON in `body` even before the row is E2E.
    if (
      !messages.some(
        (m) => m.isE2e || m.attachments?.length || m.tempId !== undefined,
      )
    )
      return messages;
    const out: ThreadMessage[] = [];
    for (const m of messages) {
      // Local optimistic / failed rows already hold the user's plaintext.
      if (m.tempId || !m.isE2e) {
        out.push(withDecryptedContent(m, m.body));
        continue;
      }
      const outcome = decrypted.get(m.id);
      if (outcome?.status === "ok")
        out.push(withDecryptedContent(m, outcome.plaintext));
      else if (outcome?.status === "unavailable")
        // Never ciphertext, and never its own bubble: a run of these is
        // collapsed into one notice row below (`groupUnavailable`), whose
        // text is state-aware instead of the old one-note-per-bubble copy.
        out.push({ ...m, unavailable: true });
      else if (outcome?.status === "failed")
        out.push({ ...m, body: t("message.decryptFailed") });
      // Still decrypting. With a live engine, hold the row back — a new
      // message or an older page appears once decrypted (milliseconds).
      // Without one (bootstrap failed / timed out), show a neutral
      // placeholder — never the raw ciphertext.
      else if (!e2eEngine) out.push({ ...m, body: t("message.decrypting") });
    }
    return out;
  }, [messages, decrypted, e2eEngine, t]);

  // ── Scroll management ─────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const restoreOffsetRef = useRef<number | null>(null);
  const shownCountRef = useRef(0);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  const handleLoadOlder = useCallback(() => {
    const el = scrollRef.current;
    // Anchor on distance-from-bottom so prepended history doesn't yank the
    // viewport to the top of the thread.
    restoreOffsetRef.current = el ? el.scrollHeight - el.scrollTop : null;
    loadOlder();
  }, [loadOlder]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // An older page is held back until decrypted, so only consume the anchor
    // once rows were actually added — not when the raw page merely arrived.
    const grew = displayMessages.length > shownCountRef.current;
    shownCountRef.current = displayMessages.length;
    if (restoreOffsetRef.current !== null) {
      if (!grew) return;
      el.scrollTop = el.scrollHeight - restoreOffsetRef.current;
      restoreOffsetRef.current = null;
      return;
    }
    if (atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [displayMessages, revealed]);

  // The listing still waiting to ride out on the next send of any kind.
  const pendingListingId = showListingAttachment ? listingId : undefined;

  const handleSend = useCallback(
    (draft: ComposerDraft) => {
      if (pendingListingId) setListingSent(true);
      // Location, voice and the ad picked from the composer's "+" menu must be
      // forwarded here: the composer clears its staged state on send, so a
      // dropped field is a silently lost message. An explicitly picked ad wins
      // over the deep-linked listing card.
      send({
        body: draft.body,
        draftKeys: draft.draftKeys,
        listingId: draft.listingId ?? pendingListingId,
        location: draft.location,
        voice: draft.voice,
      });
    },
    [send, pendingListingId],
  );

  const handleQuickReply = useCallback(
    (text: string) => {
      if (pendingListingId) setListingSent(true);
      send({ body: text, listingId: pendingListingId });
    },
    [send, pendingListingId],
  );

  // Sending the card is a send of its own — the quick replies row stays
  // available for a follow-up message.
  const handleSendListing = useCallback(() => {
    if (!listingId) return;
    setListingSent(true);
    send({ listingId });
  }, [send, listingId]);

  const listingPrice = listing
    ? formatPrice(listing.price, listing.currency, locale)
    : null;

  const grouped = useMemo(() => {
    // First group by day.
    const dayBuckets: { day: string; items: ThreadMessage[] }[] = [];
    for (const message of displayMessages) {
      const day = dayKey(message.createdAt);
      const last = dayBuckets[dayBuckets.length - 1];
      if (last && last.day === day) last.items.push(message);
      else dayBuckets.push({ day, items: [message] });
    }
    // Then, within each day: collapse runs of unavailable messages into one
    // notice node first (a readable message splits a run in two — see
    // `groupUnavailable`), then group consecutive image messages among what
    // is left readable.
    return dayBuckets.map((bucket) => {
      const unavailability = groupUnavailable(
        bucket.items,
        (m) => m.unavailable === true,
      );
      const nodes: ThreadNode[] = [];
      let readable: ThreadMessage[] = [];
      const flushReadable = () => {
        if (readable.length === 0) return;
        nodes.push(...groupImageMessages(readable));
        readable = [];
      };
      for (const node of unavailability) {
        if (node.kind === "unavailable-run") {
          flushReadable();
          nodes.push({
            kind: "unavailable-notice",
            key: node.messages[0].id,
            count: node.count,
          });
        } else {
          readable.push(node.message);
        }
      }
      flushReadable();
      return { day: bucket.day, nodes };
    });
  }, [displayMessages]);

  // A 404 on a conversation route means "not a participant" — the backend
  // deliberately refuses to distinguish that from "no such thread", so we must
  // not render it as an access-denied message.
  if (error && isNotFound(error)) {
    return (
      <ThreadNotice
        icon={<MessageSquareOff className="size-8 text-muted-foreground" />}
        title={t("thread.notFoundTitle")}
        description={t("thread.notFoundDescription")}
        onBack={onBack}
        backLabel={t("thread.back")}
      />
    );
  }

  if (error) {
    return (
      <ThreadNotice
        icon={<ShieldAlert className="size-8 text-muted-foreground" />}
        title={t("errors.loadFailedTitle")}
        description={t("errors.loadFailed")}
        onBack={onBack}
        backLabel={t("thread.back")}
      />
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-3 sm:px-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label={t("thread.back")}
            className="-ml-1 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted md:hidden"
          >
            <ArrowLeft className="size-5" />
          </button>
        )}
        <Avatar className="h-9 w-9 shrink-0">
          {peer.profilePhotoUrl && (
            <AvatarImage src={peer.profilePhotoUrl} alt={peerName} />
          )}
          <AvatarFallback className="font-semibold">
            {peerName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-none">
            {peerName}
          </p>
          {!canMessage ? (
            <p className="mt-1 text-[11px] text-destructive">
              {blockedByMe ? t("thread.blockedByMe") : t("thread.blocked")}
            </p>
          ) : lastActiveLabel ? (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {lastActiveLabel}
            </p>
          ) : null}
        </div>
        {username && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={t("thread.viewProfile")}
                className="-mr-1 shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted"
              >
                <MoreVertical className="size-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem asChild>
                <Link
                  href={{ pathname: "/[username]", params: { username } }}
                  className="flex w-full items-center gap-1.5"
                >
                  <UserRound className="size-4" />
                  {t("thread.viewProfile")}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex flex-1 flex-col gap-4 overflow-y-auto bg-background px-3 py-4 sm:px-4"
      >
        {isLoading ? (
          <ThreadSkeleton />
        ) : !revealed ? (
          <div
            role="status"
            className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground"
          >
            <Loader2 className="size-6 animate-spin" />
            <p className="text-xs">{t("message.decrypting")}</p>
          </div>
        ) : (
          <>
            {hasOlder && (
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={handleLoadOlder}
                  disabled={isLoadingOlder}
                >
                  {isLoadingOlder && (
                    <Loader2 className="size-3 animate-spin" />
                  )}
                  {t("thread.loadOlder")}
                </Button>
              </div>
            )}

            {/* Empty thread: no prompt copy — the composer and the quick
                replies are the empty state. Only a listing that is still
                pending has something to show here. */}
            {messages.length === 0 &&
              listing !== undefined &&
              showListingAttachment && (
                <div className="flex flex-1 flex-col items-center justify-center gap-1.5">
                  <ListingContextCard listing={listing} />
                  <button
                    type="button"
                    onClick={() => setListingDismissed(true)}
                    className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                  >
                    {t("thread.removeListing")}
                  </button>
                </div>
              )}

            {grouped.map((group) => (
              <div key={group.day} className="flex flex-col gap-4">
                <div className="flex justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] font-medium text-muted-foreground">
                    {format.dateTime(new Date(group.day), {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>
                {group.nodes.map((node) =>
                  node.kind === "unavailable-notice" ? (
                    <UnavailableNotice
                      key={`notice-${node.key}`}
                      count={node.count}
                    />
                  ) : node.kind === "image-group" ? (
                    <ImageGroup
                      key={`group-${node.messages[0].id}`}
                      messages={node.messages}
                      isMine={node.senderId === viewerId}
                      onOpenImage={setLightbox}
                    />
                  ) : (
                    <MessageBubble
                      key={node.message.id}
                      message={node.message}
                      isMine={node.message.senderId === viewerId}
                      peerLastReadAt={peerLastReadAt}
                      peerName={peerName}
                      peerAvatarUrl={peer.profilePhotoUrl}
                      onRetry={retry}
                      onCancelHeld={cancelHeldSend}
                      onOpenImage={setLightbox}
                    />
                  ),
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Pending listing — a compact row until the card itself is sent
          (paper plane), it rides out on the next message, or it is
          dismissed. The empty-thread case shows the full card above. */}
      {canMessage && showListingAttachment && displayMessages.length > 0 && (
        <div className="shrink-0 border-t border-border bg-card px-3 py-2 sm:px-4">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted">
              {listing?.thumbnailUrl ? (
                <Image
                  src={listing.thumbnailUrl}
                  alt={listing.title}
                  fill
                  sizes="40px"
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <ImageOff className="size-4 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">
                {listing?.title ?? t("listing.unavailable")}
              </p>
              <p className="truncate text-[11px] font-semibold text-[#f04d4e]">
                {listingPrice ?? t("listing.noPrice")}
              </p>
            </div>
            <button
              type="button"
              onClick={handleSendListing}
              aria-label={t("composer.send")}
              className="shrink-0 rounded-full bg-sky-500 p-1.5 text-white transition-colors hover:bg-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SendHorizonal className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setListingDismissed(true)}
              aria-label={t("thread.removeListing")}
              className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {/* Quick replies: one tap sends the pill's text (plus the pending
          listing, if one is still armed). See `showQuickReplies` — the row
          only exists in a message-less thread and a dismissal is persisted
          per conversation. */}
      {showQuickReplies && (
        <div className="shrink-0 border-t border-border bg-card px-3 pt-2 sm:px-4">
          <div className="flex items-center gap-1.5 pb-2">
            <div
              role="group"
              aria-label={t("thread.quickReplies.label")}
              className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {QUICK_REPLIES.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    handleQuickReply(t(`thread.quickReplies.${key}`))
                  }
                  disabled={isSending}
                  className="shrink-0 rounded-full bg-sky-500 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-sky-600 disabled:opacity-60"
                >
                  {t(`thread.quickReplies.${key}`)}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                dismissQuickReplies(quickRepliesScope);
                setQuickRepliesDismissedNow(true);
              }}
              aria-label={t("thread.quickReplies.hide")}
              className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}

      <Composer
        disabled={!canMessage}
        disabledReason={
          blockedByMe ? t("composer.blockedByMe") : t("composer.blocked")
        }
        sending={isSending}
        onSend={handleSend}
        onActivity={markActivity}
        hasListing={showListingAttachment}
      />

      <Dialog
        open={lightbox !== null}
        onOpenChange={(open) => !open && setLightbox(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{t("message.imageAlt")}</DialogTitle>
          </DialogHeader>
          {lightbox && (
            <div className="relative h-[70vh] w-full">
              <Image
                src={lightbox}
                alt={t("message.imageAlt")}
                fill
                sizes="100vw"
                className="object-contain"
                unoptimized
              />
            </div>
          )}
          {lightbox && (
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  void saveFromUrl(lightbox).then(
                    (ok) => ok || toast.error(t("message.downloadFailed")),
                  )
                }
              >
                <Download className="size-4" />
                {t("message.download")}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ThreadNotice({
  icon,
  title,
  description,
  onBack,
  backLabel,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onBack?: () => void;
  backLabel: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      {icon}
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
      {onBack && (
        <Button variant="outline" size="sm" onClick={onBack}>
          {backLabel}
        </Button>
      )}
    </div>
  );
}

/**
 * One notice row for a whole run of unavailable messages (finding H-5):
 * state-aware text instead of the old identical note on every bubble, with
 * the passcode button inline only when there is a passcode to enter.
 */
function UnavailableNotice({ count }: { count: number }) {
  const t = useTranslations("Chat.message");
  const tBackup = useTranslations("Chat.backup");
  const backup = useE2eBackupContext();
  const locked = backup?.state?.kind === "locked" ? backup.state : null;
  const textKey = !locked
    ? "unavailableReady"
    : locked.hasPasscode
      ? "unavailableLockedWithPasscode"
      : "unavailableLockedNoPasscode";

  return (
    <div className="flex justify-center">
      <div className="flex max-w-[85%] flex-col items-center gap-1.5 rounded-xl bg-muted/70 px-3 py-2 text-center text-[11px] text-muted-foreground sm:max-w-[70%]">
        <p>{t(textKey, { count })}</p>
        {locked?.hasPasscode && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => backup?.setDialog("enter")}
          >
            <KeyRound className="size-3" />
            {tBackup("enterPasscode")}
          </Button>
        )}
      </div>
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={cn(
            "flex items-end gap-3",
            i % 2 === 0 ? "flex-row" : "flex-row-reverse",
          )}
        >
          {i % 2 === 0 && (
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          )}
          <Skeleton
            className={cn("h-11 rounded-2xl", i % 2 === 0 ? "w-52" : "w-40")}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Wire types for the chat API (`/api/v1/chats/*`). These mirror
 * `apps/backend/src/chat/chat.types.ts`, with `Date` columns narrowed to the
 * ISO strings they arrive as over JSON.
 */

import type { AttachmentMeta } from "@/lib/e2e/attachments/content";
import type { SharedLocation } from "@/lib/e2e/chat-content";

export type ListingStatus = "draft" | "active" | "expired" | "deleted";

export interface ChatUserSummary {
  id: string;
  username: string | null;
  profilePhotoUrl: string | null;
  /**
   * ISO over JSON. Coarse last activity ("last active 25 minutes ago"), not
   * live presence — `null` when the user has never been active. Only ever
   * shown to a participant of the conversation.
   */
  lastSeenAt?: string | null;
}

/** Listing context card attached to a message. Null when the ad was deleted. */
export interface ListingContext {
  id: string;
  title: string;
  price: string | null;
  currency: string;
  status: ListingStatus;
  thumbnailUrl: string | null;
}

/**
 * Signal-protocol envelope carried alongside an E2E message. Mirrors
 * `E2eHeader` in `apps/backend/src/db/schema/chat.schema.ts`. `body` on
 * such a message is ciphertext, not plaintext.
 */
export interface E2eHeader {
  v: 1;
  dh: string;
  pn: number;
  n: number;
  identityKey?: string;
  ephemeralKey?: string;
  oneTimePrekeyId?: number;
  signedPrekeyId?: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string | null;
  listingId: string | null;
  imageUrl: string | null;
  imagePath: string | null;
  groupId: string | null;
  /** Sender's dedup key for this message, when one was sent. */
  clientMessageId?: string | null;
  readAt: string | null;
  createdAt: string;
  isE2e: boolean;
  /** v1 only — v2 rows carry one header per device in `envelopes`. */
  e2eHeader: E2eHeader | null;
  /** null = plaintext, 1 = single-device E2E, 2 = multi-device E2E. */
  e2eVersion?: number | null;
  /** v2 only: the device that encrypted `body` (also its AEAD associated data). */
  senderDeviceId?: string | null;
  /** v2 only: the content key wrapped once per recipient device. */
  envelopes?: E2eEnvelope[];
  /**
   * v2 only, when the message carries encrypted files. Keys, MIME types and
   * previews are inside the decrypted body (lib/e2e/attachments/content.ts).
   */
  attachments?: MessageAttachment[];
  listing?: ListingContext | null;
}

export interface MessageAttachment {
  id: string;
  kind: "image" | "file";
}

/** v2: the message content key, ratchet-encrypted for one device. */
export interface E2eEnvelope {
  recipientDeviceId: string;
  header: E2eHeader;
  wrappedKey: string;
}

/** v2 send payload — see `E2eV2PayloadDto` on the backend. */
export interface E2eV2Payload {
  v: 2;
  senderDeviceId: string;
  envelopes: E2eEnvelope[];
}

export interface InboxItem {
  id: string;
  otherUser: ChatUserSummary | null;
  lastMessage: ChatMessage | null;
  unreadCount: number;
  lastMessageAt: string;
  createdAt: string;
}

export interface ConversationWithUser {
  conversation: InboxItem | null;
  otherUser: ChatUserSummary;
  /** I blocked them — distinct from "they blocked me", which we never reveal. */
  blockedByMe: boolean;
  /** False when a block exists in EITHER direction; the composer must lock. */
  canMessage: boolean;
}

export interface ChatPaginationMeta {
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

export interface ChatMessagesMeta extends ChatPaginationMeta {
  /** Cursor of the newest message returned — the next `after` watermark. */
  latestCursor: string | null;
  /** max(readAt) over MY messages; drives read receipts. */
  peerLastReadAt: string | null;
}

export interface InboxPage {
  items: InboxItem[];
  meta: ChatPaginationMeta;
}

export interface MessagePage {
  items: ChatMessage[];
  meta: ChatMessagesMeta;
}

export interface SendMessageInput {
  recipientId: string;
  body?: string;
  listingId?: string;
  groupId?: string;
  e2eHeader?: E2eHeader;
  /** v1: the identity key the session was built against (server 409s if it changed). */
  recipientIdentityKey?: string;
  e2e?: E2eV2Payload;
  /** Encrypted attachments carried by a v2 message (see actions/chat-attachments.ts). */
  attachmentIds?: string[];
  /**
   * Stable client-minted dedup key. Mint once per logical send (optimistic
   * echo / draft) and reuse on every retry so a lost response or double-tap
   * replays the original row instead of inserting twice.
   */
  clientMessageId?: string;
}

export interface SendMessageResult {
  conversationId: string;
  message: ChatMessage;
}

/**
 * Discriminated result used by every chat server action. Server actions cannot
 * throw structured errors across the RSC boundary (the message is scrubbed in
 * production), so the HTTP status travels back in the payload — the UI needs
 * it to tell 404 "not a participant" from 403 "messaging unavailable".
 */
export type ChatActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      /** Structured error payload, e.g. `{ missing, stale }` on E2E_DEVICES_MISMATCH. */
      details?: unknown;
    };

/**
 * A message plus the client-only state an optimistic send needs. `pending`
 * marks an echo the server has not confirmed; `failed` keeps a rejected send
 * on screen with a retry affordance instead of silently dropping it.
 */
export interface ThreadMessage extends ChatMessage {
  /**
   * Decrypted file metadata of an encrypted-attachment message, parsed from
   * its plaintext by the thread (the bubble renders `body` as the caption).
   */
  e2eFiles?: AttachmentMeta[];
  /**
   * Decrypted position of a structured location body. Its plaintext JSON is
   * consumed here, never rendered as text (lib/e2e/chat-content.ts).
   */
  sharedLocation?: SharedLocation;
  /** Decrypted body is the structured "listing card only" marker. */
  listingOnly?: boolean;
  /**
   * No envelope for this device (`decrypt-message.ts` "unavailable" outcome)
   * — predates this device joining the account's active set. Drives the
   * collapsed notice row in `message-thread.tsx` (`lib/chat/group-unavailable`).
   */
  unavailable?: boolean;
  /**
   * Local-only row for a send the recipient cannot receive yet (no E2E device
   * registered): "held" waits and sends by itself, "expired" gave up after the
   * hold lifetime. Never present on server rows.
   */
  held?: "held" | "expired";
  pending?: boolean;
  failed?: boolean;
  /** Local correlation id for the optimistic echo (temp rows only). */
  tempId?: string;
  /**
   * Dedup key for this logical send — minted with the optimistic echo and
   * kept across retries so `POST /chats/messages` can replay instead of
   * duplicating. Also echoed back on server rows (ChatMessage).
   */
  clientMessageId?: string | null;
}

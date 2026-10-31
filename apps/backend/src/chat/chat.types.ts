import type { E2eHeader, MessageRow } from '../db/schema/chat.schema';
import type { ListingRow } from '../db/schema/listings.schema';
import type { PaginationMeta } from '../common/types/api-response.types';

export interface ChatUserSummary {
  id: string;
  username: string | null;
  profilePhotoUrl: string | null;
  /**
   * Coarse last activity (ActivityService touches at most every 5 minutes),
   * not live presence — disconnected users keep their last timestamp.
   */
  lastSeenAt: Date | null;
}

export interface ListingContext {
  id: string;
  title: string;
  price: string | null;
  currency: string;
  status: ListingRow['status'];
  thumbnailUrl: string | null;
}

/** One v2 E2E envelope: the content key wrapped for one recipient device. */
export interface MessageEnvelopeView {
  recipientDeviceId: string;
  header: E2eHeader;
  wrappedKey: string;
}

/** Server-side view of an encrypted attachment; everything else is in the E2E body. */
export interface MessageAttachmentView {
  id: string;
  kind: 'image' | 'file';
}

/**
 * A message row plus, for v2 E2E rows only, every device envelope. All
 * envelopes are returned (not just the caller's): each is ciphertext only
 * the holder of that device's private keys can open, and it spares every
 * read path from needing to know which device is asking.
 */
export interface MessageWithEnvelopes extends MessageRow {
  envelopes?: MessageEnvelopeView[];
  /** v2 rows only, and only when the message carries files. */
  attachments?: MessageAttachmentView[];
}

export interface MessageWithListing extends MessageWithEnvelopes {
  listing: ListingContext | null;
}

export interface InboxItem {
  id: string;
  otherUser: ChatUserSummary | null;
  lastMessage: MessageWithEnvelopes | null;
  unreadCount: number;
  lastMessageAt: Date;
  createdAt: Date;
}

export interface ConversationWithUser {
  conversation: InboxItem | null;
  otherUser: ChatUserSummary;
  blockedByMe: boolean;
  canMessage: boolean;
}

export interface ChatMessagesMeta extends PaginationMeta {
  /** Cursor of the newest message returned — the client's next `after` watermark. */
  latestCursor: string | null;
  /** max(readAt) of MY messages in this conversation — drives read receipts over polling. */
  peerLastReadAt: Date | null;
}

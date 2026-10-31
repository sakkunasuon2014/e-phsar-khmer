import { parseAttachmentContent } from "@/lib/e2e/attachments/content";
import type { ChatMessage } from "@/types/chat";

/** Sort key: chronological, with `id` as the tiebreak for same-millisecond rows. */
function order(a: ChatMessage, b: ChatMessage): number {
  const at = Date.parse(a.createdAt);
  const bt = Date.parse(b.createdAt);
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Merge message batches (history pages + poll deltas + optimistic echoes) into
 * one ascending, de-duplicated timeline. Later batches win on id collision, so
 * a server row always replaces the optimistic copy it confirms.
 */
export function mergeMessages(...batches: ChatMessage[][]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const batch of batches) {
    for (const message of batch) byId.set(message.id, message);
  }
  return [...byId.values()].sort(order);
}

/** A message of mine counts as read once the peer's read watermark passes it. */
export function isReadByPeer(
  message: ChatMessage,
  peerLastReadAt: string | null,
): boolean {
  if (!peerLastReadAt) return false;
  return Date.parse(message.createdAt) <= Date.parse(peerLastReadAt);
}

/** Day bucket used to group bubbles under a date separator. */
export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Format a listing price. `price` arrives as a numeric string (or null for
 * "contact for price"); `currency` is an ISO code the backend does not
 * validate, so fall back to a plain number when `Intl` rejects it.
 */
export function formatPrice(
  price: string | null,
  currency: string,
  locale: string,
): string | null {
  if (price === null) return null;
  const value = Number(price);
  if (!Number.isFinite(value)) return price;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString(locale)} ${currency}`;
  }
}

/**
 * One-line inbox preview for a conversation's last message.
 *
 * `decryptedPlaintext` is the resolved body for an E2E row (from the local
 * decrypt cache or a completed decrypt). When it's missing, the preview is
 * left blank rather than showing ciphertext or a "Encrypted message" badge —
 * personal chat should read like any other message list.
 *
 * `labels.voice` / `labels.location` are optional so existing callers keep
 * compiling; they fall back to the image and listing labels respectively.
 * `structured` is the decrypted content kind when the plaintext is structured
 * JSON (a shared location or a listing-only card) — that content has no human
 * text, so the preview shows a label instead of the raw JSON.
 */
export function previewOf(
  message: ChatMessage | null,
  labels: {
    image: string;
    listing: string;
    none: string;
    voice?: string;
    location?: string;
  },
  decryptedPlaintext?: string | null,
  structured?: { kind: "location" } | { kind: "listing" } | null,
): string {
  if (!message) return labels.none;
  // Encrypted files: the label is known from the server's `attachments`
  // alone; the caption (if any) needs the decrypted JSON.
  if (message.attachments?.length) {
    const content = decryptedPlaintext
      ? parseAttachmentContent(decryptedPlaintext)
      : null;
    const caption = content?.text;
    // A voice note is a single encrypted audio file whose purpose lives only
    // inside the decrypted body — the server only sees `kind: "file"`.
    const first = content?.attachments[0];
    if (first?.purpose === "voice-note") {
      const voice = labels.voice ?? labels.image;
      return caption ? `${voice} · ${caption}` : voice;
    }
    return caption ? `${labels.image} · ${caption}` : labels.image;
  }
  // Structured content has no human-readable text; like ciphertext, its raw
  // JSON must never reach the inbox.
  if (structured?.kind === "location") return labels.location ?? labels.listing;
  if (structured?.kind === "listing") return labels.listing;
  if (message.isE2e) {
    if (decryptedPlaintext) return decryptedPlaintext;
    // Still decrypting (or failed): never surface base64 ciphertext.
    return "";
  }
  if (message.body) return message.body;
  if (message.imageUrl) return labels.image;
  if (message.listingId) return labels.listing;
  return labels.none;
}

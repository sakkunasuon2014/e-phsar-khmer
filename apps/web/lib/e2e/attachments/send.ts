import { sendE2eText } from "../send-encrypt";
import type { E2eSendOptions, E2eSendOutcome } from "../send-encrypt";
import type { RatchetEngine } from "../types";
import { buildAttachmentContent } from "./content";
import type { AttachmentMeta } from "./content";
import { encryptFile } from "./format";
import { prepareImage } from "./prepare";
import { deleteOutbox, putCachedFile, putOutbox } from "./store";
import type { OutboxEntry } from "./store";
import { AttachmentUploadError, directUploader } from "./uploader";
import type { AttachmentUploader } from "./uploader";

/** Mirrors the backend caps (chat-attachments.constants.ts). */
export const ATTACHMENTS_PER_MESSAGE_MAX = 10;
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** Voice notes stay short — a minute of Opus is well under this. */
export const VOICE_MAX_BYTES = 8 * 1024 * 1024;
export const VOICE_MAX_DURATION_MS = 60_000;

/** File extension for the audio container the recorder produced. */
function voiceExtension(mime: string): string {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}
/**
 * The encrypted body is capped at 24,000 base64 chars (~18,000 bytes of
 * plaintext minus AEAD overhead). Past this, thumbnails are dropped so the
 * message still fits — the full images are unaffected.
 */
const CONTENT_MAX_CHARS = 16_000;

/**
 * Prepare, encrypt and persist a send BEFORE any network call (plan §5
 * steps 1–3), so a reload mid-upload can resume it with the same ids.
 * The sender's own plaintext files go straight into the decrypted-file
 * cache: the sender never needs to download what it just sent.
 */
export async function createOutboxEntry(input: {
  clientMessageId: string;
  recipientId: string;
  conversationId: string | null;
  listingId?: string;
  text?: string;
  images?: File[];
  /** Raw recorder output; encrypted exactly like any other file. */
  voice?: { blob: Blob; mime: string; durationMs: number };
}): Promise<OutboxEntry> {
  const images = input.images ?? [];
  if (images.length > ATTACHMENTS_PER_MESSAGE_MAX)
    throw new Error(
      `At most ${ATTACHMENTS_PER_MESSAGE_MAX} images per message`,
    );

  const attachments: OutboxEntry["attachments"] = [];
  for (const file of images) {
    const id = crypto.randomUUID();
    const image = await prepareImage(file);
    const plain = new Uint8Array(image.bytes);
    if (plain.byteLength > IMAGE_MAX_BYTES)
      throw new Error("Image is too large");
    const encrypted = await encryptFile(plain, id);
    const meta: AttachmentMeta = {
      id,
      kind: "image",
      mime: image.mime,
      key: encrypted.key,
      ciphertextHash: encrypted.ciphertextHash,
      ciphertextSize: encrypted.blob.byteLength,
      plaintextSize: plain.byteLength,
      w: image.w,
      h: image.h,
      thumb: image.thumb,
      thumbMime: image.thumbMime,
    };
    attachments.push({
      meta,
      blob: encrypted.blob.buffer,
      uploaded: false,
    });
    await putCachedFile(id, image.bytes, image.mime);
  }

  if (input.voice) {
    const { blob, mime, durationMs } = input.voice;
    if (durationMs < 300 || durationMs > VOICE_MAX_DURATION_MS)
      throw new Error("Voice note is too long");
    if (!mime.startsWith("audio/"))
      throw new Error("Voice note has an unsupported format");
    const plain = new Uint8Array(await blob.arrayBuffer());
    if (plain.byteLength === 0) throw new Error("Voice note is empty");
    if (plain.byteLength > VOICE_MAX_BYTES)
      throw new Error("Voice note is too large");
    const id = crypto.randomUUID();
    const encrypted = await encryptFile(plain, id);
    const meta: AttachmentMeta = {
      id,
      kind: "file",
      mime,
      name: `voice-note-${Date.now()}.${voiceExtension(mime)}`,
      key: encrypted.key,
      ciphertextHash: encrypted.ciphertextHash,
      ciphertextSize: encrypted.blob.byteLength,
      plaintextSize: plain.byteLength,
      purpose: "voice-note",
      durationMs: Math.round(durationMs),
    };
    attachments.push({
      meta,
      blob: encrypted.blob.buffer,
      uploaded: false,
    });
    await putCachedFile(id, plain.buffer, mime);
  }

  const entry: OutboxEntry = {
    clientMessageId: input.clientMessageId,
    recipientId: input.recipientId,
    conversationId: input.conversationId,
    ...(input.listingId ? { listingId: input.listingId } : {}),
    ...(input.text ? { text: input.text } : {}),
    attachments,
    createdAt: Date.now(),
  };
  await putOutbox(entry);
  return entry;
}

/** The message plaintext, shrunk (thumbnails dropped) if it wouldn't fit. */
export function contentFor(entry: OutboxEntry): string {
  const metas = entry.attachments.map((a) => a.meta);
  const full = buildAttachmentContent(entry.text, metas);
  if (full.length <= CONTENT_MAX_CHARS) return full;
  return buildAttachmentContent(
    entry.text,
    metas.map((m) => ({ ...m, thumb: undefined, thumbMime: undefined })),
  );
}

export type AttachmentSendOutcome =
  | E2eSendOutcome
  | { ok: false; reason: "upload-failed"; message: string; status: number };

/**
 * Upload whatever isn't uploaded yet, then send ONE E2E message carrying
 * every file's key (plan §5 steps 4–5). Resumable: progress is written back
 * to the outbox after each file, and the entry is removed only once the
 * message is accepted. Every retry reuses the same attachment ids and
 * clientMessageId, so nothing is created twice.
 */
const inFlight = new Map<string, Promise<AttachmentSendOutcome>>();

export function sendOutboxEntry(
  engine: RatchetEngine | null,
  entry: OutboxEntry,
  opts: Pick<E2eSendOptions, "senderId" | "send">,
  uploader: AttachmentUploader = directUploader,
): Promise<AttachmentSendOutcome> {
  // A thread remount mid-upload resumes the same entry; share the running
  // attempt instead of uploading and encrypting it a second time.
  const running = inFlight.get(entry.clientMessageId);
  if (running) return running;
  const attempt = runSend(engine, entry, opts, uploader).finally(() =>
    inFlight.delete(entry.clientMessageId),
  );
  inFlight.set(entry.clientMessageId, attempt);
  return attempt;
}

async function runSend(
  engine: RatchetEngine | null,
  entry: OutboxEntry,
  opts: Pick<E2eSendOptions, "senderId" | "send">,
  uploader: AttachmentUploader,
): Promise<AttachmentSendOutcome> {
  for (const item of entry.attachments) {
    if (item.uploaded) continue;
    try {
      await uploader.upload({
        id: item.meta.id,
        kind: item.meta.kind,
        blob: item.blob,
      });
    } catch (err) {
      return {
        ok: false,
        reason: "upload-failed",
        message: err instanceof Error ? err.message : "Upload failed",
        status: err instanceof AttachmentUploadError ? err.status : 0,
      };
    }
    item.uploaded = true;
    await putOutbox(entry);
  }

  const outcome = await sendE2eText(engine, {
    conversationId: entry.conversationId,
    senderId: opts.senderId,
    recipientId: entry.recipientId,
    plaintext: contentFor(entry),
    listingId: entry.listingId,
    attachmentIds: entry.attachments.map((a) => a.meta.id),
    clientMessageId: entry.clientMessageId,
    send: opts.send,
  });
  if (outcome.ok) await deleteOutbox(entry.clientMessageId);
  return outcome;
}

import { base64ToBytes, bytesToBase64 } from "../crypto/base64";

/**
 * E2E_FILE_V1 — the frozen on-storage format of an encrypted attachment
 * (docs/e2e-attachments.md §4):
 *
 *   ┌──────────────────┬──────────┬──────────────────────────────┐
 *   │ "NPF" + 0x01 (4B)│ IV (12B) │ ciphertext + GCM tag (N+16B) │
 *   └──────────────────┴──────────┴──────────────────────────────┘
 *
 * AES-256-GCM, one fresh key per file, single shot (files are ≤ 25 MB).
 * AAD = header || "npic-chat-file-v1:" + attachmentId, so the version byte
 * and the file↔attachment binding are both authenticated.
 */

const HEADER = new Uint8Array([0x4e, 0x50, 0x46, 0x01]);
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
/** Bytes added on top of the plaintext: header + IV + tag. */
export const FILE_OVERHEAD = HEADER.length + IV_LENGTH + TAG_LENGTH;

const utf8 = new TextEncoder();

function aad(attachmentId: string): Uint8Array<ArrayBuffer> {
  const label = utf8.encode(`npic-chat-file-v1:${attachmentId}`);
  const out = new Uint8Array(HEADER.length + label.length);
  out.set(HEADER, 0);
  out.set(label, HEADER.length);
  return out;
}

async function sha256Base64(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return bytesToBase64(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  );
}

export interface EncryptedFile {
  /** What gets uploaded: header || iv || ciphertext+tag. */
  blob: Uint8Array<ArrayBuffer>;
  /** Raw AES key, base64 — travels only inside the E2E message. */
  key: string;
  /** base64 sha256 of `blob`; the recipient checks it before decrypting. */
  ciphertextHash: string;
}

export async function encryptFile(
  plaintext: Uint8Array<ArrayBuffer>,
  attachmentId: string,
): Promise<EncryptedFile> {
  const cryptoKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: aad(attachmentId),
        tagLength: 128,
      },
      cryptoKey,
      plaintext,
    ),
  );
  const blob = new Uint8Array(HEADER.length + IV_LENGTH + sealed.length);
  blob.set(HEADER, 0);
  blob.set(iv, HEADER.length);
  blob.set(sealed, HEADER.length + IV_LENGTH);
  const rawKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", cryptoKey),
  );
  return {
    blob,
    key: bytesToBase64(rawKey),
    ciphertextHash: await sha256Base64(blob),
  };
}

export class AttachmentIntegrityError extends Error {}

/**
 * Hash first (reject a swapped or truncated object before touching the key),
 * then the format header, then AES-GCM, whose tag authenticates the rest.
 */
export async function decryptFile(
  blob: Uint8Array<ArrayBuffer>,
  keyB64: string,
  attachmentId: string,
  expectedHash: string,
): Promise<Uint8Array<ArrayBuffer>> {
  if ((await sha256Base64(blob)) !== expectedHash)
    throw new AttachmentIntegrityError("attachment hash mismatch");
  if (blob.length < FILE_OVERHEAD || !HEADER.every((b, i) => blob[i] === b))
    throw new AttachmentIntegrityError("unknown attachment format");
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(base64ToBytes(keyB64)),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const iv = blob.slice(HEADER.length, HEADER.length + IV_LENGTH);
  const sealed = blob.slice(HEADER.length + IV_LENGTH);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: aad(attachmentId),
          tagLength: 128,
        },
        cryptoKey,
        sealed,
      ),
    );
  } catch {
    throw new AttachmentIntegrityError("attachment authentication failed");
  }
}

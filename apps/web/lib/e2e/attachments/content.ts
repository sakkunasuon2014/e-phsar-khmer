/**
 * Plaintext of an E2E message that carries attachments (plan §4). Text-only
 * messages stay a plain string; this JSON is used — and parsed — only when
 * the server lists `attachments` on the message, so an old plain-string
 * message can never be misread as one.
 */

export interface AttachmentMeta {
  id: string;
  kind: "image" | "file";
  mime: string;
  /** Files only. */
  name?: string;
  /** Raw AES-256 key, base64. */
  key: string;
  ciphertextHash: string;
  ciphertextSize: number;
  plaintextSize: number;
  /** Images only. */
  w?: number;
  h?: number;
  /** Images only: tiny WebP/JPEG preview as a data-URL-free base64 string. */
  thumb?: string;
  /** MIME of `thumb`. */
  thumbMime?: string;
  /** Optional purpose stored only inside the encrypted body. */
  purpose?: "voice-note";
  /** Voice-note duration, also encrypted with the message body. */
  durationMs?: number;
}

export interface AttachmentContent {
  v: 1;
  text?: string;
  attachments: AttachmentMeta[];
}

export function buildAttachmentContent(
  text: string | undefined,
  attachments: AttachmentMeta[],
): string {
  const content: AttachmentContent = {
    v: 1,
    ...(text ? { text } : {}),
    attachments,
  };
  return JSON.stringify(content);
}

function isMeta(a: unknown): a is AttachmentMeta {
  if (!a || typeof a !== "object") return false;
  const m = a as Record<string, unknown>;
  if (
    typeof m.id !== "string" ||
    (m.kind !== "image" && m.kind !== "file") ||
    typeof m.mime !== "string" ||
    typeof m.key !== "string" ||
    typeof m.ciphertextHash !== "string"
  )
    return false;
  if (m.purpose === undefined) return m.durationMs === undefined;
  return (
    m.purpose === "voice-note" &&
    m.kind === "file" &&
    m.mime.startsWith("audio/") &&
    typeof m.durationMs === "number" &&
    Number.isFinite(m.durationMs) &&
    m.durationMs >= 300 &&
    m.durationMs <= 60_000
  );
}

/** null when the plaintext isn't a (valid) attachment payload. */
export function parseAttachmentContent(
  plaintext: string,
): AttachmentContent | null {
  try {
    const parsed = JSON.parse(plaintext) as Partial<AttachmentContent>;
    if (parsed?.v !== 1 || !Array.isArray(parsed.attachments)) return null;
    return {
      v: 1,
      ...(typeof parsed.text === "string" ? { text: parsed.text } : {}),
      attachments: parsed.attachments.filter(isMeta),
    };
  } catch {
    return null;
  }
}

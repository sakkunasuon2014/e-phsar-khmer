"use client";

import { useEffect, useState } from "react";
import { Download, FileText, ImageOff, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { AttachmentMeta } from "@/lib/e2e/attachments/content";
import { loadAttachment } from "@/lib/e2e/attachments/download";
import { mediaFileName, saveBlob } from "@/lib/chat/save-file";
import { toast } from "@/components/ui/sonner";
import { VoicePlayer } from "@/components/chat/voice-player";

/** Save decrypted bytes (cache first, else download → verify → decrypt). */
async function downloadAttachment(
  meta: AttachmentMeta,
  failedMessage: string,
): Promise<void> {
  try {
    const { bytes, mime } = await loadAttachment(meta);
    const ok = await saveBlob(
      new Blob([bytes], { type: mime }),
      meta.name ?? mediaFileName(mime),
    );
    if (!ok) toast.error(failedMessage);
  } catch {
    toast.error(failedMessage);
  }
}

type State =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error" };

/** Decrypted object URL for one attachment; revoked on unmount. */
function useAttachmentUrl(meta: AttachmentMeta): State {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    loadAttachment(meta)
      .then(({ bytes, mime }) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        setState({ status: "ready", url });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // The attachment id fully identifies its (immutable) content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id]);
  return state;
}

function EncryptedImage({
  meta,
  single,
  onOpen,
}: {
  meta: AttachmentMeta;
  single: boolean;
  onOpen?: (url: string) => void;
}) {
  const t = useTranslations("Chat");
  const state = useAttachmentUrl(meta);
  const thumb = meta.thumb
    ? `data:${meta.thumbMime ?? "image/webp"};base64,${meta.thumb}`
    : null;
  const ratio = meta.w && meta.h ? meta.w / meta.h : 1;

  return (
    <div className="group relative">
      <button
        type="button"
        disabled={state.status !== "ready"}
        onClick={() => state.status === "ready" && onOpen?.(state.url)}
        className={cn(
          "relative block overflow-hidden rounded-2xl border border-border bg-muted",
          single ? "w-52 sm:w-60" : "aspect-square w-full",
        )}
        style={
          single
            ? { aspectRatio: String(Math.min(Math.max(ratio, 0.6), 1.8)) }
            : undefined
        }
      >
        {state.status === "ready" ? (
          // Blob URL of locally decrypted bytes — nothing for next/image to optimize.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={state.url}
            alt={t("message.imageAlt")}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <>
            {thumb && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumb}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full scale-110 object-cover blur-md"
              />
            )}
            <span className="absolute inset-0 flex items-center justify-center">
              {state.status === "loading" ? (
                <Loader2 className="size-5 animate-spin text-white drop-shadow" />
              ) : (
                <ImageOff
                  aria-label={t("message.decryptFailed")}
                  className="size-5 text-muted-foreground"
                />
              )}
            </span>
          </>
        )}
      </button>
      {state.status === "ready" && (
        <button
          type="button"
          aria-label={t("message.download")}
          onClick={() =>
            void downloadAttachment(meta, t("message.downloadFailed"))
          }
          className="absolute right-1.5 bottom-1.5 rounded-full bg-black/55 p-1.5 text-white opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Download className="size-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * A voice note is an encrypted audio file: the sender's duration rides in the
 * encrypted metadata, while the bytes only exist as a blob URL decrypted
 * locally (revoked on unmount by `useAttachmentUrl`).
 */
function EncryptedVoiceNote({ meta }: { meta: AttachmentMeta }) {
  const t = useTranslations("Chat");
  const state = useAttachmentUrl(meta);
  return (
    <VoicePlayer
      src={state.status === "ready" ? state.url : null}
      status={state.status}
      durationMs={meta.durationMs ?? 0}
      onDownload={() =>
        void downloadAttachment(meta, t("message.downloadFailed"))
      }
    />
  );
}

function EncryptedFile({ meta }: { meta: AttachmentMeta }) {
  const t = useTranslations("Chat");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const sizeKb = Math.max(1, Math.round(meta.plaintextSize / 1024));

  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const { bytes, mime } = await loadAttachment(meta);
      setFailed(
        !(await saveBlob(
          new Blob([bytes], { type: mime }),
          meta.name ?? mediaFileName(mime),
        )),
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void download()}
      className="flex max-w-60 items-center gap-2 rounded-2xl border border-border bg-muted px-3 py-2 text-left type-body"
    >
      {busy ? (
        <Loader2 className="size-4 shrink-0 animate-spin" />
      ) : (
        <FileText className="size-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate">{meta.name ?? "file"}</span>
        <span className="block type-meta text-muted-foreground">
          {failed ? t("message.decryptFailed") : `${sizeKb} KB`}
        </span>
      </span>
    </button>
  );
}

/** Images and files of one encrypted message (plan §5, receive side). */
export function EncryptedAttachments({
  files,
  onOpenImage,
}: {
  files: AttachmentMeta[];
  onOpenImage?: (url: string) => void;
}) {
  const images = files.filter((f) => f.kind === "image");
  // The purpose is stored only inside the encrypted body, so it is the only
  // thing that separates a voice note from a generic file chip.
  const voices = files.filter((f) => f.purpose === "voice-note");
  const others = files.filter(
    (f) => f.kind === "file" && f.purpose !== "voice-note",
  );
  return (
    <div className="flex flex-col gap-1">
      {images.length > 0 && (
        <div
          className={cn(
            images.length > 1 && "grid w-52 grid-cols-2 gap-1 sm:w-60",
          )}
        >
          {images.map((m) => (
            <EncryptedImage
              key={m.id}
              meta={m}
              single={images.length === 1}
              onOpen={onOpenImage}
            />
          ))}
        </div>
      )}
      {voices.map((m) => (
        <EncryptedVoiceNote key={m.id} meta={m} />
      ))}
      {others.map((m) => (
        <EncryptedFile key={m.id} meta={m} />
      ))}
    </div>
  );
}

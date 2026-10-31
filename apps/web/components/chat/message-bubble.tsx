"use client";

import Image from "next/image";
import {
  Check,
  CheckCheck,
  Loader2,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { isReadByPeer } from "@/lib/chat/format";
import { ListingContextCard } from "@/components/chat/listing-context-card";
import { LocationCard } from "@/components/chat/location-card";
import { EncryptedAttachments } from "@/components/chat/encrypted-attachments";
import type { ThreadMessage } from "@/types/chat";

export function MessageBubble({
  message,
  isMine,
  peerLastReadAt,
  peerName,
  peerAvatarUrl,
  onRetry,
  onCancelHeld,
  onOpenImage,
}: {
  message: ThreadMessage;
  isMine: boolean;
  peerLastReadAt: string | null;
  peerName: string;
  peerAvatarUrl: string | null;
  onRetry?: (message: ThreadMessage) => void;
  onCancelHeld?: (message: ThreadMessage) => void;
  onOpenImage?: (url: string) => void;
}) {
  const t = useTranslations("Chat");
  const format = useFormatter();

  const time = format.dateTime(new Date(message.createdAt), {
    hour: "2-digit",
    minute: "2-digit",
  });
  const read = isMine && isReadByPeer(message, peerLastReadAt);

  return (
    <div
      className={cn(
        "flex items-end gap-2",
        isMine ? "flex-row-reverse" : "flex-row",
      )}
    >
      {!isMine && (
        <Avatar className="h-8 w-8 shrink-0">
          {peerAvatarUrl && <AvatarImage src={peerAvatarUrl} alt={peerName} />}
          <AvatarFallback className="bg-muted type-meta">
            {peerName.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      )}

      <div
        className={cn(
          "flex max-w-[78%] flex-col gap-1 sm:max-w-[60%]",
          isMine ? "items-end" : "items-start",
        )}
      >
        {/* Listing context card. `listing` is undefined on inbox previews and
            null when the ad was deleted — only the latter renders a tombstone.
            A listing-only body renders this card instead of any text. */}
        {message.listing !== undefined &&
          (message.listingOnly === true || message.listingId !== null) && (
            <ListingContextCard listing={message.listing} />
          )}

        {message.sharedLocation && (
          <LocationCard location={message.sharedLocation} />
        )}

        {message.imageUrl && (
          <button
            type="button"
            onClick={() => onOpenImage?.(message.imageUrl as string)}
            className="relative block h-44 w-44 overflow-hidden rounded-2xl border border-border bg-muted sm:h-52 sm:w-52"
          >
            <Image
              src={message.imageUrl}
              alt={t("message.imageAlt")}
              fill
              sizes="208px"
              className="object-cover"
              unoptimized
            />
          </button>
        )}

        {message.e2eFiles && message.e2eFiles.length > 0 && (
          <EncryptedAttachments
            files={message.e2eFiles}
            onOpenImage={onOpenImage}
          />
        )}

        {message.body && (
          <div
            className={cn(
              "overflow-hidden rounded-2xl px-3.5 py-2 type-body whitespace-pre-wrap break-words",
              isMine
                ? "rounded-br-sm bg-muted text-foreground"
                : "rounded-bl-sm bg-sky-500 text-white",
              message.failed && "border border-destructive/60",
            )}
          >
            {message.body}
          </div>
        )}

        <div
          className={cn(
            "flex items-center gap-1 px-1",
            isMine ? "flex-row-reverse" : "flex-row",
          )}
        >
          <span className="type-meta text-muted-foreground">{time}</span>
          {isMine && message.pending && (
            <Loader2
              aria-label={t("message.sending")}
              className="size-3 animate-spin text-muted-foreground"
            />
          )}
          {isMine && message.failed && (
            <button
              type="button"
              onClick={() => onRetry?.(message)}
              className="flex items-center gap-1 type-meta text-destructive"
            >
              <TriangleAlert className="size-3" />
              {t("message.retry")}
              <RotateCcw className="size-3" />
            </button>
          )}
          {isMine &&
            !message.pending &&
            !message.failed &&
            !message.held &&
            (read ? (
              <CheckCheck
                aria-label={t("message.read")}
                className="size-3 text-sky-500"
              />
            ) : (
              <Check
                aria-label={t("message.sent")}
                className="size-3 text-muted-foreground"
              />
            ))}
        </div>
        {isMine && message.held && (
          <div className="flex max-w-full flex-wrap items-center justify-end gap-x-2 px-1 text-[10px]">
            <span
              className={
                message.held === "expired"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }
            >
              {message.held === "expired"
                ? t("message.heldExpired", { name: peerName })
                : t("message.heldWaiting", { name: peerName })}
            </span>
            <button
              type="button"
              onClick={() => onCancelHeld?.(message)}
              className="font-medium underline-offset-2 hover:underline"
            >
              {message.held === "expired"
                ? t("message.heldRemove")
                : t("message.heldCancel")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

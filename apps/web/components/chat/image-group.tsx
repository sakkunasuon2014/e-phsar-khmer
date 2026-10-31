"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ThreadMessage } from "@/types/chat";

/**
 * Grid of 2+ consecutive image-only messages from the same sender.
 * Renders as a compact photo grid without individual bubbles.
 */
export function ImageGroup({
  messages,
  isMine,
  onOpenImage,
}: {
  messages: ThreadMessage[];
  isMine: boolean;
  onOpenImage?: (url: string) => void;
}) {
  const t = useTranslations("Chat");
  const count = messages.length;

  const gridClass = "grid-cols-3";

  return (
    <div
      className={cn(
        "flex items-end gap-2",
        isMine ? "flex-row-reverse" : "flex-row",
      )}
    >
      {/* No avatar for groups — shown on first message only. */}
      <div
        className={cn(
          "flex max-w-[78%] flex-col gap-1 sm:max-w-[60%]",
          isMine ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "grid w-40 gap-1 overflow-hidden rounded-2xl sm:w-48",
            gridClass,
            count > 4 && "max-h-80",
          )}
        >
          {messages.map((msg) => (
            <button
              key={msg.id}
              type="button"
              onClick={() => msg.imageUrl && onOpenImage?.(msg.imageUrl)}
              className="relative block aspect-square overflow-hidden bg-muted"
            >
              <Image
                src={msg.imageUrl!}
                alt={t("message.imageAlt")}
                fill
                sizes="(min-width: 640px) 240px, 156px"
                className="object-cover"
                unoptimized
              />
            </button>
          ))}
        </div>

        {/* Timestamp on last image in group. */}
        <div
          className={cn(
            "flex items-center gap-1 px-1",
            isMine ? "flex-row-reverse" : "flex-row",
          )}
        >
          <span className="type-meta text-muted-foreground">
            {new Date(
              messages[messages.length - 1].createdAt,
            ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </div>
    </div>
  );
}

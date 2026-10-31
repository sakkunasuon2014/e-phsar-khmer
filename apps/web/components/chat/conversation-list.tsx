"use client";

import { useState } from "react";
import { Loader2, MessagesSquare, MoreVertical, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { cn } from "@/lib/utils";
import { previewOf } from "@/lib/chat/format";
import { parseStructuredChatContent } from "@/lib/e2e/chat-content";
import { useE2eEngine } from "@/hooks/use-e2e-engine";
import { useE2eInboxPreviews } from "@/hooks/use-e2e-inbox-previews";
import type { InboxItem } from "@/types/chat";

function RelativeTime({ iso }: { iso: string }) {
  const format = useFormatter();
  // `relativeTime` renders "2 hours ago" in the active locale — no date-fns
  // locale bundles to keep in sync with next-intl's six locales.
  return <>{format.relativeTime(new Date(iso), new Date())}</>;
}

export function ConversationList({
  items,
  viewerId,
  activeId,
  onSelect,
  isLoading,
  hasMore,
  isLoadingMore,
  onLoadMore,
  onDelete,
  deletingId,
  collapsed = false,
}: {
  items: InboxItem[];
  /** Signed-in user — bootstraps E2E so inbox previews can show plaintext. */
  viewerId: string | null;
  activeId: string | null;
  onSelect: (item: InboxItem) => void;
  isLoading: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;
  /** Called after the user confirms deletion in the dialog below. */
  onDelete: (item: InboxItem) => void;
  /** Id of the conversation currently being deleted, if any. */
  deletingId: string | null;
  /** Narrow avatar-only rail (desktop sidebar collapse) — no swipe actions. */
  collapsed?: boolean;
}) {
  const t = useTranslations("Chat");
  const [pendingDelete, setPendingDelete] = useState<InboxItem | null>(null);
  const e2eEngine = useE2eEngine(viewerId);
  const e2ePreviews = useE2eInboxPreviews(items, e2eEngine);

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex flex-col gap-3 p-4",
          collapsed && "items-center p-2",
        )}
      >
        {[0, 1, 2, 3, 4].map((i) =>
          collapsed ? (
            <Skeleton key={i} className="h-10 w-10 shrink-0 rounded-full" />
          ) : (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          ),
        )}
      </div>
    );
  }

  if (items.length === 0) {
    if (collapsed) return null;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <MessagesSquare className="size-8 text-muted-foreground" />
        <p className="type-nav text-foreground">{t("inbox.emptyTitle")}</p>
        <p className="type-meta text-muted-foreground">
          {t("inbox.emptyDescription")}
        </p>
      </div>
    );
  }

  // Collapsed rail: avatars only, no swipe/delete affordance — expand to act
  // on a specific conversation.
  if (collapsed) {
    return (
      <div className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-2">
        {items.map((item) => {
          const name = item.otherUser?.username ?? t("unknownUser");
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              title={name}
              aria-label={name}
              className={cn(
                "relative shrink-0 rounded-full p-0.5 transition-colors hover:bg-muted",
                activeId === item.id && "bg-muted",
              )}
            >
              <Avatar className="h-10 w-10">
                {item.otherUser?.profilePhotoUrl && (
                  <AvatarImage
                    src={item.otherUser.profilePhotoUrl}
                    alt={name}
                  />
                )}
                <AvatarFallback className="font-semibold">
                  {name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              {item.unreadCount > 0 && (
                <span
                  aria-label={t("inbox.unreadCount", {
                    count: item.unreadCount,
                  })}
                  className="absolute top-0 right-0 h-3 w-3 rounded-full bg-[#f04d4e] ring-2 ring-card"
                />
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {items.map((item) => {
        const name = item.otherUser?.username ?? t("unknownUser");
        const deleting = deletingId === item.id;
        const plaintext = item.lastMessage
          ? (e2ePreviews.get(item.lastMessage.id) ?? null)
          : null;
        return (
          <div
            key={item.id}
            className={cn(
              "group flex w-full items-center gap-1 border-b border-border/50 pr-2 transition-colors hover:bg-muted/50",
              activeId === item.id && "bg-muted",
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(item)}
              className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
            >
              <Avatar className="h-10 w-10 shrink-0">
                {item.otherUser?.profilePhotoUrl && (
                  <AvatarImage
                    src={item.otherUser.profilePhotoUrl}
                    alt={name}
                  />
                )}
                <AvatarFallback className="font-semibold">
                  {name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate type-nav">{name}</span>
                  <span className="shrink-0 type-meta text-muted-foreground">
                    <RelativeTime iso={item.lastMessageAt} />
                  </span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      "truncate type-meta",
                      item.unreadCount > 0
                        ? "font-medium text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {previewOf(
                      item.lastMessage,
                      {
                        image: t("inbox.previewImage"),
                        listing: t("inbox.previewListing"),
                        none: t("inbox.previewEmpty"),
                        voice: t("thread.voiceNote"),
                        location: t("thread.locationShared"),
                      },
                      plaintext,
                      // Structured content carries no human text — without this
                      // the row would render the decrypted JSON blob.
                      plaintext ? parseStructuredChatContent(plaintext) : null,
                    )}
                  </p>
                  {item.unreadCount > 0 && (
                    <span
                      aria-label={t("inbox.unreadCount", {
                        count: item.unreadCount,
                      })}
                      className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#f04d4e] px-1.5 type-photo-badge text-white"
                    >
                      {item.unreadCount > 99 ? "99+" : item.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("inbox.actionsLabel")}
                  onClick={(e) => e.stopPropagation()}
                  disabled={deleting}
                  // Always visible on touch (no hover state to reveal it —
                  // this market is phone-first, see ChatWorkspace); fades in
                  // on hover/focus only at desktop widths.
                  className="shrink-0 rounded-full p-1.5 text-muted-foreground opacity-100 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 data-[state=open]:bg-muted data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                >
                  {deleting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <MoreVertical className="size-4" />
                  )}
                </button>
              </DropdownMenuTrigger>
              {/* Portaled to <body> — inherits the html-level theme scope,
                  same as the chat panel itself. */}
              <DropdownMenuContent
                align="end"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setPendingDelete(item)}
                >
                  <Trash2 className="size-4" />
                  {t("inbox.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}

      {hasMore && (
        <div className="p-3">
          <Button
            type="button"
            variant="ghost"
            className="w-full type-meta"
            onClick={onLoadMore}
            disabled={isLoadingMore}
          >
            {isLoadingMore && <Loader2 className="size-3 animate-spin" />}
            {t("inbox.loadMore")}
          </Button>
        </div>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("inbox.deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("inbox.deleteConfirmDescription", {
                name: pendingDelete?.otherUser?.username ?? t("unknownUser"),
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              {t("inbox.deleteCancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete);
                setPendingDelete(null);
              }}
            >
              {t("inbox.deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

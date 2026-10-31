"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EllipsisVertical, BookmarkIcon } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import type { Post } from "@/lib/posts";
import { useState } from "react";
import { toSlug } from "@/lib/utils";
import { SITE_URL } from "@/lib/site";
import { useRouter } from "@/i18n/routing";
import { ReportPost } from "../report/ReportPost";
import { IconShare3, IconUser, IconAlertTriangle } from "@tabler/icons-react";
import { Button } from "../ui/button";
import ShareModal from "@/components/share/ShareModel";
import { useReactions } from "@/components/reactions/reactions-provider";
import { useTranslations } from "next-intl";

/**
 * Every row in this menu shares one shape — the same box, gap and padding —
 * so the icons and labels line up. They used to differ: the Save row was a
 * `Toggle` in a zero-padded item while the others were buttons inside a
 * padded one, which indented it a few pixels, and the icons were sized
 * `scale-140` / `scale-150` / `scale-130` / `18`, so each label started at its
 * own x.
 */
const ITEM =
  "flex w-full items-center gap-3 px-3 py-2 type-nav cursor-pointer outline-none transition-colors hover:bg-muted";

/** One icon box for all four rows. */
const ICON = "size-[18px] shrink-0";

export function ThreeDotPost({ post }: { post: Post }) {
  const t = useTranslations();
  const router = useRouter();
  const username = post.sellerUsername ?? null;
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const reactions = useReactions();
  const listingId = String(post.postId);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            onClick={(e) => e.stopPropagation()}
            className="bg-card h-11 w-11 shrink-0 hover:bg-card/90 text-foreground rounded-full p-1.5 transition-colors shadow-sm outline-none cursor-pointer"
          >
            <EllipsisVertical size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="center"
          className="w-40 rounded-lg p-1 shadow-lg border-muted"
        >
          {/* Offered only when there is somewhere to go — a menu row that
              cannot lead anywhere is worse than no row. */}
          {username && (
            <DropdownMenuItem asChild className="p-0">
              <button
                type="button"
                onClick={() =>
                  router.push({
                    pathname: "/[username]",
                    params: { username },
                  })
                }
                className={ITEM}
              >
                <IconUser className={ICON} strokeWidth={1.5} />
                <span>{t("Common.viewProfile")}</span>
              </button>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            asChild
            onSelect={(e) => e.preventDefault()}
            className="p-0"
          >
            <Toggle
              pressed={reactions.isSaved(listingId)}
              onPressedChange={() => reactions.toggleSave(listingId)}
              disabled={reactions.isPending(listingId)}
              className={`${ITEM} justify-start data-[state=on]:text-blue-500 disabled:opacity-50 border-none rounded-none hover:bg-muted`}
            >
              <BookmarkIcon
                className={`${ICON} transition-all ${
                  reactions.isSaved(listingId)
                    ? "fill-blue-500 text-blue-500"
                    : "text-foreground"
                }`}
              />
              <span>
                {reactions.isSaved(listingId)
                  ? t("Common.unsave")
                  : t("Common.save")}
              </span>
            </Toggle>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="p-0">
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className={ITEM}
            >
              <IconShare3 className={ICON} strokeWidth={1.5} />
              <span>{t("Common.share")}</span>
            </button>
          </DropdownMenuItem>
          <DropdownMenuItem asChild className="p-0">
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className={`${ITEM} text-destructive hover:bg-destructive/10`}
            >
              <IconAlertTriangle className={ICON} strokeWidth={1.5} />
              <span>{t("Common.report")}</span>
            </button>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareModal
        open={shareOpen}
        onOpenChange={setShareOpen}
        url={`${SITE_URL}/${toSlug(post.title)}-adid-${post.postId}`}
      />
      <ReportPost open={reportOpen} onOpenChange={setReportOpen} post={post} />
    </>
  );
}

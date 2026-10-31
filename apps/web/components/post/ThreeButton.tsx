"use client";

import { Button } from "../ui/button";
import {
  IconBookmark,
  IconAlertTriangle,
  IconShare3,
} from "@tabler/icons-react";
import { useState } from "react";
import ShareModal from "../share/ShareModel";
import type { Post } from "@/lib/posts";
import { toSlug } from "@/lib/utils";
import { SITE_URL } from "@/lib/site";
import { ReportPost } from "../report/ReportPost";
import { useReactions } from "@/components/reactions/reactions-provider";
import { useTranslations } from "next-intl";
export function ThreeButton({
  post,
  viewerId,
}: {
  post: Post;
  viewerId?: string | null;
}) {
  const t = useTranslations("Common");
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const reactions = useReactions();
  const listingId = String(post.postId);
  const saved = reactions.isSaved(listingId);
  // Reporting your own listing is a backend 400; hide the control instead of
  // letting it be present-but-refused.
  const isOwnListing = viewerId != null && String(post.userId) === viewerId;
  return (
    <>
      <div className="flex gap-2 mt-4">
        <Button
          onClick={(e) => {
            e.stopPropagation();
            reactions.toggleSave(listingId);
          }}
          disabled={reactions.isPending(listingId)}
          className="flex-1 bg-muted-foreground/10 hover:bg-muted-foreground/20 h-11 rounded-sm type-nav flex justify-center items-center text-foreground transition-colors cursor-pointer"
        >
          <IconBookmark
            className={`scale-150 mr-2 ${
              saved ? "fill-blue-500 text-blue-500" : "text-foreground"
            }`}
            strokeWidth={1.5}
          />{" "}
          {saved ? t("unsave") : t("save")}
        </Button>
        {!isOwnListing && (
          <Button
            onClick={() => setReportOpen(true)}
            className="flex-1 bg-muted-foreground/10 hover:bg-muted-foreground/20 h-11 rounded-sm type-nav flex justify-center items-center text-foreground transition-colors cursor-pointer text-destructive focus:text-destructive"
          >
            <IconAlertTriangle
              className="scale-150 mr-2 text-destructive focus:text-destructive"
              strokeWidth={1.5}
            />{" "}
            {t("report")}
          </Button>
        )}
        <Button
          onClick={() => setShareOpen(true)}
          className="flex-1 bg-muted-foreground/10 hover:bg-muted-foreground/20 h-11 rounded-sm type-nav flex justify-center items-center text-foreground transition-colors cursor-pointer"
        >
          <IconShare3 className="scale-150 mr-2 text-foreground" stroke={1.5} />{" "}
          {t("share")}
        </Button>
      </div>
      <ReportPost open={reportOpen} onOpenChange={setReportOpen} post={post} />
      <ShareModal
        open={shareOpen}
        onOpenChange={setShareOpen}
        url={`${SITE_URL}/${toSlug(post.title)}-adid-${post.postId}`}
      />
    </>
  );
}

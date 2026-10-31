"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "../ui/button";
import { IconHeartPlus, IconShare3 } from "@tabler/icons-react";
import { useReactions } from "@/components/reactions/reactions-provider";
import ShareModal from "@/components/share/ShareModel";
import type { Post } from "@/lib/posts";
import { toSlug } from "@/lib/utils";
import { SITE_URL } from "@/lib/site";

/**
 * The like counter and the share button, as one unit — they render together in
 * two places now (the photo overlay on every listing, and beside the title on
 * a job listing, where the captain's mock moves them out of the photo), and
 * three copies of this markup is how the count and the modal drift apart.
 *
 * The share URL is built here so both placements share one link shape.
 */
export function PostSocialActions({
  post,
  className,
}: {
  post: Pick<Post, "title" | "postId" | "likeCount">;
  className?: string;
}) {
  const t = useTranslations();
  const [shareOpen, setShareOpen] = useState(false);
  // Seeded from the listing; each toggle response replaces it with the
  // backend's fresh count, so the control never needs a refetch.
  const { isLiked, toggleLike, isPending, likeCount } = useReactions();
  const listingId = String(post.postId);
  const likes = likeCount(listingId, post.likeCount ?? 0);

  return (
    <>
      <div className={className ?? "absolute top-3 right-3 flex gap-2 z-10"}>
        <Button
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(listingId);
          }}
          disabled={isPending(listingId)}
          className="bg-card type-nav px-2 py-1.5 h-10 min-w-26 rounded-sm flex items-center shadow-sm hover:bg-white/80 transition-colors cursor-pointer"
        >
          <IconHeartPlus
            className={`scale-145 ${
              isLiked(listingId)
                ? "fill-red-500 text-red-500"
                : "text-foreground"
            }`}
            stroke={2}
          />
          <p className="text-foreground pl-1 pt-0.5">
            {t("ListingCard.likes", { count: likes })}
          </p>
        </Button>
        <Button
          onClick={(e) => {
            e.stopPropagation();
            setShareOpen(true);
          }}
          aria-label={t("Common.share")}
          className="bg-card px-2 py-1.5 h-10 w-15 rounded-sm flex items-center shadow-sm hover:bg-white/80 transition-colors cursor-pointer"
        >
          <IconShare3 className="scale-160 text-foreground" stroke={1.5} />
        </Button>
      </div>
      <ShareModal
        open={shareOpen}
        onOpenChange={setShareOpen}
        url={`${SITE_URL}/${toSlug(post.title)}-adid-${post.postId}`}
      />
    </>
  );
}

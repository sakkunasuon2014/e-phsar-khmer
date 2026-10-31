"use client";

import type { ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import DbImage from "@/components/common/DbImage";
import { toSlug } from "@/lib/utils";
import type { Post } from "@/lib/posts";

const PROFILE_ROW_PHOTO = "h-28 w-28";

/**
 * One row of a profile tab list (captain, 2026-10-27): image left, title over
 * the location with the price at the bottom, and an optional trailing control
 * — the design every populated `/me` tab follows. The tabs render full-width
 * rows when they have data; the centred card is the empty state only.
 */
export function ProfileListingRow({
  post,
  action,
  badge,
  linkable = true,
}: {
  post: Post;
  /** Trailing control (like/save toggle); omit for a plain row. */
  action?: ReactNode;
  /** Optional state chip beside the title (Manage Ads' Expired tab). */
  badge?: ReactNode;
  /** Set false when the ad has no public page (Manage Ads' Hidden tab). */
  linkable?: boolean;
}) {
  const t = useTranslations("Common");
  const photo = post.images[0];

  return (
    <article className="relative flex items-stretch gap-4 rounded-sm border bg-card p-3 shadow-sm">
      {/* Full-row link; the trailing control sits above it. */}
      {linkable ? (
        <Link
          // @ts-expect-error dynamic marketplace slug isn't in the routing pathnames
          href={`/${toSlug(post.title)}-adid-${post.postId}`}
          className="absolute inset-0 z-10"
        />
      ) : null}

      <div
        className={`relative ${PROFILE_ROW_PHOTO} shrink-0 overflow-hidden rounded-sm bg-muted`}
      >
        {photo ? (
          <DbImage
            src={photo}
            alt={post.title}
            fill
            className="object-cover"
            sizes="112px"
            unoptimized
            fallback={
              <div className="absolute inset-0 flex items-center justify-center">
                <ImageIcon className="h-7 w-7 text-zinc-400" aria-hidden />
              </div>
            }
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-7 w-7 text-zinc-400" aria-hidden />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-start gap-2">
            <p className="type-body line-clamp-2 text-foreground">
              {post.title}
            </p>
            {badge ? <span className="shrink-0 pt-0.5">{badge}</span> : null}
          </div>
          {post.location ? (
            <p className="type-meta truncate text-muted-foreground">
              {post.location}
            </p>
          ) : null}
        </div>
        <p className="text-red-500 type-price">
          {post.price === null
            ? t("negotiable")
            : `$${post.price.toLocaleString()}`}
        </p>
      </div>

      {action ? (
        <div className="z-20 flex items-center pr-1">{action}</div>
      ) : null}
    </article>
  );
}

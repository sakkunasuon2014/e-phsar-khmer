"use client";

import DbImage from "@/components/common/DbImage";
import { VerifiedAccountBadge } from "@/components/common/VerifiedAccountBadge";
import { ConditionLabel } from "@/components/common/ConditionLabel";
import { ReportPost } from "@/components/report/ReportPost";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import type { Post } from "@/lib/posts";
import { toSlug } from "@/lib/utils";
import {
  DotIcon,
  ImageIcon,
  TruckIcon,
  HeartIcon,
  EllipsisVertical,
  User,
  BookmarkIcon,
  Forward,
  AlertTriangle,
} from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Toggle } from "@/components/ui/toggle";
import { useReactions } from "@/components/reactions/reactions-provider";
import { useListingImpression } from "@/hooks/use-listing-impression";

export function ListCardPost({ post }: { post: Post }) {
  const t = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  // See GridCardPost — a "Negotiable" listing has no price to subtract from.
  const discountAmount =
    post.oldPrice && post.price !== null ? post.oldPrice - post.price : 0;

  const reactions = useReactions();
  const impressionRef = useListingImpression(post.postId);
  const listingId = String(post.postId);
  // No photo at all, or a stored photo missing from storage → empty area (the
  // DB is the only image source: no static stand-in, no broken <img>).
  const photo = post.images[0];
  const emptyPhoto = (
    <div className="absolute inset-0 flex items-center justify-center">
      <ImageIcon className="h-8 w-8 text-zinc-400" aria-hidden />
    </div>
  );
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      <div
        ref={impressionRef}
        className="relative flex items-stretch bg-card rounded-sm hover:bg-muted/20 transition-colors border cursor-pointer select-none w-full mt-4"
      >
        {/* Full-card link */}
        <Link
          // @ts-expect-error dynamic marketplace slug isn't in the routing pathnames
          href={`/${toSlug(post.title)}-adid-${post.postId}`}
          className="absolute inset-0 z-10"
        />

        {/* ── LEFT: Image ── */}
        <div className="relative shrink-0 w-[200px] h-[180px] ">
          {photo ? (
            <DbImage
              src={photo}
              alt={post.title}
              fill
              className="object-cover rounded-l-sm"
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              loading="eager"
              unoptimized
              fallback={emptyPhoto}
            />
          ) : (
            emptyPhoto
          )}

          {/* Discount badge — single pill, top-left, orange like PhsarKhmer */}
          {post.oldPrice && (
            <div className="absolute top-2 left-2 z-20 flex flex-col items-start gap-0.5">
              <span className="bg-amber-500 text-white type-discount px-2 py-0.5 rounded-full">
                ${discountAmount.toLocaleString()}
              </span>
              <span className="bg-amber-500 text-white type-discount px-2 py-0.5 rounded-full">
                {t("ListingCard.offShort")}
              </span>
            </div>
          )}

          {/* ⋮ menu — top-right of image */}
          <div className="absolute top-1.5 right-1.5 z-20">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="bg-card/80 hover:bg-background text-foreground rounded-full p-1.5 transition-colors shadow outline-none cursor-pointer"
                >
                  <EllipsisVertical size={14} />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                className="w-40 rounded-lg p-1 shadow-lg border-muted z-50"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenuItem asChild>
                  <Link
                    // @ts-expect-error "/profile" isn't declared in the i18n pathnames
                    href={"/profile"}
                    className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                  >
                    <User size={15} />
                    <span>{t("Common.viewProfile")}</span>
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuItem
                  asChild
                  onSelect={(e) => e.preventDefault()}
                  className="p-0"
                >
                  <Toggle
                    pressed={reactions.isSaved(listingId)}
                    onPressedChange={() => reactions.toggleSave(listingId)}
                    disabled={reactions.isPending(listingId)}
                    className="flex w-full items-center justify-start gap-3 px-3 py-2 type-nav transition-colors data-[state=on]:text-blue-500 hover:bg-muted outline-none border-none rounded-sm"
                  >
                    <BookmarkIcon
                      size={15}
                      className={
                        reactions.isSaved(listingId)
                          ? "fill-blue-500 text-blue-500"
                          : ""
                      }
                    />
                    <span>
                      {reactions.isSaved(listingId)
                        ? t("Common.unsave")
                        : t("Common.save")}
                    </span>
                  </Toggle>
                </DropdownMenuItem>

                <DropdownMenuItem
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer"
                  onSelect={(e) => {
                    e.preventDefault();
                    setShareOpen(true);
                  }}
                >
                  <Forward size={15} />
                  <span>{t("Common.share")}</span>
                </DropdownMenuItem>

                <DropdownMenuItem
                  className="flex items-center gap-3 px-3 py-2 cursor-pointer text-destructive focus:text-destructive"
                  onSelect={(e) => {
                    e.preventDefault();
                    setReportOpen(true);
                  }}
                >
                  <AlertTriangle size={15} />
                  <span>{t("Common.report")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Image count — bottom-right */}
          {post.images.length > 1 && (
            <span className="absolute bottom-1.5 right-1.5 z-20 bg-black/60 text-white type-photo-badge px-1.5 py-0.5 rounded flex items-center gap-1">
              <ImageIcon size={10} />
              <span>{post.images.length - 1}</span>
            </span>
          )}
        </div>

        {/* ── MIDDLE: Text content ── */}
        <div className="flex flex-col flex-1 min-w-0 px-4 py-3 justify-between">
          <div className="flex flex-col gap-1">
            {/* Title — allow 2 lines like PhsarKhmer */}
            <p className="type-body line-clamp-2 text-foreground">
              {post.title}
            </p>

            {post.sellerVerifiedAccount && (
              <span className="w-fit">
                <VerifiedAccountBadge />
              </span>
            )}

            {/* Time · Location */}
            <div className="flex items-center gap-0.5 type-meta text-muted-foreground">
              <span className="shrink-0">
                {format.dateTime(new Date(post.createdat), {
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: locale !== "km",
                })}
              </span>
              {post.location && (
                <>
                  <DotIcon className="shrink-0 w-3 h-3" />
                  <span className="truncate">{post.location}</span>
                </>
              )}
            </div>

            {/* Condition · Year · etc */}
            <p className="type-meta text-muted-foreground">
              <ConditionLabel value={post.condition} />
            </p>

            {/* Free delivery — styled like PhsarKhmer: icon + text, muted blue */}
            {post.freeDelivery && (
              <span className="inline-flex items-center gap-1 type-meta text-sky-600 w-fit mt-0.5">
                <TruckIcon size={12} />
                <span>{t("Common.freeDelivery")}</span>
              </span>
            )}
          </div>

          {/* Price row */}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-red-500 type-price">
              {post.price === null
                ? t("Common.negotiable")
                : `$${post.price.toLocaleString()}`}
            </span>
            {post.oldPrice && (
              <span className="type-body-sm text-zinc-400 line-through">
                ${post.oldPrice.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* ── RIGHT: Heart — bottom-aligned with the price row (captain,
            2026-10-06: centered, it floated mid-card on tall cards) ── */}
        <div className="flex items-end pb-3 pr-4 z-20">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              reactions.toggleLike(listingId);
            }}
            disabled={reactions.isPending(listingId)}
            className="group/heart h-11 w-11 shrink-0 flex items-center justify-center rounded-full hover:bg-gray-500 transition-colors outline-none cursor-pointer"
          >
            <HeartIcon
              className={`h-5 w-5 transition-transform ${
                reactions.isLiked(listingId)
                  ? "fill-red-500 text-red-500 scale-110"
                  : "text-muted-foreground group-hover/heart:text-white"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Share dialog */}
      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent
          className="sm:max-w-md"
          onClick={(e) => e.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>{t("Share.linkTitle")}</DialogTitle>
            <DialogDescription>{t("Share.linkDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid flex-1 gap-2">
            <Input
              id="link"
              defaultValue={`${typeof window !== "undefined" ? window.location.origin : ""}/${toSlug(post.title)}-adid-${post.postId}`}
              readOnly
            />
          </div>
        </DialogContent>
      </Dialog>

      <ReportPost post={post} open={reportOpen} onOpenChange={setReportOpen} />
    </>
  );
}

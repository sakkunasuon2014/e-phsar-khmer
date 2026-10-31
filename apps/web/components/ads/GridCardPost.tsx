"use client";

import DbImage from "@/components/common/DbImage";
import { VerifiedAccountBadge } from "@/components/common/VerifiedAccountBadge";
import { ConditionLabel } from "@/components/common/ConditionLabel";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import type { Post } from "@/lib/posts";
import { toSlug } from "@/lib/utils";
import { DotIcon, ImageIcon, TruckIcon, HeartIcon, Play } from "lucide-react";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useReactions } from "@/components/reactions/reactions-provider";
import { useListingImpression } from "@/hooks/use-listing-impression";
import { ThreeDotPost } from "../Card/ThreeDotPost";

export function GridCardPost({ post }: { post: Post }) {
  const t = useTranslations();
  const format = useFormatter();
  const locale = useLocale();
  const reactions = useReactions();
  const impressionRef = useListingImpression(post.postId);
  const listingId = String(post.postId);
  // No photo at all, or a stored photo missing from storage → empty area. The
  // DB is the only image source: no static stand-in, no broken <img>.
  const photo = post.images[0];
  const emptyPhoto = (
    <div className="absolute inset-0 flex items-center justify-center">
      <ImageIcon className="h-8 w-8 text-zinc-400" aria-hidden />
    </div>
  );

  // `oldPrice` only exists alongside a real price, but a "Negotiable" listing
  // has none — guard it rather than letting the subtraction see null.
  const discountAmount =
    post.oldPrice && post.price !== null ? post.oldPrice - post.price : 0;

  const discountPercent = post.oldPrice
    ? Math.round((discountAmount / post.oldPrice) * 100)
    : 0;

  return (
    <Card
      ref={impressionRef}
      className="relative h-full select-none cursor-pointer bg-card rounded-sm shadow-sm hover:shadow-md transition overflow-hidden pt-0 border-none"
    >
      <Link
        // @ts-expect-error dynamic marketplace slug isn't in the routing pathnames
        href={`/${toSlug(post.title)}-adid-${post.postId}`}
        className="absolute inset-0 z-20"
      />
      <div className="relative h-52 w-full bg-zinc-100">
        {photo ? (
          <DbImage
            src={photo}
            alt={post.title}
            fill
            className="object-cover"
            priority={false}
            unoptimized
            fallback={emptyPhoto}
          />
        ) : (
          emptyPhoto
        )}
        {(post.sellerVerifiedAccount || post.oldPrice) && (
          <div className="pointer-events-none absolute top-2 left-2 z-30 flex flex-col items-start gap-1">
            {/* Paid-plan badge. Stacked above the discounts rather than
                centred: the Khmer label is ~1.7x the English one and would
                collide with the discount badges on a 260px card. */}
            {post.sellerVerifiedAccount && <VerifiedAccountBadge />}
            {post.oldPrice && (
              <>
                {/* % OFF */}
                <span className="bg-red-600 text-white type-discount px-2 py-0.5 rounded">
                  -{discountPercent}%
                </span>
                {/* $ OFF */}
                <span className="bg-black/70 text-white type-discount px-2 py-0.5 rounded">
                  {t("ListingCard.amountOff", {
                    amount: discountAmount.toLocaleString(),
                  })}
                </span>
              </>
            )}
          </div>
        )}
        <div className="absolute top-2 right-2 z-30">
          <ThreeDotPost post={post} />
        </div>
        {/* Container positioned in the bottom right corner */}
        <div className="absolute bottom-2 right-2 flex flex-row-reverse items-center gap-1.5 pointer-events-none">
          {/* 1. Image Count Badge */}
          {post.images && post.images.length > 1 && (
            <span className="bg-black/70 text-white type-photo-badge px-2 py-1 rounded flex items-center gap-1 whitespace-nowrap">
              <ImageIcon size={14} />
              <span>{post.images.length}</span>
            </span>
          )}
          {/* 2. Free Delivery Badge */}
          {post.freeDelivery && (
            <span className="bg-black/70 text-white type-button-sm px-2 py-1 rounded flex items-center gap-1 whitespace-nowrap">
              <TruckIcon size={14} />
              <span>{t("Common.freeDelivery")}</span>
            </span>
          )}
          {post.video && (
            <span className="bg-black/70 text-white type-button-sm px-2 py-1 rounded flex items-center gap-1 whitespace-nowrap">
              <Play size={14} />
            </span>
          )}
        </div>
      </div>
      <CardHeader className="flex flex-1 flex-col items-stretch">
        <CardTitle className="truncate block">{post.title}</CardTitle>
        {/* `min-w-0`: CardHeader is a grid, and a grid item's `min-width: auto`
            would let the location row size the track wider than the card — then
            the card's `overflow-hidden` clips the ellipsis and the heart. With
            it the track stays at the card's width and `truncate` does its job
            (ListCardPost already carries the same guard). */}
        <CardDescription className="flex min-w-0 flex-col text-muted-foreground">
          <div className="flex min-w-0 items-center">
            <span className="shrink-0">
              {format.dateTime(new Date(post.createdat), {
                hour: "2-digit",
                minute: "2-digit",
                hour12: locale !== "km",
              })}
            </span>
            {post.location && (
              <>
                <DotIcon className="scale-120" />
                <span className="truncate">{post.location}</span>
              </>
            )}
          </div>
          <div className="type-meta text-muted-foreground">
            <ConditionLabel value={post.condition} />
          </div>
        </CardDescription>
        {/* `mt-auto`: with the header stretched (flex-1), the price + heart row
            pins to the card's bottom — so cards in a row line up even when one
            has no condition line (captain, 2026-10-06). */}
        <div className="mt-auto flex items-center justify-between">
          {/* LEFT: price */}
          <div className="flex items-center gap-3">
            <span className="text-red-600 type-price">
              {post.price === null
                ? t("Common.negotiable")
                : `$${post.price.toLocaleString()}`}
            </span>
            {post.oldPrice && (
              <span className="type-body-sm text-zinc-400 italic line-through">
                ${post.oldPrice.toLocaleString()}
              </span>
            )}
          </div>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              reactions.toggleLike(listingId);
            }}
            disabled={reactions.isPending(listingId)}
            className="group/heart h-11 w-11 shrink-0 z-30 rounded-full bg-card hover:bg-gray-500 flex items-center justify-center cursor-pointer"
          >
            <HeartIcon
              className={`h-6 w-6 transition ${
                reactions.isLiked(listingId)
                  ? "fill-red-500 text-red-500 scale-110"
                  : "text-gray-400 group-hover/heart:text-white"
              }`}
            />
          </button>
        </div>
      </CardHeader>
    </Card>
  );
}

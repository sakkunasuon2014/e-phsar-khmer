"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn, toSlug } from "@/lib/utils";
import { formatPrice } from "@/lib/chat/format";
import type { ListingContext } from "@/types/chat";

/**
 * The listing card attached to a chat message — the core marketplace
 * interaction ("I'm asking about *this* ad").
 *
 * `listing` is null when the ad has since been deleted: the FK is
 * ON DELETE SET NULL, so the message survives its listing and we render a
 * tombstone rather than dropping the card. A live listing is clickable — it
 * opens a leaving-chat confirmation before routing to the ad, so a stray tap
 * inside the thread never silently navigates someone away mid-conversation.
 */
export function ListingContextCard({
  listing,
  className,
}: {
  listing: ListingContext | null;
  className?: string;
}) {
  const t = useTranslations("Chat");
  const locale = useLocale();
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!listing) {
    return (
      <div
        className={cn(
          "w-56 max-w-full rounded-xl border border-dashed border-border bg-card/60 px-3 py-4 type-meta text-muted-foreground",
          className,
        )}
      >
        {t("listing.unavailable")}
      </div>
    );
  }

  const price = formatPrice(listing.price, listing.currency, locale);
  const inactive = listing.status !== "active";

  function goToAd() {
    setConfirmOpen(false);
    // Same dynamic-slug shape as the card links (GridCardPost/ListCardPost):
    // `title-adid-<uuid>` isn't a route the pathnames config can type.
    // @ts-expect-error dynamic marketplace slug isn't in the routing pathnames
    router.push(`/${toSlug(listing!.title)}-adid-${listing!.id}`);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        className={cn(
          "w-56 max-w-full cursor-pointer overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition-colors hover:border-primary/50 hover:shadow-md",
          className,
        )}
      >
        <div className="relative flex h-28 items-center justify-center bg-muted">
          {listing.thumbnailUrl ? (
            <Image
              src={listing.thumbnailUrl}
              alt={listing.title}
              fill
              sizes="224px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <ImageOff className="size-7 text-muted-foreground" />
          )}
        </div>
        <div className="p-2.5">
          <p className="line-clamp-2 type-meta text-foreground">
            {listing.title}
          </p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="type-price text-[#f04d4e]">
              {price ?? t("listing.noPrice")}
            </p>
            {inactive && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 type-button-sm text-muted-foreground">
                {t(`listing.status.${listing.status}`)}
              </span>
            )}
          </div>
        </div>
      </button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("listing.confirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("listing.confirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t("listing.confirmCancel")}
            </Button>
            <Button onClick={goToAd}>{t("listing.confirmContinue")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

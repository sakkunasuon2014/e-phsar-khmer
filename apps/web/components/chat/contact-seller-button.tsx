"use client";

import { useState, useTransition } from "react";
import { Loader2, MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { startConversationWith } from "@/actions/chat";
import { storeListingPreview } from "@/lib/chat/listing-handoff";
import { trackEvent } from "@/lib/insights/queue";
import type { ListingContext } from "@/types/chat";

/**
 * "Chat" entry point for a listing page.
 *
 * Creates (or resolves) the thread via `POST /chats/with/:userId` FIRST — so
 * the conversation exists and shows up in both inboxes as soon as the buyer
 * opens it, regardless of whether they end up sending a message — then hands
 * off to `/chats`, where the listing rides along as context for the first
 * message (see `listingId` in the query string / `ListingContextCard`).
 *
 * Renders nothing when `sellerId` is missing or is the viewer's own id: the
 * backend rejects self-messages with a 400 and there is nothing useful to show.
 */
export function ContactSellerButton({
  sellerId,
  listingId,
  listing,
  viewerId,
  label,
  className,
  size = "default",
  variant = "default",
}: {
  sellerId: string | null | undefined;
  listingId?: string;
  /** Full preview (title/price/thumbnail) for the ad being asked about — stashed
   *  for the chat page so it can render the card before any message is sent. */
  listing?: ListingContext | null;
  /** Pass the signed-in user's id when the host page has it, to hide the
   *  button on your own ad without an extra request. */
  viewerId?: string | null;
  /** Overrides the default "Chat" — a job application's poster is
   *  not a seller, and an applicant is not a buyer. */
  label?: string;
  className?: string;
  size?: "default" | "sm" | "lg";
  variant?: "default" | "outline" | "secondary" | "ghost";
}) {
  const t = useTranslations("Chat");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [resolving, setResolving] = useState(false);

  if (!sellerId || (viewerId && viewerId === sellerId)) return null;

  async function open() {
    if (!sellerId) return;
    // Count the click even when it ends in a sign-in bounce or a block —
    // the metric is "people clicked chat", not "messages sent".
    if (listingId) trackEvent(listingId, "chat");
    setResolving(true);
    const res = await startConversationWith(sellerId);
    setResolving(false);

    if (!res.ok) {
      if (res.status === 401) {
        toast.error(t("auth.requiredTitle"));
        startTransition(() => router.push("/login"));
        return;
      }
      toast.error(res.message || t("errors.generic"));
      return;
    }

    if (!res.data.canMessage) {
      toast.error(t("composer.blocked"));
      return;
    }

    if (listingId && listing) storeListingPreview(listing);

    const query = listingId
      ? { to: sellerId, listing: listingId }
      : { to: sellerId };
    startTransition(() => router.push({ pathname: "/chats", query }));
  }

  const busy = resolving || pending;

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      disabled={busy}
      onClick={() => void open()}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <MessageCircle className="size-4" />
      )}
      {label ?? t("messageSeller")}
    </Button>
  );
}

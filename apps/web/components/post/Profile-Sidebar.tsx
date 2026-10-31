"use client";

import { useState } from "react";
import Image from "next/image";
import UserAvatar from "@/components/common/UserAvatar";
import { VerifiedAccountBadge } from "@/components/common/VerifiedAccountBadge";
import { useFormatter, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { type User } from "@/lib/user";
import {
  IconBuilding,
  IconPhoneCall,
  IconWorld,
  IconMail,
} from "@tabler/icons-react";
import CarrierBadge from "./CarrierBadge";
import { ContactSellerButton } from "@/components/chat/contact-seller-button";
import { FollowButton } from "@/components/profile/FollowButton";
import type { ListingContext } from "@/types/chat";
import { trackEvent } from "@/lib/insights/queue";
import { maskPhone } from "@/lib/phone";

/**
 * The email counterpart of `maskPhone`: the local part is reduced to its
 * first character, the domain stays readable so the visitor can tell which
 * mailbox they are asking for. A very short local part is fully masked.
 */
function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.length > 2 ? local[0] : "*"}***@${domain}`;
}

export default function ProfileSidebar({
  userId,
  user,
  listingId,
  listing,
  viewerId,
  initialFollowing = false,
}: {
  userId: string;
  user: User;
  listingId?: string;
  /** Preview card for the ad, stashed for the chat page — see ContactSellerButton. */
  listing?: ListingContext | null;
  /** Signed-in viewer's id, if any — when it matches `userId` this is the
   *  viewer's own ad, so follow/message actions don't make sense. */
  viewerId?: string | null;
  /** Whether `viewerId` already follows the seller. */
  initialFollowing?: boolean;
}) {
  const t = useTranslations("Post");
  const format = useFormatter();
  // Same "Show Phone Number" gate as the description block: the numbers stay
  // masked until the visitor asks for them. The email follows the same rule —
  // the "Show Email Address" control used to only log the event, leaving the
  // address already readable above it.
  const [phoneRevealed, setPhoneRevealed] = useState(false);
  const [emailRevealed, setEmailRevealed] = useState(false);
  const isOwnAd = !!viewerId && viewerId === userId;
  // An expired ad keeps its seller card (identity, follow) but offers no way
  // to contact anyone: the offer is no longer live (captain, 2026-10-27).
  const expired = listing?.status === "expired";

  const phone0 = user.phone?.[0];
  const phone1 = user.phone?.[1];
  const phones: { value: string; badgeBg: string; letter: string }[] = [];
  if (phone0) {
    phones.push({ value: phone0, badgeBg: "bg-orange-400", letter: "C" });
  }
  if (phone1) {
    phones.push({ value: phone1, badgeBg: "bg-green-600", letter: "S" });
  }

  // One list serves both states: revealed (linked) and masked (the reveal
  // button, or the expired row that offers no action at all).
  const phoneNodes = (linked: boolean) => (
    <>
      {phones.map((phone) => (
        <span key={phone.value} className="flex items-center gap-1 font-bold">
          <CarrierBadge
            phone={phone.value}
            fallback={
              <span
                className={`${phone.badgeBg} w-4 h-4 rounded-sm flex items-center justify-center type-discount text-white`}
              >
                {phone.letter}
              </span>
            }
          />
          {linked ? (
            <a
              href={`tel:${phone.value}`}
              onClick={() => {
                if (listingId) trackEvent(listingId, "call");
              }}
              className="hover:underline"
            >
              {phone.value}
            </a>
          ) : (
            maskPhone(phone.value)
          )}
        </span>
      ))}
    </>
  );

  // Avatar + name + handle. It becomes a link to the seller's profile only
  // when there is a real handle to link to — the server joins it onto the
  // listing, and a seller whose owner is gone has none, so the card renders
  // the same identity without a link to nowhere.
  const identity = (
    <>
      <div className="relative h-16 w-16 rounded-full border-4 border-card overflow-hidden">
        <UserAvatar
          src={user?.avatar}
          name={user?.name}
          className="h-full w-full text-xl"
          imgClassName="bg-card"
        />
      </div>
      <div className="text-card min-w-0">
        <h2 className="type-card-heading flex min-w-0 items-center gap-1.5">
          <span className="truncate">{user?.name}</span>
          {user?.verifiedAccount && <VerifiedAccountBadge />}
        </h2>
        {/* No handle, no row — the same rule the company, phone and email
            rows below already follow. */}
        {user?.username && (
          <p className="type-body-sm opacity-90">@{user.username}</p>
        )}
        <p className="type-meta">
          {t("membersSince", {
            date: user?.joinDate
              ? format.dateTime(new Date(user.joinDate), {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : "",
          })}
        </p>
      </div>
    </>
  );

  return (
    <div className="w-[400px] space-y-3">
      <div className="bg-card rounded-sm border border-border overflow-hidden shadow-sm">
        <div className="bg-[#00a0e9] p-4 hover:bg-[#00a0e9]/80  flex items-center justify-between">
          {user?.username ? (
            <Link
              href={{
                pathname: "/[username]",
                params: { username: user.username },
              }}
              className="flex min-w-0 flex-1 items-center gap-3  cursor-pointer"
            >
              {identity}
            </Link>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-3">
              {identity}
            </div>
          )}

          {/* Nothing sits here on your own ad — the "Your Ad" badge that used
              to told the visitor a fact they could not act on, and it sat
              where every other listing offers a Follow. */}
          {!isOwnAd && (
            <FollowButton
              key={userId}
              userId={userId}
              initialFollowing={initialFollowing}
              viewerId={viewerId}
              variant="compact"
              className="bg-card text-foreground hover:bg-gray-100 h-7 mt-9 rounded-sm flex items-center cursor-pointer"
            />
          )}
        </div>

        {/* Contact Info Section */}
        <div className="p-3 space-y-3 type-body-sm">
          {/* The jobs form's Company leads this list. Every row follows the
              same design — a muted icon square plus its text — and the first
              row is normally the username, so a job listing swaps in the
              employer instead (captain, 2026-09-24: "for job, this has company
              row as the first row, instead of username (or name)"). Plain
              text: the company is never a link. */}
          {user?.company ? (
            <>
              <div className="flex gap-2">
                <div className="bg-muted h-8 w-8 rounded-sm flex items-center justify-center flex-shrink-0">
                  <IconBuilding
                    size={18}
                    className="text-muted-foreground"
                    stroke={1.5}
                  />
                </div>
                <p className="truncate type-body-sm mt-1">{user.company}</p>
              </div>
              <div className="border-t border-muted-foreground/30" />
            </>
          ) : null}
          <div className="flex gap-2">
            <div className="bg-muted h-8 w-8 rounded-sm flex items-center justify-center">
              <IconWorld
                size={18}
                className="text-muted-foreground"
                stroke={1.5}
              />
            </div>
            <Link
              href={{
                pathname: "/[username]",
                params: { username: user?.username },
              }}
              className="type-body-sm text-[#00a0e9] hover:underline truncate mt-1"
            >
              {user?.userlink || "username"}
            </Link>
          </div>
          <div className="border-t border-muted-foreground/30" />
          {/* Phone Number — the row and its divider render only when the
              seller actually gave a number; a row whose only content is the
              "Show Phone Number" button is worse than no row. */}
          {phone0 || phone1 ? (
            <>
              <div className="flex gap-2">
                <div className="bg-muted h-8 w-8 rounded-sm flex items-center justify-center flex-shrink-0">
                  <IconPhoneCall size={18} className="text-muted-foreground" />
                </div>
                {phoneRevealed ? (
                  <div className="flex flex-wrap items-center gap-3">
                    {phoneNodes(true)}
                  </div>
                ) : expired ? (
                  <span className="flex flex-wrap items-center gap-3">
                    {phoneNodes(false)}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setPhoneRevealed(true);
                      if (listingId) trackEvent(listingId, "show_contact");
                    }}
                    className="-m-1 flex cursor-pointer flex-col items-start gap-1 rounded-md p-1 text-left transition-colors hover:bg-muted"
                  >
                    <span className="flex flex-wrap items-center gap-3">
                      {phoneNodes(false)}
                    </span>
                    <span className="text-[#00a0e9] type-body-sm italic">
                      {t("showPhone")}
                    </span>
                  </button>
                )}
              </div>
              <div className="border-t border-muted-foreground/30" />
            </>
          ) : null}
          {/* Email — same rule: no address, no row (captain, 2026-09-24:
              "if it has no data don't let it appear … I don't enter any then
              it still show email row"). An expired ad hides it entirely:
              there is no live offer to reply to. */}
          {!expired && user?.email ? (
            <>
              <div className="flex gap-3">
                <div className="bg-muted h-8 w-8 rounded-sm flex items-center justify-center flex-shrink-0">
                  <IconMail size={18} className="text-muted-foreground" />
                </div>
                {emailRevealed ? (
                  <a
                    href={`mailto:${user.email}`}
                    className="font-medium text-foreground hover:underline break-all"
                  >
                    {user.email}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEmailRevealed(true);
                      if (listingId) trackEvent(listingId, "show_contact");
                    }}
                    className="-m-1 flex cursor-pointer flex-col items-start gap-1 rounded-md p-1 text-left transition-colors hover:bg-muted"
                  >
                    <span className="font-medium text-foreground break-all">
                      {maskEmail(user.email)}
                    </span>
                    <span className="text-[#00a0e9] type-body-sm italic">
                      {t("showEmail")}
                    </span>
                  </button>
                )}
              </div>
              <div className="border-t border-muted-foreground/30" />
            </>
          ) : null}

          {isOwnAd ? (
            <div className="w-full bg-muted text-muted-foreground h-10 rounded-sm type-nav flex items-center justify-center text-center px-2">
              {t("ownAdNote")}
            </div>
          ) : expired ? (
            <div className="w-full bg-muted text-muted-foreground h-10 rounded-sm type-nav flex items-center justify-center text-center px-2">
              {t("expiredContact")}
            </div>
          ) : (
            <ContactSellerButton
              sellerId={userId}
              listingId={listingId}
              listing={listing}
              viewerId={viewerId}
              className="w-full bg-[#f68b1e] hover:bg-[#e57a10] text-white h-10 rounded-sm type-nav cursor-pointer"
            />
          )}
        </div>
      </div>
      <div className="bg-card rounded-sm border border-border p-4 shadow-sm">
        <div className="flex items-center justify-center gap-2 mb-4 pt-3">
          <Image
            src="/user-img/warning.png"
            alt="warning icon"
            width={32}
            height={32}
            unoptimized
          />
          <h2 className="text-[#e3281b] type-card-heading">
            {t("safetyTips.title")}
          </h2>
        </div>
        <ol className="space-y-3 type-body-sm text-foreground list-decimal pl-6 pb-3">
          <li className="px-2">{t("safetyTips.noMoney")}</li>
          <li className="px-2">{t("safetyTips.checkItem")}</li>
          <li className="px-2">{t("safetyTips.payAfter")}</li>
          <li className="px-2">{t("safetyTips.meetSafe")}</li>
        </ol>
      </div>
    </div>
  );
}

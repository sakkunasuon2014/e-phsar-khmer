"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { IconMapPin, IconPhoneCall } from "@tabler/icons-react";
import CarrierBadge from "./CarrierBadge";
import ListingLocationMap from "./ListingLocationMap";
import { trackEvent } from "@/lib/insights/queue";
import { maskPhone } from "@/lib/phone";

export default function ContactUser({
  user,
  district,
  province,
  coords,
  locationLine,
  addressLine,
  listingId,
  contactDisabled = false,
}: {
  user: { phone?: string[] };
  district?: { name?: string };
  province?: { name?: string };
  /** The listing's saved map pin, when it was posted with one. */
  coords?: { lat: number; lng: number } | null;
  /** The listing's location as text (real listings carry it on the row). */
  locationLine?: string;
  /** The seller's street address — printed under the location. */
  addressLine?: string;
  /** Present on a real listing; drives call/show-contact tracking. */
  listingId?: string;
  /** An expired ad: numbers stay masked and the reveal is never offered. */
  contactDisabled?: boolean;
}) {
  const t = useTranslations("Post");
  // Numbers stay masked until the visitor asks for them. The whole
  // logo + number + "Show Phone Number" group is one click target.
  const [revealed, setRevealed] = useState(false);
  const phone0 = user?.phone?.[0];
  const phone1 = user?.phone?.[1];
  // Display order and colours match the original markup (second number first).
  const phones: {
    value: string;
    color: string;
    badgeBg: string;
    letter: string;
  }[] = [];
  if (phone1) {
    phones.push({
      value: phone1,
      color: "text-[#118c28]",
      badgeBg: "bg-[#118c28]",
      letter: "S",
    });
  }
  if (phone0) {
    phones.push({
      value: phone0,
      color: "text-[#f68b1e]",
      badgeBg: "bg-[#f68b1e]",
      letter: "C",
    });
  }
  const heading =
    locationLine ?? [district?.name, province?.name].filter(Boolean).join(", ");
  // The map link searches the most precise text we have, address included.
  const mapQuery = [heading, addressLine].filter(Boolean).join(", ");

  // One list serves all three states: revealed (linked), expired (masked, no
  // action offered) and the normal masked reveal button.
  const phoneNodes = (linked: boolean) => (
    <>
      {phones.map((phone) => (
        <span key={phone.value} className={`flex items-center ${phone.color}`}>
          <CarrierBadge
            phone={phone.value}
            className="mr-1"
            fallback={
              <span
                className={`${phone.badgeBg} text-white type-discount w-[15px] h-[15px] flex items-center justify-center rounded-sm mr-2`}
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

  return (
    <>
      <div className="mt-4">
        <h1 className="type-body-sm text-foreground mb-3">
          {t("contactHint")}
        </h1>
        {/* The icon is its own flex track, so the heading text and every row
            under it share one left edge. A hardcoded indent (ml-[26px]) kept
            drifting: the icon lays out at 24px + 8px gap, not 26px. */}
        <div className="flex items-start gap-2">
          <IconPhoneCall className="shrink-0 scale-80 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h3 className="type-card-heading mb-2">{t("contactPhones")}</h3>
            {revealed ? (
              <div className="flex flex-wrap items-center gap-5 type-nav">
                {phoneNodes(true)}
              </div>
            ) : contactDisabled ? (
              <span className="flex flex-wrap items-center gap-5 type-nav">
                {phoneNodes(false)}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setRevealed(true);
                  if (listingId) trackEvent(listingId, "show_contact");
                }}
                className="-m-2 inline-block max-w-full cursor-pointer rounded-md p-2 text-left transition-colors hover:bg-muted"
              >
                <span className="flex flex-wrap items-center gap-5 type-nav">
                  {phoneNodes(false)}
                </span>
                <span className="mt-2 block text-[#00a0e9] type-meta italic">
                  {t("showPhone")}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="mt-4">
        <div className="flex items-start gap-2">
          <IconMapPin className="shrink-0 scale-80 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h3 className="type-card-heading mb-2">{heading}</h3>
            {/* The street address sits on its own line under the location,
                and only when the seller gave one — no empty line otherwise. */}
            {addressLine ? (
              <p className="type-body-sm text-muted-foreground mb-2">
                {addressLine}
              </p>
            ) : null}
          </div>
        </div>
        <ListingLocationMap coords={coords ?? null} locationLine={mapQuery} />
      </div>
    </>
  );
}

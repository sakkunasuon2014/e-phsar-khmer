"use client";

import { useTranslations } from "next-intl";
import { IconMapPin } from "@tabler/icons-react";

/** The design's map mock — the detail page never embeds a live map. */
const MAP_MOCK = "/icon/bg_map.jpg";

/**
 * The listing's location on the detail page: the design's map mock with a
 * "Show on Google Map" button, which opens Google Maps in a new tab. With a
 * saved pin that link carries the exact coordinates; otherwise it searches the
 * listing's location text. No live map is embedded here (nothing to interact
 * with — the seller's pick is what matters, and it is one click away).
 */
export default function ListingLocationMap({
  coords,
  locationLine,
}: {
  coords: { lat: number; lng: number } | null;
  locationLine?: string;
}) {
  const t = useTranslations("Post.map");
  const href = coords
    ? `https://www.google.com/maps?q=${coords.lat},${coords.lng}`
    : locationLine
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationLine)}`
      : null;

  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="relative mx-6 block h-[120px] max-w-3xl overflow-hidden rounded-sm border border-gray-200"
    >
      <span
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url('${MAP_MOCK}')` }}
        aria-hidden
      />
      <span className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center rounded-sm bg-card px-3 py-2 type-meta text-muted-foreground shadow-sm">
        <IconMapPin className="mr-1" />
        {t("show")}
      </span>
    </a>
  );
}

"use client";

import { MapPin } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { SharedLocation } from "@/lib/e2e/chat-content";

/**
 * A shared position, rounded to ~1 m. The full-precision coordinate stays on
 * the device: a chat bubble is a meeting point, not a device fingerprint.
 */
function formatCoordinate(value: number): string {
  return value.toFixed(5);
}

/**
 * Static card for a location shared inside an encrypted message.
 *
 * Deliberately no map tiles: rendering a map would fire a third-party request
 * per message and hand the position to that host before the reader ever asks
 * for it. The pin is plain text, and "View on map" opens the point in
 * OpenStreetMap only on an explicit tap.
 */
export function LocationCard({
  location,
  className,
}: {
  location: SharedLocation;
  className?: string;
}) {
  const t = useTranslations("Chat");
  const latitude = formatCoordinate(location.latitude);
  const longitude = formatCoordinate(location.longitude);
  const mapsUrl = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;

  return (
    <div
      className={cn(
        "w-56 max-w-full rounded-xl border border-border bg-card p-3 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-500">
          <MapPin className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">
            {t("thread.locationShared")}
          </p>
          <p className="truncate text-[11px] tabular-nums text-muted-foreground">
            {latitude}, {longitude}
          </p>
        </div>
      </div>
      <a
        href={mapsUrl}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-sky-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MapPin className="size-3.5" />
        {t("thread.viewOnMap")}
      </a>
    </div>
  );
}

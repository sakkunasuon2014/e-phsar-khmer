"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, LocateFixed } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DEFAULT_CENTER,
  type MapCoords,
} from "@/components/post/location-map.constants";
import type { SharedLocation } from "@/lib/e2e/chat-content";

// Leaflet touches `window` at module scope — keep it client-only, same as the
// post form's picker.
const LocationMapCanvas = dynamic(
  () => import("@/components/post/LocationMapCanvas"),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
  },
);

/** Result of the last "use current location" attempt. */
type LocateStatus =
  | "idle"
  | "locating"
  | "unsupported"
  | "denied"
  | "timeout"
  | "unavailable";

/**
 * Chat's "share location" dialog: a pick-mode map the sender can drag/click,
 * plus a "Use current location" button that is the *only* thing in this flow
 * that asks the browser for GPS — opening the dialog itself never does.
 *
 * `accuracyMeters` is kept only while the pin sits exactly where the last GPS
 * fix put it; any further drag/click (hand-picked) drops it, since a moved
 * pin no longer describes the device's actual position.
 */
export function LocationPickerDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (location: SharedLocation) => void;
}) {
  const t = useTranslations("Chat");
  const [staged, setStaged] = useState<MapCoords>(DEFAULT_CENTER);
  const [accuracyMeters, setAccuracyMeters] = useState<number | undefined>(
    undefined,
  );
  const [status, setStatus] = useState<LocateStatus>("idle");
  const [flyTo, setFlyTo] = useState<
    { lat: number; lng: number; zoom?: number; nonce: number } | undefined
  >(undefined);

  // True between triggering a GPS-driven `flyTo` and the map reporting the
  // centre it settled on — that one `onChange` is "the fix", not a hand move.
  const pendingFlyRef = useRef(false);
  const flyNonceRef = useRef(0);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Fresh state every time this mounts: the caller remounts this component
  // (new `key`) on every open, so reopening never carries over a previous
  // pick, a stale GPS fix, or a leftover error message — no reset effect
  // needed here.

  function handleMapChange(coords: MapCoords) {
    setStaged(coords);
    if (pendingFlyRef.current) {
      // This is the `moveend` our own `flyTo` triggered — the pin has not
      // moved since the fix, so the accuracy already staged still applies.
      pendingFlyRef.current = false;
      return;
    }
    // Any other move (drag or click) is a hand pick: the fix no longer
    // describes where the pin is.
    setAccuracyMeters(undefined);
  }

  function useCurrentLocation() {
    if (status === "locating") return;
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unsupported");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!aliveRef.current) return;
        const accuracy = position.coords.accuracy;
        const next = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        pendingFlyRef.current = true;
        setAccuracyMeters(Number.isFinite(accuracy) ? accuracy : undefined);
        setStaged(next);
        setStatus("idle");
        flyNonceRef.current += 1;
        setFlyTo({ ...next, zoom: 16, nonce: flyNonceRef.current });
      },
      (error) => {
        if (!aliveRef.current) return;
        if (error.code === error.PERMISSION_DENIED) setStatus("denied");
        else if (error.code === error.TIMEOUT) setStatus("timeout");
        else setStatus("unavailable");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  }

  function confirm() {
    onConfirm({
      latitude: staged.lat,
      longitude: staged.lng,
      ...(accuracyMeters !== undefined ? { accuracyMeters } : {}),
    });
    onOpenChange(false);
  }

  const statusMessage =
    status === "denied"
      ? t("composer.locationDenied")
      : status === "timeout"
        ? t("composer.locationTimeout")
        : status === "unavailable"
          ? t("composer.locationUnavailable")
          : status === "unsupported"
            ? t("composer.locationUnsupported")
            : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="gap-0 overflow-hidden p-0 sm:max-w-4xl"
      >
        <DialogHeader className="px-4 pt-4 pb-4 pr-12">
          <DialogTitle className="font-bold">
            {t("composer.locationPickerTitle")}
          </DialogTitle>
        </DialogHeader>

        {/* Leaflet panes use z-index 400/800; isolate keeps them inside. */}
        <div className="relative isolate z-0 h-[60vh] min-h-[320px] w-full border-y border-border">
          <LocationMapCanvas
            value={staged}
            onChange={handleMapChange}
            defaultCenter={staged}
            defaultZoom={13}
            flyTo={flyTo}
            className="h-full w-full"
          />

          <div className="pointer-events-none absolute inset-x-0 top-2 z-1000 flex flex-col items-center gap-2 px-3">
            <Button
              type="button"
              onClick={useCurrentLocation}
              disabled={status === "locating"}
              className="pointer-events-auto h-9 cursor-pointer rounded-full bg-background/95 px-4 text-sm font-medium text-foreground shadow-md hover:bg-muted"
            >
              {status === "locating" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LocateFixed className="size-4" />
              )}
              {status === "locating"
                ? t("composer.locationLocating")
                : t("composer.useCurrentLocation")}
            </Button>
            {statusMessage && (
              <p
                role="alert"
                className="pointer-events-auto max-w-[min(92%,24rem)] rounded-md bg-background/95 px-3 py-1.5 text-center text-xs text-destructive shadow-md"
              >
                {statusMessage}
              </p>
            )}
          </div>
        </div>

        <div className="p-4">
          <Button
            type="button"
            className="h-11 w-full cursor-pointer rounded-full bg-[#00a0e9] text-base font-medium text-white hover:bg-[#0090d0]"
            onClick={confirm}
          >
            {t("composer.sendLocation")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

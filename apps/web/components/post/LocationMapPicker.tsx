"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { MapPinned, Minus } from "lucide-react";
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

// Leaflet touches `window` at module scope — keep it client-only.
const LocationMapCanvas = dynamic(
  () => import("@/components/post/LocationMapCanvas"),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
  },
);

/**
 * Location block for the post form, under Location + Address. The strip is a
 * read-only preview; the button opens a Leaflet/OpenStreetMap map where the
 * seller drops a red pin, and the picked coordinates are saved with the post.
 */
export default function LocationMapPicker({
  value,
  onChange,
}: {
  value: MapCoords | null;
  onChange: (value: MapCoords | null) => void;
}) {
  const t = useTranslations("Common");
  const [open, setOpen] = useState(false);
  // Edits are staged until confirmed, so Cancel/X leave the form untouched.
  const [staged, setStaged] = useState<MapCoords | null>(value);

  // The picker opens with the pin already placed — at the saved point, or at the
  // map's centre — so the seller adjusts instead of having to click to start.
  const openDialog = () => {
    setStaged(value ?? DEFAULT_CENTER);
    setOpen(true);
  };

  const confirm = () => {
    if (!staged) return;
    onChange(staged);
    setOpen(false);
  };

  return (
    <>
      <div className="relative isolate z-0 h-36 overflow-hidden rounded-lg border border-gray-200 sm:h-40">
        {/* No pin yet → the design's mock map. With a pin the real map renders
            (isolated: Leaflet panes use z-index 400/800 and would otherwise
            paint straight over the dialog's overlay). */}
        {value ? (
          <div className="pointer-events-none absolute inset-0">
            <LocationMapCanvas
              value={value}
              readOnly
              defaultCenter={value}
              defaultZoom={15}
              className="h-full w-full"
            />
          </div>
        ) : (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: "url('/icon/bg_map.jpg')" }}
            aria-hidden
          />
        )}

        {value ? (
          <>
            {/* Remove the saved pin */}
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label={t("removeLocation")}
              className="absolute right-2 top-2 z-1000 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-[#dc2626] text-white shadow-md transition-colors hover:bg-[#b91c1c]"
            >
              <Minus className="h-4 w-4" strokeWidth={3} />
            </button>
            {/* Reopen the picker */}
            <button
              type="button"
              onClick={openDialog}
              className="absolute inset-x-0 bottom-0 z-1000 cursor-pointer bg-card/90 py-2 text-center type-nav text-card-foreground backdrop-blur-sm transition-colors hover:bg-card"
            >
              {t("changeLocation")}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={openDialog}
            className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center gap-2 rounded-md border border-gray-200 bg-card px-4 py-2.5 type-nav text-card-foreground shadow-md transition-colors hover:bg-muted"
          >
            <MapPinned className="h-4 w-4 text-[#dc2626]" />
            {t("selectLocationOnMap")}
          </button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          className="gap-0 overflow-hidden p-0 sm:max-w-4xl"
        >
          <DialogHeader className="px-4 pt-4 pb-4 pr-12">
            <DialogTitle className="font-bold">
              {t("selectLocationOnMap")}
            </DialogTitle>
          </DialogHeader>

          {/* Leaflet panes use z-index 400/800; isolate keeps them inside. */}
          <div className="relative isolate z-0 h-[68vh] min-h-[420px] w-full border-y border-border">
            <LocationMapCanvas
              value={staged}
              onChange={setStaged}
              defaultCenter={staged ?? DEFAULT_CENTER}
              defaultZoom={staged ? 16 : 12}
              className="h-full w-full"
            />
          </div>

          <div className="p-4">
            <Button
              type="button"
              className="h-11 w-full cursor-pointer rounded-full bg-[#00a0e9] type-nav text-white hover:bg-[#0090d0]"
              disabled={!staged}
              onClick={confirm}
            >
              {t("save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

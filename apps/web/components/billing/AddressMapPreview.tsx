"use client";

import dynamic from "next/dynamic";
import type { MapCoords } from "@/components/post/location-map.constants";

// Leaflet touches `window` at module scope, so the canvas is only ever reached
// through a client-only dynamic import.
const LocationMapCanvas = dynamic(
  () => import("@/components/post/LocationMapCanvas"),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
  },
);

/** Non-interactive map thumbnail for a saved billing address. */
export default function AddressMapPreview({ coords }: { coords: MapCoords }) {
  return (
    <div className="isolate z-0 h-[92px] w-[132px] shrink-0 overflow-hidden rounded-sm border">
      <LocationMapCanvas
        value={coords}
        readOnly
        defaultZoom={14}
        className="h-full w-full"
      />
    </div>
  );
}

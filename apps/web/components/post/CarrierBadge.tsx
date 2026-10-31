import Image from "next/image";
import type { ReactNode } from "react";
import { carrierIconPath } from "@/utils/telecom";

export default function CarrierBadge({
  phone,
  fallback,
  className = "",
}: {
  phone?: string;
  fallback: ReactNode;
  className?: string;
}) {
  const src = phone ? carrierIconPath(phone) : null;
  if (!src) return <>{fallback}</>;
  return (
    <Image
      src={src}
      alt=""
      width={16}
      height={16}
      unoptimized
      // The logo assets are square; a fixed 32px-wide box letterboxed them
      // (object-contain) so the visible logo sat ~8px in from the row edge.
      // Natural width keeps the logo ink flush with the text beside it.
      className={`object-contain h-4 w-auto shrink-0 ${className}`}
    />
  );
}

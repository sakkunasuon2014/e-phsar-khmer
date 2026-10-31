"use client";

import DbImage from "@/components/common/DbImage";
import { cn } from "@/lib/utils";

/** "Sok Dara" → "SD"; a single-word name keeps its first letter. */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/**
 * The one user avatar. The photo is a DB value, so it renders through
 * DbImage: a missing photo, a Storage object that no longer loads, or any
 * non-Storage source degrades to an initials circle on the brand blue — never
 * a broken <img>, and never a generated avatar fetched from a third party.
 *
 * Sizing: pass `size` for a fixed diameter, or omit it and size the circle
 * with `className` (the photo and the initials both fill the circle).
 */
export default function UserAvatar({
  src,
  name,
  size,
  className,
  imgClassName,
}: {
  src?: string | null;
  name?: string | null;
  /** Fixed diameter in px. Omit when the caller sizes with `className`. */
  size?: number;
  /** Classes for the circle: size, ring/border, text size of the initials. */
  className?: string;
  /** Classes for the photo alone. */
  imgClassName?: string;
}) {
  const label = name?.trim() ?? "";
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-[#00a0e9] font-semibold text-white",
        className,
      )}
      style={size ? { width: size, height: size } : undefined}
    >
      <span aria-hidden="true">{initials(label)}</span>
      <DbImage
        src={src ?? ""}
        alt={label}
        fill
        sizes={size ? `${size}px` : undefined}
        className={cn("object-cover", imgClassName)}
      />
    </span>
  );
}

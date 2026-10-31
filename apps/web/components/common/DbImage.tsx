"use client";

import Image, { type ImageProps } from "next/image";
import { useState, type ReactNode } from "react";

/**
 * A Supabase Storage object URL is the ONLY legitimate image source: the DB
 * row holds the reference and the bytes live in the bucket. Local static paths
 * (`/sub-img/…` — files shipped inside the web app) and third-party hosts are
 * not image sources, so they render the fallback exactly like a missing object.
 */
const STORAGE_OBJECT_RE =
  /^https?:\/\/[^/]+\/storage\/v1\/object\/(public|sign)\//;

export const isStorageObjectUrl = (src: string): boolean =>
  STORAGE_OBJECT_RE.test(src);

/** Admin-table stand-in for a DB image with no loadable Storage object. */
export const NoImageCell = () => (
  <span className="type-meta text-muted-foreground">—</span>
);

/**
 * next/image for DB-referenced files. Renders the caller's `fallback`
 * (default: nothing) unless the DB points at a Storage object that actually
 * loads — never a static stand-in, never a broken <img> glyph.
 *
 * `unoptimized` defaults to true: the Storage hostname is not in
 * `next.config` remotePatterns, and next/image validates the hostname even for
 * a plain <img> pass-through — a Storage URL without it throws and takes the
 * whole page to the error boundary.
 */
export default function DbImage({
  fallback = null,
  alt,
  src,
  unoptimized = true,
  ...props
}: ImageProps & { fallback?: ReactNode }) {
  // The failure is remembered per `src`, not as a plain boolean: a boolean
  // latch survives a src change, so an edit dialog that opened on a dead
  // object would keep showing the empty slot after a successful re-upload
  // (the new object never even gets a request). Keyed by src, a new value
  // retries once, while the same failing src stays failed — no retry loop.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const srcKey = typeof src === "string" ? src : null;

  if (
    (srcKey !== null && failedSrc === srcKey) ||
    srcKey === null ||
    !isStorageObjectUrl(srcKey)
  ) {
    return <>{fallback}</>;
  }

  return (
    <Image
      {...props}
      src={srcKey}
      alt={alt}
      unoptimized={unoptimized}
      onError={() => setFailedSrc(srcKey)}
    />
  );
}

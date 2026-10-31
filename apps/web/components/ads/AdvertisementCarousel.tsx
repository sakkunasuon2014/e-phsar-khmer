"use client";

import { useEffect, useState } from "react";
import DbImage from "@/components/common/DbImage";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
// Plain next/link, not `@/i18n/routing`: a banner's target comes from the
// database, so it cannot be checked against the typed route union. next-intl's
// middleware adds the locale prefix for site paths.
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AdvertisementCard } from "@/lib/api/advertisements";

const AUTOPLAY_MS = 5000;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The storefront banner for one placement. Superadmins control the images from
 * `/wanderer/dashboard/advertisements`; a slot with no active banner renders
 * nothing at all (never an empty frame), and an image that no longer loads
 * falls back to nothing rather than a broken glyph (DbImage's rule).
 *
 * Auto-advance stops on hover, on focus inside, and for visitors who asked
 * their system for reduced motion — the dot controls stay usable throughout.
 */
export default function AdvertisementCarousel({
  banners,
  ratio = "aspect-[4/1]",
  className,
  imageClassName,
  priority = false,
}: {
  banners: AdvertisementCard[];
  /** Every storefront slot is 4:1 today; kept as a prop for future slots. */
  ratio?: string;
  className?: string;
  imageClassName?: string;
  priority?: boolean;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => setIndex(api.selectedScrollSnap());
    onSelect();
    api.on("select", onSelect);
    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  useEffect(() => {
    if (!api || banners.length < 2 || paused) return;
    if (prefersReducedMotion()) return;
    const timer = window.setInterval(() => api.scrollNext(), AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [api, banners.length, paused]);

  if (banners.length === 0) return null;

  return (
    <Carousel
      setApi={setApi}
      opts={{ loop: banners.length > 1 }}
      className={cn("relative w-full", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* The shadcn defaults (-ml-4 / pl-4) exist for a gapped multi-slide
          layout; a full-bleed single image needs them cleared. */}
      <CarouselContent className="ml-0">
        {banners.map((banner, i) => {
          const image = (
            <DbImage
              src={banner.imageUrl}
              alt={banner.altText || "Advertisement"}
              fill
              sizes="100vw"
              // Next 16 deprecated `priority` on next/image; `preload` is the
              // replacement and only the first slide is above the fold.
              preload={priority && i === 0}
              className={cn("object-cover", imageClassName)}
            />
          );

          return (
            <CarouselItem key={banner.id} className={cn("pl-0", ratio)}>
              <div className="relative h-full w-full overflow-hidden">
                {banner.linkUrl ? (
                  <BannerLink href={banner.linkUrl}>{image}</BannerLink>
                ) : (
                  image
                )}
              </div>
            </CarouselItem>
          );
        })}
      </CarouselContent>

      {banners.length > 1 && (
        <div className="absolute inset-x-0 bottom-2 z-10 flex justify-center gap-1.5">
          {banners.map((banner, i) => (
            <button
              key={banner.id}
              type="button"
              aria-label={`Show banner ${i + 1}`}
              aria-current={i === index}
              onClick={() => api?.scrollTo(i)}
              className={cn(
                "size-2 rounded-full transition-colors",
                i === index
                  ? "bg-[#00a0e9] ring-2 ring-white/90"
                  : "bg-white/70 ring-1 ring-black/10 hover:bg-white",
              )}
            />
          ))}
        </div>
      )}
    </Carousel>
  );
}

/** Off-site links open in a new tab; site paths stay inside the locale router. */
function BannerLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  if (/^https?:\/\//i.test(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="block h-full w-full"
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className="block h-full w-full">
      {children}
    </Link>
  );
}

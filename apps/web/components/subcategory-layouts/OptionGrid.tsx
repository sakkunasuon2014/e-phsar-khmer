"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import DbImage from "@/components/common/DbImage";

/** Minimal option row (brand/bodyType/model) — local type, web is standalone. */
interface Option {
  slug: string;
  name: string;
  image?: string | null;
}

type Props = {
  options: Option[];
  baseHref: string;
  paramKey: "brand" | "body_type" | "model";
  /** Section heading rendered above the grid (e.g. "Brand", "Body Type"). */
  title?: string;
  /** Declared design: true = the icon-circle grid, whether or not a single row
   *  carries an image yet. Omitted = the bordered text design (models, and any
   *  set the browse page does not declare). */
  imageTiles?: boolean;
};

export default function OptionGrid({
  options,
  baseHref,
  paramKey,
  title,
  imageTiles,
}: Props) {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const LIMIT = paramKey === "model" ? 18 : 20;
  const [showAll, setShowAll] = useState(false);
  const visibleOptions = showAll ? options : options.slice(0, LIMIT);
  const router = useRouter();

  // The design follows the SET, never the load result: an image-bearing set
  // (brands, body types, accessories, job types, type pickers, …) uses the
  // icon-circle design even while an object is missing — a dead image, or a set
  // whose images no admin has uploaded yet, leaves an EMPTY CIRCLE; it never
  // re-styles the tile or the grid.
  //
  // Nothing here is sniffed from the rows. It used to be: "icon tiles when the
  // set is majority image-bearing" read the images as a proxy for the set's
  // design, and since images are never seeded the proxy was wrong nearly
  // everywhere — Phone Accessories (0 of 16 rows) and every Type grid but
  // musical instruments (the shared `other` row is their only image, 1 of N)
  // silently fell to the text design. The caller declares the design instead.
  const textTiles = paramKey === "model" || !imageTiles;

  const handleClick = (e: React.MouseEvent, slug: string) => {
    // Prevent the Link from performing a full navigation
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());

    if (paramKey === "brand") {
      // A brand pick drills INTO the brand (grid steps aside, models appear) —
      // it is not a toggle. The applied brand is shown by the More Filters
      // dialog and the breadcrumb (captain, 2026-10-27).
      params.set("ad_field", slug);
      params.delete("ad_model");
    }

    if (paramKey === "body_type") {
      params.set("ad_type", slug);
    }

    if (paramKey === "model") {
      params.set("ad_model", slug);
    }

    const targetPath = pathname || baseHref;
    // PUSH, not replace: each pick is a navigation step, so Back walks the
    // drill-down back one choice at a time (replace overwrote the subcategory
    // entry, which sent Back straight past it to the category page). The view
    // also resets to the top — a pick changes which grids exist, and keeping
    // the old offset left the remaining grid's heading under the sticky bar.
    router.push(`${targetPath}?${params.toString()}`, { scroll: true });
  };

  return (
    <div className="bg-card rounded px-6 py-4 mb-2">
      {title && <h2 className="type-card-heading mb-4">{title}</h2>}
      <div
        className={
          textTiles
            ? "grid grid-cols-3 md:grid-cols-6 gap-2"
            : "grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-y-6 gap-x-4"
        }
      >
        {visibleOptions.map((opt) => {
          const targetPath = pathname || baseHref;

          const isSelected =
            (paramKey === "model" &&
              searchParams.get("ad_model") === opt.slug) ||
            (paramKey === "brand" &&
              searchParams.get("ad_field") === opt.slug) ||
            (paramKey === "body_type" &&
              searchParams.get("ad_type") === opt.slug);

          return (
            <a
              key={opt.slug}
              href={`${targetPath}?${paramKey === "model" ? "ad_model" : paramKey === "body_type" ? "ad_type" : "ad_field"}=${opt.slug}`}
              onClick={(e) => handleClick(e, opt.slug)}
              className={
                textTiles
                  ? `border py-2 px-1 type-body-sm text-center transition-colors flex items-center justify-center min-h-[40px] ${
                      isSelected
                        ? "text-blue-500 bg-blue-50 border-blue-100 font-medium"
                        : "hover:bg-muted bg-card"
                    }`
                  : `flex flex-col items-center text-center group ${isSelected ? "text-blue-500 font-medium" : ""}`
              }
            >
              {textTiles ? (
                <span>{opt.name}</span>
              ) : (
                <>
                  <div className="w-14 h-14 flex items-center justify-center rounded-full bg-blue-50 group-hover:bg-blue-100">
                    {opt.image ? (
                      <DbImage
                        src={opt.image}
                        alt={opt.name}
                        width={56}
                        height={56}
                        className="object-contain"
                      />
                    ) : null}
                  </div>
                  <span className="type-body-sm mt-2 block">{opt.name}</span>
                </>
              )}
            </a>
          );
        })}
      </div>
      {options.length > LIMIT && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => setShowAll(!showAll)}
            className="w-full border rounded py-2 type-nav bg-muted hover:bg-gray-200"
          >
            {showAll ? t("Common.showLess") : t("Common.showMore")}
          </button>
        </div>
      )}
    </div>
  );
}

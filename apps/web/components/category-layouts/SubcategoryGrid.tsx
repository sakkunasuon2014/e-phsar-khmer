"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import DbImage from "@/components/common/DbImage";

/** Minimal backend subcategory slice this grid renders (local type — web is standalone). */
export interface SubcategoryTile {
  slug: string;
  name: string;
  icon: string | null;
}

type Props = {
  categorySlug: string;
  subcategories: SubcategoryTile[];
  cols: number;
};

/** The design follows the row, not the load result: a subcategory with no
 *  icon value uses this name-in-circle state, while one that has an icon keeps
 *  the icon design — if its object is missing the circle is simply empty.
 *  The circle behind it is a fixed light blue in both themes, so the label
 *  needs a fixed dark colour to stay readable on dark themes. */
const SubcategoryNameFallback = ({ name }: { name: string }) => (
  <span className="type-meta text-zinc-700">{name}</span>
);

/** `cols` is only ever 5|6|7|8 (every entry in `SUBCATEGORY_LAYOUT`,
 *  category/[categorySlug]/page.tsx). Tailwind can't JIT a class built from a
 *  runtime-interpolated number, so every variant must appear literally here. */
const GRID_COLS_CLASS: Record<number, string> = {
  5: "grid-cols-3 sm:grid-cols-4 md:grid-cols-5",
  6: "grid-cols-3 sm:grid-cols-4 md:grid-cols-6",
  7: "grid-cols-3 sm:grid-cols-4 md:grid-cols-7",
  8: "grid-cols-3 sm:grid-cols-4 md:grid-cols-8",
};

export default function SubcategoryGrid({
  categorySlug,
  subcategories,
  cols,
}: Props) {
  const t = useTranslations();
  const LIMIT = 24;
  const searchParams = useSearchParams();
  const [showAll, setShowAll] = useState(false);

  const visibleItems = showAll ? subcategories : subcategories.slice(0, LIMIT);

  return (
    <div className="rounded ">
      <div
        className={`text-center leading-normal grid gap-2 ${GRID_COLS_CLASS[cols] ?? GRID_COLS_CLASS[6]}`}
      >
        {visibleItems.map((sub) => (
          <Link
            key={sub.slug}
            href={{
              pathname: "/category/[categorySlug]/[subcategorySlug]",
              params: {
                categorySlug,
                subcategorySlug: sub.slug,
              },
              query: Object.fromEntries(searchParams.entries()),
            }}
            className="block h-full group bg-card rounded cursor-pointer active:opacity-50 p-3"
          >
            <div className="mx-auto bg-blue-50 rounded-full w-16 h-16 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
              {sub.icon ? (
                <DbImage
                  src={sub.icon}
                  alt={sub.name}
                  width={128}
                  height={128}
                  className="object-contain"
                />
              ) : (
                <SubcategoryNameFallback name={sub.name} />
              )}
            </div>
            <p className="mt-3 type-body-sm truncate w-full block">
              {sub.name}
            </p>
          </Link>
        ))}
      </div>
      {/* SHOW MORE OUTSIDE GRID */}
      {subcategories.length > LIMIT && (
        <div className="flex justify-center mt-2">
          <button
            onClick={() => setShowAll(!showAll)}
            className="w-full border rounded py-2.5 type-nav text-muted-foreground bg-card hover:bg-gray-200"
          >
            {showAll ? t("Common.showLess") : t("Common.showMore")}
          </button>
        </div>
      )}
    </div>
  );
}

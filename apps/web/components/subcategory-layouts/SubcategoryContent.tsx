"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import OptionGrid from "./OptionGrid";

/** Minimal option row shape (web standalone; backend rows mapped at the page boundary). */
export interface OptionRow {
  slug: string;
  name: string;
  image?: string | null;
}

type Props = {
  categorySlug: string;
  subcategorySlug: string;
  /** Brand options — null when the subcategory has no live brands. */
  brands?: OptionRow[] | null;
  /** Models of the selected brand — null unless a brand is selected. */
  models?: OptionRow[] | null;
  /** Linked attribute sets (body types, types, bedrooms, …) — each has a
   *  design title (e.g. "Body Type") and non-empty options. `imageTiles` is the
   *  set's declared design (icon-circle grid); when it is absent the set draws
   *  the bordered text tiles. */
  sets?: {
    slug: string;
    title: string;
    imageTiles?: boolean;
    options: OptionRow[];
  }[];
};

export default function SubcategoryContent({
  categorySlug,
  subcategorySlug,
  brands,
  models,
  sets,
}: Props) {
  const t = useTranslations("Specs");
  const baseHref = `/category/${categorySlug}/${subcategorySlug}`;
  const searchParams = useSearchParams();

  const brandSlug = searchParams.get("ad_field");
  const attrSlug = searchParams.get("ad_type");

  // Force lowercase comparison to avoid "Kia" vs "kia" issues
  const selectedBrand = brands?.find(
    (b) => b.slug.toLowerCase() === brandSlug?.toLowerCase(),
  );

  // A set the user has already applied steps aside for the next choice — the
  // Body Type grid disappears once a body type is picked, leaving Brand (the
  // applied filter is still shown by the bar, the breadcrumb and the feed).
  const pendingSets = sets?.filter(
    (set) => !set.options.some((o) => o.slug === attrSlug),
  );

  return (
    <>
      {/* BRAND GRID: steps aside once a brand is applied — same rule as the
          attribute sets below. A pick drills INTO the brand: the grid is
          replaced by its Model grid (captain, 2026-10-27: "it show get into
          the brand … it should work like bodytype"). The applied brand stays
          visible in the More Filters dialog (Brand select + badge) and in the
          breadcrumb; it is not a toggle on the tile. */}
      {!selectedBrand && !!brands?.length && (
        <OptionGrid
          options={brands}
          baseHref={baseHref}
          paramKey="brand"
          title={t("brand")}
          /* Every brand grid in the mock is icon tiles, so the design is
             declared rather than derived from the rows' `icon` values. */
          imageTiles
        />
      )}

      {/* MODEL GRID: Show when a brand is selected */}
      {selectedBrand && !!models?.length && (
        <OptionGrid
          options={models}
          baseHref={baseHref}
          paramKey="model"
          title={t("model")}
        />
      )}

      {/* ATTRIBUTE GRIDS (Body Type, Type, Bedroom, Accessories, …): each
          linked set renders its own card with the design title; an applied set
          is filtered out above */}
      {pendingSets?.map((set) => (
        <OptionGrid
          key={set.slug}
          options={set.options}
          baseHref={baseHref}
          paramKey="body_type"
          title={set.title}
          imageTiles={set.imageTiles}
        />
      ))}
    </>
  );
}

import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import AdvertisementCarousel from "@/components/ads/AdvertisementCarousel";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
// ─── Header: one component; chip flags come from the maps below ──────────────
import LSPCYEHeader, {
  type LSPCYEHeaderProps,
} from "@/components/subcategory-layouts/LSPYCEHeader";
// ─── Content & posts ─────────────────────────────────────────────────────────
import SubcategoryContent from "@/components/subcategory-layouts/SubcategoryContent";
import type { OptionRow } from "@/components/subcategory-layouts/SubcategoryContent";
import { GridCardSell } from "@/components/ads/GridCardSell";
import { ListCardSell } from "@/components/ads/ListCardSell";
import { Tabs } from "@/components/ui/tabs";
import { FeedResults } from "@/components/search/FeedResults";
import { getAdvertisements } from "@/lib/api/advertisements";
import { feedQueryKey, parseFeedParams } from "@/lib/search-params";
import {
  getBrandsForSubcategory,
  getAttributeOptions,
  getCategoryWithSubcategories,
  getLinkedAttributeOptions,
  getListingsFeed,
  getModelsForBrand,
  getYears,
  toCardPost,
  type ListingsFeedParams,
} from "@/lib/api/categories";
import { TEXT_TILE_SETS_BY_CATEGORY } from "@/lib/attribute-types";
import type { Post } from "@/lib/posts";

// ─── Bar chip flags: the design groups chips per main category; the vehicles
//     family has per-subcategory chip sets. All chips default to true (cars).
type HeaderFlags = Pick<
  LSPCYEHeaderProps,
  "year" | "engine" | "condition" | "price"
>;
const CATEGORY_HEADER_FLAGS: Record<string, HeaderFlags> = {
  "phones-and-tablets": { year: false, engine: false },
  "computers-and-accessories": { year: false, engine: false },
  "electronics-and-appliances": { year: false, engine: false },
  "home-and-land": {
    year: false,
    engine: false,
    condition: false,
    price: false,
  },
  services: { year: false, engine: false, condition: false, price: false },
  jobs: {
    year: false,
    engine: false,
    condition: false,
  },
  "fashion-and-beauty": { year: false, engine: false, condition: false },
  "furniture-and-decor": { year: false, engine: false, condition: false },
  "books-sports-and-hobbies": {
    year: false,
    engine: false,
    condition: false,
  },
  pets: { year: false, engine: false, condition: false },
  foods: { year: false, engine: false, condition: false },
};
const SUBCATEGORY_HEADER_FLAGS: Record<string, HeaderFlags> = {
  "cars-for-sale": {},
  "motorcycles-for-sale": { engine: false },
  bicycles: { year: false, engine: false },
  "vehicles-for-rent": { year: false, engine: false, condition: false },
  "maintenance-and-repair": { year: false, engine: false, condition: false },
  "lorries-vans-and-tractors": {
    year: false,
    engine: false,
    condition: false,
  },
  "financing-and-insurance": { year: false, engine: false, condition: false },
  "tuk-tuk-and-remork": { year: false, engine: false, condition: false },
  "parts-and-accessories": { year: false, engine: false, condition: false },
  "vehicles-others": { year: false, engine: false, condition: false },
};
const DEFAULT_HEADER_FLAGS: HeaderFlags = {
  year: false,
  engine: false,
  condition: false,
};
// ─── Attribute sets rendered as option grids on the browse pages; the rows
//     carry subcategoryIds (UUIDs) — the page filters by the subcategory id. ──
const ATTRIBUTE_SET_TITLES: Record<string, string> = {
  bodytypes: "Specs.attributes.bodyType",
  types: "Specs.attributes.type",
  accessories: "Specs.attributes.accessories",
  networks: "Specs.attributes.network",
  jobtypes: "Specs.attributes.jobType",
  enginetypes: "Specs.attributes.engineType",
  // `vehicletypes` is deliberately absent (2026-09-16): it duplicated
  // `bodytypes`, and Vehicles For Rent rendered both grids with 5 values
  // appearing twice. The duplicate set is retired; rent's grid is Body Type.
  //
  // `colors` is deliberately absent too (2026-09-16). Colour is a FORM-only
  // field by design ("the plain dropdown, no image sets are deliberately left
  // unlinked so they never become browse grids"). That used to be enforced by
  // leaving the rows unlinked — but they had to be scoped to make unticking
  // work in the form, and a linked set whose type is listed here renders a
  // grid. This map is now the control, not the absence of links.
  bedrooms: "Specs.attributes.bedroom",
  bathrooms: "Specs.attributes.bathroom",
  facings: "Specs.attributes.facing",
  experiences: "Specs.attributes.experience",
  rams: "Specs.attributes.ram",
  cpus: "Specs.attributes.cpu",
  storage_phone: "Specs.attributes.storage",
  storage_computer: "Specs.attributes.storage",
  screensize_laptop: "Specs.attributes.screenSize",
  screensize_monitor: "Specs.attributes.screenSize",
  vgas: "Specs.attributes.vga",
};
const ATTRIBUTE_SET_TYPES = Object.keys(ATTRIBUTE_SET_TITLES);

/**
 * Which attribute key a grid's value is stored under.
 *
 * The option-set type is NOT that key: `types` → `type`, `accessories` →
 * `accessory`, `bodytypes` → `bodyType` on cars/lorries **but `vehicleType` on
 * vehicles-for-rent and parts** (the same set, stored under a different key
 * depending on the subcategory's own schema). So each entry lists its
 * candidates in preference order and the first one the subcategory's
 * `field_schema` actually declares wins — the schema is the arbiter, not this
 * table.
 *
 * Getting this wrong is not a no-op: the feed filters a key the listings do
 * not have and returns NOTHING, which is what made every non-car grid — the
 * Type grid above all — empty the feed on click (2026-09-23).
 */
const SET_FIELD_KEYS: Record<string, string[]> = {
  bodytypes: ["bodyType", "vehicleType"],
  types: ["type"],
  accessories: ["accessory"],
  networks: ["network"],
  jobtypes: ["jobType"],
  enginetypes: ["engineType"],
  experiences: ["experience"],
  bedrooms: ["bedroom"],
  bathrooms: ["bathroom"],
  facings: ["facing"],
  rams: ["ram"],
  cpus: ["cpu"],
  vgas: ["vga"],
  storage_phone: ["storage"],
  storage_computer: ["storage"],
  screensize_laptop: ["screenSize"],
  screensize_monitor: ["screenSize"],
};

/** The first candidate key this subcategory's schema declares, if any. */
function resolveAttrKey(
  setType: string,
  schemaKeys: string[],
): string | undefined {
  return (SET_FIELD_KEYS[setType] ?? []).find((k) => schemaKeys.includes(k));
}
// ─── Sets whose DESIGN is the icon-circle grid — the mock draws each of them
//     with icons (Phone Accessories = 10 accessory icons, Fashion Accessories
//     = 7, Body Types, Job Types, carrier Networks, and every Type picker:
//     computer parts, cameras, TVs/audio, fashion, musical instruments,
//     property). The design belongs to the SET, not to the rows: these sets
//     keep the icon grid while no admin has uploaded their images yet, so they
//     render empty circles instead of silently falling back to the text design
//     (captain, 2026-09-10: "if the thing that we have to use image, then use
//     the image design"). Brands are declared at the call site — every brand
//     grid in the mock is icon tiles. ─────────────────────────────────────────
const IMAGE_TILE_SETS = new Set([
  "accessories",
  "bodytypes",
  "jobtypes",
  "networks",
  "types",
]);
// ─── The exception, by MAIN CATEGORY: Furniture & Decor draws its Type grid as
//     bordered TEXT tiles (see `TEXT_TILE_SETS_BY_CATEGORY` in
//     `lib/attribute-types.ts` for the declaration and the reasoning). It lives
//     there rather than here because the post form's pickers obey the same
//     declaration — one design fact, two surfaces, one source. ───────────────
// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function SubcategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ categorySlug: string; subcategorySlug: string }>;
  // ad_field / ad_type / ad_model drive the brand/type/model drill-down; the
  // rest are the shared filter-bar params (lib/search-params.ts).
  searchParams: Promise<
    {
      ad_field?: string;
      ad_type?: string;
      ad_model?: string;
    } & Record<string, string | string[] | undefined>
  >;
}) {
  const { categorySlug, subcategorySlug } = await params;
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations();

  // Single category fetch covers both sides: breadcrumb names + subcategory
  // identity (id/slug/name/icon). The backend localizes names via
  // Accept-Language; an unknown slug is a real 404.
  const category = await getCategoryWithSubcategories(categorySlug, locale);
  const subcategory = category?.subcategories.find(
    (s) => s.slug === subcategorySlug,
  );
  if (!category || !subcategory) {
    notFound();
  }

  // Live option grids for every subcategory with linked data: brands + models
  // (cars, phones/tablets/smart-watches, ...) plus every linked attribute set
  // (body types / types / bedrooms / ...) — the subcategoryIds filter (UUIDs)
  // naturally returns [] for subcategories without links.
  let brands: OptionRow[] | null = null;
  let models: OptionRow[] | null = null;

  const brandRows = await getBrandsForSubcategory(subcategory.slug);
  if (brandRows.length > 0) {
    brands = brandRows.map((b) => ({
      slug: b.slug,
      name: b.name,
      // OptionGrid reads `image`; backend rows carry `icon`
      image: b.icon,
    }));
  }

  // One call returns every attribute row linked to this subcategory (the
  // denormalized subcategoryIds mirror of the admin UI); rows are grouped
  // into per-set grids below.
  const linkedRows = await getLinkedAttributeOptions(subcategory.id);
  const textTileSets = TEXT_TILE_SETS_BY_CATEGORY[category.slug];
  const sets = ATTRIBUTE_SET_TYPES.map((type) => ({
    slug: type,
    title: t(ATTRIBUTE_SET_TITLES[type]),
    // Declared design — never sniffed from the rows (see IMAGE_TILE_SETS).
    imageTiles: IMAGE_TILE_SETS.has(type) && !textTileSets?.has(type),
    options: linkedRows
      .filter((r) => r.type === type)
      .map((r) => ({ slug: r.slug, name: r.name, image: r.image })),
  })).filter((s) => s.options.length > 0);

  // Model grid for the selected brand (per-brand fetch; brands carry no nested models)
  let modelName: string | undefined;
  if (sp.ad_field) {
    const selected = brandRows.find((b) => b.slug === sp.ad_field);
    if (selected) {
      // Scoped to this subcategory — a tablet page must not show iPhone
      // models in its Model grid.
      const modelRows = await getModelsForBrand(selected.id, subcategorySlug);
      if (modelRows.length > 0) {
        models = modelRows.map((m) => ({ slug: m.slug, name: m.name }));
      }
      // The grid/dialog picks a slug; the feed filters on the stored name.
      if (sp.ad_model) {
        modelName = modelRows.find((m) => m.slug === sp.ad_model)?.name;
      }
    }
  }

  const brand = sp.ad_field;
  const adType = sp.ad_type;
  const isFiltered = !!(brand || adType);

  // OptionGrid links carry slugs; the feed filters on the display names the
  // post form stores in `attributes` — map slug → name before fetching.
  const brandName = brand
    ? brandRows.find((b) => b.slug === brand)?.name
    : undefined;

  // A grid click carries only the option's slug, so WHICH attribute it filters
  // has to be resolved here: the set the option belongs to says which key this
  // subcategory's schema writes that value under (see SET_FIELD_KEYS).
  const clickedSet = adType
    ? sets.find((s) => s.options.some((o) => o.slug === adType))
    : undefined;
  const clickedOption = clickedSet?.options.find((o) => o.slug === adType);
  const attrKey = clickedSet
    ? resolveAttrKey(
        clickedSet.slug,
        (subcategory.fieldSchema ?? []).map((f) => f.key),
      )
    : undefined;
  // Unresolvable set → keep the pre-existing `bodyType` path. The status quo
  // beats a second way to silently empty the feed.
  const bodyTypeName =
    !attrKey && adType
      ? sets.flatMap((s) => s.options).find((o) => o.slug === adType)?.name
      : undefined;

  // Real active listings — every subcategory runs the real feed, narrowed by
  // the drill-down (brand/type) and the filter bar's URL params. The dialog's
  // `attrs` object carries every schema-declared attribute; a browse-grid
  // click adds its own key/value on top so both survive a mixed URL.
  const parsedParams = parseFeedParams(sp);
  const attrFilters: Record<string, string> = { ...(parsedParams.attrs ?? {}) };
  if (attrKey && clickedOption?.name) {
    attrFilters[attrKey] = clickedOption.name;
  }
  const feedQuery: ListingsFeedParams = {
    ...parsedParams,
    subcategorySlug,
    brand: brandName,
    model: modelName,
    bodyType: bodyTypeName,
    attrs: Object.keys(attrFilters).length > 0 ? attrFilters : undefined,
  };
  const [feed, banners] = await Promise.all([
    getListingsFeed(feedQuery, locale),
    getAdvertisements("subcategory"),
  ]);
  const feedItems: Post[] = (feed?.items ?? []).map(toCardPost);

  // ── Header component ────────────────────────────────────────────────────────
  const headerFlags =
    SUBCATEGORY_HEADER_FLAGS[subcategory.slug] ??
    CATEGORY_HEADER_FLAGS[category.slug] ??
    DEFAULT_HEADER_FLAGS;
  // Engine + Year chip options are the real `enginetypes` names and the
  // generated `years` set — exactly what the post form offers, never a
  // hardcoded list. Both fetches are independent, so run them together.
  const [engineOptions, yearOptions] = await Promise.all([
    headerFlags.engine !== false
      ? getAttributeOptions("enginetypes").then((rows) =>
          rows.map((row) => row.name),
        )
      : Promise.resolve<string[]>([]),
    headerFlags.year !== false
      ? getYears().then((rows) => rows.map((row) => row.name))
      : Promise.resolve<string[]>([]),
  ]);
  // The mock labels the vehicle price chip "Sale Price" (jobs keeps Salary).
  const priceLabel =
    category.slug === "jobs"
      ? t("Filters.price.salary")
      : category.slug === "cars-and-vehicles"
        ? t("Filters.price.salePrice")
        : undefined;

  // ── Active filter label — display names when available (slug-derived
  //    fallback only: slugs like `honda-moto` would read "honda moto") ───────
  // `clickedOption.name` is the clicked option's display name — the same value
  // the old `bodyTypeName` lookup produced, so the resolved-attrKey path keeps
  // reading "Flat" rather than falling through to the slug-derived "flat".
  const filterLabel =
    brandName ??
    clickedOption?.name ??
    bodyTypeName ??
    (brand ?? adType)?.replace(/-/g, " ") ??
    "";

  return (
    <main className="min-h-screen flex flex-col bg-gray-100">
      {/* ── Top banner ad ─────────────────────────────────────────────────── */}
      {banners.length > 0 && (
        <div className="w-full flex justify-center py-6">
          <div className="w-full max-w-4xl">
            <AdvertisementCarousel banners={banners} priority />
          </div>
        </div>
      )}
      {/* ── Breadcrumb + header ───────────────────────────────────────────── */}
      <div className="px-4 py-2">
        <div className="max-w-7xl mx-auto w-full pb-1">
          <Breadcrumbs
            items={[
              { label: t("Search.home"), href: "/" },
              {
                label: category.name,
                href: {
                  pathname: "/category/[categorySlug]",
                  params: { categorySlug: category.slug },
                },
              },
              ...(isFiltered
                ? [
                    {
                      label: subcategory.name,
                      href: {
                        pathname:
                          "/category/[categorySlug]/[subcategorySlug]" as const,
                        params: {
                          categorySlug: category.slug,
                          subcategorySlug: subcategory.slug,
                        },
                      },
                    },
                    {
                      label: t("Common.inCambodia", { name: filterLabel }),
                      className: "capitalize",
                    },
                  ]
                : [
                    {
                      label: t("Common.inCambodia", {
                        name: subcategory.name,
                      }),
                    },
                  ]),
            ]}
          />
        </div>
      </div>

      {/* The grid/list toggle in the cars-for-sale header drives the two
          TabsContent views below; the header is NOT wrapped in a short div —
          the bar inside it is sticky and needs the tall Tabs root as its
          containing block (same pattern as the category page). */}
      <Tabs defaultValue="grid" className="max-w-7xl mx-auto w-full pb-2">
        {/* Subcategory header */}
        <LSPCYEHeader
          title={subcategory.name}
          {...headerFlags}
          engineOptions={engineOptions}
          yearOptions={yearOptions}
          priceLabel={priceLabel}
        />
        {/* Main listing content (visible in both grid/list views — same as
            SubcategoryGrid on the category page) */}
        <div>
          <SubcategoryContent
            categorySlug={category.slug}
            subcategorySlug={subcategory.slug}
            brands={brands}
            models={models}
            sets={sets}
          />
        </div>
        {/* ── Post sections: grid/list views driven by the bar's toggle ── */}
        <FeedResults
          key={feedQueryKey(feedQuery)}
          initialPosts={feedItems}
          initialCursor={feed?.nextCursor ?? null}
          query={feedQuery}
          locale={locale}
          gridLead={<GridCardSell />}
          listLead={<ListCardSell />}
        />
      </Tabs>
    </main>
  );
}

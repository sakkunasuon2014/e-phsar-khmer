"use server";

import { ApiError, userServerFetch } from "@/lib/api/client";
import {
  type BackendAttributeRow,
  type BackendPlace,
  type BackendBrand,
  type BackendListing,
  type BackendModel,
  getAttributeOptions,
  getBrandsForSubcategory,
  getCommunes,
  getDistricts,
  getProvinces,
  resolvePlaceSelection,
  getBodyTypes,
  getCategoryWithSubcategories,
  getColors,
  getLinkedAttributeOptions,
  getModelsForBrand,
  getYears,
  getAllCategories,
  getListingsFeed,
  toCardPost,
  type ListingsFeedParams,
} from "@/lib/api/categories";
import type { Post } from "@/lib/posts";
import type { ProductSummary } from "@/types/product";
import { getProducts } from "@/lib/api/products";
import { familyForSubcategory } from "@/lib/product-spec-families";
import type { BackendUser } from "@/lib/api/adapters";
import { getCurrentUser } from "@/lib/auth/current-user";
import { formatPhoneLocal } from "@/lib/phone";
import { describeBucket } from "@/lib/subscription-pricing";
import { getMyEntitlements } from "@/actions/subscriptions";
import type { PlanEntitlements } from "@/types/subscription";
import { TEXT_TILE_SETS_BY_CATEGORY } from "@/lib/attribute-types";
import { ALL_ADS_PAGE_SIZE, type AllAdsFilters } from "@/lib/all-ads";

/** Row of `GET /users/me/phones` — only `phone` is read here. */
interface UserPhoneRow {
  phone: string;
}

/**
 * The field keys the form renders as a searchable picker, mapped to the
 * attribute set that may back each one — `null` meaning "no set, the
 * subcategory's own inline `field_schema.options` is the source".
 *
 * The `null` entries are not oversights — they are the spec-fixed plain
 * dropdowns whose values live only in the subcategory's own `field_schema`.
 * None of them has an admin-manageable set behind it (see
 * `lib/attribute-types.ts`), and two are backed by *two* sets at once:
 * `storage` by `storage_phone`/`storage_computer` (phones read 128GB/256GB/…,
 * computers "128GB & Under"/"250GB - 256GB"/…) and `screenSize` by
 * `screensize_laptop`/`screensize_monitor` (10.9" & Under vs 22.9" & Under).
 * A key→set mapping would be wrong for one of each pair, so the schema's own
 * list is authoritative. `ram`, `cpu` and `vga` each map to a single set
 * (`rams`/`cpus`/`vgas`) but are equally unmanageable, so they follow the same
 * rule rather than growing a second mechanism.
 *
 * `type`, `accessory` and `network` DO have admin-managed sets (`types`,
 * `accessories`, `networks`) linked to their subcategories, so those ticks
 * drive the form — including computers-parts-and-accessories, whose 17 type
 * rows are ticked for it.
 */
const PICKER_ATTR_TYPES: Record<string, string | null> = {
  storage: null,
  screenSize: null,
  ram: null,
  cpu: null,
  vga: null,
  type: "types",
  // One key, one set, two families (captain, 2026-09-27: keep them ONE
  // `accessories` set). Phone Accessories and Fashion Accessories both read
  // `accessories`; the per-subcategory ticks decide which rows each sees, and
  // each family's own `field_schema` supplies its own label ("Accessory" vs
  // "Accessory Type"). A `fashion_accessories` split was built and reverted the
  // same day — see the `accessories` block in `attributes.seed.ts` for why.
  accessory: "accessories",
  network: "networks",
  // Home & Land's three property pickers. Each has a seeded set but every one
  // of its rows is unlinked, so `forSub`'s global rule applies and the resolver
  // uses the subcategory's own inline options. Mapped rather than `null` so
  // that linking a row in the admin turns the ticks authoritative, exactly as
  // `type`/`accessory`/`network` behave.
  //
  // The two sources do NOT always agree, which is the whole reason this is a
  // latent hazard rather than a no-op: `bedrooms` and `facings` match their
  // inline lists exactly, but **`bathrooms` does not** — the set carries
  // 1,2,3,4,5,6,More+ while the seed's inline list (and spec-detail-five.md)
  // carries 1,2,3,4,5,More+, because Bedroom has a "6" and Bathroom
  // deliberately does not. So the first admin tick on ANY `bathrooms` row
  // flips the set to managed for every subcategory at once and the picker
  // silently grows a "6"; tick one for a *different* subcategory only and this
  // form's Bathroom renders EMPTY, with no inline fallback — by design, and
  // silent because Bathroom is unstarred. Fixing the set's extra row is a data
  // decision (a seed change alone cannot delete it: `attributes.seed.ts` is
  // insert-only), so it is tracked in tasks/todo.md rather than done here.
  bedroom: "bedrooms",
  bathroom: "bathrooms",
  facing: "facings",
  // The jobs family (2026-09-23). `jobType` is the job-type field's key; the
  // seed originally declared it as `type`, which maps to the admin-managed
  // `types` set — and since no `types` row is ticked for any job subcategory,
  // the resolver returned an EMPTY list for a field the design stars, so the
  // form could not be submitted at all. `jobtypes` is linked to all 36 job
  // subcategories, so its ticks are the truth here, and the three consumers
  // that were already written for it (`SET_FIELD_KEYS.jobtypes`,
  // `ListingSpecs.ATTR_KEYS`, the `jobtypes` admin page) all say `jobType`.
  jobType: "jobtypes",
  // `experiences` is a global picklist — no row of it is linked anywhere, so
  // `forSub`'s global rule applies and the subcategory's own inline options
  // are what render. Mapped rather than `null` for the same reason as the
  // Home & Land keys above: linking a row would turn the ticks authoritative.
  experience: "experiences",
};

/**
 * The logged-in user's contact info, prefilled into the form's contact
 * section (name, up to 3 phones in local format, email if the profile has
 * one). Empty when the seller has no profile data.
 */
export interface ContactPrefill {
  name: string;
  phones: string[];
  email: string | null;
}

/**
 * The signed-in user's saved location, shaped for the post form's cascade.
 * The user row carries ids only, so the names come from the same public
 * geography lookups the settings form resolves through.
 */
export interface LocationPrefill {
  province: BackendPlace | null;
  district: BackendPlace | null;
  commune: BackendPlace | null;
  address: string | null;
}

const EMPTY_LOCATION_PREFILL: LocationPrefill = {
  province: null,
  district: null,
  commune: null,
  address: null,
};

async function getUserProfilePrefill(): Promise<{
  contact: ContactPrefill;
  location: LocationPrefill;
}> {
  const user = await getCurrentUser();
  if (!user)
    return {
      contact: { name: "", phones: [], email: null },
      location: EMPTY_LOCATION_PREFILL,
    };

  const [phonesRes, meRes] = await Promise.all([
    userServerFetch<UserPhoneRow[]>("/users/me/phones").catch(() => null),
    userServerFetch<BackendUser>("/auth/me").catch(() => null),
  ]);
  const me = meRes?.data;

  const name =
    [me?.firstName, me?.lastName].filter(Boolean).join(" ").trim() ||
    user.username ||
    "";

  const phones = (phonesRes?.data ?? []).map((p) => p.phone);
  if (phones.length === 0 && user.primaryPhone) phones.push(user.primaryPhone);

  // Resolves at most two extra lookups, and only for the levels the account
  // actually saved — an empty profile costs nothing.
  const place = me
    ? await resolvePlaceSelection(me.provinceId, me.districtId, me.communeId)
    : EMPTY_LOCATION_PREFILL;

  return {
    contact: {
      name,
      phones: [...new Set(phones)].map(formatPhoneLocal).slice(0, 3),
      email: me?.email ?? null,
    },
    location: {
      province: place.province,
      district: place.district,
      commune: place.commune,
      address: me?.address ?? null,
    },
  };
}

/**
 * Data the listing form needs to render its selects — category and subcategory
 * UUIDs (the create DTO takes IDs, not slugs), which fields the subcategory
 * actually has, plus their option lists. All of it is public backend data and
 * lives here (not in the client) because `API_URL` is only reachable from
 * server context.
 */
export interface ListingFormConfig {
  categoryId: string;
  subcategoryId: string;
  /**
   * The subcategory's own `field_schema` keys — the form renders a block iff
   * its key is here, so Cars For Sale and Bicycles are the same component with
   * a different declared field set.
   */
  fields: string[];
  /**
   * Field labels taken from the subcategory's own `field_schema` (key → label.en).
   * The design names the same field differently per subcategory: the
   * `vehicleType` key prints "Vehicle Type" on Vehicles For Rent but "Type" on
   * Parts & Accessories. Both live in the schema, so the form reads them rather
   * than hardcoding one and being wrong on the other. (`ListingSpecs` on the
   * public listing page already carries a hardcoded override map for exactly
   * this pair — the schema makes that unnecessary.)
   */
  labels: Record<string, string>;
  brands: BackendBrand[];
  /**
   * Published trusted product pages — only fetched when this subcategory
   * declares `productSpec` (the phones form). Drives the required picker and
   * local resolution of pasted product URLs; capped at 200 for v1.
   */
  products: ProductSummary[];
  /**
   * Resolved options for whichever "kind of vehicle" field this subcategory
   * declares — `bodyType` (cars, lorries, motorcycles) or `vehicleType`
   * (Vehicles For Rent, Parts & Accessories). See the resolver in
   * `getListingFormConfig` for why three sources feed it.
   */
  vehicleKinds: {
    name: string;
    nameKm?: string | null;
    image: string | null;
  }[];
  colors: BackendAttributeRow[];
  /**
   * Option lists for the plain-dropdown pickers (`storage`, `accessory`,
   * `network`, …), keyed by the subcategory's own field key. A key is present
   * only when the subcategory declares it — see `PICKER_ATTR_TYPES` for which
   * source wins for each.
   */
  pickLists: Record<
    string,
    { name: string; nameKm?: string | null; image: string | null }[]
  >;
  years: string[];
  /**
   * The subcategory's own photo cap, read from its `photos` field (`max`).
   * Jobs declare 1 (the design's single "Logo" slot); all 146 other
   * subcategories declare 8, so the `?? 8` in the resolver is a safety net
   * rather than a live path. Note this is a UI cap only — the create DTO's
   * `@ArrayMaxSize(8)` is category-agnostic.
   */
  photoMax: number;
  /**
   * The seller's plan allowance, so the form can cap photos and warn before
   * the backend refuses. Null when it could not be read — the backend still
   * enforces, this only keeps the UI honest.
   */
  plan: PlanEntitlements | null;
  /** Province rows for the Location cascade (public lookup). */
  provinces: BackendPlace[];
  contact: ContactPrefill;
  /**
   * The user's saved location, so a new ad starts with Location and Address
   * filled in. The form still applies each block only where the subcategory's
   * schema declares it.
   */
  location: LocationPrefill;
}

export async function getListingFormConfig(
  categorySlug: string,
  subcategorySlug: string,
  locale: string,
): Promise<ListingFormConfig | null> {
  const category = await getCategoryWithSubcategories(categorySlug, locale);
  const sub = category?.subcategories.find((s) => s.slug === subcategorySlug);
  if (!category || !sub) return null;

  const fields = (sub.fieldSchema ?? []).map((f) => f.key);
  const has = (key: string) => fields.includes(key);

  // Option lists are only fetched for the fields this subcategory declares —
  // a bicycle form never asks the cars endpoints for a year or a body type.
  // One fetch per attribute set that this subcategory's pickers might read.
  const pickerTypes = [
    ...new Set(
      Object.entries(PICKER_ATTR_TYPES)
        .filter(([key, type]) => type !== null && has(key))
        .map(([, type]) => type as string),
    ),
  ];

  const [
    brands,
    bodyTypes,
    colors,
    years,
    provinces,
    profile,
    pickerRows,
    products,
  ] = await Promise.all([
    has("brand") ? getBrandsForSubcategory(subcategorySlug) : [],
    has("bodyType") || has("vehicleType") ? getBodyTypes() : [],
    has("color") ? getColors() : [],
    has("year") ? getYears() : [],
    getProvinces(),
    getUserProfilePrefill(),
    Promise.all(pickerTypes.map((t) => getAttributeOptions(t))),
    has("productSpec")
      ? getProducts(
          undefined,
          200,
          familyForSubcategory(subcategorySlug) ?? undefined,
        )
      : [],
  ]);

  /**
   * Scope an option set to this subcategory.
   *
   * `attribute_options` holds two kinds of set, and they need opposite rules:
   *
   *  - **Managed** — at least one row of the type carries `subcategoryIds`. The
   *    ticks are then the whole truth: a subcategory that was not ticked for a
   *    row must NOT see it, so unticking a value really removes it.
   *  - **Global** — no row of the type is linked anywhere (the colours today).
   *    These are plain picklists that were never scoped; filtering them would
   *    empty the field, so the whole list is returned.
   *
   * The previous rule — "if nothing is ticked *for this subcategory*, return
   * everything" — conflated the two and had a nasty edge: unticking the last
   * row of a managed set resurrected the ENTIRE list, so the field grew exactly
   * when it should have emptied. Deciding on the *set* rather than on this
   * subcategory's slice is what makes unticking authoritative.
   */
  const forSub = (rows: BackendAttributeRow[]) =>
    rows.some((r) => r.subcategoryIds.length > 0)
      ? rows.filter((r) => r.subcategoryIds.includes(sub.id))
      : rows;

  /**
   * Resolve each plain-dropdown picker's options. Two sources, in this order:
   *
   *  1. the attribute set mapped in `PICKER_ATTR_TYPES`, scoped by `forSub`.
   *     When that set is *managed*, its ticks are the whole truth — so a
   *     subcategory with no tick against a managed set correctly renders an
   *     EMPTY list, which is the point of the 2026-09-16 untick fix. (An
   *     earlier draft fell back to the inline options here, which would have
   *     resurrected an unticked set — the exact bug that fix removed.)
   *  2. otherwise the subcategory's own inline `field_schema.options` — either
   *     because no set is mapped for the key (`storage`), or because the mapped
   *     set is a global picklist nobody has linked.
   */
  const rowsByType = new Map(
    pickerTypes.map((type, i) => [type, pickerRows[i] ?? []]),
  );
  const pickLists: Record<string, { name: string; image: string | null }[]> =
    {};
  for (const key of Object.keys(PICKER_ATTR_TYPES)) {
    if (!has(key)) continue;
    const type = PICKER_ATTR_TYPES[key];
    const rows = type === null ? [] : (rowsByType.get(type) ?? []);
    // Same managed/global test `forSub` uses — but the *empty* case must not
    // be conflated with the global one: a managed set that this subcategory
    // has no tick against renders EMPTY, it does not fall back to the inline
    // list. Falling back there is precisely the resurrection bug the
    // 2026-09-16 `forSub` fix removed, so it must not reappear here.
    const managed = rows.some((r) => r.subcategoryIds.length > 0);
    const scoped = managed
      ? rows.filter((r) => r.subcategoryIds.includes(sub.id))
      : [];
    const inline =
      (sub.fieldSchema ?? []).find((f) => f.key === key)?.options ?? [];
    // A set its category draws as plain text advertises no image, whatever the
    // rows hold — `SearchPicker` reads an image here as "this picker is the
    // icon design" and would otherwise reserve an empty slot on every row (the
    // shared `types` "other" row's `/sub-img/…` path is enough to do it, and
    // `DbImage` refuses that path, so the slot can never be filled). The
    // declaration is shared with the browse page's text-tile rule.
    const textOnly =
      type !== null &&
      (TEXT_TILE_SETS_BY_CATEGORY[categorySlug]?.has(type) ?? false);
    pickLists[key] = managed
      ? scoped.map((r) => ({
          name: r.name,
          nameKm: r.nameKm ?? null,
          image: textOnly ? null : r.image,
        }))
      : inline.map((name) => ({ name, nameKm: null, image: null }));
  }

  /**
   * Resolve the "kind of vehicle" list. Three sources, in this order:
   *
   *  1. the **linked `bodytypes` rows** — the admin-managed set, and the only
   *     source that responds to ticks in the Body Types page (cars 9, lorries 8,
   *     Vehicles For Rent 20);
   *  2. the subcategory's **own inline `field_schema.options`** when no row is
   *     linked to it. Parts & Accessories needs this: nothing in `bodytypes`
   *     points at it, so without the fallback its Type picker would be EMPTY —
   *     and because that field is required, the form could not be submitted at
   *     all;
   *  3. nothing.
   *
   * The inline copy is deliberately NOT preferred over the attribute set: on
   * Vehicles For Rent it is stale (four rows spelled "…Track" instead of
   * "…Truck") while the attribute rows are correct and admin-editable.
   */
  const kindKey = has("bodyType")
    ? "bodyType"
    : has("vehicleType")
      ? "vehicleType"
      : null;
  const linkedKinds = bodyTypes.filter((r) =>
    r.subcategoryIds.includes(sub.id),
  );
  const inlineKinds =
    (sub.fieldSchema ?? []).find((f) => f.key === kindKey)?.options ?? [];
  const vehicleKinds =
    linkedKinds.length > 0
      ? linkedKinds.map((r) => ({
          name: r.name,
          nameKm: r.nameKm ?? null,
          image: r.image,
        }))
      : inlineKinds.map((name) => ({ name, nameKm: null, image: null }));

  const labels: Record<string, string> = {};
  for (const field of sub.fieldSchema ?? []) {
    const label = field.label?.en;
    if (label) labels[field.key] = label;
  }

  // The photo cap is per-subcategory data, not a constant: the 36 jobs forms
  // declare `max: 1` (the single "Logo" slot) while every other subcategory
  // declares 8.
  const schemaPhotoMax =
    (sub.fieldSchema ?? []).find((f) => f.key === "photos")?.max ?? 8;
  const plan = await getMyEntitlements(sub.id).catch(() => null);
  const photoMax = plan
    ? Math.min(schemaPhotoMax, plan.limits.photos)
    : schemaPhotoMax;

  return {
    categoryId: category.id,
    subcategoryId: sub.id,
    fields,
    labels,
    brands,
    products,
    vehicleKinds,
    colors: forSub(colors),
    pickLists,
    years: years.map((y) => y.name),
    photoMax,
    plan,
    provinces,
    contact: profile.contact,
    location: profile.location,
  };
}

/** Category tree for the header search bar's scope dropdown. */
export interface SearchCategory {
  slug: string;
  name: string;
  icon: string | null;
  subcategories: { slug: string; name: string; icon: string | null }[];
}

export async function getSearchCategories(
  locale: string,
): Promise<SearchCategory[]> {
  const all = (await getAllCategories(locale)) ?? [];
  return all.map((c) => ({
    slug: c.slug,
    name: c.name,
    icon: c.icon,
    subcategories: c.subcategories.map((s) => ({
      slug: s.slug,
      name: s.name,
      icon: s.icon,
    })),
  }));
}

/** Location cascade: all provinces (client-invoked by the filter bar). */
export async function getLocationProvinces(): Promise<BackendPlace[]> {
  return getProvinces();
}

/**
 * Next page of a feed for the "Load more" button. The query is whatever the
 * page parsed from its URL (`parseFeedParams`), so the pages it appends are
 * filtered and sorted exactly like the first one.
 */
export async function loadMoreListings(
  query: ListingsFeedParams,
  cursor: string,
  locale: string,
): Promise<{ posts: Post[]; nextCursor: string | null }> {
  // Counts belong to the first page only; later pages skip those queries.
  const feed = await getListingsFeed(
    { ...query, includeTotal: false, includeFacets: false, cursor },
    locale,
  );
  return {
    posts: (feed?.items ?? []).map(toCardPost),
    nextCursor: feed?.nextCursor ?? null,
  };
}

/** Location cascade: districts of a province (lazy, client-invoked). */
export async function getLocationDistricts(
  provinceSlug: string,
): Promise<BackendPlace[]> {
  return getDistricts(provinceSlug);
}

/** Location cascade: communes of a district (lazy, client-invoked). */
export async function getLocationCommunes(
  provinceSlug: string,
  districtSlug: string,
): Promise<BackendPlace[]> {
  return getCommunes(provinceSlug, districtSlug);
}

/**
 * Models for the chosen brand, scoped to the subcategory being posted in —
 * a passthrough for `getModelsForBrand`. Without the slug, Tablets under Apple
 * would offer iPhones.
 */
export async function getBrandModels(
  brandId: string,
  subcategorySlug: string,
): Promise<BackendModel[]> {
  return getModelsForBrand(brandId, subcategorySlug);
}

/** One subcategory's option lists for the More Filters dialog. */
export interface BrowseFilterOptions {
  /** The subcategory's own field-schema keys — every dialog field is gated on
   *  one of these, so a phone page never offers a Body Type. */
  fields: string[];
  brands: { id: string; slug: string; name: string }[];
  /** The `bodytypes` rows linked to this subcategory; `slug` is the value the
   *  browse grid writes into `ad_type`, so the dialog and the grid agree. */
  bodyTypes: { slug: string; name: string }[];
  colors: string[];
  engineTypes: string[];
  years: string[];
  /**
   * Every other `select` field the subcategory's schema declares (storage,
   * screen size, RAM, CPU, job type, …), with its inline options. These are
   * AND-ed through the feed's `attrs` JSON param; the dialog renders one
   * select per entry, so the fields follow the form instead of a fixed list.
   */
  selects: {
    key: string;
    /** English schema label — the fallback when no `Specs.attributes` key exists. */
    label: string;
    options: { value: string; label: string }[];
  }[];
}

/**
 * Option lists for the More Filters dialog's vehicle fields.
 *
 * Gated by the subcategory's `field_schema`, and sourced exactly like the
 * browse grid / post form so a value picked here always matches what listings
 * actually store: brands from the subcategory's linked set, body types from
 * the same linked `bodytypes` rows the grid renders, colours through the form's
 * managed/global set rule, engine types from `enginetypes`, years from the
 * generated `years` set.
 */
const DEDICATED_FILTER_KEYS = new Set([
  "brand",
  "model",
  "condition",
  "year",
  "taxType",
  "color",
  "transmission",
  "engineType",
  "bodyType",
  "vehicleType",
]);

export async function getBrowseFilterOptions(
  categorySlug: string,
  subcategorySlug: string,
  locale: string,
): Promise<BrowseFilterOptions | null> {
  const category = await getCategoryWithSubcategories(categorySlug, locale);
  const sub = category?.subcategories.find((s) => s.slug === subcategorySlug);
  if (!sub) return null;

  const fields = (sub.fieldSchema ?? []).map((f) => f.key);
  const has = (key: string) => fields.includes(key);
  const wantsBodyType = has("bodyType") || has("vehicleType");

  const [brands, linkedRows, colors, engineRows, years] = await Promise.all([
    has("brand") ? getBrandsForSubcategory(subcategorySlug) : [],
    wantsBodyType ? getLinkedAttributeOptions(sub.id) : [],
    has("color") ? getColors() : [],
    has("engineType") ? getAttributeOptions("enginetypes") : [],
    has("year") ? getYears() : [],
  ]);

  // Colours follow the post form's set rule: a managed set's ticks are the
  // whole truth; a global picklist returns in full (see `forSub`).
  const colorRows = colors.some((r) => r.subcategoryIds.length > 0)
    ? colors.filter((r) => r.subcategoryIds.includes(sub.id))
    : colors;

  return {
    fields,
    brands: brands.map((b) => ({ id: b.id, slug: b.slug, name: b.name })),
    // The grid renders exactly these linked rows, so the dialog's select can
    // never offer a body type the grid cannot also select.
    bodyTypes: linkedRows
      .filter((r) => r.type === "bodytypes")
      .map((r) => ({ slug: r.slug, name: r.name })),
    colors: colorRows.map((r) => r.name),
    engineTypes: engineRows.map((r) => r.name),
    years: years.map((y) => y.name),
    selects: (sub.fieldSchema ?? [])
      // Keys with a dedicated control below are excluded here so the dialog
      // cannot render the same dimension twice.
      .filter(
        (f) =>
          f.type === "select" &&
          !DEDICATED_FILTER_KEYS.has(f.key) &&
          (f.options?.length ?? 0) > 0,
      )
      .map((f) => ({
        key: f.key,
        label: f.label?.en ?? f.key,
        options: (f.options ?? []).map((o) => ({ value: o, label: o })),
      })),
  };
}

export interface AllAdsBatch {
  items: Post[];
  nextCursor: string | null;
}

/**
 * One more screen of the All Ads feed — the page server-renders the first
 * batch and the grid asks for the rest as the visitor reaches the bottom.
 * `cursor` is the previous batch's `nextCursor`, and a null `nextCursor` back
 * means the feed is finished (an unreachable backend reads the same way to the
 * grid: stop asking).
 */
export async function getAllAdsBatch(
  filters: AllAdsFilters,
  cursor: string | undefined,
  locale: string,
): Promise<AllAdsBatch> {
  const feed = await getListingsFeed(
    { ...filters, cursor, limit: ALL_ADS_PAGE_SIZE },
    locale,
  );
  return {
    items: (feed?.items ?? []).map(toCardPost),
    nextCursor: feed?.nextCursor ?? null,
  };
}

/**
 * One more screen of a *seller's* feed — the public profile renders the first
 * batch server-side and this appends the rest as the visitor reaches the
 * bottom, and it is also what the drill-down calls to swap the grid when a
 * category or subcategory is picked (no navigation, no remount).
 *
 * Same contract as `getAllAdsBatch`; the seller is the scope, and the two
 * slugs are the drill levels. The backend feed is active-only, so a draft of
 * theirs can never surface here.
 */
export async function getSellerAdsBatch(
  params: { userId: string; categorySlug?: string; subcategorySlug?: string },
  cursor: string | undefined,
  locale: string,
): Promise<AllAdsBatch> {
  const feed = await getListingsFeed(
    { ...params, cursor, limit: ALL_ADS_PAGE_SIZE },
    locale,
  );
  return {
    items: (feed?.items ?? []).map(toCardPost),
    nextCursor: feed?.nextCursor ?? null,
  };
}

/**
 * Mirrors the backend `CreateListingDto` exactly — the web app is standalone,
 * so no backend DTO import; the validation pipe whitelists + forbids stray
 * keys, so the client must never send anything beyond these fields.
 */
export interface CreateListingPayload {
  categoryId: string;
  subcategoryId: string;
  title: string;
  description?: string;
  price?: number;
  discountValue?: number;
  discountType?: "percent" | "amount";
  condition?: "new" | "used";
  photos?: { url: string; path: string; sort: number }[];
  attributes?: Record<string, unknown>;
  location?: string;
  address?: string;
  provinceId?: string;
  districtId?: string;
  communeId?: string;
  /** Trusted spec page (a `models` id) — required by the phones form. */
  productModelId?: string;
  latitude?: number;
  longitude?: number;
  deliveryFree?: boolean;
  contactName?: string;
  contactPhones?: string[];
  contactEmail?: string;
}

export type CreateListingResult =
  | { success: true; listingId: string }
  | { success: false; error: string };

/**
 * Creates the listing (the backend stores it as a draft) then immediately
 * publishes it — the feed only shows `active`. The web has no draft surface,
 * so a refused publish rolls the created ad back instead of leaving an
 * orphaned row nobody can see; both a create and a publish failure are hard
 * errors shown on the form.
 */
export async function createListing(
  payload: CreateListingPayload,
): Promise<CreateListingResult> {
  // Fast path: refuse up front when the plan has no room, so the common
  // over-limit case never creates a row at all.
  // Limits are the free/group pool plus the posting scope's cap, so ask for
  // the subcategory this ad lands in.
  const plan = await getMyEntitlements(payload.subcategoryId).catch(() => null);
  if (plan && plan.usage.ads >= plan.limits.ads) {
    const bucketCopy = describeBucket(plan.bucket);
    return {
      success: false,
      error: `Your ${bucketCopy.planLabel} allows ${plan.limits.ads} active ads ${bucketCopy.scopeLabel} and you have ${plan.usage.ads}. ${bucketCopy.ctaLabel} or remove an ad to post another.`,
    };
  }

  try {
    const { data } = await userServerFetch<BackendListing>("/listings", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    try {
      await userServerFetch(`/listings/${data.id}/publish`, {
        method: "POST",
      });
    } catch (err) {
      // Nothing in the app lists drafts, so an unpublished ad would vanish
      // for its owner. Roll it back and surface the backend's own reason.
      await userServerFetch(`/listings/${data.id}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      return {
        success: false,
        error:
          err instanceof ApiError
            ? err.message
            : "Your ad could not be published. Please try again.",
      };
    }
    return { success: true, listingId: data.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof ApiError ? err.message : "Failed to create listing",
    };
  }
}

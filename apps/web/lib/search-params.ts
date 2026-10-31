/**
 * The one URL vocabulary shared by every listing feed page (search, category,
 * subcategory, all-ads) and the filter bar — and the ONLY place URL params
 * become backend `GET /listings` params (`parseFeedParams`).
 *
 * Plain module on purpose (no "use client"): server pages must be able to read
 * these constants as values, which a client-module export would not give them.
 */

export const Q_PARAM = "q";
export const CATEGORY_PARAM = "category";
export const SUB_PARAM = "sub";
export const LOCATION_PRO_PARAM = "loc_pro";
export const LOCATION_DIS_PARAM = "loc_dis";
export const LOCATION_COM_PARAM = "loc_com";
export const MIN_AD_PRICE_PARAM = "min_ad_price";
export const MAX_AD_PRICE_PARAM = "max_ad_price";
export const CONDITION_PARAM = "condition";
export const DATE_PARAM = "date";
export const DELIVERY_PARAM = "delivery";
export const DISCOUNT_PARAM = "discount";
export const SORT_PARAM = "sort";
export const YEAR_MIN_PARAM = "year_min";
export const YEAR_MAX_PARAM = "year_max";
export const ENGINE_PARAM = "engine";
/** The browse dialog's remaining attribute filters (display names, verbatim). */
export const TAX_TYPE_PARAM = "tax_type";
export const COLOR_PARAM = "color";
export const TRANSMISSION_PARAM = "transmission";
/** The multi-attribute filter — a JSON object of `{ attributeKey: value }`.
 *  The More Filters dialog writes every schema-declared select here, and a
 *  detail spec link writes a one-entry object, so one vocabulary serves both. */
export const ATTRS_PARAM = "attrs";

/** The browse grids' own drill-down params (brand/model/type), NOT filter-bar
 *  params: they live on the same URLs and the More Filters dialog edits them,
 *  but "Clear filters" on /search leaves them alone. */
export const AD_FIELD_PARAM = "ad_field";
export const AD_MODEL_PARAM = "ad_model";
export const AD_TYPE_PARAM = "ad_type";

/** Everything the filter bar owns — "Clear all" removes exactly these. */
export const FILTER_PARAMS = [
  Q_PARAM,
  LOCATION_PRO_PARAM,
  LOCATION_DIS_PARAM,
  LOCATION_COM_PARAM,
  MIN_AD_PRICE_PARAM,
  MAX_AD_PRICE_PARAM,
  CONDITION_PARAM,
  DATE_PARAM,
  DELIVERY_PARAM,
  DISCOUNT_PARAM,
  SORT_PARAM,
  YEAR_MIN_PARAM,
  YEAR_MAX_PARAM,
  ENGINE_PARAM,
  TAX_TYPE_PARAM,
  COLOR_PARAM,
  TRANSMISSION_PARAM,
  ATTRS_PARAM,
] as const;

export const MAX_QUERY_LENGTH = 100;

// "Most Hit" is hidden until listing views are counted (nothing increments
// views_count yet), and "New Ads" was a duplicate of "Latest Ads".
// "Best match" only exists while there is a keyword — and is then the default.
export const SORT_OPTIONS = [
  {
    value: "best-match",
    labelKey: "Filters.sort.bestMatch",
    backend: "relevance",
  },
  {
    value: "latest-ads",
    labelKey: "Filters.sort.latestAds",
    backend: "newest",
  },
  {
    value: "price-asc",
    labelKey: "Filters.sort.priceLowToHigh",
    backend: "price_asc",
  },
  {
    value: "price-desc",
    labelKey: "Filters.sort.priceHighToLow",
    backend: "price_desc",
  },
] as const;
export type SortValue = (typeof SORT_OPTIONS)[number]["value"];
export type BackendSort = (typeof SORT_OPTIONS)[number]["backend"];

/** The sort an absent `sort` param means: best match with a keyword, else newest. */
export function defaultSortFor(hasQuery: boolean): SortValue {
  return hasQuery ? "best-match" : "latest-ads";
}

/** The options to offer — "Best match" needs a keyword to rank against. */
export function sortOptionsFor(hasQuery: boolean) {
  return SORT_OPTIONS.filter((o) => hasQuery || o.value !== "best-match");
}

/**
 * Unknown or retired values (`new-ads`, `most-hit`), and "best-match" without
 * a keyword, fall back to the default for the current keyword state.
 */
export function parseSortParam(
  value: string | null | undefined,
  hasQuery: boolean,
): SortValue {
  return (
    sortOptionsFor(hasQuery).find((o) => o.value === value)?.value ??
    defaultSortFor(hasQuery)
  );
}

/** Whether the URL currently has a (non-blank) keyword. */
export function hasQueryParam(params: URLSearchParams): boolean {
  return normalizeQuery(params.get(Q_PARAM)) !== "";
}

export const DATE_OPTIONS = [
  { value: "", labelKey: "Filters.date.allTime" },
  { value: "today", labelKey: "Filters.date.today" },
  { value: "week", labelKey: "Filters.date.thisWeek" },
  { value: "month", labelKey: "Filters.date.thisMonth" },
] as const;
export type DateValue = (typeof DATE_OPTIONS)[number]["value"];

export const CONDITION_OPTIONS = [
  { value: "new", labelKey: "Common.condition.new" },
  { value: "used", labelKey: "Common.condition.used" },
] as const;
export type ConditionValue = (typeof CONDITION_OPTIONS)[number]["value"];

/**
 * Stored engine values → the `PostForm.options.*` label keys.
 *
 * The URL/feed keep the English value the post form wrote; only the label is
 * localized, so /km reads សាំង, ម៉ាស៊ូត, … while filtering still works. Shared
 * by the bar's Engine chip and the More Filters dialog.
 */
export const ENGINE_LABEL_KEYS: Record<string, string> = {
  Diesel: "diesel",
  Electric: "electric",
  Hybrid: "hybrid",
  LPG: "lpg",
  Petrol: "petrol",
};

/** Backend `GET /listings` filter params (see QueryListingsDto). */
export interface FeedQuery {
  q?: string;
  categorySlug?: string;
  subcategorySlug?: string;
  provinceSlug?: string;
  districtSlug?: string;
  communeSlug?: string;
  minPrice?: number;
  maxPrice?: number;
  condition?: ConditionValue;
  postedWithin?: Exclude<DateValue, "">;
  deliveryFree?: boolean;
  hasDiscount?: boolean;
  yearMin?: number;
  yearMax?: number;
  engineType?: string;
  /** The More Filters dialog's attribute filters — display names, verbatim.
   *  `model` is resolved by the page from the `ad_model` slug (the brands API
   *  is the only place a model id/name pair exists). */
  model?: string;
  taxType?: string;
  color?: string;
  transmission?: string;
  /** Multi-attribute filter (detail spec links + More Filters selects). */
  attrs?: Record<string, string>;
  sort?: BackendSort;
}

type RawParams =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function reader(raw: RawParams) {
  return (key: string): string | undefined => {
    const v = raw instanceof URLSearchParams ? raw.get(key) : raw[key];
    const s = Array.isArray(v) ? v[0] : v;
    return s ?? undefined;
  };
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ATTR_KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,39}$/;
const MAX_ATTR_FILTERS = 12;

/**
 * Parse the `attrs` JSON param, mirroring the backend's validation. Exported
 * because the More Filters dialog seeds its schema selects from the URL.
 * Malformed/oversized input returns undefined — the feed then applies no
 * attribute filter, the same "applies nothing" rule as a half `attrKey`.
 */
export function parseAttrsParam(
  raw: string | null | undefined,
): Record<string, string> | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_ATTR_FILTERS) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!ATTR_KEY_RE.test(key)) continue;
    if (typeof value !== "string" && typeof value !== "number") continue;
    const text = String(value).trim();
    if (!text || text.length > 120) continue;
    out[key] = text;
  }
  return Object.keys(out).length ? out : undefined;
}
const slug = (v: string | undefined) =>
  v && v.length <= 100 && SLUG_RE.test(v) ? v : undefined;

function price(v: string | undefined): number | undefined {
  if (!v?.trim()) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function year(v: string | undefined): number | undefined {
  if (!v || !/^\d{4}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= 1900 && n <= 2100 ? n : undefined;
}

export function normalizeQuery(v: string | undefined | null): string {
  return (v ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH);
}

/**
 * URL → backend feed params. Garbage is dropped rather than sent (an unknown
 * sort, a non-slug, a negative price), an inverted price range is swapped
 * (the backend would 400 it), and a district/commune without its parent is
 * dropped the same way the backend ignores it.
 *
 * `category`/`sub` are read only when `withCategory` is set — the category and
 * subcategory pages take those from the path instead.
 */
export function parseFeedParams(
  raw: RawParams,
  { withCategory = false }: { withCategory?: boolean } = {},
): FeedQuery {
  const get = reader(raw);
  const out: FeedQuery = {};

  const q = normalizeQuery(get(Q_PARAM));
  if (q) out.q = q;

  if (withCategory) {
    out.categorySlug = slug(get(CATEGORY_PARAM));
    out.subcategorySlug = slug(get(SUB_PARAM));
  }

  const pro = slug(get(LOCATION_PRO_PARAM));
  const dis = pro ? slug(get(LOCATION_DIS_PARAM)) : undefined;
  const com = dis ? slug(get(LOCATION_COM_PARAM)) : undefined;
  if (pro) out.provinceSlug = pro;
  if (dis) out.districtSlug = dis;
  if (com) out.communeSlug = com;

  let min = price(get(MIN_AD_PRICE_PARAM));
  let max = price(get(MAX_AD_PRICE_PARAM));
  if (min !== undefined && max !== undefined && min > max) {
    [min, max] = [max, min];
  }
  if (min !== undefined) out.minPrice = min;
  if (max !== undefined) out.maxPrice = max;

  const condition = CONDITION_OPTIONS.find(
    (o) => o.value === get(CONDITION_PARAM),
  )?.value;
  if (condition) out.condition = condition;

  const date = get(DATE_PARAM);
  if (date === "today" || date === "week" || date === "month") {
    out.postedWithin = date;
  }

  if (get(DELIVERY_PARAM) === "1") out.deliveryFree = true;
  if (get(DISCOUNT_PARAM) === "1") out.hasDiscount = true;

  let yearMin = year(get(YEAR_MIN_PARAM));
  let yearMax = year(get(YEAR_MAX_PARAM));
  if (yearMin !== undefined && yearMax !== undefined && yearMin > yearMax) {
    [yearMin, yearMax] = [yearMax, yearMin];
  }
  if (yearMin !== undefined) out.yearMin = yearMin;
  if (yearMax !== undefined) out.yearMax = yearMax;

  const engine = get(ENGINE_PARAM)?.trim();
  if (engine && engine.length <= 60) out.engineType = engine;

  // The browse dialog's attribute filters carry display names verbatim (the
  // values the post form wrote into `attributes`), so only trim + bound them.
  const taxType = get(TAX_TYPE_PARAM)?.trim();
  if (taxType && taxType.length <= 120) out.taxType = taxType;
  const color = get(COLOR_PARAM)?.trim();
  if (color && color.length <= 120) out.color = color;
  const transmission = get(TRANSMISSION_PARAM)?.trim();
  if (transmission && transmission.length <= 120) {
    out.transmission = transmission;
  }

  // Multi-attribute filter (the detail specs grid and the More Filters
  // selects): a JSON object of { attributeKey: value }. Malformed input
  // applies nothing, matching the backend.
  const attrs = parseAttrsParam(get(ATTRS_PARAM));
  if (attrs) out.attrs = attrs;

  const sort = SORT_OPTIONS.find(
    (o) => o.value === parseSortParam(get(SORT_PARAM), !!out.q),
  )!.backend;
  if (sort !== "newest") out.sort = sort;

  for (const k of Object.keys(out) as (keyof FeedQuery)[]) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

/** Stable string for a query — keys a load-more island so it resets on change. */
export function feedQueryKey(query: object): string {
  return JSON.stringify(
    Object.entries(query)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

/**
 * The current params as a plain query object with `changes` applied (`null`
 * removes a key) — for `<Link href={{ pathname, query }}>`, which the typed
 * next-intl pathnames require instead of a raw `?…` string.
 */
export function queryWith(
  current: RawParams,
  changes: Record<string, string | null>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const entries =
    current instanceof URLSearchParams
      ? Array.from(current.entries())
      : Object.entries(current).flatMap(([k, v]) =>
          v === undefined ? [] : [[k, Array.isArray(v) ? v[0] : v] as const],
        );
  for (const [k, v] of entries) if (v !== undefined) out[k] = v;
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) delete out[k];
    else out[k] = v;
  }
  return out;
}

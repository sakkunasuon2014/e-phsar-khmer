# Listing-detail spec values as working feed filters — Implementation Plan

> **Superseded in part (2026-10-31):** the single `attr_key`/`attr_value` pair became one
> multi-attribute `attrs` JSON param on the backend (`GET /listings?attrs={"storage":"128GB"}`)
> when More Filters became schema-driven for every family — laptops carry five generic attributes
> at once. Read every `attr_key`/`attr_value` below as that `attrs` object; the dedicated params,
> brand/model links, raw-English-value rule, and the verification set are unchanged.

**Goal:** Every value in the listing-detail **Description** grid becomes a working filter: clicking it opens the listing's subcategory feed narrowed by that value. Today every non-brand/model value is a link to the unfiltered subcategory page, so the click "does nothing" — the captain's report.

**Architecture:** The detail link gets its query from the value's own attribute key. Dimensions the filter bar already owns use the shared URL vocabulary (`condition`, `year_min`/`year_max`, `tax_type`, `engine`, `color`, `transmission`); every other attribute key uses the backend feed's existing generic `attrKey`/`attrValue` pair, exposed to the web as two new URL params. The backend already supports all of these; only the web vocabulary and the detail links change. Values are always the stored English attribute values, never the localized display labels, so `/km` links still match.

**Tech Stack:** Next.js 16 App Router, next-intl typed links, the shared `lib/search-params.ts` vocabulary; NestJS feed untouched.

## Root cause (verified against code and the live dev stack)

- `apps/web/components/post/ListingSpecs.tsx:264-274` builds every attribute row with `href: browseHref` — the subcategory page **with no query**. Only Brand/Model add `ad_field`/`ad_model` (`:190-226`).
- The URL vocabulary (`apps/web/lib/search-params.ts:215`) maps `condition`, `year_min`/`year_max`, `engine`, `tax_type`, `color`, `transmission`, but has no generic attribute pair; `FeedQuery` (`:148`) has no `attrKey`/`attrValue`.
- The subcategory page already resolves `ad_field` (brand slug → name), `ad_model` (model slug → name) and `ad_type` (browse option slug → key/name), then adds `attrKey`/`attrValue` to the feed (`apps/web/app/[locale]/(user)/category/[categorySlug]/[subcategorySlug]/page.tsx:246-304`).
- The backend feed already filters by `attrKey`+`attrValue` (validated key, display-name equality in `attributes` JSONB).

Live checks (car listing BYD Atto 2, `cars-for-sale`): unfiltered 5; `yearMin=2026&yearMax=2026` → 2; `condition=new` → 3; `engineType=Electric` → 1; `color=White` → 1; `attrKey=bodyType&attrValue=SUV` → 1. The backend works; the links do not.

## Parameter map

| Spec row                                                                                                                                                                                       | URL params                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------ |
| Brand                                                                                                                                                                                          | `ad_field=<brand slug>` (existing; best-effort slug)     |
| Model                                                                                                                                                                                          | `ad_field=<brand slug>&ad_model=<model slug>` (existing) |
| Main/Category                                                                                                                                                                                  | no filter (path only)                                    |
| Year                                                                                                                                                                                           | `year_min=<v>&year_max=<v>` (exact year)                 |
| Condition                                                                                                                                                                                      | `condition=<new                                          | used>` |
| Tax type                                                                                                                                                                                       | `tax_type=<stored value>`                                |
| Engine type                                                                                                                                                                                    | `engine=<stored value>`                                  |
| Color                                                                                                                                                                                          | `color=<stored value>`                                   |
| Transmission                                                                                                                                                                                   | `transmission=<stored value>`                            |
| Everything else (`bodyType`, `vehicleType`, `type`, `accessory`, `jobType`, `experience`, `bedroom`, `bathroom`, `facing`, `size`, `screenSize`, `storage`, `ram`, `cpu`, `vga`, `network`, …) | `attr_key=<schema key>&attr_value=<stored value>`        |

Decisions:

- **Generic pair, not `ad_type` slugs.** `ad_type` resolves a slug against the page's option grids and guesses the key from the set; the same slug can appear in two sets, and values that are not option rows (`size`, `year`) have no slug. The generic pair carries the exact key the listing stores and works for every family. Trade-off: the browse grid does not highlight the value and the More Filters dialog shows no chip — the feed is narrowed correctly and "Clear all" removes the pair (added to `FILTER_PARAMS`).
- **Raw attribute value for the link, display label for the text.** `/km` renders `សាំង`/`ស` etc.; the URL must carry `Petrol`/`White` so the feed matches.
- **The condition row is a column, not an attribute** — its own `condition` param.
- **Brand/Model keep `ad_field`/`ad_model`** so the brand grid/selection still shows; the slugify mismatch noted in CLAUDE.md stays a known gap, but the plan verifies the two live car brands.
- **No backend change**: the feed already accepts every param.

## Tasks

### Task 1 — URL vocabulary: generic attribute pair

**Files:** `apps/web/lib/search-params.ts`

- Add `ATTR_KEY_PARAM = "attr_key"` and `ATTR_VALUE_PARAM = "attr_value"`.
- Add `attrKey?: string; attrValue?: string;` to `FeedQuery`.
- In `parseFeedParams`, read both only as a pair (half a pair is ignored, mirroring the backend), validate the key as a plain identifier (`/^[A-Za-z][A-Za-z0-9]*$/`, max 60) and the value as trimmed non-empty ≤ 120 chars.
- Add both names to `FILTER_PARAMS` so "Clear all"/"Clear filters" removes them.

Verify: `pnpm --filter web lint`, `pnpm --filter web build`.

### Task 2 — Page merge: do not clobber a URL-provided attribute pair

**Files:** `apps/web/app/[locale]/(user)/category/[categorySlug]/[subcategorySlug]/page.tsx`

- Parse once: `const parsed = parseFeedParams(sp)`.
- Build `feedQuery` as `{ ...parsed, ... }` but set `attrKey: adTypeKey ?? parsed.attrKey` and `attrValue: adTypeKey ? clickedOption?.name : parsed.attrValue`, where `adTypeKey` is today's `ad_type`-derived key. An explicit detail link must survive the spread; a grid click still wins when both are present.
- Include the generic pair in `isFiltered` so the header/breadcrumb behaves like any other filter.

Verify: a car detail link with `attr_key=bodyType&attr_value=SUV` narrows the feed; a grid click still works.

### Task 3 — Detail spec rows carry the filter query

**Files:** `apps/web/components/post/ListingSpecs.tsx`

- Add a `filterQueryFor(key, value)` helper returning the map above (dedicated params first, generic pair otherwise).
- `browseHref` stays the path; each attribute row gets `query: filterQueryFor(key, value)` using the **raw** `value`, not `displayValue`.
- Condition row gets `query: { condition }`.
- Brand/Model keep their existing `ad_field`/`ad_model` query.
- Main/Category rows stay unfiltered.

Verify: `pnpm --filter web lint`, `pnpm --filter web build`.

### Task 4 — Browser + API verification across categories

Use `chrome-devtools-axi` against the dev stack (it launches its own Chromium) on real detail pages.

- **Cars (BYD Atto 2, `cars-for-sale`)**: click Year, Tax Type, Condition, Body Type, Engine, Color, Transmission one at a time; assert the URL carries the expected params and the result count changes to the API-verified values (year 2, condition-new 3, engine-electric 1, color-white 1, bodyType-SUV 1).
- **One listing each in** phones (`storage`, `screenSize`, `network`, `condition`), computers (`ram`, `cpu`, `vga`), jobs (`jobType`, `experience`), Home & Land (`bedroom`, `bathroom`, `facing`, `size`, `type`), fashion (`accessory`), Books/Sports (`type` on musical instruments): capture each listing's attribute values from `GET /listings/:id`, click each spec link, and assert the URL uses `attr_key`/`attr_value` (or the dedicated param) and the feed returns ≥1 result including the source listing.
- **`/km`**: click a car spec value whose label is Khmer and assert the URL carries the English stored value and the feed still narrows.
- **Brand/Model**: click both on the BYD page; assert the brand grid/selection appears and the feed is narrowed.
- **Clear all**: with a generic filter applied, open More Filters → Clear all; assert `attr_key`/`attr_value` leave the URL and the feed returns to the unfiltered count.

### Task 5 — Docs

- Append the ship entry to `tasks/todo.md` (root cause, params map, verification evidence).
- Add the `CHANGELOG.md` **Unreleased → Fixed** bullet.
- Note in **Known gaps** (CLAUDE.md is edited by bash/python only — never Edit/prettier): generic-attribute filters have no filter-bar chip and no browse-grid selection; the value filters the feed and Clear-all removes it.

## Risks / open

- **No chip for generic attributes.** The feed is correct; the More Filters dialog does not show `attr_key`/`attr_value`, so a visitor sees a narrowed feed without an obvious cause. If the captain wants parity, the next step is an "Other filters" chip + label map for the ~16 attribute keys.
- **Brand/Model slugs are best-effort** (`slugify(name)`); a brand whose API slug differs silently skips the brand filter. The plan verifies the live seeded brands; a mismatch would be fixed by resolving the real slug in `buildRealDetailData` (one extra API call).
- **`ad_type` and the generic pair are two vocabularies for attributes.** A later cleanup could migrate the browse-grid click to the generic pair once every grid option carries its schema key; not this ship.
- **`tax_type`/`transmission` can match every listing** in a family (all cars are Tax Paper/Auto) — the filter is still applied; the count just does not change. The browser test must assert the URL, not only the count, for those two.

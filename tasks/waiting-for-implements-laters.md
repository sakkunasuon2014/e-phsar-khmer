# Waiting for implementation (later)

Deferred work — seen and deliberately parked, not forgotten. Do NOT start these
unprompted; pick one up when asked. Each entry carries enough context to act
without re-deriving it. (The wider backlog lives in CLAUDE.md → "Known gaps".)

## 1. Unify the filter chips with the grid picks (Back undoes one filter at a time)

Captain, 2026-09-10: "unify the filter chips too" — recorded, not implemented.

Context: the grid picks (brand / body type / model in
`components/subcategory-layouts/OptionGrid.tsx`) now use `router.push`, so Back
walks the drill-down one choice at a time:
`?ad_type=sedan&ad_field=mg` → Back → `?ad_type=sedan` → Back → `cars-for-sale`.
The four shared chip filters still call `router.replace`, which rewrites the
current history entry instead of adding one — so filtering by Sedan and then
changing Price means a single Back loses both.

The change — `router.replace(...)` → `router.push(...)`, keeping each call's
existing `{ scroll: false }` (chips must not jump the viewport; scroll-to-top is
deliberate for the grid picks only, which change which grids exist):

- `components/filter/LocationSelectorFilter.tsx:117`
- `components/filter/SortFilter.tsx:59`
- `components/filter/PriceFilter.tsx:72`
- `components/filter/MoreFilters.tsx:211` (apply) and `:234` (clear all)

(Line numbers re-checked 2026-10-24; all five calls are still `router.replace`.)

Verify (headless CDP recipe in CLAUDE.md → "Web (Next.js)"): from a subcategory,
pick a Location / Sort / Price value, then `history.back()` must land on the
previous filter state — never past the subcategory page.

## 2. ~~Grid clicks outside brand/bodyType don't filter the feed~~ — done

**Done 2026-09-24 (`e70df0c`):** `GET /listings` gained `attrKey` + `attrValue`, and the subcategory page resolves the key from the set type via `SET_FIELD_KEYS`. Recorded in `CHANGELOG.md`. The original note is kept below for context.

Clicking a Network, Job Type, Type, Accessory, … tile highlights it and updates
`ad_type`, but `GET /listings` accepts only `brand` / `bodyType` attribute
params, so the feed ignores every other attribute filter. Needs a backend param
(generic `attr=<key>:<value>` or per-key params) plus the page's slug → name
mapping it already does for brand/bodyType.

## 3. Admin Edit dialog keeps a non-storage image value in the form

`components/dashboard/image-upload.tsx` now hides a stored value that is not a
Storage object (shows "No <label> stored"), but the form still carries the raw
string, so pressing Save re-persists it (`icon: parsed.data.image || null` in
`actions/brand.ts` and siblings). Option: drop non-Storage values on save so the
stale bundled `/sub-img` paths clear themselves as admins edit. Captain's earlier
call was to leave the data alone, so this one needs an explicit go-ahead.

## 4. Centre the map on the typed Location / Address text

The post form's location picker (`components/post/LocationMapPicker.tsx`) opens on
Phnom Penh until the seller drops a pin; it ignores the text they typed in the
Location/Address fields above it (the old Google-embed preview followed that text,
the Leaflet picker cannot without a geocoder). Fixing it means a geocoding lookup
— e.g. Nominatim `https://nominatim.openstreetmap.org/search?format=json&q=…`,
which requires a real Referer/User-Agent and is rate-limited, so it wants a
server-side call (a route handler or backend endpoint) with caching, not a
per-keystroke browser fetch.

# Product Specifications — family-scoped spec pages

> **Update 2026-10-30 (captain):** Cars and Motorcycles were switched to the
> old freeform group/row editor; only Phones, Tablets and Smart Watches remain
> template-driven. The template sections below describe the original
> template-first design — see `CHANGELOG.md` and `CLAUDE.md` for the shipped
> per-family `mode`.

Design document, 2026-10-30. Approved pieces come from the captain; every other
decision is marked as the builder's call and can be overridden at review.

## Intent

"Product Specs" today is a freeform group/row editor nested under Attributes:
an admin picks a model and types any section and any row by hand. Nothing makes
a car page look like a car page or a phone page like a phone page, and only the
`phones` listing form requires one.

The captain wants a top-level admin section named **Product Specifications**,
with one child per product family — **Cars, Motorcycles, Phones, Tablets, Smart
Watches** — each backed by its own fixed spec template, and all five listing
forms requiring a published spec page the way phone ads do today.

Reference structures:

- Cars — <https://www.autospecshub.com/cars/2026-byd-atto-2-45>
- Motorcycles — <https://www.ultimatespecs.com/motorcycles-specs/bmw/bmw-f-900-r-2023>
- Phones, tablets, smart watches — <https://www.gsmarena.com/apple_iphone_18_pro_max-14716.php>

## Goals

1. Rename the admin surface to **Product Specifications** and make it a
   top-level sidebar parent with five family children.
2. Give each family a fixed template — sections and fields derived from the
   reference sites — so the admin fills values instead of inventing labels.
3. Show only filled values on the public spec page; an empty field disappears.
4. Require a published spec page on `cars-for-sale`, `motorcycles-for-sale`,
   `phones`, `tablets`, and `smart-watches`.
5. Keep existing spec data and existing listing links intact.

## Non-goals

- A family-specific public-page redesign (galleries, comparisons, price
  history, hero imagery). The public page keeps its current group/row layout.
- Trim- or variant-level spec pages. One page per `models` row for now; the
  variant/trim is an ordinary field on the page.
- Scraping or importing specs automatically.
- Translated spec labels (`en` only; the public page's surrounding chrome stays
  translated as it is today).
- Letting customers submit or edit specs.
- Changing the listing-detail "View full specs" embed.

## Anti-goals

- A template that is only a visual hint — the admin must not be able to create
  a Car page with Display/Camera sections.
- Breaking existing pages or orphaning listings whose model already has a spec.
- Letting a phone spec be attached to a car ad (or the reverse).

## Constraints

- Repo rules: no new dependencies, no API contract break for the public page,
  no commits.
- Drizzle migration comes after `0046` (next number `0047`); `0045` and `0046`
  are untracked work on this branch, so the implementer must confirm the
  journal state before generating.
- `field_schema` is written only by the seed. Production needs a targeted
  `UPDATE subcategories SET field_schema = …` — never a full seed run.
- Backend templates are the single source of truth; the web admin form renders
  from an API response rather than a duplicated copy.

## Decisions from the captain

1. **Sidebar**: top-level parent, one child per family.
2. **Templates**: fixed per family — the references define the fields.
3. **Requirement**: all five listing forms require a published spec page.

## Builder calls (overridable)

1. **Five families, four templates.** Cars, Motorcycles, and Smart Watch get
   their own; Phones and Tablets share one device template because gsmarena's
   tablet pages are the phone skeleton with fields left blank. The watch
   template is the device template trimmed to fields a watch actually has.
2. **Storage stays `spec_groups`.** The template is a scaffold: the admin form
   loads the family template, the admin fills values, and the client sends only
   non-empty `{title, rows}` groups as it does today. The backend gains a
   `family` column but the public response shape does not change. This avoids a
   data migration and keeps the public page and listing embed untouched.
3. **Family is pinned at create and immutable.** It is chosen by which family
   page the admin is on, and the backend verifies the chosen model is linked to
   that family's subcategory. A model linked to no subcategory must be linked
   first (Models page) before it can get a spec page. Edit and delete keep the
   model/family pair.
4. **One page per model; trims are fields.** A car page carries `Years`,
   `Generation`, and variant-ish facts as values. Separate trim pages are a
   follow-up if the captain wants them.
5. **Legacy rows are preserved.** The migration derives each existing row's
   family from the model's family subcategory link, falling back to `'phone'`.
   A stored group "matches" the template only when its section title AND its
   row-label set both belong to the template; anything else is a legacy group.
   The edit dialog keeps legacy groups under an **Additional details** block
   (removable, never edited into the template) and writes them back unchanged.
   New template fields are the normal editing surface.
6. **The template is enforced server-side, with grandfathering.** On create,
   every group must be a template section carrying template labels (400
   `INVALID_SPEC_SECTION` otherwise). On update, the allowed set is the
   template plus the row's own already-stored legacy groups — so a legacy page
   stays editable, but no new non-template group can be introduced. Matching is
   exact: section title plus the full row-label set, never title alone (a
   legacy "Display" group with non-template labels must not collapse into the
   template's Display section and lose its rows).
7. **Route rename.** `/wanderer/dashboard/product-specifications/{family}` is
   the new home; the existing `/wanderer/dashboard/products` becomes a redirect
   so bookmarks and stale links still land.
8. **Picker scoping is enforced on both ends.** The post form requests products
   filtered by the subcategory's family, and the backend rejects a
   `productModelId` whose spec family does not match the listing's subcategory
   (family-bearing subcategories only; see Backend).
9. **No template-editing UI.** Templates are code constants. Adding a field is
   a code change; that is the point of "fixed".

## Family templates

Every field is an optional single-line text input (values like `5.3 s`,
`120 kW`, `6.1"` are strings). Blank values are dropped when saving. Field keys
are internal; labels are what the admin and public page show.

### Car — `car`, subcategory `cars-for-sale`

| Section                   | Fields                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview                  | Years, Generation, Body Type, Fuel Type, Drive, Status, Price (MSRP)                                                                                                |
| Performance               | Top Speed, 0–60 mph, 0–62 mph, Power, Torque, Power-to-Weight                                                                                                       |
| Engine & Transmission     | Engine Type, Displacement, Peak Power, Peak Output, Peak Torque, Transmission, Driven Wheels, Fuel System                                                           |
| Electric Powertrain       | Battery Size, Battery Range, Charge Time, Efficiency                                                                                                                |
| Fuel & Energy             | Combined Economy, City Economy, CO2 Emissions                                                                                                                       |
| Dimensions & Practicality | Doors, Seats, Luggage Space, Curb Weight, Gross Weight, Maximum Payload, Towing Capacity, Length, Width, Height, Wheelbase, Front Track, Rear Track, Turning Radius |
| Chassis & Brakes          | Tyre Sizes, Front Suspension, Rear Suspension, Front Brakes, Rear Brakes                                                                                            |

### Motorcycle — `motorcycle`, subcategory `motorcycles-for-sale`

| Section                | Fields                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview               | Start Year, Year, Category, Factory Warranty                                                                                                                                                                                                                                                                                                 |
| Dimensions & Weight    | Frame Type, Seat Height, Alternate Seat Height, Wheelbase, Length, Width, Height, Ground Clearance, Trail Size, Wheels, Front Tyre / Rim, Rear Tyre / Rim, Front Brakes, Rear Brakes, Curb Weight, Dry Weight, Fuel Tank Capacity, Reserve Fuel Capacity, Front Suspension, Front Suspension Travel, Rear Suspension, Rear Suspension Travel |
| Engine & Transmission  | Engine Type, Engine Details, Fuel System, Displacement, Bore × Stroke, Compression Ratio, Valves per Cylinder, Camshaft / Valvetrain, Maximum Power, Maximum Torque, Maximum RPM, Cooling System, Lubrication System, Engine Oil Capacity, Exhaust System, Gearbox, Final Drive, Clutch Type, Driveline                                      |
| Performance            | Top Speed, 0–100 km/h, 1/4 Mile, Fuel Consumption, CO2 Emissions, Emissions                                                                                                                                                                                                                                                                  |
| Electrical & Equipment | Ignition Type, Electrical Details, Starter Type, Instruments, Lights                                                                                                                                                                                                                                                                         |

### Phone / Tablet — `phone` and `tablet`, subcategories `phones`, `tablets`

| Section       | Fields                                                    |
| ------------- | --------------------------------------------------------- |
| Network       | Technology, 2G bands, 3G bands, 4G bands, 5G bands, Speed |
| Launch        | Announced, Status                                         |
| Body          | Dimensions, Weight, Build, SIM                            |
| Display       | Type, Size, Resolution, Protection                        |
| Platform      | OS, Chipset, CPU, GPU                                     |
| Memory        | Card slot, Internal                                       |
| Main Camera   | Modules, Features, Video                                  |
| Selfie Camera | Modules, Features, Video                                  |
| Sound         | Loudspeaker, 3.5mm jack                                   |
| Comms         | WLAN, Bluetooth, Positioning, NFC, Radio, USB             |
| Features      | Sensors                                                   |
| Battery       | Type, Charging                                            |
| Misc          | Colors, Models, Price                                     |

### Smart Watch — `smartwatch`, subcategory `smart-watches`

Same skeleton as the device template, trimmed to fields a watch carries:

| Section  | Fields                                                    |
| -------- | --------------------------------------------------------- |
| Network  | Technology, 2G bands, 3G bands, 4G bands, 5G bands, Speed |
| Launch   | Announced, Status                                         |
| Body     | Dimensions, Weight, Build, SIM                            |
| Display  | Type, Size, Resolution, Protection                        |
| Platform | OS, Chipset, CPU, GPU                                     |
| Memory   | Card slot, Internal                                       |
| Sound    | Loudspeaker                                               |
| Comms    | WLAN, Bluetooth, Positioning, NFC, USB                    |
| Features | Sensors                                                   |
| Battery  | Type, Charging                                            |
| Misc     | Colors, Models, Price                                     |

## Backend

Module stays `src/products/`. New file `src/products/spec-templates.ts` owns the
family→template map and the family→subcategory-slug map; the DB enum lives in
`src/db/schema/products.schema.ts` (`product_spec_family`).

### Contract

```
GET    /api/v1/products?q=&limit=&family=        @Public — family optional
GET    /api/v1/products/:brandSlug/:modelSlug    @Public — unchanged + family
GET    /api/v1/admin/products?family=            admin — list, optional filter
POST   /api/v1/admin/products                    admin — { modelId, family, specGroups, isPublished? }
PATCH  /api/v1/admin/products/:id                admin — { specGroups?, isPublished? }
DELETE /api/v1/admin/products/:id                admin
GET    /api/v1/admin/products/template/:family   admin — the family's template
```

- `family` is a validated enum everywhere; unknown values are a 400.
- Create verifies the model is linked to the family's subcategory and rejects
  a model that already has a page (409, unchanged).
- `specGroups` are validated against the family template on create, and against
  the template plus the row's stored legacy groups on update (builder call 6).
  Normalization and the non-empty rule stay as they are.
- The public detail response gains `family` (additive). The public summary shape
  is unchanged; `family` filtering is the new selector.
- The listing create/update paths pass the listing's `subcategoryId` alongside
  `productModelId`. When the subcategory maps to one of the five families, the
  spec must carry the same family (400 otherwise). When it maps to no family
  (laptops, cameras, …), today's published-page check is unchanged, so existing
  non-family ads are not broken.

### Template response shape

```ts
{
  family: "car",
  label: "Cars",
  subcategorySlug: "cars-for-sale",
  sections: [
    { key: "overview", title: "Overview",
      fields: [{ key: "years", label: "Years" }, …] },
  ],
}
```

## Admin web

- Sidebar: replace the `Product Specs` child entry with a top-level
  `Product Specifications` item (icon to be chosen from the existing lucide
  set) whose children are Cars, Motorcycles, Phones, Tablets, Smart Watches.
- Route `app/wanderer/dashboard/product-specifications/[family]/page.tsx` — one
  dynamic route driven by a small family config (label + slug + backend family
  key), mirroring the five sidebar entries. Client component, `useQuery` keys
  `["admin", "product-specs", family]`, per the admin-page conventions.
- `/wanderer/dashboard/products` becomes a `redirect()` to the Cars child.
- Family page:
  - Table columns: Product (brand + model), Specs (count of filled rows or
    section chips), Published, Updated, row actions. Search + status filter as
    today, client-side.
  - **Create** dialog: brand → model (only models linked to the family's
    subcategory and without a page), then template sections, publish toggle.
    A missing model links to Models, as today.
  - **Edit** dialog: brand/model fixed; template sections prefilled; unmatched
    legacy groups under a collapsible **Additional details** block; publish
    toggle and delete.
  - Template sections render as bordered blocks with a two-column label/input
    grid on wide screens; all inputs optional; at least one filled value is
    required to save (checked client-side and by the existing non-empty rule).
- `actions/product.ts` gains `getProductTemplate(family)`; create/update send
  `family` on create and the composed `specGroups`.
- `types/product.ts` and `schemas/product.ts` gain the family types; the zod
  schema keeps the existing group/row limits.

## Public web

- `lib/api/products.ts#getProducts` gains an optional `family` argument.
- The public product page keeps its current layout. No new section or visual
  treatment in v1.
- `/search` keeps showing all published products; no family filter there.

## Post form

- Add the `productSpec` field to four more subcategory schemas in
  `categories.seed.ts`: `cars-for-sale`, `motorcycles-for-sale`, `tablets`,
  `smart-watches` (phones already has it). Label: **Product Specification** —
  the phones entry is updated from "Product Spec" so all five read the same.
- `getListingFormConfig` resolves the subcategory slug → family and calls
  `getProducts(family, 200)`; the picker then only offers that family's pages.
  The pasted product URL resolver keeps working for URLs of the same family; a
  foreign-family URL toasts "not found", consistent with the existing paste
  rule.
- The existing `has("productSpec")` validation and payload wiring need no
  change; the requirement follows from the schema key.
- Listing create/update send the listing's `subcategoryId` to the product
  validation check (the DTO already carries it).

## Data and migration

- New pg enum `product_spec_family` = `car | motorcycle | phone | tablet |
smartwatch`.
- `product_specs.family` — not null; add nullable, backfill from the model's
  family subcategory link (`cars-for-sale` → car, `motorcycles-for-sale` →
  motorcycle, `phones` → phone, `tablets` → tablet, `smart-watches` →
  smartwatch), fall back to `'phone'` when the model links to none or to more
  than one family, then set not null. Existing `spec_groups` is untouched.
- No other table changes. `listings.product_model_id` keeps its semantics.
- Seed: no product-spec seed exists; none is added. The five `field_schema`
  updates live in `categories.seed.ts` for fresh databases, and the release
  notes must call out the targeted production `UPDATE` for the four changed
  subcategories.

## Documentation

- `CLAUDE.md`: Products section (new surface, families, template source,
  requirement on five subcategories), Known gaps (trim-level pages absent;
  spec pages must exist before those categories can be posted), the sidebar
  wording, and the migration list (`0047`).
- `CHANGELOG.md`: Unreleased entry.
- `tasks/todo.md`: dated ship entry per the running log convention.

## Verification

- Backend: unit tests for family validation (wrong family, unlinked model),
  template enforcement on create and grandfathered legacy groups on update,
  family filtering on both list endpoints, template endpoint shape, public
  detail including `family`, and the listing family-mismatch rejection
  (including the non-family subcategory passthrough).
- `pnpm --filter backend test`, `pnpm --filter backend lint`,
  `pnpm --filter backend build`.
- Web: `pnpm --filter web build` (the type gate) and `pnpm --filter web lint`.
- Browser: drive the five admin pages and one post form per family with the
  repo's headless-Chromium CDP recipe — create a spec page, confirm it appears
  in the right family only, confirm the picker offers only that family, and
  confirm a publish without a spec is refused. Check the public spec page and
  the listing detail's "View full specs" link.
- Migration: `pnpm --filter backend db:generate` must report no drift after the
  generated `0047` is applied; confirm the journal/watermark state first.

## Open items left to the builder

- Exact section layout in the admin dialog (accordion vs stacked blocks) and
  the table's "Specs" cell presentation — follow the existing AdminPage /
  AdminTable kit.
- Icon choice for the sidebar parent.
- Whether the public page should later gain a family-specific layout or a
  key-facts strip (explicitly out of scope here).
- Whether trim-level pages are wanted later; the current model is one page per
  model.

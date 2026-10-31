# Product Specifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn "Product Specs" into a top-level **Product Specifications** admin section with five family pages (Cars, Motorcycles, Phones, Tablets, Smart Watches), each driven by a fixed backend-owned spec template, and require a published spec page on all five matching listing forms.

**Architecture:** The backend owns one template per family in `spec-templates.ts`; the admin web form fetches that template and saves only the non-empty values as the existing `spec_groups` JSONB. A new `family` enum column on `product_specs` scopes every list and picker, and the listing create/update path rejects a spec whose family differs from the listing subcategory's family. No public API shape changes except an additive `family` on the product detail.

**Tech Stack:** NestJS 11, Drizzle ORM/PostgreSQL, class-validator, Jest 30; Next.js 16 App Router, React Query 5, zod, class-variance shadcn-style UI.

**Spec:** `docs/superpowers/specs/2026-10-30-product-specifications-design.md`

## Global Constraints

- No new dependencies in any package.
- **Do not commit.** The captain owns commits (global CLAUDE.md); every task ends with verification instead of a commit step.
- The working tree already carries unrelated uncommitted work (subscriptions/rebrand). Never revert, stash, or reformat unrelated files; touch only the files named in each task.
- Migration is the next free number after `0046` (confirm the journal at implementation time) — `0047`.
- `field_schema` is written only by the seed; production gets targeted `UPDATE subcategories SET field_schema = …` statements, never a full seed run.
- Backend templates are the single source of truth. The web renders the template returned by `GET /admin/products/template/:family`; never duplicate the field lists in web code.
- Public routes stay `@Public()`; admin routes stay under `@Roles('admin')` with `RolesGuard`.
- Keep `pnpm --filter backend build` and `pnpm --filter web build` green after every task.

## Review Focus

- Creating a spec page for a model **not linked** to the family's subcategory must return a clear 400 and create no row. (Task 3 test)
- Editing a legacy page whose stored groups do not match the template must keep those groups and save successfully. (Task 3 test)
- A car/motorcycle listing carrying a **phone** spec through the API must be rejected, not silently accepted. (Task 4 test)
- A non-family listing (e.g. laptop) that already carries a spec link must keep working on update. (Task 4 test)
- Posting in a newly-required subcategory with **zero published specs** must block with the existing "product required" toast, never crash or allow the post. (Task 9 browser check)

---

### Task 1: Database schema — family enum, column, derived backfill

**Files:**

- Modify: `apps/backend/src/db/schema/products.schema.ts`
- Create: `apps/backend/drizzle/migrations/0047_<generated-name>.sql` (and the generated `meta/0047_snapshot.json`, journal entry)
- Test: none (schema change); verification is `db:generate` + build

**Interfaces:**

- Consumes: nothing.
- Produces: `PRODUCT_SPEC_FAMILIES` (readonly tuple `['car','motorcycle','phone','tablet','smartwatch']`), type `ProductSpecFamily`, `productSpecFamilyEnum`, and the `productSpecs.family` column (`notNull`, enum).

- [ ] **Step 1: Add the enum and column to the schema**

In `products.schema.ts`, above the table:

```ts
export const PRODUCT_SPEC_FAMILIES = [
  "car",
  "motorcycle",
  "phone",
  "tablet",
  "smartwatch",
] as const;

export type ProductSpecFamily = (typeof PRODUCT_SPEC_FAMILIES)[number];

export const productSpecFamilyEnum = pgEnum(
  "product_spec_family",
  PRODUCT_SPEC_FAMILIES,
);
```

Add to the table definition, after `modelId`:

```ts
family: productSpecFamilyEnum('family').notNull(),
```

- [ ] **Step 2: Generate the migration**

Run: `pnpm --filter backend db:generate`
Expected: a new `0047_*.sql` creating the enum and adding `"family"` to `product_specs`.

- [ ] **Step 3: Replace the generated ADD COLUMN with the derived backfill**

Edit the generated SQL so it creates the enum, adds a nullable column, backfills, then sets `NOT NULL`:

```sql
CREATE TYPE "public"."product_spec_family" AS ENUM('car', 'motorcycle', 'phone', 'tablet', 'smartwatch');
ALTER TABLE "product_specs" ADD COLUMN "family" "public"."product_spec_family";

UPDATE "product_specs" ps
SET "family" = CASE sub.slug
  WHEN 'cars-for-sale' THEN 'car'::"public"."product_spec_family"
  WHEN 'motorcycles-for-sale' THEN 'motorcycle'::"public"."product_spec_family"
  WHEN 'phones' THEN 'phone'::"public"."product_spec_family"
  WHEN 'tablets' THEN 'tablet'::"public"."product_spec_family"
  WHEN 'smart-watches' THEN 'smartwatch'::"public"."product_spec_family"
  ELSE 'phone'::"public"."product_spec_family"
END
FROM (
  SELECT msl.model_id, min(s.slug) AS slug
  FROM model_subcategory_links msl
  JOIN subcategories s ON s.id = msl.subcategory_id
  WHERE s.slug IN ('cars-for-sale','motorcycles-for-sale','phones','tablets','smart-watches')
  GROUP BY msl.model_id
  HAVING count(DISTINCT s.slug) = 1
) sub
WHERE ps.model_id = sub.model_id;

UPDATE "product_specs" SET "family" = 'phone' WHERE "family" IS NULL;
ALTER TABLE "product_specs" ALTER COLUMN "family" SET NOT NULL;
```

The `HAVING count(DISTINCT s.slug) = 1` clause is deliberate: a model linked to more than one family falls through to the `'phone'` fallback, exactly as the spec says.

- [ ] **Step 4: Prove the migration matches the schema**

Run: `pnpm --filter backend db:generate`
Expected: `No schema changes, nothing to migrate`.

- [ ] **Step 5: Build**

Run: `pnpm --filter backend build`
Expected: success.

---

### Task 2: Family templates and pure matching helpers

**Files:**

- Create: `apps/backend/src/products/spec-templates.ts`
- Create: `apps/backend/src/products/spec-templates.spec.ts`
- Test: `apps/backend/src/products/spec-templates.spec.ts`

**Interfaces:**

- Consumes: `ProductSpecFamily` from Task 1; `ProductSpecGroup` from `../db/schema/products.schema`.
- Produces:
  - `interface ProductSpecTemplateField { key: string; label: string }`
  - `interface ProductSpecTemplateSection { key: string; title: string; fields: ProductSpecTemplateField[] }`
  - `interface ProductSpecTemplate { family; label; subcategorySlug; sections }`
  - `PRODUCT_SPEC_TEMPLATES: Record<ProductSpecFamily, ProductSpecTemplate>`
  - `FAMILY_SUBCATEGORY_SLUG: Record<ProductSpecFamily, string>`
  - `getProductSpecTemplate(family: ProductSpecFamily): ProductSpecTemplate` (throws `BadRequestException` on an unknown family)
  - `getFamilyForSubcategorySlug(slug: string): ProductSpecFamily | null`
  - `isTemplateGroup(family: ProductSpecFamily, group: { title: string; rows: { label: string }[] }): boolean`
  - `groupSignature(group: { title: string; rows: { label: string }[] }): string`

- [ ] **Step 1: Write the failing tests**

```ts
import { BadRequestException } from "@nestjs/common";
import {
  FAMILY_SUBCATEGORY_SLUG,
  PRODUCT_SPEC_TEMPLATES,
  getProductSpecTemplate,
  getFamilyForSubcategorySlug,
  isTemplateGroup,
} from "./spec-templates";

it("defines all five families with their subcategory slugs", () => {
  expect(Object.keys(PRODUCT_SPEC_TEMPLATES).sort()).toEqual([
    "car",
    "motorcycle",
    "phone",
    "smartwatch",
    "tablet",
  ]);
  expect(FAMILY_SUBCATEGORY_SLUG).toEqual({
    car: "cars-for-sale",
    motorcycle: "motorcycles-for-sale",
    phone: "phones",
    tablet: "tablets",
    smartwatch: "smart-watches",
  });
});

it("gives every section unique field keys and labels", () => {
  for (const template of Object.values(PRODUCT_SPEC_TEMPLATES)) {
    for (const section of template.sections) {
      const keys = section.fields.map((f) => f.key);
      const labels = section.fields.map((f) => f.label);
      expect(new Set(keys).size).toBe(keys.length);
      expect(new Set(labels).size).toBe(labels.length);
    }
  }
});

it("accepts a filled subset of a template section and rejects foreign groups", () => {
  expect(
    isTemplateGroup("phone", {
      title: "Display",
      rows: [{ label: "Size" }, { label: "Resolution" }],
    }),
  ).toBe(true);
  expect(
    isTemplateGroup("phone", {
      title: "Display",
      rows: [{ label: "Nope" }],
    }),
  ).toBe(false);
  expect(
    isTemplateGroup("phone", {
      title: "Camera",
      rows: [{ label: "Size" }],
    }),
  ).toBe(false);
  expect(
    isTemplateGroup("phone", {
      title: "Display",
      rows: [{ label: "Size" }, { label: "Size" }],
    }),
  ).toBe(false);
});

it("resolves families from subcategory slugs and rejects unknown ones", () => {
  expect(getFamilyForSubcategorySlug("phones")).toBe("phone");
  expect(getFamilyForSubcategorySlug("laptops")).toBeNull();
  expect(() => getProductSpecTemplate("nope" as never)).toThrow(
    BadRequestException,
  );
});

it("maps the template labels from the design document", () => {
  expect(PRODUCT_SPEC_TEMPLATES.phone.sections.map((s) => s.title)).toEqual([
    "Network",
    "Launch",
    "Body",
    "Display",
    "Platform",
    "Memory",
    "Main Camera",
    "Selfie Camera",
    "Sound",
    "Comms",
    "Features",
    "Battery",
    "Misc",
  ]);
  expect(PRODUCT_SPEC_TEMPLATES.car.sections.map((s) => s.title)).toEqual([
    "Overview",
    "Performance",
    "Engine & Transmission",
    "Electric Powertrain",
    "Fuel & Energy",
    "Dimensions & Practicality",
    "Chassis & Brakes",
  ]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter backend test -- --testPathPatterns=spec-templates`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `spec-templates.ts`**

Create the two records with the exact sections/fields from the design document's four tables (Car, Motorcycle, Phone/Tablet, Smart Watch). Rules:

- `PRODUCT_SPEC_TEMPLATES.phone` and `.tablet` share one `deviceSections` array declared above the record; each entry still carries its own `family`, `label`, and `subcategorySlug`.
- `isTemplateGroup` returns true when the title equals a section title, every row label belongs to that section's field labels, and labels are unique within the group.
- `groupSignature(group)` returns `` `${title}\u0000${rows.map((r) => r.label).join('\u0000')}` `` (order-sensitive; the update path uses it to grandfather stored legacy groups).
- `getFamilyForSubcategorySlug` reverses `FAMILY_SUBCATEGORY_SLUG`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter backend test -- --testPathPatterns=spec-templates`
Expected: PASS.

---

### Task 3: Products service, DTOs, and controllers

**Files:**

- Modify: `apps/backend/src/products/products.service.ts`
- Modify: `apps/backend/src/products/dto/create-product.dto.ts`
- Modify: `apps/backend/src/products/dto/query-products.dto.ts`
- Modify: `apps/backend/src/products/public-products.controller.ts`
- Modify: `apps/backend/src/products/admin-products.controller.ts`
- Modify: `apps/backend/src/products/products.service.spec.ts`
- Test: `apps/backend/src/products/products.service.spec.ts`

**Interfaces:**

- Consumes: Task 1's `ProductSpecFamily`; Task 2's `getProductSpecTemplate`, `getFamilyForSubcategorySlug`, `isTemplateGroup`, `groupSignature`.
- Produces:
  - `CreateProductDto.family: ProductSpecFamily` (`@IsIn([...PRODUCT_SPEC_FAMILIES])`)
  - `QueryProductsDto.family?: ProductSpecFamily`
  - `ProductsService.listAdmin(family?: ProductSpecFamily)`
  - `ProductsService.getTemplate(family: string): ProductSpecTemplate`
  - The detail/admin row select (`detailFields`) includes `family`; the public summary select stays unchanged.
  - `ProductsService.assertPublishedModel(modelId: string, subcategoryId?: string)` (Task 4 uses the second arg)

- [ ] **Step 1: Write the failing tests**

Add to `products.service.spec.ts` (extend the existing `selectChain`/`simpleSelect` helpers; a `mockSelectSequence(...results)` helper that chains `mockReturnValueOnce` is acceptable):

```ts
it("rejects a model that is not linked to the family subcategory", async () => {
  const db = makeDb();
  const service = makeService(db);
  db.select.mockReturnValueOnce(simpleSelect([])); // link probe: no row
  await expect(
    service.createAdmin({
      modelId: "m1",
      family: "car",
      specGroups: [
        { title: "Overview", rows: [{ label: "Years", value: "2026" }] },
      ],
    }),
  ).rejects.toThrow(BadRequestException);
});

it("rejects a group outside the family template on create", async () => {
  const db = makeDb();
  const service = makeService(db);
  // Validation runs before any DB read, so no select mock is needed.
  await expect(
    service.createAdmin({
      modelId: "m1",
      family: "car",
      specGroups: [
        { title: "Display", rows: [{ label: "Size", value: '6.1"' }] },
      ],
    }),
  ).rejects.toThrow("INVALID_SPEC_SECTION");
});

it("keeps a legacy group that is already stored on the row", async () => {
  const db = makeDb();
  const service = makeService(db);
  const legacy = {
    title: "Display",
    rows: [{ label: "Panel", value: "OLED" }],
  };
  db.select
    .mockReturnValueOnce(
      simpleSelect([{ id: "p1", family: "phone", specGroups: [legacy] }]),
    ) // existing-row probe
    .mockReturnValueOnce(
      selectChain([{ ...detailRow, family: "phone", specGroups: [legacy] }])
        .chain,
    );
  db.update.mockReturnValue({
    set: () => ({ where: () => Promise.resolve([]) }),
  });
  await expect(
    service.updateAdmin("p1", { specGroups: [legacy] }),
  ).resolves.toMatchObject({ specGroups: [legacy] });
});

it("rejects a new non-template group on update", async () => {
  const db = makeDb();
  const service = makeService(db);
  db.select.mockReturnValueOnce(
    simpleSelect([{ id: "p1", family: "phone", specGroups: [] }]),
  );
  await expect(
    service.updateAdmin("p1", {
      specGroups: [
        { title: "Display", rows: [{ label: "Panel", value: "OLED" }] },
      ],
    }),
  ).rejects.toThrow("INVALID_SPEC_SECTION");
});

it("filters the public list by family", async () => {
  const db = makeDb();
  const service = makeService(db);
  const { chain, where } = selectChain([]);
  db.select.mockReturnValue(chain);

  await service.listPublished({ family: "car" });

  const compiled = dialect.sqlToQuery(where.mock.calls[0][0] as SQL);
  expect(compiled.sql).toContain('"family"');
  expect(compiled.params).toContain("car");
});

it("filters the admin list by family", async () => {
  const db = makeDb();
  const service = makeService(db);
  const { chain, where } = selectChain([detailRow]);
  db.select.mockReturnValue(chain);

  await service.listAdmin("phone");

  const compiled = dialect.sqlToQuery(where.mock.calls[0][0] as SQL);
  expect(compiled.sql).toContain('"family"');
  expect(compiled.params).toContain("phone");
});
```

Add `family: "phone"` to the `summaryRow` and `detailRow` fixtures so the mocked rows match the new `PublicProduct`/`AdminProduct` shape.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter backend test -- --testPathPatterns=products.service`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the service and DTO changes**

- `detailFields` (public detail + admin list/one) gains `family: productSpecs.family`; the public summary select stays unchanged, per the spec.
- `listPublished`: push `eq(productSpecs.family, query.family)` when present.
- `listAdmin(family?)`: add the same condition.
- `createAdmin`:
  1. `const template = getProductSpecTemplate(dto.family);`
  2. `normalizeGroups`, then for each group `if (!isTemplateGroup(dto.family, group)) throw new BadRequestException('INVALID_SPEC_SECTION')`. Also reject duplicate section titles. Do this before any DB read so invalid input costs no query.
  3. Link probe: select `modelSubcategoryLinks.modelId` joined to `subcategories`, matching `modelId` and `subcategories.slug = template.subcategorySlug`, limit 1. Missing → `new BadRequestException('Model is not linked to the <label> category')`.
  4. Insert with `family: dto.family`.
- `updateAdmin`:
  1. Load the existing row with `family` and `specGroups` (one select).
  2. `normalizeGroups`.
  3. Allowed = `isTemplateGroup(existing.family, g)` OR `groupSignature(g)` is in the set of `groupSignature` for `existing.specGroups`. Otherwise `INVALID_SPEC_SECTION`.
  4. Update.
- **Update the existing tests in the same file** — they predate families:
  - `creates a spec page …`: add `family: 'phone'`; queue the link probe (`db.select.mockReturnValueOnce(simpleSelect([{ modelId: 'm1' }]))`) before the detail chain.
  - `rejects empty spec text`: add `family: 'phone'`; normalization now runs before the probe, so no probe mock is needed.
  - `maps a duplicate model to 409` and `maps a missing model to 400`: add `family: 'phone'` and queue the link probe.
  - `updates groups and publish state`: mock the existing row as `{ id: 'spec-1', family: 'phone', specGroups: [] }` and use a template-valid group, e.g. `{ title: 'Battery', rows: [{ label: 'Type', value: 'Li-Ion' }] }` — `Capacity` is not a phone-template label and is now rejected.
  - `404s an update on a missing page`: unchanged.
- `getTemplate(family: string)`: `return getProductSpecTemplate(family as ProductSpecFamily)`.
- `PublicProduct`/`AdminProduct` interfaces gain `family: ProductSpecFamily`.

- [ ] **Step 4: Add the DTO and controller wiring**

- `CreateProductDto`: add `family` with `@IsIn([...PRODUCT_SPEC_FAMILIES])`.
- `QueryProductsDto`: add optional `family` with the same validator.
- `PublicProductsController.list` already passes the query object; no signature change.
- `AdminProductsController.list(@Query() query: QueryProductsDto)` → `service.listAdmin(query.family)`.
- `AdminProductsController` gains:

```ts
@Get('template/:family')
@ApiOperation({ summary: 'Get the family spec template' })
template(@Param('family') family: string) {
  return this.service.getTemplate(family);
}
```

Declare it before the `:id` routes (no GET `:id` exists today, but keep the static route first).

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter backend test -- --testPathPatterns=products.service`
Expected: PASS, including the existing cases.

---

### Task 4: Listing family-match enforcement

**Files:**

- Modify: `apps/backend/src/products/products.service.ts` (`assertPublishedModel`)
- Modify: `apps/backend/src/listings/listings.service.ts` (create ~line 193, update ~line 316)
- Modify: `apps/backend/src/products/products.service.spec.ts`
- Modify: `apps/backend/src/listings/listings.service.spec.ts`
- Test: both spec files

**Interfaces:**

- Consumes: `assertPublishedModel(modelId, subcategoryId?)` from Task 3; `getFamilyForSubcategorySlug`.
- Produces: create/update call `assertPublishedModel(dto.productModelId, dto.subcategoryId)` and `assertPublishedModel(dto.productModelId, existing.subcategoryId)` respectively.

- [ ] **Step 1: Write the failing tests**

In `products.service.spec.ts`:

```ts
it("rejects a spec whose family differs from the listing subcategory", async () => {
  const db = makeDb();
  const service = makeService(db);
  // 1) the published-spec probe returns a phone-family row
  db.select.mockReturnValueOnce(
    selectChain([{ id: "p1", family: "phone" }]).chain,
  );
  // 2) the subcategory probe returns cars-for-sale
  db.select.mockReturnValueOnce(simpleSelect([{ slug: "cars-for-sale" }]));
  await expect(service.assertPublishedModel("m1", "sub-car")).rejects.toThrow(
    BadRequestException,
  );
});

it("skips the family check for a subcategory with no family", async () => {
  const db = makeDb();
  const service = makeService(db);
  db.select.mockReturnValueOnce(
    selectChain([{ id: "p1", family: "phone" }]).chain,
  );
  db.select.mockReturnValueOnce(simpleSelect([{ slug: "laptops" }]));
  await expect(
    service.assertPublishedModel("m1", "sub-laptop"),
  ).resolves.toBeUndefined();
});
```

In `listings.service.spec.ts`, update the existing product-spec attachment tests:

```ts
// "stores the product model id on a valid create": the DTO sends subcategoryId
expect(products.assertPublishedModel).toHaveBeenCalledWith("m1", "sub-1");
```

For the update tests, add `subcategoryId: "sub-1"` to the object mocked for `findById`, then assert `expect(products.assertPublishedModel).toHaveBeenCalledWith("m1", "sub-1")` in the "rejects an update that points at an unpublished product" case.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter backend test -- --testPathPatterns=products.service` and `pnpm --filter backend test -- --testPathPatterns=listings.service` (two separate invocations — the flag is per run)
Expected: the new assertions fail.

- [ ] **Step 3: Implement**

- `assertPublishedModel(modelId, subcategoryId?)`:
  - Select `id`, `family` from `productSpecs` joined to models/brands with the existing visibility conditions (add `family` to the select).
  - When `subcategoryId` is present: select `{ slug }` from `subcategories` by id; `const family = getFamilyForSubcategorySlug(row.slug)`; if `family` is non-null and `spec.family !== family`, throw `new BadRequestException('productModelId must reference a spec page from the same family as the listing subcategory')`.
  - No subcategory → unchanged behavior.
- `listings.service.ts` create: `await this.products.assertPublishedModel(dto.productModelId, dto.subcategoryId);`
- `listings.service.ts` update: `await this.products.assertPublishedModel(dto.productModelId, existing.subcategoryId);` (`existing` is the `findById` result already loaded at the top of `update`).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter backend test -- --testPathPatterns=products.service` and `pnpm --filter backend test -- --testPathPatterns=listings.service`
Expected: PASS.

---

### Task 5: Web data layer

**Files:**

- Create: `apps/web/lib/product-spec-families.ts`
- Modify: `apps/web/types/product.ts`
- Modify: `apps/web/actions/product.ts`
- Modify: `apps/web/actions/admin-products.ts`
- Modify: `apps/web/lib/api/products.ts`
- Test: none (web has no test framework); verification is `pnpm --filter web build`

**Interfaces:**

- Produces:
  - `ProductSpecFamily` union in `types/product.ts`
  - `ProductSpecTemplate`, `ProductSpecTemplateSection`, `ProductSpecTemplateField` interfaces
  - `ProductDetail.family: ProductSpecFamily`
  - `getProductTemplate(family): Promise<ProductSpecTemplate | null>`
  - `getAdminProducts(family?: ProductSpecFamily): Promise<AdminProduct[]>`
  - `getProducts(q?, limit?, family?)`
  - In `lib/product-spec-families.ts`: `FAMILY_PAGES` (slug/family/label/subcategorySlug rows for Cars→Smart Watches), `familyPage(slug)`, `familyForSubcategory(slug)`, `matchTemplateGroup(template, group)` (title + every row label belongs to that section).

**Sequencing note:** the `productSchema`/`createProduct` contract change belongs to Task 6 — the old admin page still calls `createProduct` until Task 6 replaces it, so Task 5 leaves that path untouched and stays green at runtime.

- [ ] **Step 1: Add the family types and template shape**

`types/product.ts`: add the union and interfaces; add `family: ProductSpecFamily` to `ProductDetail`.

- [ ] **Step 2: Add the web family config module**

`lib/product-spec-families.ts` exports `FAMILY_PAGES` in sidebar order:

```ts
export const FAMILY_PAGES = [
  {
    slug: "cars",
    family: "car",
    label: "Cars",
    subcategorySlug: "cars-for-sale",
  },
  {
    slug: "motorcycles",
    family: "motorcycle",
    label: "Motorcycles",
    subcategorySlug: "motorcycles-for-sale",
  },
  {
    slug: "phones",
    family: "phone",
    label: "Phones",
    subcategorySlug: "phones",
  },
  {
    slug: "tablets",
    family: "tablet",
    label: "Tablets",
    subcategorySlug: "tablets",
  },
  {
    slug: "smart-watches",
    family: "smartwatch",
    label: "Smart Watches",
    subcategorySlug: "smart-watches",
  },
] as const;
```

plus `familyPage(slug)`, `familyForSubcategory(slug)`, and `matchTemplateGroup(template, group)`.

- [ ] **Step 3: Update the product actions and API client**

- `actions/product.ts`: add

```ts
export async function getProductTemplate(
  family: ProductSpecFamily,
): Promise<ProductSpecTemplate | null> {
  try {
    const { data } = await serverFetch<ProductSpecTemplate>(
      `/admin/products/template/${family}`,
    );
    return data;
  } catch {
    return null;
  }
}
```

- `actions/admin-products.ts`: `getAdminProducts(family?)` appends `?family=` when provided.
- `lib/api/products.ts`: `getProducts(q?, limit = 10, family?)` appends `family` to the query string when provided.

- [ ] **Step 4: Build**

Run: `pnpm --filter web build`
Expected: success (the admin page still compiles; its runtime paths are updated in Task 6).

---

### Task 6: Admin routes, sidebar, and family pages

**Files:**

- Modify: `apps/web/components/dashboard/app-sidebar.tsx`
- Create: `apps/web/app/wanderer/dashboard/product-specifications/[family]/page.tsx`
- Create: `apps/web/components/dashboard/product-specs-page.tsx`
- Modify: `apps/web/app/wanderer/dashboard/products/page.tsx` (replace with a redirect)
- Modify: `apps/web/schemas/product.ts`
- Modify: `apps/web/actions/product.ts`
- Test: none; verification is `pnpm --filter web build` + Task 9 browser checks

**Interfaces:**

- Consumes: Task 5's `FAMILY_PAGES`, `familyPage`, `matchTemplateGroup`, `getAdminProducts`, `getProductTemplate`, `createProduct`, `updateProduct`, `deleteProduct`.
- Produces: five working admin pages under `/wanderer/dashboard/product-specifications/{cars|motorcycles|phones|tablets|smart-watches}`.

- [ ] **Step 1: Replace the sidebar entry**

In `app-sidebar.tsx`:

- Remove the `Product Specs` child from the `Attributes` items array.
- Add a top-level entry (place it after `Attributes`):

```ts
{
  title: "Product Specifications",
  icon: IconDeviceMobile,
  href: "/wanderer/dashboard/product-specifications/cars",
  roles: ["admin"],
  items: FAMILY_PAGES.map((page) => ({
    title: page.label,
    icon: SPEC_FAMILY_ICONS[page.family],
    href: `/wanderer/dashboard/product-specifications/${page.slug}`,
  })),
},
```

Declare the map above the nav array:

```ts
const SPEC_FAMILY_ICONS = {
  car: IconCar,
  motorcycle: IconMotorbike,
  phone: IconDeviceMobile,
  tablet: IconDeviceTablet,
  smartwatch: IconDeviceWatch,
} as const;
```

Import those five from `@tabler/icons-react` (the file's icon source) and `FAMILY_PAGES` from `@/lib/product-spec-families`. All five names exist in the installed `@tabler/icons-react@3.45.0`; `IconWatch` does **not**, the watch icon is `IconDeviceWatch`.

- [ ] **Step 2: Replace the old route with a redirect**

`apps/web/app/wanderer/dashboard/products/page.tsx` becomes:

```tsx
import { redirect } from "next/navigation";

export default function ProductsRedirect() {
  redirect("/wanderer/dashboard/product-specifications/cars");
}
```

- [ ] **Step 3: Add the dynamic route shell**

`product-specifications/[family]/page.tsx` is a server component:

```tsx
export default async function ProductSpecsRoute({
  params,
}: {
  params: Promise<{ family: string }>;
}) {
  const { family } = await params;
  const config = familyPage(family);
  if (!config) notFound();
  return (
    <ProductSpecsPage
      family={config.family}
      label={config.label}
      subcategorySlug={config.subcategorySlug}
    />
  );
}
```

- [ ] **Step 4: Build the family page component**

First, wire the create contract (this was deliberately left out of Task 5):

- `schemas/product.ts`: `productSchema` gains `family: z.enum([...])`; `updateProductSchema` omits both `modelId` and `family`.
- `actions/product.ts`: `createProduct` includes `family` in the POST body and in the zod parse input.

Then `product-specs-page.tsx` (`"use client"`) follows the existing admin-page conventions:

- `AdminPage` title `Product Specifications — <label>`, description naming the reference family.
- Queries: `["admin","product-specs",family]` → `getAdminProducts(family)`; `["admin","product-spec-template",family]` → `getProductTemplate(family)`; brands/models/subcategories via `getAdminBrands`, `getAdminModels`, `getAdminSubcategories`.
- Model filtering: resolve the family subcategory id from the subcategories list by `subcategorySlug`; a model is eligible when `model.subcategories.includes(subId)` and no spec page already uses it.
- Table columns: Product (image + `brandName modelName` + slug subtitle), Specs (filled-row count), Published (badge), Updated, row actions (edit/delete).
- Create/Edit dialogs share a `TemplateFields` component:
  - State `values: Record<string, string>` keyed `` `${section.key}:${field.key}` ``.
  - Render sections in template order; each field is a labeled `Input`; all optional.
  - Submit composes `specGroups` from sections with at least one non-empty value; blocks with a toast when nothing is filled.
  - Edit prefill: for each stored group, `matchTemplateGroup` → fill matching values; otherwise push to `legacyGroups`.
  - Additional details: render `legacyGroups` as label/value rows with a remove button; append them unchanged on save.
  - Keep the existing publish toggle, delete dialog, and `useQueryClient().invalidateQueries` refresh pattern.
- Show a clear empty state when the template query returns `null` (`"Template unavailable"`) rather than rendering an empty form.

- [ ] **Step 5: Build and lint**

Run: `pnpm --filter web build` and `pnpm --filter web lint`
Expected: success.

---

### Task 7: Post form — required specs on five subcategories, family-scoped picker

**Files:**

- Modify: `apps/backend/src/categories/seeds/categories.seed.ts`
- Modify: `apps/web/actions/listings.ts` (~line 315)
- Modify: `apps/web/lib/api/products.ts` (already has the param from Task 5)
- Modify: `apps/web/components/post/ListingPostForm.tsx` (`LABEL_KEYS`, fallback label)
- Modify: `apps/web/messages/en.json` (`PostForm.labels.productSpec`)
- Test: none directly; covered by Task 9 browser checks

**Interfaces:**

- Consumes: `familyForSubcategory` from Task 5; backend `GET /products?family=`.
- Produces: `productSpec` present in `cars-for-sale`, `motorcycles-for-sale`, `phones`, `tablets`, `smart-watches` field schemas.

- [ ] **Step 1: Add the shared field definition to the seed**

Next to `conditionField` in `categories.seed.ts`, define:

```ts
const productSpecField = {
  key: "productSpec",
  label: { en: "Product Specification" },
  type: "product",
  required: true,
} as const;
```

- [ ] **Step 2: Add it to the four new subcategory schemas**

Insert `productSpecField` after the brand/model spread in `cars-for-sale`, `motorcycles-for-sale`, `tablets`, and `smart-watches`; replace the inline phones object at line ~1043 with `productSpecField` (this updates its label to "Product Specification"). Keep the comment at each new site short and factual (the key is form-required, not DTO-required).

- [ ] **Step 3: Scope the picker to the subcategory's family**

In `getListingFormConfig` (`actions/listings.ts`), replace:

```ts
has("productSpec") ? getProducts(undefined, 200) : [],
```

with:

```ts
const productFamily = familyForSubcategory(subcategorySlug);
has("productSpec") ? getProducts(undefined, 200, productFamily ?? undefined) : [],
```

An unknown family keeps the old unfiltered behavior so a misconfigured subcategory never locks posting.

`resolveProductPaste` needs no change: it searches `config.products`, which is now the scoped list, so a foreign-family URL falls through to the existing "not found" toast.

- [ ] **Step 4: Update the label plumbing**

- `ListingPostForm.tsx`: add `"Product Specification": "productSpec"` to `LABEL_KEYS`; change the `labelFor("productSpec", …)` fallback from `"Product Spec"` to `"Product Specification"`.
- `messages/en.json`: `PostForm.labels.productSpec` → `"Product Specification"`. Leave `km.json` as-is (its value already means the longer form).

- [ ] **Step 5: Build**

Run: `pnpm --filter backend build` and `pnpm --filter web build`
Expected: success.

---

### Task 8: Documentation

**Files:**

- Modify: `CLAUDE.md` (Products section, Admin API table, migration list, Known gaps)
- Modify: `CHANGELOG.md` (Unreleased)
- Modify: `tasks/todo.md` (dated ship entry)

**Interfaces:** none.

- [ ] **Step 1: Update CLAUDE.md**

- Products section: replace the single freeform-page description with the family model: five families, template source (`src/products/spec-templates.ts`), `family` column, admin surface `/wanderer/dashboard/product-specifications/<family>`, and the five required subcategories.
- Admin API table: add `GET /admin/products/template/:family`; note the `family` query on the list routes.
- Migration list: add `0047` (enum + family column + derived backfill).
- Known gaps: note that trim/variant-level pages do not exist (one page per model), that the five categories now need published spec pages before posting, and that production needs targeted `field_schema` UPDATEs rather than a seed.

**CLAUDE.md formatter caution:** the file is `.prettierignore`d, and the repo's post-edit hook has corrupted it before. Edit it with a `python3` script through `Bash` (read → replace exact strings → write), then `git diff --stat CLAUDE.md` to confirm only the intended lines changed. Do not run `pnpm format` on it.

- [ ] **Step 2: Update CHANGELOG.md**

Add an Unreleased entry: "Product Specifications: family-scoped spec pages (Car, Motorcycle, Phone, Tablet, Smart Watch), template-driven admin, specs required on five listing categories."

- [ ] **Step 3: Append the ship entry**

Append one dated entry to `tasks/todo.md` in the file's existing style, linking the design and plan documents.

- [ ] **Step 4: Verify formatting**

Run: `pnpm exec prettier --check CHANGELOG.md tasks/todo.md`
Expected: both pass. Do not include `CLAUDE.md` (it is ignored on purpose).

---

### Task 9: Full verification

**Files:** none.

- [ ] **Step 1: Backend gates**

```bash
pnpm --filter backend lint
pnpm --filter backend test
pnpm --filter backend build
```

Expected: all pass.

- [ ] **Step 2: Web gates**

```bash
pnpm --filter web lint
pnpm --filter web build
```

Expected: all pass. `next build` is the type gate (the package has no `check-types` script).

- [ ] **Step 3: Migration gate**

```bash
pnpm --filter backend db:generate
```

Expected: "No schema changes, nothing to migrate". If it prompts or reports drift, stop and reconcile the snapshot before applying anything.

- [ ] **Step 4: Apply the migration to the dev database**

Before running `db:migrate`, confirm the journal watermark (the repo has a known silent-skip hazard). Apply, then confirm `product_specs.family` is populated:

```bash
psql "$DATABASE_URL" -c "select family, count(*) from product_specs group by 1;"
```

Expected: every existing row has a family; no nulls. If the environment's secret guard blocks reading `.env`, use Drizzle Studio (`pnpm --filter backend db:studio`) or ask the captain to run the query instead of reading the credential directly.

- [ ] **Step 5: Browser checks**

Use the repo's headless-Chromium CDP recipe (CLAUDE.md → Web). Do not kill the captain's running dev servers; probe `:3000` and `:3001` first and restart only if a port answers 000.

Check, in order:

1. Admin sidebar shows `Product Specifications` with five children; `Attributes` no longer contains it.
2. `/wanderer/dashboard/products` redirects to the Cars child.
3. Create a Car spec page: pick a car brand/model, fill two fields, publish; it appears under Cars and not under Phones.
4. Edit it: values re-render; clearing a field hides that row on the public page.
5. Post form for `cars-for-sale`: the Product Specification picker lists car pages only; submit without one is blocked with the product-required toast; pasting a **phone** product URL toasts "not found".
6. Post form for `phones`: picker lists phone/tablet pages only, never car pages.
7. Public product page renders the filled groups; a listing detail's "View full specs" still links.
8. A legacy page (if the dev DB has one) opens in the edit dialog with its unmatched groups under Additional details and saves without losing them.

- [ ] **Step 6: Report**

Summarize to the captain: gates run and their results, any browser step that could not be completed, and the remaining production step (targeted `field_schema` UPDATEs + creating spec pages before those categories can be posted). Do not commit.

"use client";

import { useEffect, useState, useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import Image from "next/image";
import { Separator } from "@/components/ui/separator";
import { Category, Subcategory } from "@/types/post-form";
import {
  ChevronRight,
  MapPin,
  Phone,
  Mail,
  Building2,
  User,
  DollarSign,
  Truck,
} from "lucide-react";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import ImageUpload from "@/components/post/ImageUpload";
import ListingPostForm from "@/components/post/ListingPostForm";
import DbImage from "@/components/common/DbImage";
import { getPostCategories } from "@/actions/post-categories";
import { toast } from "@/components/ui/sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
type FormData = Record<string, string | number | boolean | string[]>;

/**
 * Subcategories on the real listing form (`ListingPostForm`), which renders
 * exactly the fields the subcategory's own `field_schema` declares. Everything
 * else still falls through to the mock `DynamicForm` below, whose submit is
 * deliberately unwired — so this list is an explicit opt-in, not a guess.
 */
const REAL_FORM_SUBCATEGORIES = [
  "cars-for-sale",
  "bicycles",
  "motorcycles-for-sale",
  "vehicles-for-rent",
  "maintenance-and-repair",
  "lorries-vans-and-tractors",
  "financing-and-insurance",
  "tuk-tuk-and-remork",
  "parts-and-accessories",
  "vehicles-others",
  // Phones & Tablets — opted in 2026-09-22 once the `storage`, `accessory`
  // and `network` blocks existed (they were the family's only unrenderable
  // keys; a key with no block vanishes silently).
  "phones",
  "tablets",
  "smart-watches",
  "phone-accessories",
  "phone-numbers",
  // Computers & Accessories — opted in 2026-09-22 once the `screenSize`,
  // `ram`, `cpu`, `vga` and `type` blocks existed (the family's only
  // unrenderable keys; a key with no block vanishes silently). Note the parts
  // subcategory's slug is `computers-parts-and-accessories` — the cars family
  // already owns the bare `parts-and-accessories`.
  "laptops",
  "desktops",
  "all-in-one",
  "monitors",
  "printers-and-scanners",
  "computers-parts-and-accessories",
  "softwares",
  // Electronics & Appliances — opted in 2026-09-22. No new block was needed:
  // the family's 13 keys (photos/title/type/condition/price/discount/
  // description/location/address/deliveryFree/contact trio) are all already
  // renderable, `type` by the same block the computers parts form uses.
  // All 12 declare Condition (captain, 2026-09-22) — spec-detail-four.md
  // omits it on machinery/security-cameras/lighting, but the captain's mock
  // groups those with the Fridges & Freezers form, so the seed and the
  // ListingSpecs condition list both carry it.
  "washing-machines-and-dryers",
  "fridges-and-freezers",
  "air-conditioning-and-heating",
  "tools",
  "machinery",
  "consumer-electronics",
  "security-cameras",
  "lighting",
  "cameras-and-camcorders",
  "tvs-videos-and-audio",
  "home-appliances",
  "video-games-consoles-toys",
  // Home & Land — opted in 2026-09-22 once the `bedroom`, `bathroom`, `facing`
  // and `size` blocks existed (the family's only unrenderable keys; a key with
  // no block vanishes silently). The property cluster renders above the
  // identity cluster so Type lands after Size, per the captain's mock. Note
  // `facing` was dropped from apartment-for-rent in the seed the same day
  // (mock wins over spec-detail-five.md, which listed it) — the block simply
  // does not render for a subcategory that does not declare it.
  "house-for-sale",
  "house-for-rent",
  "condo-for-sale",
  "apartment-for-rent",
  // The rest of Home & Land — opted in 2026-09-23. **No new block was needed
  // this time**: every key these eight declare (`size`, `type`, `price`,
  // `description`, `location`, `address`, the contact trio) already had a
  // render block, because the property cluster added for the four above
  // (2026-09-22) covered `size` and the `type` block already existed for the
  // computers/electronics forms. Three of them — properties-wanted,
  // agent-services and home-and-land-others — declare **no `size` and no
  // `price`**, which the schema gating handles on its own: the Price block is
  // skipped at render, at validation and in the payload, and `listings.price`
  // is nullable.
  "land-for-sale",
  "land-for-rent",
  "commercial-properties-for-sale",
  "commercial-properties-for-rent",
  "room-for-rent",
  "properties-wanted",
  "agent-services",
  "home-and-land-others",
  // Jobs — all 36 subcategories, opted in 2026-09-23. They share one form
  // (spec-detail-six.md: "they have the same form"), which needed three new
  // blocks: `jobType`, `experience` and `company`. The first two are pickers
  // whose lists come from the admin-managed `jobtypes` set and the (global)
  // `experiences` set; `company` is a plain text field. The job-type key was
  // ALSO renamed from `type` to `jobType` in the seed the same day — `type`
  // maps to the `types` set, whose rows are ticked for computers/property and
  // for no jobs subcategory at all, so the picker resolved to an empty list on
  // a starred field; `jobType` is what `SET_FIELD_KEYS`, `ListingSpecs` and
  // the `jobtypes` admin page already expected.
  "accounting-jobs",
  "administration",
  "architecture-engineering",
  "assistant-secretary",
  "audit-taxation",
  "banking-insurance",
  "cashier-receptionist",
  "catering-restaurant",
  "cleaner-maid",
  "consultancy",
  "customer-service",
  "design",
  "education-training",
  "finance",
  "freight-shipping-delivery-warehouse",
  "hotel-hospitality",
  "human-resources",
  "information-technology",
  "lawyer-legal-services",
  "management",
  "manufacturing",
  "marketing",
  "media-advertising",
  "medical-health-nursing",
  "merchandising-purchasing",
  "operations",
  "project-management",
  "quality-control",
  "resort-casino",
  "sales",
  "security-driver",
  "technicians",
  "telecommunications",
  "translations-interpretation",
  "travel-agents-ticket-sales",
  "jobs-others",
  // Services — all 24 subcategories, opted in 2026-09-27. **No new block was
  // needed**: the family's 8 keys (photos max 8 / title / description /
  // location / address / the contact trio) are every one already renderable —
  // `contactEmail` was the only one that could have vanished silently, and its
  // block is there. spec-detail-seven.md (13 lines — "they have the same
  // form") and the seed agree field-for-field, so unlike Jobs there was no
  // rename or divergence to resolve. The family declares **no price**: these
  // listings publish with a NULL price and read "Negotiable" on the cards and
  // the detail page, exactly like the three Home & Land forms that declare
  // none. The deleted `lib/post-ad.ts` mock carried a `company_name` payload
  // field, but that was the mock's generic boilerplate — 146 occurrences
  // against 145 mock subcategory entries, i.e. one per subcategory of every
  // category, Jobs and Cars included — never Services design intent.
  "accounting-services",
  "financial-services",
  "travel-and-tourism",
  "automotive-services",
  "advertising-and-media",
  "bridal-services",
  "cleaning-and-maid-services",
  "construction-arch-and-interiors",
  "education-training-services",
  "engineering-services",
  "insurance-services",
  "massage-and-spa",
  "hospitality-travel-and-tourism",
  "health-medical-and-pharma",
  "it-and-telecom",
  "interior-design-and-renovation",
  "legal-services",
  "movers-and-logistics",
  "plumbing-and-electrical",
  "property-and-real-estate",
  "science-services",
  "supply-chain-and-logistics",
  "printing-and-publishing",
  "other-services",
  // Fashion & Beauty — all 6 subcategories, opted in 2026-09-27. Five of the
  // six declare `type` (the same block the computers/electronics/property forms
  // use), so most of this family is the usual schema-gated opt-in.
  //
  // Two things made it NOT a copy-paste of Services:
  //  1. `fashion-accessories`' picker reuses the **`accessory`** block — the
  //     same key and the same `accessories` set Phone Accessories reads — and
  //     only its LABEL differs: its own `field_schema` says **"Accessory Type"**
  //     (captain, 2026-09-27), which the block already picks up from
  //     `config.labels`. So no new block was needed for it either. What the key
  //     must NOT be is `type` (→ `types`): NO `types` row is ticked for this
  //     subcategory and `types` is managed, so it would have rendered an EMPTY
  //     picker on a starred field — the same unpublishable-form trap Jobs hit
  //     with `jobType`.
  //     (A separate `fashion_accessories` set, keyed `accessoryType`, was built
  //     the same day and reverted — captain's call to keep ONE set. See the
  //     `accessories` block in attributes.seed.ts before re-proposing it.)
  //  2. `beauty-and-healthcare-products` declares **no type at all** — the
  //     family's one form without it, per the captain and spec-detail-eight.
  //     Nothing special handles that: the schema gating simply skips the block.
  // Also note the type lists are admin-managed data, not seed literals —
  // spec-detail-eight spells the men's/kids options "Men's Accessories" and
  // "Baby & Kids Clothing" while the `types` set (and the design mock data in
  // the since-deleted `lib/post-ad.ts`) say "Men Accessories"/"Kid Clothing".
  // The design mock agrees with the ticked rows, so the rows stand and the
  // spec-detail wording loses — the same mock-wins rule as apartment-for-rent's
  // dropped `facing`.
  "womens-fashion",
  "mens-fashion",
  "baby-and-kids",
  "travel-and-luggage",
  "fashion-accessories",
  "beauty-and-healthcare-products",
  // Furniture & Decor — all 10 subcategories, opted in 2026-09-27.
  //
  // Like the 2026-09-23 Home & Land batch and Services, this one needed **no
  // new block and no new code at all**: every key the family declares — photos
  // / title / price / discount / description / location / address /
  // deliveryFree / the contact trio, plus `type` on two of them — already had a
  // render block, so the ship is the slug list alone.
  //
  // **Only `table-and-desks` and `chairs-and-sofas` declare `type`** (captain's
  // mock, matching spec-detail-nine.md); the other 8 are the same 11-field form
  // with no Type at all. `wardrobe-and-cabinets` and the seven below it are
  // therefore the no-Type shape, not the Type one — do not add a `type` key to
  // them: `types` is a managed set and no row is ticked for those eight, so a
  // Type field there would render an EMPTY picker (and, starred, make the form
  // unpublishable — the Jobs `jobType` trap).
  //
  // Where Type DOES render, its options come from the admin-managed `types`
  // rows ticked for that subcategory, not from the schema's inline `options`:
  // the rows (and the design mock data in the since-deleted `lib/post-ad.ts`)
  // read "Dining Table"
  // / "Kids Desks" / "Kids Chairs&Seats" while spec-detail-nine.md spells them
  // "Dining Tables" / "Kid's Desks" / "Kid's Chair & Seats". The rows agree
  // with the design, so the rows stand and the spec wording loses — the same
  // mock-wins rule as apartment-for-rent's dropped `facing` and the Fashion &
  // Beauty type lists.
  "table-and-desks",
  "chairs-and-sofas",
  "wardrobe-and-cabinets",
  "shelves-and-drawers",
  "beds-and-mattresses",
  "curtains-and-carpets",
  "other-furniture",
  "kitchenware",
  "household-items",
  "handicrafts-paintings",
  // Books, Sports & Hobbies — all 7 subcategories, opted in 2026-09-27.
  //
  // The slug list is the whole ship again — every key this family declares
  // already had a render block, so no new code was needed. What makes it worth
  // a comment is that it is the catalogue's **mixed** family, and the only one
  // where both shapes sit inside a single category: per spec-detail-ten.md,
  // `musical-instruments` is the Type+Condition form (13 keys) while the six
  // below it share the plain 11-field form with neither. The schema gating does
  // all of that work, so nothing here needs a per-subcategory exception — but
  // **do not add `type` or `condition` to the six**: `types` is a managed set
  // with no row ticked for any of them and no inline fallback, so a Type field
  // there would render an EMPTY picker (and, starred, make the form
  // unpublishable — the Jobs `jobType` trap), while a Condition field would put
  // a row on their detail pages that their forms can never fill.
  //
  // `musical-instruments`' Type options come from the admin-managed `types`
  // rows ticked for it (11: the spec's 10 + the shared `other`), not from the
  // schema's inline `options` — and the two disagree on one name: the row reads
  // **"Traditional-instruments"** where spec-detail-ten.md writes "Traditional
  // Instruments". The rows agree with the design mock (formerly
  // `lib/post-ad.ts:6108`, deleted in the 2026-10-30 mock-data cleanup),
  // so the rows stand and the spec wording loses — the same mock-wins rule as
  // apartment-for-rent's dropped `facing` and the Fashion & Beauty / Furniture
  // type lists. Its Condition row was already in
  // `ListingSpecs.CONDITION_SUBCATEGORIES`, so the published grid needed no
  // change either.
  "musical-instruments",
  "fishing",
  "hike-and-camping",
  "cds-dvds-vhs",
  "books",
  "sports-equipment",
  "hobbies-others",
  // Pets — all 7 subcategories, opted in 2026-09-28. **No new block and no new
  // code**: the family's 11 keys ARE `commonListingFields`, and all 7 seeded
  // `fieldSchema` arrays match that const field-for-field (key, type, required,
  // max, label, options — proven by parsing the seed, not by eye).
  // spec-detail-eleven.md is 15 lines and says "they have the same form",
  // pointing at spec-detail-one.md:194-202 for the seven. `deliveryFree` and
  // `contactEmail` were the two keys that could have vanished silently; both
  // blocks exist (ListingPostForm.tsx:1093, :1212).
  "dogs",
  "cats",
  "birds",
  "fish",
  "pet-food",
  "pet-accessories",
  "other-pets",
  // Foods — all 10 subcategories, opted in 2026-09-28, the same shape as Pets
  // and the catalogue's last un-opted family. spec-detail-twelve.md is again 15
  // lines ("they have the same form") and points at spec-detail-one.md:203-214
  // for the ten; its header says "Meats" where spec-detail-one says "Meat",
  // which is cosmetic — the slug, the seed and the form all agree. With this
  // list every seeded subcategory in the catalogue runs the real form. The mock
  // `DynamicForm` below is NOT dead code: a subcategory created through the
  // admin UI later (no `field_schema`, so no entry here) still lands on it.
  "meat",
  "seafood",
  "fruits",
  "vegetables",
  "beverages",
  "grocery",
  "bread-and-bakery",
  "beer-and-wine",
  "rice-and-cereal",
  "other-foods",
];

// ─── Step Indicator ───────────────────────────────────────────────────────────
function StepIndicator({ step }: { step: 1 | 2 }) {
  const t = useTranslations("PostAd");
  return (
    <div className="flex items-center gap-2 ">
      {[
        { n: 1, label: t("stepChooseCategory") },
        { n: 2, label: t("stepFillInfo") },
      ].map(({ n, label }, i) => (
        <div key={n} className="flex items-center gap-2 py-2">
          {i > 0 && <ChevronRight className="w-4 h-4 text-gray-400" />}
          <div className="flex items-center gap-2">
            <span
              className={`w-4 h-4 rounded-full type-button-sm flex items-center justify-center
                  ${step === n ? "bg-[#00a0e9] text-white" : step > n ? "bg-green-500 text-white" : "bg-gray-200 text-gray-500"}`}
            >
              {n}
            </span>
            <span
              className={`type-body  ${step === n ? "text-foreground" : "text-gray-400"}`}
            >
              {label}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Category Selector (Step 1) ───────────────────────────────────────────────
function CategorySelector({
  onSelect,
}: {
  onSelect: (cat: Category, sub: Subcategory) => void;
}) {
  const t = useTranslations("PostAd");
  const locale = useLocale();
  const [hoveredCat, setHoveredCat] = useState<Category | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPostCategories(locale)
      .then((rows) => {
        if (!cancelled) setCategories(rows);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCatEnter = (cat: Category) => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setHoveredCat(cat);
  };

  const handlePanelLeave = () => {
    leaveTimer.current = setTimeout(() => setHoveredCat(null), 150);
  };

  const handlePanelEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  };

  return (
    <div className="flex">
      <div className="w-64 flex-shrink-0 flex flex-col">
        <div className="px- py-3 flex-shrink-0">
          <span className="flex items-center gap-2 type-body  text-foreground">
            <span className="w-4 h-4 rounded-full bg-[#00a0e9] text-muted type-meta flex items-center justify-center">
              1
            </span>
            {t("chooseCategory")}
          </span>
        </div>
        <ul>
          {(categories ?? []).map((cat) => (
            <li
              key={cat.slug}
              onMouseEnter={() => handleCatEnter(cat)}
              onMouseLeave={handlePanelLeave}
              className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-all border-l-2
                ${
                  hoveredCat?.slug === cat.slug
                    ? "bg-[#00a0e9]/10 border-l-[#00a0e9]"
                    : "border-l-transparent hover:bg-gray-50"
                }`}
            >
              <div className="w-8 h-8 relative flex-shrink-0">
                <DbImage
                  src={cat.cateIcon}
                  alt={cat.name}
                  width={32}
                  height={32}
                  className="object-contain"
                  fallback={
                    <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-muted type-button-sm text-muted-foreground">
                      {cat.name.charAt(0)}
                    </span>
                  }
                />
              </div>
              <span
                className={`type-body flex-1 ${hoveredCat?.slug === cat.slug ? "font-semibold text-[#00a0e9]" : "font-normal text-foreground"}`}
              >
                {cat.name}
              </span>
              <ChevronRight
                className={`w-4 h-4 flex-shrink-0 transition-colors ${hoveredCat?.slug === cat.slug ? "text-[#00a0e9]" : "text-gray-500"}`}
              />
            </li>
          ))}
        </ul>
      </div>

      {/* Vertical Separator */}
      <div className="w-px bg-gray-200 flex-shrink-0" />

      {/* Right: Subcategories - scroll only when > 15 items */}
      <div
        className="flex-1  flex flex-col"
        onMouseEnter={handlePanelEnter}
        onMouseLeave={handlePanelLeave}
      >
        <div className="px-6 py-3 flex-shrink-0">
          <span className="flex items-center gap-2 type-body text-gray-500">
            <span
              className={`w-4 h-4 rounded-full type-meta flex items-center justify-center ${hoveredCat ? "bg-[#00a0e9]  text-foreground" : "bg-gray-300 text-white"}`}
            >
              2
            </span>
            {t("chooseSubcategory")}
          </span>
        </div>

        {hoveredCat ? (
          <ul
            className={
              hoveredCat.subcategories.length > 15 ? "overflow-y-auto" : ""
            }
            style={
              hoveredCat.subcategories.length > 15
                ? { maxHeight: "620px" }
                : undefined
            }
          >
            {hoveredCat.subcategories.map((sub) => (
              <li key={sub.slug}>
                <button
                  onClick={() => onSelect(hoveredCat, sub)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-blue-100 transition-colors group text-left"
                >
                  <div className="w-8 h-8 relative flex-shrink-0">
                    <DbImage
                      src={sub.subcate}
                      alt={sub.name}
                      width={32}
                      height={32}
                      className="object-contain"
                      fallback={
                        <span className="flex h-8 w-8 items-center justify-center rounded-sm bg-muted type-button-sm text-muted-foreground">
                          {sub.name.charAt(0)}
                        </span>
                      }
                    />
                  </div>
                  <span className="type-body text-foreground group-hover:text-[#00a0e9] group-hover:font-semibold flex-1 transition-colors">
                    {sub.name}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-[#00a0e9] flex-shrink-0 transition-colors" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-gray-400 py-24">
            <ChevronRight className="w-8 h-8 text-gray-200 mb-2" />
            <p className="type-body">{t("hoverHint")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Field Components ─────────────────────────────────────────────────────────
function SelectField({
  label,
  required,
  options,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block type-nav text-card-foreground mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-sm px-3 py-2.5 type-body text-card-foreground bg-card focus:outline-none focus:ring-2 focus:ring-[#00a0e9] focus:border-transparent appearance-none cursor-pointer"
      >
        <option value="">Select {label}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function InputField({
  label,
  required,
  placeholder,
  value,
  onChange,
  type = "text",
  icon,
}: {
  label: string;
  required?: boolean;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <label className="block type-nav text-card-foreground mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            {icon}
          </div>
        )}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full border border-gray-200 rounded-sm py-2.5 type-body text-card-foreground focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent ${icon ? "pl-9 pr-3" : "px-3"}`}
        />
      </div>
    </div>
  );
}

function TextareaField({
  label,
  required,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  required?: boolean;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block type-nav text-gray-700 mb-1.5">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 type-body text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent resize-none"
      />
    </div>
  );
}

function BrandModelField({
  sub,
  form,
  setForm,
}: {
  sub: Subcategory;
  form: FormData;
  setForm: (f: FormData) => void;
}) {
  if (!sub.brands) return null;
  const selectedBrand = sub.brands.find((b) => b.name === form.brand);
  return (
    <>
      <div>
        <label className="block type-nav text-card-foreground mb-1.5">
          Brand <span className="text-red-500">*</span>
        </label>
        <select
          value={(form.brand as string) || ""}
          onChange={(e) =>
            setForm({ ...form, brand: e.target.value, model: "" })
          }
          className="w-full border border-gray-200 rounded-sm px-3 py-2.5 type-body text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-[#00a0e9] focus:border-transparent"
        >
          <option value="">Select Brand</option>
          {sub.brands.map((b) => (
            <option key={b.slug} value={b.name}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      {selectedBrand?.Model && (
        <div>
          <label className="block type-nav text-card-foreground mb-1.5">
            Model
          </label>
          <select
            value={(form.model as string) || ""}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            className="w-full border border-gray-200 rounded-sm px-3 py-2.5 type-body text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-[#00a0e9] focus:border-transparent"
          >
            <option value="">{selectedBrand.Model?.[0].name} </option>
            {selectedBrand.Model.map((m) => (
              <option key={m.slug} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}

function TypesField({
  sub,
  form,
  setForm,
}: {
  sub: Subcategory;
  form: FormData;
  setForm: (f: FormData) => void;
}) {
  if (!sub.Types) return null;
  return (
    <div>
      <label className="block type-nav text-card-foreground mb-2">
        Type <span className="text-red-500">*</span>
      </label>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {sub.Types.map((t) => (
          <button
            key={t.slug}
            type="button"
            onClick={() => setForm({ ...form, type: t.name })}
            className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border-2 transition-all text-center
              ${form.type === t.name ? "border-orange-500 bg-orange-50" : "border-gray-200 hover:border-orange-300 hover:bg-orange-50"}`}
          >
            <div className="w-10 h-10 relative">
              <Image
                src={t.image}
                alt={t.name}
                width={200}
                height={200}
                className="object-contain"
                //onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </div>
            <span className="type-button-sm text-gray-600">{t.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorsField({
  sub,
  form,
  setForm,
}: {
  sub: Subcategory;
  form: FormData;
  setForm: (f: FormData) => void;
}) {
  if (!sub.colors) return null;
  const colorMap: Record<string, string> = {
    Red: "#ef4444",
    Blue: "#3b82f6",
    Green: "#22c55e",
    Yellow: "#eab308",
    Black: "#111827",
    White: "#f9fafb",
  };
  return (
    <div>
      <label className="block type-nav text-gray-700 mb-2">Color</label>
      <div className="flex flex-wrap gap-2">
        {sub.colors.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setForm({ ...form, color: c })}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border-2 type-button-sm transition-all
              ${form.color === c ? "border-orange-500" : "border-gray-200 hover:border-gray-300"}`}
          >
            <span
              className="w-4 h-4 rounded-full border border-gray-200"
              style={{ background: colorMap[c] ?? c }}
            />
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

function DiscountPriceField({
  sub,
  form,
  setForm,
}: {
  sub: Subcategory;
  form: FormData;
  setForm: (f: FormData) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {sub.discount && (
        <SelectField
          label="Discount Type"
          options={sub.discount}
          value={(form.discountType as string) || ""}
          onChange={(v) => setForm({ ...form, discountType: v })}
        />
      )}
      {sub.price !== undefined && (
        <div>
          <label className="block type-nav text-gray-700 mb-1.5">
            Price <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 type-body">
              $
            </span>
            <input
              type="number"
              value={(form.price as string) || ""}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="0"
              className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2.5 type-body text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Dynamic Form (Step 2) ────────────────────────────────────────────────────
function DynamicForm({
  category,
  sub,
  onBack,
}: {
  category: Category;
  sub: Subcategory;
  onBack: () => void;
}) {
  const [images, setImages] = useState<File[]>([]);
  // Parallel store of Supabase public URLs as photos finish uploading. Consumed
  // by the listing submit (still TODO); kept here so the upload mechanism is
  // fully wired today.
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [form, setForm] = useState<FormData>({});

  const isJob = !!sub.salary;

  // Listing submit is a tracked follow-up (dynamic field_schema form → POST
  // /listings). Photos are already uploaded to Supabase; stage their public
  // URLs here so the wiring is ready when the submit lands.
  const handleSubmit = () => {
    const photos = imageUrls.map((url, sort) => ({ url, path: url, sort }));
    if (photos.length === 0) {
      toast.error("Add at least one photo");
      return;
    }
    // TODO: POST /listings with `form` + `photos`.
    toast.success("Photos staged — listing submit is not wired yet");
  };

  return (
    <div className="space-y-6">
      {/* Reset / breadcrumb */}
      <div className="flex justify-between items-center">
        <div />
        <button
          onClick={onBack}
          className="type-nav text-[#00a0e9] hover:underline"
        >
          Reset
        </button>
      </div>

      {/* Photos */}

      <ImageUpload
        images={images}
        onChange={setImages}
        onUploaded={(url) => setImageUrls((prev) => [...prev, url])}
      />

      {/* Post Details */}
      <div className="space-y-4">
        <h2 className="type-section-title">Post Details</h2>
        <Separator />

        <InputField
          label="Title"
          required
          placeholder=""
          value={(form.title as string) || ""}
          onChange={(v) => setForm({ ...form, title: v })}
        />
        {/* Category breadcrumb */}
        <div>
          <label className="block type-nav text-card-foreground mb-1.5">
            Choose a category <span className="text-red-500">*</span>
          </label>
          <div className="flex items-center gap-3 border border-gray-200 rounded-sm px-3 py-2.5 flex-wrap">
            <span className="type-body text-foreground">{category.name}</span>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <span className="type-body  text-foreground">{sub.name}</span>
            <button
              onClick={onBack}
              className="type-nav bg-[#00a0e9] text-card px-3 py-1.5 rounded-sm hover:bg-[#00a0e9]/80 transition-colors"
            >
              Change
            </button>
          </div>
        </div>
        {/* Brand + Model */}
        <BrandModelField sub={sub} form={form} setForm={setForm} />
        {/* Years */}
        {sub.years && (
          <SelectField
            label="Year"
            required
            options={sub.years.map(String)}
            value={(form.year as string) || ""}
            onChange={(v) => setForm({ ...form, year: v })}
          />
        )}
        {/* Tax Types */}
        {sub.tax_types && (
          <div className="space-y-2">
            <label className="block type-nav text-foreground">
              Tax Type <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2 w-full">
              {sub.tax_types.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm({ ...form, taxType: t })}
                  className={`py-2.5 type-nav transition-all border rounded-sm
                    ${
                      form.taxType === t
                        ? "bg-[#e1f5fe] text-[#00a0e9] border-[#00a0e9]"
                        : "bg-card text-foreground border-gray-300 hover:border-[#00a0e9] hover:text-[#00a0e9]"
                    }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Condition */}
        {sub?.condition && (
          <div className="space-y-2">
            <label className="block type-nav text-foreground">
              Condition <span className="text-red-500">*</span>
            </label>
            {/* Using grid-cols-2 for perfect 50/50 split and gap-2 for the middle space */}
            <div className="grid grid-cols-2 gap-2 w-full">
              {sub.condition.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, condition: c })}
                  className={`py-2.5 type-nav transition-all border rounded-sm
                   ${
                     form.condition === c
                       ? "bg-[#e1f5fe] text-[#00a0e9] border-[#00a0e9]"
                       : "bg-card text-foreground border-gray-300 hover:border-[#00a0e9] hover:text-[#00a0e9]"
                   }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Types */}
        <TypesField sub={sub} form={form} setForm={setForm} />

        {/* Engine Types */}
        {sub.engine_types && (
          <SelectField
            label="Engine Type"
            options={sub.engine_types}
            value={(form.engineType as string) || ""}
            onChange={(v) => setForm({ ...form, engineType: v })}
          />
        )}

        {/* Transmission */}
        {sub.transmission && (
          <div className="space-y-2">
            <label className="block type-nav text-foreground">
              Transmission
            </label>
            <div className="grid grid-cols-2 gap-2 w-full">
              {sub.transmission.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm({ ...form, transmission: t })}
                  className={`py-2.5 type-nav transition-all border rounded-sm
                    ${
                      form.transmission === t
                        ? "bg-[#e1f5fe] text-[#00a0e9] border-[#00a0e9]"
                        : "bg-card text-foreground border-gray-300 hover:border-[#00a0e9] hover:text-[#00a0e9]"
                    }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Colors */}
        <ColorsField sub={sub} form={form} setForm={setForm} />

        {/* Storages */}
        {sub.storages && (
          <SelectField
            label="Storage"
            options={sub.storages}
            value={(form.storage as string) || ""}
            onChange={(v) => setForm({ ...form, storage: v })}
          />
        )}

        {/* Screen Size */}
        {sub.screen_size && (
          <SelectField
            label="Screen Size (inch)"
            options={sub.screen_size}
            value={(form.screenSize as string) || ""}
            onChange={(v) => setForm({ ...form, screenSize: v })}
          />
        )}

        {/* RAM */}
        {sub.ram && (
          <SelectField
            label="RAM"
            options={sub.ram}
            value={(form.ram as string) || ""}
            onChange={(v) => setForm({ ...form, ram: v })}
          />
        )}

        {/* CPU */}
        {sub.cpus && (
          <SelectField
            label="CPU"
            options={sub.cpus}
            value={(form.cpu as string) || ""}
            onChange={(v) => setForm({ ...form, cpu: v })}
          />
        )}

        {/* VGA */}
        {sub.vgas && (
          <SelectField
            label="VGA"
            options={sub.vgas}
            value={(form.vga as string) || ""}
            onChange={(v) => setForm({ ...form, vga: v })}
          />
        )}

        {/* Network */}
        {sub.network && (
          <div className="space-y-2">
            <label className="block type-nav text-gray-700">
              Network
              <span className="text-red-500">*</span>
            </label>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {sub.network.map((net) => (
                <button
                  key={net.slug}
                  type="button"
                  onClick={() => setForm({ ...form, network: net.slug })}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-all
            ${
              form.network === net.slug
                ? "border-orange-500 bg-orange-50 text-orange-600"
                : "border-gray-200 bg-white text-gray-700 hover:border-orange-300"
            }`}
                >
                  <Image
                    src={net.image}
                    width={20}
                    height={20}
                    alt={net.name}
                    className="object-contain"
                  />
                  <span className="type-nav">{net.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Accessories */}
        {sub.accessories && (
          <SelectField
            label="Compatible With"
            options={sub.accessories}
            value={(form.accessory as string) || ""}
            onChange={(v) => setForm({ ...form, accessory: v })}
          />
        )}

        {/* Bedrooms / Bathrooms */}
        {sub.bedrooms && (
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label="Bedrooms"
              options={sub.bedrooms.map(String)}
              value={(form.bedrooms as string) || ""}
              onChange={(v) => setForm({ ...form, bedrooms: v })}
            />
            {sub.bathrooms && (
              <SelectField
                label="Bathrooms"
                options={sub.bathrooms.map(String)}
                value={(form.bathrooms as string) || ""}
                onChange={(v) => setForm({ ...form, bathrooms: v })}
              />
            )}
          </div>
        )}

        {/* Facing */}
        {sub.facing && (
          <SelectField
            label="Facing"
            options={sub.facing}
            value={(form.facing as string) || ""}
            onChange={(v) => setForm({ ...form, facing: v })}
          />
        )}

        {/* Size */}
        {sub.size !== undefined && (
          <InputField
            label="Size"
            placeholder="e.g. 200 sqft"
            value={(form.size as string) || ""}
            onChange={(v) => setForm({ ...form, size: v })}
          />
        )}

        {/* Experience (Jobs) */}
        {sub.experience && (
          <SelectField
            label="Experience Required"
            required
            options={sub.experience}
            value={(form.experience as string) || ""}
            onChange={(v) => setForm({ ...form, experience: v })}
          />
        )}

        {/* Salary (Jobs) */}
        {isJob && (
          <div>
            <label className="block type-nav text-gray-700 mb-1.5">
              Salary <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="number"
                value={(form.salary as string) || ""}
                onChange={(e) => setForm({ ...form, salary: e.target.value })}
                placeholder="Monthly salary"
                className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 type-body text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
          </div>
        )}

        {/* Price + Discount */}
        {!isJob && (sub.price !== undefined || sub.discount) && (
          <DiscountPriceField sub={sub} form={form} setForm={setForm} />
        )}

        {/* Delivery */}
        {sub.delivery !== undefined && !isJob && (
          <div>
            <label className="block type-nav text-gray-700 mb-2">
              Delivery Available
            </label>
            <div className="flex gap-2">
              {["Yes", "No"].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setForm({ ...form, delivery: v === "Yes" })}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 type-nav transition-all
                    ${
                      (form.delivery === true && v === "Yes") ||
                      (form.delivery === false && v === "No")
                        ? "border-orange-500 bg-orange-50 text-orange-600"
                        : "border-gray-200 text-gray-600 hover:border-orange-300"
                    }`}
                >
                  <Truck className="w-4 h-4" />
                  {v}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        <TextareaField
          label="Description"
          required
          placeholder="Describe your listing in detail..."
          value={(form.description as string) || ""}
          onChange={(v) => setForm({ ...form, description: v })}
        />
      </div>

      {/* Location & Contact */}
      <div className="bg-white rounded-xl p-5 space-y-4">
        <h2 className="type-card-heading text-gray-800 border-b border-gray-100 pb-3">
          Location & Contact
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InputField
            label="Location"
            required
            placeholder="City / Province"
            value={(form.location as string) || ""}
            onChange={(v) => setForm({ ...form, location: v })}
            icon={<MapPin className="w-4 h-4" />}
          />
          <InputField
            label="Address"
            placeholder="Street address"
            value={(form.address as string) || ""}
            onChange={(v) => setForm({ ...form, address: v })}
            icon={<MapPin className="w-4 h-4" />}
          />
          <InputField
            label="Company Name"
            placeholder="Your company (optional)"
            value={(form.company_name as string) || ""}
            onChange={(v) => setForm({ ...form, company_name: v })}
            icon={<Building2 className="w-4 h-4" />}
          />
          <InputField
            label="Contact Name"
            required
            placeholder="Your name"
            value={(form.name_contact as string) || ""}
            onChange={(v) => setForm({ ...form, name_contact: v })}
            icon={<User className="w-4 h-4" />}
          />
          <InputField
            label="Phone"
            required
            placeholder="+855 ..."
            type="tel"
            value={(form.phone as string) || ""}
            onChange={(v) => setForm({ ...form, phone: v })}
            icon={<Phone className="w-4 h-4" />}
          />
          <InputField
            label="Email"
            placeholder="email@example.com"
            type="email"
            value={(form.email as string) || ""}
            onChange={(v) => setForm({ ...form, email: v })}
            icon={<Mail className="w-4 h-4" />}
          />
        </div>
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-3 pb-8">
        <button
          onClick={onBack}
          className="px-6 py-2.5 rounded-lg border border-gray-200 type-nav text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          className="px-8 py-2.5 rounded-lg bg-orange-500 text-white type-body hover:bg-orange-600 transition-colors shadow-sm shadow-orange-200"
        >
          Post Ad
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PostPage() {
  const t = useTranslations("PostAd");
  const tSearch = useTranslations("Search");
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(
    null,
  );
  const [selectedSub, setSelectedSub] = useState<Subcategory | null>(null);

  const handleSelect = (cat: Category, sub: Subcategory) => {
    setSelectedCategory(cat);
    setSelectedSub(sub);
    setStep(2);
  };

  const handleBack = () => {
    setStep(1);
    setSelectedCategory(null);
    setSelectedSub(null);
  };

  return (
    <div className="min-h-screen bg-muted">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Breadcrumbs
          className="mb-6"
          items={[
            { label: tSearch("home"), href: "/" },
            { label: t("breadcrumb") },
          ]}
        />

        <div className="bg-card border rounded-sm p-6 shadow-sm">
          <h1 className="type-page-title mb-1">{t("title")}</h1>
          <StepIndicator step={step} />

          {step === 1 ? (
            <>
              <Separator />
              <br />

              <CategorySelector onSelect={handleSelect} />
            </>
          ) : (
            selectedCategory &&
            selectedSub &&
            (REAL_FORM_SUBCATEGORIES.includes(selectedSub.slug) ? (
              <ListingPostForm
                categorySlug={selectedCategory.slug}
                subcategorySlug={selectedSub.slug}
                categoryName={selectedCategory.name}
                subName={selectedSub.name}
                onBack={handleBack}
              />
            ) : (
              <DynamicForm
                category={selectedCategory}
                sub={selectedSub}
                onBack={handleBack}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

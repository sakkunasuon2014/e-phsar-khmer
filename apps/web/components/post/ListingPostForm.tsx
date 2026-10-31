"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { useRouter } from "@/i18n/routing";
import { ChevronDown, ChevronRight, Loader2, Minus, Plus } from "lucide-react";

import ImageUpload from "@/components/post/ImageUpload";
import LocationMapPicker from "@/components/post/LocationMapPicker";
import { FieldLabel } from "@/components/post/FieldLabel";
import LocationPicker, {
  EMPTY_PLACE,
  placeLabel,
  type PlaceSelection,
} from "@/components/post/LocationPicker";
import type { MapCoords } from "@/components/post/location-map.constants";
import { signUploadUser } from "@/actions/files";
import {
  createListing,
  getBrandModels,
  getListingFormConfig,
  type CreateListingPayload,
  type ListingFormConfig,
} from "@/actions/listings";
import type { BackendModel } from "@/lib/api/categories";
import { describeBucket } from "@/lib/subscription-pricing";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import DbImage from "@/components/common/DbImage";

/** Spec-fixed pickers with no backend source (spec-detail-one.md:210-228). */
const TAX_TYPES = ["Tax Paper", "Plate Number"] as const;
const ENGINE_TYPES = ["Diesel", "Electric", "Hybrid", "LPG", "Petrol"] as const;
const TRANSMISSIONS = ["Auto", "Manual"] as const;

/** Stored engine values → `PostForm.options.*` message keys. */
const ENGINE_KEYS: Record<string, string> = {
  Diesel: "diesel",
  Electric: "electric",
  Hybrid: "hybrid",
  LPG: "lpg",
  Petrol: "petrol",
};

/** English `field_schema` labels → `PostForm.labels.*` message keys. */
const LABEL_KEYS: Record<string, string> = {
  Photos: "photos",
  Logo: "logo",
  Title: "title",
  "Job Title": "jobTitle",
  Brand: "brand",
  Model: "model",
  "Product Spec": "productSpec",
  "Product Specification": "productSpec",
  Year: "year",
  "Tax Type": "taxType",
  Condition: "condition",
  "Body Type": "bodyType",
  "Engine Type": "engineType",
  Transmission: "transmission",
  Color: "color",
  Price: "price",
  "Minimum salary": "minSalary",
  Discount: "discount",
  "Free Delivery": "deliveryFree",
  Description: "description",
  Location: "location",
  Address: "address",
  Company: "company",
  Name: "name",
  "Phone Number": "phone",
  Email: "email",
  Bedroom: "bedroom",
  Bathroom: "bathroom",
  Facing: "facing",
  Size: "size",
  Accessory: "accessory",
  "Accessory Type": "accessoryType",
  Network: "network",
  Type: "type",
  "Job Type": "jobType",
  Experience: "experience",
  "Screen Size": "screenSize",
  Storage: "storage",
  RAM: "ram",
  CPU: "cpu",
  VGA: "vga",
  "Vehicle Type": "vehicleType",
};

/**
 * Where the Condition block sits in a subcategory's Post Details section.
 *
 * The design puts Condition in a different place on almost every form and the
 * `field_schema` cannot arbitrate: Cars For Sale's own schema lists Condition
 * before Body Type while its approved layout puts it after (docs/post-form-layout.md
 * rows 11/15). So the slot is declared here, per subcategory:
 *
 *  - `lead` — directly under the identity pickers and above the spec cluster
 *    (Screen Size/Storage/RAM/CPU/VGA). The computers forms, where Condition is
 *    the second field after Brand.
 *  - `afterScreenSize` — All-in-One and Monitors put Screen Size first and
 *    Condition directly beneath it.
 *  - `beforeBodyType` — Lorries, Vans & Tractors follows its own mock and its
 *    schema order, condition → bodyType (captain, 2026-09-21). Only applies
 *    when the subcategory also declares bodyType; otherwise it falls back to
 *    the normal slot.
 *  - anything unlisted — the normal slot, after Tax Type (cars, motorcycles,
 *    Phones & Tablets).
 */
const CONDITION_SLOT: Record<
  string,
  "lead" | "afterScreenSize" | "beforeBodyType"
> = {
  laptops: "lead",
  desktops: "lead",
  "printers-and-scanners": "lead",
  "computers-parts-and-accessories": "lead",
  "all-in-one": "afterScreenSize",
  monitors: "afterScreenSize",
  "lorries-vans-and-tractors": "beforeBodyType",
};

/**
 * Subcategories that star Storage. Every computers form stars it; Phones &
 * Tablets' mock approved it unstarred, and required-ness is hardcoded per block
 * because `field_schema.required` is not consumed (tasks/todo.md) — so this is
 * the one field whose star has to differ between families.
 */
const STORAGE_REQUIRED = ["laptops", "desktops", "all-in-one"];

/**
 * Subcategories whose Type picker is NOT starred (captain's Home & Land mocks,
 * 2026-09-22 and 2026-09-23). `type` is required on every other form that
 * declares it — Computers Parts & Accessories and the electronics family — so
 * this is the short exception list rather than a positive `TYPE_REQUIRED` one,
 * the mirror of `STORAGE_REQUIRED` above. Required-ness is hardcoded per block
 * because `field_schema.required` is not consumed.
 */
const TYPE_OPTIONAL = new Set([
  "house-for-sale",
  "house-for-rent",
  // The commercial forms declare `type` too (Building/Factory/Hotel/Offices/
  // Restaurant/Shop/Warehouse, ticked in the `types` set) and their mock also
  // leaves it unstarred (2026-09-23).
  "commercial-properties-for-sale",
  "commercial-properties-for-rent",
]);

// ─── Shared field bits (styled to match the page's inline fields) ─────────────
function TextInput({
  label,
  value,
  onChange,
  required,
  placeholder,
  type = "text",
  maxLength,
  min,
  prefix,
  trailing,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  placeholder?: string;
  type?: string;
  maxLength?: number;
  min?: number;
  /** Glyph shown inside the field's left edge (e.g. the price's "$"). */
  prefix?: string;
  /** Control pinned inside the field's right edge (e.g. the row's remove). */
  trailing?: React.ReactNode;
}) {
  return (
    <div>
      <FieldLabel label={label} required={required} />
      <div className="relative">
        {prefix && (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 type-body text-gray-500">
            {prefix}
          </span>
        )}
        <input
          type={type}
          value={value}
          maxLength={maxLength}
          min={min}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          // Chrome changes a focused number input on wheel — scrolling the
          // page with the cursor over the field just typed silently walked
          // "1" down to "0" (captain, 2026-10-28). Blur on wheel so the
          // scroll moves the page, never the value.
          onWheel={
            type === "number"
              ? (event) => event.currentTarget.blur()
              : undefined
          }
          className={`w-full border border-gray-200 rounded-lg py-2.5 type-body text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent ${
            prefix ? "pl-7" : "pl-3"
          } ${trailing ? "pr-14" : "pr-3"}`}
        />
        {trailing && (
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
            {trailing}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Searchable picker for long option lists (91+ brands, a brand's models):
 * the trigger opens a panel with a Search field over a scrolling list. Images
 * go through DbImage, so only Storage-backed icons render; the logo slot is
 * kept only when the option set actually carries images.
 */
function SearchPicker({
  label,
  options,
  value,
  onChange,
  required,
  disabled,
  placeholder,
  emptyLabel,
  showOnlyKm,
  resolveInput,
}: {
  label: string;
  options: {
    id: string;
    name: string;
    nameKm?: string | null;
    image?: string | null;
  }[];
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
  /** Inert until its parent choice is made (a disabled button fires no click,
   *  so the popover can never open); renders empty rather than a placeholder. */
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  /** Drop the English half of `nameKm/name` (colours and the range pickers). */
  showOnlyKm?: boolean;
  /**
   * Optional paste resolver (the Product Spec picker): a pasted product URL is
   * matched against the loaded options and selected outright. Normal search
   * filtering is untouched — a miss simply falls through to it.
   */
  resolveInput?: (text: string) => { id: string; name: string } | null;
}) {
  const t = useTranslations("PostForm");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  /**
   * Inline pick-list ranges (storage / screen size / RAM / VGA) carry no
   * `nameKm` in the DB — their seeded options are strings like "1TB & Above".
   * Translate only the words; the number/unit prefix is already universal and
   * the stored value stays the English option name.
   */
  const kmOptionLabel = (name: string): string | null => {
    if (name === "Integrated") return t("options.integrated");
    const above = name.match(/^(.*?)\s*&\s*(?:Above|Larger)$/);
    if (above) return t("options.andAbove", { value: above[1] });
    const below = name.match(/^(.*?)\s*(?:&\s*(?:Under|Below)|or below)$/);
    if (below) return t("options.andBelow", { value: below[1] });
    return null;
  };
  const optionKm = (option: { name: string; nameKm?: string | null }) =>
    option.nameKm ?? (locale === "km" ? kmOptionLabel(option.name) : null);
  /** Bilingual on km ("សេដាន/Sedan"); the stored value stays the English name. */
  const displayName = (option: { name: string; nameKm?: string | null }) => {
    const km = optionKm(option);
    return locale === "km" && km
      ? showOnlyKm
        ? km
        : `${km}/${option.name}`
      : option.name;
  };
  const selected = options.find((o) => o.id === value);
  const withIcons = options.some((o) => !!o.image);

  return (
    <div>
      <FieldLabel label={label} required={required} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            // Keyboard paste on the focused (closed) trigger: the placeholder
            // invites pasting a link, so it must work before the panel opens
            // too — clicking the trigger opens the panel and pastes land in
            // the CommandInput instead.
            onPaste={
              resolveInput
                ? (event) => {
                    const hit = resolveInput(
                      event.clipboardData.getData("text"),
                    );
                    if (!hit) return;
                    event.preventDefault();
                    onChange(hit.id);
                  }
                : undefined
            }
            className={`flex w-full items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5 text-left type-body focus:outline-none ${
              disabled
                ? "cursor-not-allowed bg-gray-100 text-gray-400"
                : "cursor-pointer text-gray-700 focus:ring-2 focus:ring-orange-400 focus:border-transparent"
            }`}
          >
            <span className={selected ? "" : "text-gray-400"}>
              {selected
                ? displayName(selected)
                : disabled
                  ? ""
                  : (placeholder ?? t("chooseOption"))}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command>
            <CommandInput
              placeholder={t("search")}
              onPaste={
                resolveInput
                  ? (event) => {
                      const hit = resolveInput(
                        event.clipboardData.getData("text"),
                      );
                      if (!hit) return;
                      event.preventDefault();
                      onChange(hit.id);
                      setOpen(false);
                    }
                  : undefined
              }
            />
            <CommandList>
              <CommandEmpty>{emptyLabel ?? t("noMatch")}</CommandEmpty>
              {options.map((option) => {
                const km = optionKm(option);
                return (
                  <CommandItem
                    key={option.id}
                    value={km ? `${km} ${option.name}` : option.name}
                    onSelect={() => {
                      onChange(option.id);
                      setOpen(false);
                    }}
                    className="cursor-pointer"
                  >
                    {withIcons && (
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                        <DbImage
                          src={option.image ?? ""}
                          alt=""
                          width={24}
                          height={24}
                          className="object-contain"
                        />
                      </span>
                    )}
                    <span>{displayName(option)}</span>
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function ToggleGroup({
  label,
  value,
  onChange,
  options,
  required,
  displayLabels,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  required?: boolean;
  /** Localized labels keyed by the stored English value. */
  displayLabels?: Record<string, string>;
}) {
  return (
    <div>
      <FieldLabel label={label} required={required} />
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        }}
      >
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`h-11 cursor-pointer rounded-sm border type-nav transition-colors ${
              value === o
                ? "border-gray-300 bg-gray-100 font-medium text-gray-800"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
            }`}
          >
            {displayLabels?.[o] ?? o}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Listing form ─────────────────────────────────────────────────────────────
/**
 * The real listing-creation form for a subcategory.
 *
 * Every block is gated on the subcategory's own backend `field_schema`: a field
 * renders iff its key is in `config.fields`. That is what makes Cars For Sale
 * (brand/model/year/tax/body type/engine/transmission/colour) and Bicycles
 * (title/condition/price/discount/description/location/contact) the same
 * component with different declared fields — the schema is the single source of
 * truth for which fields a category has, so a newly seeded subcategory needs no
 * new form code, only an entry in the post page's real-form list.
 */
export default function ListingPostForm({
  categorySlug,
  subcategorySlug,
  categoryName,
  subName,
  onBack,
}: {
  categorySlug: string;
  subcategorySlug: string;
  categoryName: string;
  subName: string;
  onBack: () => void;
}) {
  const locale = useLocale();
  const t = useTranslations("PostForm");
  const router = useRouter();

  const [config, setConfig] = useState<ListingFormConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);

  const [files, setFiles] = useState<File[]>([]);
  const [photos, setPhotos] = useState<{ url: string; path: string }[]>([]);

  const [brandId, setBrandId] = useState("");
  const [models, setModels] = useState<BackendModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [model, setModel] = useState("");
  // The trusted spec page this phone ad links to (a `models` id). Kept apart
  // from `attributes` — the backend stores it on `listings.product_model_id`.
  const [productModelId, setProductModelId] = useState("");
  const [year, setYear] = useState("");
  const [condition, setCondition] = useState("");
  const [vehicleType, setVehicleType] = useState("");
  const [bodyType, setBodyType] = useState("");
  const [engineType, setEngineType] = useState("");
  const [transmission, setTransmission] = useState("");
  const [taxType, setTaxType] = useState("");
  const [color, setColor] = useState("");
  const [typeValue, setTypeValue] = useState("");
  const [screenSize, setScreenSize] = useState("");
  const [storage, setStorage] = useState("");
  const [ram, setRam] = useState("");
  const [cpu, setCpu] = useState("");
  const [vga, setVga] = useState("");
  const [accessory, setAccessory] = useState("");
  const [network, setNetwork] = useState("");
  // Jobs family — Job Type and Experience are pickers (see PICKER_ATTR_TYPES
  // for where each list comes from), Company a plain text field.
  const [jobType, setJobType] = useState("");
  const [experience, setExperience] = useState("");
  const [company, setCompany] = useState("");
  // Home & Land property cluster — `size` is the only free-text one; Bedroom,
  // Bathroom, Facing and Type are all pickers.
  const [bedroom, setBedroom] = useState("");
  const [bathroom, setBathroom] = useState("");
  const [facing, setFacing] = useState("");
  const [size, setSize] = useState("");

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [discountValue, setDiscountValue] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "amount">(
    "percent",
  );
  const [description, setDescription] = useState("");
  const [place, setPlace] = useState<PlaceSelection>(EMPTY_PLACE);
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<MapCoords | null>(null);
  const [deliveryFree, setDeliveryFree] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhones, setContactPhones] = useState(["", "", ""]);
  // Visible phone rows (1-3) — the "+" adds one, a row's ⊖ removes it.
  const [phoneRows, setPhoneRows] = useState(1);
  const [contactEmail, setContactEmail] = useState("");

  const [submitting, setSubmitting] = useState(false);

  /** Does this subcategory's field schema declare `key`? */
  const has = (key: string) => !!config?.fields.includes(key);

  // Runs once per mount: the page unmounts this form on "Change"/"Reset"
  // (step goes back to 1), so a different subcategory always gets a fresh
  // instance and `configLoading` never needs resetting mid-life.
  useEffect(() => {
    let cancelled = false;
    getListingFormConfig(categorySlug, subcategorySlug, locale).then((cfg) => {
      if (cancelled) return;
      if (!cfg) {
        setConfigError(true);
        toast.error(t("loadErrorToast"));
      } else {
        setConfig(cfg);
        // Prefill the contact section from the logged-in user's profile.
        if (cfg.contact.name) setContactName(cfg.contact.name);
        const prefilled = [
          cfg.contact.phones[0] ?? "",
          cfg.contact.phones[1] ?? "",
          cfg.contact.phones[2] ?? "",
        ];
        setContactPhones(prefilled);
        setPhoneRows(
          Math.min(3, Math.max(1, prefilled.filter((x) => x.trim()).length)),
        );
        setContactEmail(cfg.contact.email ?? "");
        // Location + Address start from the profile too, but only where the
        // subcategory's schema declares the block — the same gate that decides
        // whether it renders at all. Read `cfg.fields`, not `has()`: `config`
        // state is not set yet inside this callback.
        const declares = (key: string) => cfg.fields.includes(key);
        if (declares("location")) {
          setPlace({
            province: cfg.location.province,
            district: cfg.location.district,
            commune: cfg.location.commune,
          });
        }
        if (declares("address") && cfg.location.address) {
          setAddress(cfg.location.address);
        }
      }
      setConfigLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [categorySlug, subcategorySlug, locale, t]);

  const onBrandChange = async (id: string) => {
    setBrandId(id);
    setModel("");
    // Changing the ad's identity drops its spec link: the page is for one
    // model, so a mismatched pair would advertise someone else's specs.
    setProductModelId("");
    setModels([]);
    if (!id) return;
    setModelsLoading(true);
    try {
      // Scoped to this subcategory — a tablet form must not offer iPhones.
      setModels(await getBrandModels(id, subcategorySlug));
    } catch {
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  /**
   * Attach a trusted spec page. Selecting it also fills Brand/Model when they
   * are still empty, so the ad and the linked page agree; a later Brand/Model
   * change clears the link (see `onBrandChange` and the model picker).
   */
  const applyProductSelection = async (modelId: string) => {
    setProductModelId(modelId);
    const product = config?.products.find((p) => p.modelId === modelId);
    if (!product) return;

    if (has("brand") && brandId === "") {
      if (!config?.brands.some((b) => b.id === product.brandId)) return;
      setBrandId(product.brandId);
      setModel("");
      setModels([]);
      setModelsLoading(true);
      try {
        const list = await getBrandModels(product.brandId, subcategorySlug);
        setModels(list);
        if (list.some((m) => m.name === product.modelName)) {
          setModel(product.modelName);
        }
      } catch {
        setModels([]);
      } finally {
        setModelsLoading(false);
      }
      return;
    }

    if (
      has("model") &&
      model === "" &&
      models.some((m) => m.name === product.modelName)
    ) {
      setModel(product.modelName);
    }
  };

  /**
   * Pasted product URLs (`/en/product/apple/iphone-16`) resolve locally against
   * the published list. A URL-shaped paste that does not resolve (an external
   * link, or a product page that is not published) gets a toast — silently
   * filtering the list read as "paste is not allowed" (2026-10-28).
   */
  const resolveProductPaste = (text: string) => {
    const trimmed = text.trim();
    const looksLikeUrl =
      /^(https?:\/\/|\/)/i.test(trimmed) || trimmed.includes("/product/");
    const match = trimmed.match(/\/?product\/([^/?#\s]+)\/([^/?#\s]+)\/?/);
    const product = match
      ? config?.products.find(
          (p) =>
            p.brandSlug === decodeURIComponent(match[1]) &&
            p.modelSlug === decodeURIComponent(match[2]),
        )
      : undefined;
    if (!product) {
      if (looksLikeUrl) toast.error(t("errors.productLinkInvalid"));
      return null;
    }
    return {
      id: product.modelId,
      name: `${product.brandName} ${product.modelName}`,
    };
  };

  const submit = async () => {
    if (!config) {
      toast.error(t("errors.formNotLoaded"));
      return;
    }
    if (has("title") && !title.trim()) {
      toast.error(t("errors.titleRequired"));
      return;
    }
    const priceNum = Number(price);
    if (
      has("price") &&
      (price === "" || !Number.isFinite(priceNum) || priceNum <= 0)
    ) {
      toast.error(t("errors.priceInvalid"));
      return;
    }
    if (
      has("type") &&
      typeValue === "" &&
      !TYPE_OPTIONAL.has(subcategorySlug)
    ) {
      toast.error(t("errors.typeRequired"));
      return;
    }
    // Jobs' two pickers are starred in the design (2026-09-23 mock), so an
    // empty one is a star that lies — enforce both here.
    if (has("jobType") && jobType === "") {
      toast.error(t("errors.jobTypeRequired"));
      return;
    }
    if (has("experience") && experience === "") {
      toast.error(t("errors.experienceRequired"));
      return;
    }
    if (has("accessory") && accessory === "") {
      toast.error(t("errors.accessoryRequired"));
      return;
    }
    if (has("network") && network === "") {
      toast.error(t("errors.networkRequired"));
      return;
    }
    if (has("brand") && brandId === "") {
      toast.error(t("errors.brandRequired"));
      return;
    }
    // The trusted spec link is starred on the phones form — enforce it here or
    // the star is a lie (required-ness is never read from `field_schema`).
    if (has("productSpec") && productModelId === "") {
      toast.error(t("errors.productRequired"));
      return;
    }
    // The computers spec cluster — all starred on every form that declares them.
    if (has("screenSize") && screenSize === "") {
      toast.error(t("errors.screenSizeRequired"));
      return;
    }
    if (
      has("storage") &&
      STORAGE_REQUIRED.includes(subcategorySlug) &&
      storage === ""
    ) {
      toast.error(t("errors.storageRequired"));
      return;
    }
    if (has("ram") && ram === "") {
      toast.error(t("errors.ramRequired"));
      return;
    }
    if (has("cpu") && cpu === "") {
      toast.error(t("errors.cpuRequired"));
      return;
    }
    if (has("vga") && vga === "") {
      toast.error(t("errors.vgaRequired"));
      return;
    }
    if (has("year") && year === "") {
      toast.error(t("errors.yearRequired"));
      return;
    }
    if (has("vehicleType") && vehicleType === "") {
      toast.error(t("errors.vehicleTypeRequired"));
      return;
    }
    if (has("taxType") && taxType === "") {
      toast.error(t("errors.taxTypeRequired"));
      return;
    }
    if (has("condition") && condition === "") {
      toast.error(t("errors.conditionRequired"));
      return;
    }
    if (has("color") && color === "") {
      toast.error(t("errors.colorRequired"));
      return;
    }
    // These three carry a red `*` on screen, so they must be enforced here or
    // the star is a lie. It matters more than it looks: the create DTO marks
    // all three optional, so an empty Location does not 400 — it publishes a
    // listing with no `location`, which then matches no province/district
    // filter and is invisible to location search (the silent drop migration
    // 0018 was written to prevent).
    if (has("description") && !description.trim()) {
      toast.error(t("errors.descriptionRequired"));
      return;
    }
    if (has("location") && !placeLabel(place)) {
      toast.error(t("errors.locationRequired"));
      return;
    }
    if (has("address") && !address.trim()) {
      toast.error(t("errors.addressRequired"));
      return;
    }
    if (has("contactName") && !contactName.trim()) {
      toast.error(t("errors.contactNameRequired"));
      return;
    }
    if (has("contactPhones") && !(contactPhones[0] ?? "").trim()) {
      toast.error(t("errors.phoneRequired"));
      return;
    }

    const attributes: Record<string, unknown> = {};
    if (has("brand"))
      attributes.brand =
        config.brands.find((b) => b.id === brandId)?.name ?? brandId;
    if (has("year") && year) attributes.year = year;
    if (has("model") && model) attributes.model = model;
    if (has("vehicleType") && vehicleType) attributes.vehicleType = vehicleType;
    if (has("bodyType") && bodyType) attributes.bodyType = bodyType;
    if (has("engineType") && engineType) attributes.engineType = engineType;
    if (has("transmission") && transmission)
      attributes.transmission = transmission;
    if (has("taxType") && taxType) attributes.taxType = taxType;
    if (has("color") && color) attributes.color = color;
    if (has("type") && typeValue) attributes.type = typeValue;
    if (has("jobType") && jobType) attributes.jobType = jobType;
    if (has("experience") && experience) attributes.experience = experience;
    if (has("company") && company.trim()) attributes.company = company.trim();
    // Keys are the schema's own — singular `bedroom`/`bathroom`, which is what
    // the seeded `field_schema` declares and what `ListingSpecs` reads back.
    if (has("bedroom") && bedroom) attributes.bedroom = bedroom;
    if (has("bathroom") && bathroom) attributes.bathroom = bathroom;
    if (has("facing") && facing) attributes.facing = facing;
    if (has("size") && size) attributes.size = size;
    if (has("screenSize") && screenSize) attributes.screenSize = screenSize;
    if (has("storage") && storage) attributes.storage = storage;
    if (has("ram") && ram) attributes.ram = ram;
    if (has("cpu") && cpu) attributes.cpu = cpu;
    if (has("vga") && vga) attributes.vga = vga;
    if (has("accessory") && accessory) attributes.accessory = accessory;
    if (has("network") && network) attributes.network = network;

    const payload: CreateListingPayload = {
      categoryId: config.categoryId,
      subcategoryId: config.subcategoryId,
      title: title.trim(),
      attributes,
      location: placeLabel(place) || undefined,
      address: address.trim() || undefined,
      provinceId: place.province?.id,
      districtId: place.district?.id,
      communeId: place.commune?.id,
      latitude: coords?.lat,
      longitude: coords?.lng,
      deliveryFree,
      contactName: contactName.trim(),
      contactPhones: contactPhones
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
      contactEmail: contactEmail.trim() || undefined,
      description: description.trim() || undefined,
    };
    if (has("price")) payload.price = priceNum;
    if (has("condition")) {
      payload.condition = condition === "New" ? "new" : "used";
    }
    // 0 / empty means "no discount" — never persist a zero discount, which the
    // cards render as a real "-0%" badge and a pointless strikethrough price
    // (captain, 2026-10-28).
    if (has("discount") && Number(discountValue) > 0) {
      payload.discountValue = Number(discountValue);
      payload.discountType = discountType;
    }
    if (photos.length > 0) {
      payload.photos = photos.map((p, sort) => ({ ...p, sort }));
    }
    if (has("productSpec") && productModelId) {
      payload.productModelId = productModelId;
    }

    setSubmitting(true);
    const result = await createListing(payload);
    setSubmitting(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Your ad was published");
    router.push({
      pathname: "/post/[slug]",
      params: { slug: result.listingId },
    });
  };

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-400">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  if (configError || !config) {
    return (
      <div className="py-16 text-center text-gray-500">
        <p className="mb-4">{t("loadError")}</p>
        <button
          onClick={onBack}
          className="type-nav text-[#00a0e9] hover:underline"
        >
          {t("back")}
        </button>
      </div>
    );
  }

  /** The schema's English label, translated through `PostForm.labels.*`. */
  const labelFor = (key: string, fallback: string) => {
    const raw = config.labels[key] ?? fallback;
    const messageKey = LABEL_KEYS[raw];
    return messageKey ? t(`labels.${messageKey}`) : raw;
  };

  const removePhoneRow = (index: number) => {
    setContactPhones((prev) => {
      const next = [...prev];
      next.splice(index, 1); // drop this row and shift the rest up
      next.push("");
      return next;
    });
    setPhoneRows((n) => Math.max(1, n - 1));
  };

  // Condition has four possible slots (see CONDITION_SLOT), so it is built once
  // here and rendered at whichever one this subcategory uses.
  const declaredSlot = CONDITION_SLOT[subcategorySlug];
  const conditionSlot =
    declaredSlot === "beforeBodyType" && !has("bodyType")
      ? undefined
      : declaredSlot;
  const conditionBlock = has("condition") ? (
    <ToggleGroup
      label={labelFor("condition", "Condition")}
      required
      options={["New", "Used"]}
      displayLabels={{
        New: t("options.new"),
        Used: t("options.used"),
      }}
      value={condition}
      onChange={setCondition}
    />
  ) : null;
  const bucketCopy = describeBucket(config.plan?.bucket ?? null);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <div />
        <button
          onClick={onBack}
          className="type-nav text-[#00a0e9] hover:underline cursor-pointer"
        >
          {t("reset")}
        </button>
      </div>

      {config.plan && (
        <div
          role="status"
          className={`flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-sm ring-1 ${
            config.plan.usage.ads >= config.plan.limits.ads
              ? "bg-amber-500/10 text-amber-800 ring-amber-500/30 dark:text-amber-300"
              : "bg-muted text-muted-foreground ring-border"
          }`}
        >
          <span>
            {/* Limits are per bucket: the group subscription covering this
                subcategory, else the free cap for where it is posted. */}
            <strong className="font-semibold text-foreground">
              {bucketCopy.planLabel}
            </strong>{" "}
            · {config.plan.usage.ads} of {config.plan.limits.ads} ads used ·{" "}
            {bucketCopy.scopeLabel} · up to {config.plan.limits.photos} photos
            per ad
          </span>
          <Link
            href="/premium-account"
            className="font-semibold text-[#0089c8] hover:underline"
          >
            {bucketCopy.ctaLabel}
          </Link>
        </div>
      )}

      {/* ── Photos ─────────────────────────────────────────────────────────── */}
      <ImageUpload
        images={files}
        onChange={setFiles}
        signFn={signUploadUser}
        onSigned={(p) => setPhotos((prev) => [...prev, p])}
        title={labelFor("photos", "Photos")}
        max={config.photoMax}
      />

      {/* ── Post Details ───────────────────────────────────────────────────── */}
      <div className="space-y-5">
        <h2 className="type-section-title text-foreground">
          {t("postDetails")}
        </h2>

        {has("title") && (
          <TextInput
            label={labelFor("title", "Title")}
            required
            maxLength={200}
            value={title}
            onChange={setTitle}
          />
        )}

        {/* Category breadcrumb */}
        <div>
          <FieldLabel label={t("category")} required />
          <div className="flex flex-wrap items-center gap-3 rounded-sm border border-dashed border-gray-300 px-3 py-2.5">
            <span className="type-body text-foreground">{categoryName}</span>
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <span className="type-body text-foreground">{subName}</span>
            <button
              onClick={onBack}
              className="rounded-sm bg-[#00a0e9] px-4 py-1.5 type-nav text-card transition-colors hover:bg-[#00a0e9]/80 cursor-pointer"
            >
              {t("change")}
            </button>
          </div>
        </div>

        {/* ── Home & Land property cluster ────────────────────────────────────
            Bedroom, Bathroom, Facing and Size sit ABOVE the identity cluster
            because the captain's mock reads Bedroom → Bathroom → Facing → Size
            → Type, and `type` renders in the identity cluster below. No other
            family declares these keys, so the position is inert elsewhere.
            Every one is an ordinary `SearchPicker`/input: post-form-layout.md's rule is
            that no native `<select>` remains, not that the mock's chevron
            renders as one. All four are unstarred in that mock. */}
        {has("bedroom") && (
          <SearchPicker
            label={labelFor("bedroom", "Bedroom")}
            options={(config.pickLists.bedroom ?? []).map((o) => ({
              id: o.name,
              name: o.name,
              nameKm: o.nameKm,
            }))}
            value={bedroom}
            onChange={setBedroom}
            placeholder={t("placeholders.chooseBedroom")}
          />
        )}
        {has("bathroom") && (
          <SearchPicker
            label={labelFor("bathroom", "Bathroom")}
            options={(config.pickLists.bathroom ?? []).map((o) => ({
              id: o.name,
              name: o.name,
              nameKm: o.nameKm,
            }))}
            value={bathroom}
            onChange={setBathroom}
            placeholder={t("placeholders.chooseBathroom")}
          />
        )}
        {has("facing") && (
          <SearchPicker
            label={labelFor("facing", "Facing")}
            options={(config.pickLists.facing ?? []).map((o) => ({
              id: o.name,
              name: o.name,
              nameKm: o.nameKm,
            }))}
            value={facing}
            onChange={setFacing}
            placeholder={t("placeholders.chooseFacing")}
          />
        )}
        {has("size") && (
          <TextInput
            label={labelFor("size", "Size")}
            type="number"
            min={0}
            value={size}
            onChange={setSize}
          />
        )}

        {/* Fields the subcategory's field schema declares — one per row */}
        {/* Accessory, Network and Type hold Brand's slot on the subcategories
            that declare them (Phone Accessories, Phone Numbers, Computers
            Parts & Accessories) — the only "what kind of thing is this" picker
            those forms have, and required. Type reads the admin-managed `types`
            set, so its ticks control which values the form offers. */}
        {has("accessory") && (
          <SearchPicker
            label={labelFor("accessory", "Accessory")}
            options={(config.pickLists.accessory ?? []).map((o) => ({
              id: o.name,
              name: o.name,
              nameKm: o.nameKm,
              image: o.image,
            }))}
            value={accessory}
            onChange={setAccessory}
            placeholder={t("placeholders.chooseAccessory")}
            required
          />
        )}
        {has("network") && (
          <SearchPicker
            label={labelFor("network", "Network")}
            options={(config.pickLists.network ?? []).map((o) => ({
              id: o.name,
              name: o.name,
              nameKm: o.nameKm,
              image: o.image,
            }))}
            value={network}
            onChange={setNetwork}
            placeholder={t("placeholders.chooseNetwork")}
            required
          />
        )}
        {has("type") && (
          <SearchPicker
            label={labelFor("type", "Type")}
            options={(config.pickLists.type ?? []).map((o) => ({
              id: o.name,
              name: o.name,
              nameKm: o.nameKm,
              image: o.image,
            }))}
            value={typeValue}
            onChange={setTypeValue}
            placeholder={t("placeholders.chooseType")}
            showOnlyKm
            required={!TYPE_OPTIONAL.has(subcategorySlug)}
          />
        )}
        {/* Jobs' Job Type and Experience hold the identity slot their form
            needs (the mock reads Job Type → Experience → Minimum salary, all
            above Price). Job Type renders the `jobtypes` icons when the admin
            has uploaded them and the plain row text until then. */}
        {has("jobType") && (
          <SearchPicker
            label={labelFor("jobType", "Job Type")}
            options={(config.pickLists.jobType ?? []).map((o) => ({
              id: o.name,
              name: o.name,
              nameKm: o.nameKm,
              image: o.image,
            }))}
            value={jobType}
            onChange={setJobType}
            placeholder={t("placeholders.chooseJobType")}
            required
          />
        )}
        {has("experience") && (
          <SearchPicker
            label={labelFor("experience", "Experience")}
            options={(config.pickLists.experience ?? []).map((o) => ({
              id: o.name,
              name: o.name,
              nameKm: o.nameKm,
            }))}
            value={experience}
            onChange={setExperience}
            placeholder={t("placeholders.chooseExperience")}
            required
          />
        )}
        {has("brand") && (
          <SearchPicker
            label={labelFor("brand", "Brand")}
            options={config.brands.map((b) => ({
              id: b.id,
              name: b.name,
              image: b.icon,
            }))}
            value={brandId}
            onChange={onBrandChange}
            placeholder={t("placeholders.chooseBrand")}
            required
          />
        )}
        {has("model") && (
          <SearchPicker
            label={labelFor("model", "Model")}
            options={models.map((m) => ({ id: m.name, name: m.name }))}
            value={model}
            onChange={(id) => {
              setModel(id);
              // A different model means a different spec page — keep them in
              // lockstep rather than linking an unrelated handset's specs.
              setProductModelId("");
            }}
            disabled={has("brand") && brandId === ""}
            placeholder={
              modelsLoading ? t("loadingModels") : t("placeholders.chooseModel")
            }
            emptyLabel={t("noModel")}
          />
        )}
        {has("productSpec") && (
          <SearchPicker
            label={labelFor("productSpec", "Product Specification")}
            options={config.products.map((p) => ({
              id: p.modelId,
              name: `${p.brandName} ${p.modelName}`,
              image: p.image,
            }))}
            value={productModelId}
            onChange={applyProductSelection}
            resolveInput={resolveProductPaste}
            placeholder={t("placeholders.chooseProduct")}
            emptyLabel={t("noProduct")}
            required
          />
        )}
        {conditionSlot === "lead" && conditionBlock}

        {has("screenSize") && (
          <SearchPicker
            label={labelFor("screenSize", "Screen Size")}
            options={(config.pickLists.screenSize ?? []).map((o) => ({
              id: o.name,
              name: o.name,
              nameKm: o.nameKm,
            }))}
            value={screenSize}
            onChange={setScreenSize}
            placeholder={t("placeholders.chooseScreenSize")}
            showOnlyKm
            required
          />
        )}

        {conditionSlot === "afterScreenSize" && conditionBlock}

        {has("storage") && (
          <SearchPicker
            label={labelFor("storage", "Storage")}
            options={(config.pickLists.storage ?? []).map((o) => ({
              id: o.name,
              name: o.name,
              nameKm: o.nameKm,
            }))}
            value={storage}
            onChange={setStorage}
            placeholder={t("placeholders.chooseStorage")}
            showOnlyKm
            required={STORAGE_REQUIRED.includes(subcategorySlug)}
          />
        )}

        {has("ram") && (
          <SearchPicker
            label={labelFor("ram", "RAM")}
            options={(config.pickLists.ram ?? []).map((o) => ({
              id: o.name,
              name: o.name,
              nameKm: o.nameKm,
            }))}
            value={ram}
            onChange={setRam}
            placeholder={t("placeholders.chooseRam")}
            showOnlyKm
            required
          />
        )}

        {has("cpu") && (
          <SearchPicker
            label={labelFor("cpu", "CPU")}
            options={(config.pickLists.cpu ?? []).map((o) => ({
              id: o.name,
              name: o.name,
              nameKm: o.nameKm,
            }))}
            value={cpu}
            onChange={setCpu}
            placeholder={t("placeholders.chooseCpu")}
            required
          />
        )}

        {has("vga") && (
          <SearchPicker
            label={labelFor("vga", "VGA")}
            options={(config.pickLists.vga ?? []).map((o) => ({
              id: o.name,
              name: o.name,
              nameKm: o.nameKm,
            }))}
            value={vga}
            onChange={setVga}
            placeholder={t("placeholders.chooseVga")}
            showOnlyKm
            required
          />
        )}
        {has("year") && (
          <SearchPicker
            label={labelFor("year", "Year")}
            options={config.years.map((y) => ({ id: y, name: y }))}
            value={year}
            onChange={setYear}
            placeholder={t("placeholders.chooseYear")}
            required
          />
        )}
        {has("vehicleType") && (
          <SearchPicker
            label={labelFor("vehicleType", "Vehicle Type")}
            options={config.vehicleKinds.map((v) => ({
              id: v.name,
              name: v.name,
              nameKm: v.nameKm,
              image: v.image,
            }))}
            value={vehicleType}
            onChange={setVehicleType}
            placeholder={t("placeholders.chooseVehicleType")}
            required
          />
        )}

        {has("engineType") && (
          <SearchPicker
            label={labelFor("engineType", "Engine Type")}
            options={ENGINE_TYPES.map((e) => ({
              id: e,
              name: t(`options.${ENGINE_KEYS[e]}`),
            }))}
            value={engineType}
            onChange={setEngineType}
            placeholder={t("placeholders.chooseEngine")}
          />
        )}

        {conditionSlot === "beforeBodyType" && conditionBlock}

        {has("bodyType") && (
          <SearchPicker
            label={labelFor("bodyType", "Body Type")}
            options={config.vehicleKinds.map((bt) => ({
              id: bt.name,
              name: bt.name,
              nameKm: bt.nameKm,
              image: bt.image,
            }))}
            value={bodyType}
            onChange={setBodyType}
            placeholder={t("placeholders.chooseBodyType")}
          />
        )}

        {has("transmission") && (
          <ToggleGroup
            label={labelFor("transmission", "Transmission")}
            options={[...TRANSMISSIONS]}
            displayLabels={{
              Auto: t("options.auto"),
              Manual: t("options.manual"),
            }}
            value={transmission}
            onChange={setTransmission}
          />
        )}

        {has("taxType") && (
          <ToggleGroup
            label={labelFor("taxType", "Tax Type")}
            required
            options={[...TAX_TYPES]}
            displayLabels={{
              "Tax Paper": t("options.taxPaper"),
              "Plate Number": t("options.plateNumber"),
            }}
            value={taxType}
            onChange={setTaxType}
          />
        )}

        {!conditionSlot && conditionBlock}

        {has("color") && (
          <SearchPicker
            label={labelFor("color", "Color")}
            options={config.colors.map((c) => ({
              id: c.name,
              name: c.name,
              nameKm: c.nameKm,
            }))}
            value={color}
            onChange={setColor}
            placeholder={t("placeholders.chooseColor")}
            required
            showOnlyKm
          />
        )}

        {has("price") && (
          <TextInput
            label={labelFor("price", "Price")}
            required
            type="number"
            min={0.01}
            prefix="$"
            value={price}
            onChange={setPrice}
          />
        )}

        {has("discount") && (
          <div>
            <FieldLabel label={labelFor("discount", "Discount")} />
            <div className="flex gap-2">
              <input
                type="number"
                min={0}
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                // Same wheel guard as TextInput: a scrolled focused field must
                // not turn an untouched discount into "0" (which then rendered
                // as a 0% discount).
                onWheel={(event) => event.currentTarget.blur()}
                className="w-full border border-gray-200 rounded-lg py-2.5 pl-3 pr-3 type-body text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
              />
              <div className="flex shrink-0 overflow-hidden rounded-sm border border-gray-200">
                {(
                  [
                    ["percent", "%"],
                    ["amount", "$"],
                  ] as const
                ).map(([kind, glyph]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setDiscountType(kind)}
                    aria-pressed={discountType === kind}
                    className={`w-12 cursor-pointer type-nav transition-colors ${
                      discountType === kind
                        ? "bg-gray-100 font-medium text-gray-800"
                        : "bg-white text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    {glyph}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {has("deliveryFree") && (
          <div>
            <FieldLabel label={labelFor("deliveryFree", "Free Delivery")} />
            <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5">
              <span className="type-body text-gray-700">
                {deliveryFree ? t("yes") : t("no")}
              </span>
              <Switch
                checked={deliveryFree}
                onCheckedChange={setDeliveryFree}
                className="cursor-pointer data-checked:bg-[#00a0e9]"
              />
            </div>
          </div>
        )}

        {has("description") && (
          <div>
            <FieldLabel
              label={labelFor("description", "Description")}
              required
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={8}
              className="w-full resize-y border border-gray-200 rounded-lg pl-3 pr-3 py-2.5 type-body text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
            />
          </div>
        )}

        {has("location") && (
          <LocationPicker
            provinces={config.provinces}
            value={place}
            onChange={setPlace}
            required
          />
        )}

        {has("address") && (
          <div>
            <FieldLabel label={labelFor("address", "Address")} required />
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={3}
              className="w-full resize-y border border-gray-200 rounded-lg pl-3 pr-3 py-2.5 type-body text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:border-transparent"
            />
          </div>
        )}

        {/* Map: the seller drops a pin that rides with the post */}
        <LocationMapPicker value={coords} onChange={setCoords} />
      </div>

      {/* ── Contact ────────────────────────────────────────────────────────── */}
      <div className="space-y-5">
        <h2 className="type-section-title text-foreground">{t("contact")}</h2>

        {/* The jobs form's Company sits at the top of Contact — its own spec
            lists it directly after Address, ahead of Name. Unstarred. */}
        {has("company") && (
          <TextInput
            label={labelFor("company", "Company")}
            placeholder={t("placeholders.yourCompany")}
            value={company}
            onChange={setCompany}
          />
        )}

        {has("contactName") && (
          <TextInput
            label={labelFor("contactName", "Name")}
            required
            placeholder={t("placeholders.yourName")}
            value={contactName}
            onChange={setContactName}
          />
        )}

        {has("contactPhones") &&
          contactPhones.slice(0, phoneRows).map((p, i) => (
            <div key={i} className="flex items-end gap-2">
              <div className="flex-1">
                <TextInput
                  label={
                    i === 0
                      ? t("labels.phone")
                      : `${t("labels.phone")} ${i + 1}`
                  }
                  required={i === 0}
                  placeholder="012 345 678"
                  value={p}
                  onChange={(v) =>
                    setContactPhones((prev) =>
                      prev.map((x, idx) => (idx === i ? v : x)),
                    )
                  }
                  trailing={
                    i > 0 ? (
                      <button
                        type="button"
                        onClick={() => removePhoneRow(i)}
                        aria-label={`${t("removePhone")} ${i + 1}`}
                        className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-2 border-red-500 text-red-500 transition-colors hover:bg-red-50"
                      >
                        <Minus className="h-4 w-4" strokeWidth={3} />
                      </button>
                    ) : undefined
                  }
                />
              </div>
              {i === phoneRows - 1 && phoneRows < 3 && (
                <button
                  type="button"
                  onClick={() => setPhoneRows((n) => Math.min(3, n + 1))}
                  aria-label={t("addPhone")}
                  className="mb-0.5 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#00a0e9] text-card transition-colors hover:bg-[#00a0e9]/80"
                >
                  <Plus className="h-5 w-5" />
                </button>
              )}
            </div>
          ))}

        {has("contactEmail") && (
          <TextInput
            label={labelFor("contactEmail", "Email")}
            type="email"
            placeholder="you@example.com"
            value={contactEmail}
            onChange={setContactEmail}
          />
        )}

        <p className="type-body text-gray-600">
          {t("agreement.prefix")}{" "}
          <Link href="/posting-rule" className="text-[#00a0e9] hover:underline">
            {t("agreement.postingRule")}
          </Link>{" "}
          {t("agreement.and")}{" "}
          <Link
            href="/privacy-policy"
            className="text-[#00a0e9] hover:underline"
          >
            {t("agreement.privacyPolicy")}
          </Link>{" "}
          {t("agreement.suffix")}
        </p>

        <button
          onClick={submit}
          disabled={submitting}
          className="w-full rounded-sm bg-[#f68b1e] py-3 type-nav text-card transition-colors hover:bg-[#e07d15] disabled:opacity-50 cursor-pointer"
        >
          {submitting ? t("publishing") : t("submit")}
        </button>
      </div>
    </div>
  );
}

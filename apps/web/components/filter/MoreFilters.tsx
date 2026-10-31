"use client";

import { useEffect, useState } from "react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { getBrandModels, getBrowseFilterOptions } from "@/actions/listings";
import {
  AD_FIELD_PARAM,
  AD_MODEL_PARAM,
  AD_TYPE_PARAM,
  ATTRS_PARAM,
  COLOR_PARAM,
  CONDITION_OPTIONS,
  CONDITION_PARAM,
  DATE_OPTIONS,
  DATE_PARAM,
  DELIVERY_PARAM,
  DISCOUNT_PARAM,
  ENGINE_LABEL_KEYS,
  ENGINE_PARAM,
  FILTER_PARAMS,
  LOCATION_COM_PARAM,
  LOCATION_DIS_PARAM,
  LOCATION_PRO_PARAM,
  MAX_AD_PRICE_PARAM,
  MIN_AD_PRICE_PARAM,
  Q_PARAM,
  SORT_PARAM,
  TAX_TYPE_PARAM,
  TRANSMISSION_PARAM,
  YEAR_MAX_PARAM,
  YEAR_MIN_PARAM,
  defaultSortFor,
  hasQueryParam,
  normalizeQuery,
  parseAttrsParam,
  parseSortParam,
  sortOptionsFor,
  type DateValue,
  type SortValue,
} from "@/lib/search-params";
import { useCommunes, useDistricts, useProvinces } from "./use-locations";
import { IconFilterCog, IconX } from "@tabler/icons-react";

// The keyword is the same `q` the header search bar writes — one keyword
// param everywhere. Re-exported for existing importers.
export const KEYWORD_PARAM = Q_PARAM;
export { DATE_PARAM, DATE_OPTIONS };
export type { DateValue };

/** The segmented controls' option rows (value "" = no filter). */
function useSegmentedOptions() {
  const t = useTranslations();
  return {
    taxType: [
      { value: "", label: t("Filters.more.all") },
      { value: "Tax Paper", label: t("PostForm.options.taxPaper") },
      { value: "Plate Number", label: t("PostForm.options.plateNumber") },
    ],
    condition: [
      { value: "", label: t("Filters.more.all") },
      { value: "used", label: t("Common.condition.used") },
      { value: "new", label: t("Common.condition.new") },
    ],
    transmission: [
      { value: "", label: t("Filters.more.all") },
      { value: "Auto", label: t("PostForm.options.auto") },
      { value: "Manual", label: t("PostForm.options.manual") },
    ],
  };
}

// ─── Active filter badge count ────────────────────────────────────────────────
function countActiveFilters(params: URLSearchParams): number {
  let n = 0;
  if (params.get(Q_PARAM)) n++;
  if (params.get(DATE_PARAM)) n++;
  if (params.get(LOCATION_PRO_PARAM)) n++;
  const sort = params.get(SORT_PARAM);
  if (sort && sort !== defaultSortFor(hasQueryParam(params))) n++;
  if (params.get(MIN_AD_PRICE_PARAM)) n++;
  if (params.get(MAX_AD_PRICE_PARAM)) n++;
  if (params.get(CONDITION_PARAM)) n++;
  if (params.get(DELIVERY_PARAM)) n++;
  if (params.get(DISCOUNT_PARAM)) n++;
  if (params.get(YEAR_MIN_PARAM) || params.get(YEAR_MAX_PARAM)) n++;
  if (params.get(ENGINE_PARAM)) n++;
  if (params.get(TAX_TYPE_PARAM)) n++;
  if (params.get(COLOR_PARAM)) n++;
  if (params.get(TRANSMISSION_PARAM)) n++;
  // One count for the whole attribute object, however many selects are set.
  if (params.get(ATTRS_PARAM)) n++;
  // The grid drill-down (brand/model/body type) is a filter too — the dialog
  // edits the same params, so the badge must see them (a body-type pick used
  // to leave the badge at zero; captain, 2026-10-27).
  if (params.get(AD_FIELD_PARAM)) n++;
  if (params.get(AD_MODEL_PARAM)) n++;
  if (params.get(AD_TYPE_PARAM)) n++;
  return n;
}

// ─── Reusable cascading select ────────────────────────────────────────────────
function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5">
      {label && <label className="type-nav text-foreground">{label}</label>}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "w-full h-11 rounded-sm border bg-background px-3 pr-8 type-nav appearance-none",
            "focus:outline-none focus:ring-2 focus:ring-ring transition-colors",
            disabled
              ? "opacity-40 cursor-not-allowed bg-muted text-muted-foreground"
              : "cursor-pointer hover:border-ring",
          )}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <svg
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </div>
    </div>
  );
}

// ─── Segmented single-choice row (All | … ) ──────────────────────────────────
// The mock draws the browse dialog's Tax Type / Condition / Transmission as
// three equal buttons: the applied one in the brand blue, the rest slate grey.
// Colours sampled from the mock: #00a0e4 (selected), #707685 (rest).
function SegmentedField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <span className="type-nav text-foreground">{label}</span>
      <div className="grid grid-cols-3 gap-4">
        {options.map((o) => (
          <button
            key={o.value || "all"}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "h-11 rounded-sm type-nav text-white transition-colors cursor-pointer",
              value === o.value
                ? "bg-[#00a0e9] hover:bg-[#0093d5]"
                : "bg-[#707685] hover:bg-[#616774]",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Bordered toggle row (Discount / Free Delivery) ──────────────────────────
// The mock's design: the state word sits inside the box beside the switch, so
// the row reads "No" / "Yes" rather than an unlabelled switch.
function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTranslations();
  return (
    <div className="space-y-1.5">
      <span className="type-nav text-foreground">{label}</span>
      <label className="flex h-11 cursor-pointer items-center gap-4 rounded-sm border bg-background px-3 transition-colors hover:border-ring">
        <Switch
          aria-label={label}
          checked={checked}
          onCheckedChange={onChange}
          className="data-checked:bg-[#00a0e9]"
        />
        <span className="type-nav text-foreground">
          {checked ? t("PostForm.yes") : t("PostForm.no")}
        </span>
      </label>
    </div>
  );
}

// Labels for the schema-driven selects (the keys `getBrowseFilterOptions`
// returns); a key outside this map falls back to the schema's English label.
const ATTRIBUTE_LABEL_KEYS = new Set([
  "jobType",
  "experience",
  "bedroom",
  "bathroom",
  "facing",
  "size",
  "type",
  "accessory",
  "screenSize",
  "storage",
  "ram",
  "cpu",
  "vga",
  "network",
]);

// ─── Main component ───────────────────────────────────────────────────────────
export default function MoreFilters({ priceLabel }: { priceLabel?: string }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const params = useParams<{
    categorySlug?: string;
    subcategorySlug?: string;
  }>();
  const categorySlug = params.categorySlug;
  const subcategorySlug = params.subcategorySlug;

  const [open, setOpen] = useState(false);

  // ── Draft state ──────────────────────────────────────────────────────────
  const [keyword, setKeyword] = useState("");
  const [sort, setSort] = useState<SortValue>(defaultSortFor(false));
  // The draft keyword decides which sorts exist and which one is the default.
  const draftHasQuery = normalizeQuery(keyword) !== "";
  const [date, setDate] = useState<DateValue>("");
  const [proId, setProId] = useState("");
  const [disId, setDisId] = useState("");
  const [comId, setComId] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [condition, setCondition] = useState("");
  const [delivery, setDelivery] = useState(false);
  const [discount, setDiscount] = useState(false);
  // Vehicle fields (the mock's lower block) — the same URL params the browse
  // grids and the bar chips write, so both views stay in sync.
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [bodyType, setBodyType] = useState("");
  const [taxType, setTaxType] = useState("");
  const [color, setColor] = useState("");
  const [transmission, setTransmission] = useState("");
  const [engine, setEngine] = useState("");
  const [yearMin, setYearMin] = useState("");
  const [yearMax, setYearMax] = useState("");
  // Every schema-declared attribute that is not one of the dedicated fields
  // above (storage, screen size, RAM, CPU, job type, …) — one select each,
  // AND-ed through the feed's `attrs` JSON param.
  const [attrs, setAttrs] = useState<Record<string, string>>({});

  // ── Option lists (vehicle block only) ────────────────────────────────────
  // Loaded on first open of a subcategory page; the dialog gates every vehicle
  // field on that subcategory's own `field_schema`, so a phone page never
  // offers a Body Type. Cached for the session's browsing.
  const optionsQuery = useQuery({
    queryKey: ["browse-filter-options", categorySlug, subcategorySlug, locale],
    queryFn: () =>
      getBrowseFilterOptions(categorySlug!, subcategorySlug!, locale),
    enabled: open && !!categorySlug && !!subcategorySlug,
    staleTime: 10 * 60 * 1000,
  });
  const options = optionsQuery.data ?? null;
  const fields = options?.fields ?? [];
  const hasField = (key: string) => fields.includes(key);
  const brandId = options?.brands.find((b) => b.slug === brand)?.id;
  const modelsQuery = useQuery({
    queryKey: ["browse-filter-models", brandId, subcategorySlug],
    queryFn: () => getBrandModels(brandId!, subcategorySlug!),
    enabled: open && !!brandId && !!subcategorySlug,
    staleTime: 10 * 60 * 1000,
  });
  const modelRows = modelsQuery.data ?? [];
  const segmented = useSegmentedOptions();

  // Sync draft from URL whenever dialog opens
  useEffect(() => {
    if (!open) return;
    // Sync draft from URL each time the dialog opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKeyword(searchParams.get(Q_PARAM) ?? "");
    setSort(
      parseSortParam(searchParams.get(SORT_PARAM), hasQueryParam(searchParams)),
    );
    setDate((searchParams.get(DATE_PARAM) as DateValue) ?? "");
    setProId(searchParams.get(LOCATION_PRO_PARAM) ?? "");
    setDisId(searchParams.get(LOCATION_DIS_PARAM) ?? "");
    setComId(searchParams.get(LOCATION_COM_PARAM) ?? "");
    setMinPrice(searchParams.get(MIN_AD_PRICE_PARAM) ?? "");
    setMaxPrice(searchParams.get(MAX_AD_PRICE_PARAM) ?? "");
    setCondition(searchParams.get(CONDITION_PARAM) ?? "");
    setDelivery(searchParams.get(DELIVERY_PARAM) === "1");
    setDiscount(searchParams.get(DISCOUNT_PARAM) === "1");
    setBrand(searchParams.get(AD_FIELD_PARAM) ?? "");
    setModel(searchParams.get(AD_MODEL_PARAM) ?? "");
    setBodyType(searchParams.get(AD_TYPE_PARAM) ?? "");
    setTaxType(searchParams.get(TAX_TYPE_PARAM) ?? "");
    setColor(searchParams.get(COLOR_PARAM) ?? "");
    setTransmission(searchParams.get(TRANSMISSION_PARAM) ?? "");
    setEngine(searchParams.get(ENGINE_PARAM) ?? "");
    setYearMin(searchParams.get(YEAR_MIN_PARAM) ?? "");
    setYearMax(searchParams.get(YEAR_MAX_PARAM) ?? "");
    setAttrs(parseAttrsParam(searchParams.get(ATTRS_PARAM)) ?? {});
  }, [open, searchParams]);

  // ── Location cascade options ─────────────────────────────────────────────
  // Real geography; the values are the slugs the URL and backend use.
  const toOptions = (rows: { slug: string; name: string }[] | undefined) =>
    (rows ?? []).map((r) => ({ value: r.slug, label: r.name }));
  const provinceOptions = toOptions(useProvinces(open).data);
  const districtOptions = toOptions(useDistricts(open ? proId : null).data);
  const communeOptions = toOptions(
    useCommunes(open ? proId : null, open ? disId : null).data,
  );

  const handleProvinceChange = (v: string) => {
    setProId(v);
    setDisId("");
    setComId("");
  };
  const handleDistrictChange = (v: string) => {
    setDisId(v);
    setComId("");
  };
  const handleBrandChange = (v: string) => {
    setBrand(v);
    // A model belongs to one brand — never carry it across.
    setModel("");
  };

  // ── Write all params to URL at once ─────────────────────────────────────
  const applyFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    const set = (key: string, val: string) =>
      val.trim() ? params.set(key, val.trim()) : params.delete(key);

    set(Q_PARAM, normalizeQuery(keyword));
    set(DATE_PARAM, date);
    // Re-validate against the draft keyword: "best-match" without one is moot.
    const finalSort = parseSortParam(sort, draftHasQuery);
    if (finalSort === defaultSortFor(draftHasQuery)) {
      params.delete(SORT_PARAM);
    } else {
      params.set(SORT_PARAM, finalSort);
    }
    set(LOCATION_PRO_PARAM, proId);
    set(LOCATION_DIS_PARAM, disId);
    set(LOCATION_COM_PARAM, comId);
    set(MIN_AD_PRICE_PARAM, minPrice);
    set(MAX_AD_PRICE_PARAM, maxPrice);
    set(CONDITION_PARAM, condition);
    set(DELIVERY_PARAM, delivery ? "1" : "");
    set(DISCOUNT_PARAM, discount ? "1" : "");

    // Fields are written only when the dialog actually renders them —
    // otherwise an untouched dialog would clear a grid drill-down it never
    // showed (the Type grids on non-vehicle pages own `ad_type` too).
    if (hasField("brand")) set(AD_FIELD_PARAM, brand);
    if (hasField("model")) set(AD_MODEL_PARAM, brand ? model : "");
    if (hasField("bodyType") || hasField("vehicleType")) {
      set(AD_TYPE_PARAM, bodyType);
    }
    if (hasField("taxType")) set(TAX_TYPE_PARAM, taxType);
    if (hasField("color")) set(COLOR_PARAM, color);
    if (hasField("transmission")) set(TRANSMISSION_PARAM, transmission);
    if (hasField("engineType")) set(ENGINE_PARAM, engine);
    if (hasField("year")) {
      set(YEAR_MIN_PARAM, yearMin);
      set(YEAR_MAX_PARAM, yearMax);
    }
    // The generic object carries every schema select; an emptied select is
    // dropped so Apply really clears it, and no select leaves no param.
    const cleanedAttrs = Object.fromEntries(
      Object.entries(attrs).filter(([, value]) => value.trim() !== ""),
    );
    if (Object.keys(cleanedAttrs).length > 0) {
      params.set(ATTRS_PARAM, JSON.stringify(cleanedAttrs));
    } else {
      params.delete(ATTRS_PARAM);
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
    setOpen(false);
  };

  // ── Clear everything ─────────────────────────────────────────────────────
  const clearAll = () => {
    setKeyword("");
    setSort(defaultSortFor(false));
    setDate("");
    setProId("");
    setDisId("");
    setComId("");
    setMinPrice("");
    setMaxPrice("");
    setCondition("");
    setDelivery(false);
    setDiscount(false);
    setBrand("");
    setModel("");
    setBodyType("");
    setTaxType("");
    setColor("");
    setTransmission("");
    setEngine("");
    setYearMin("");
    setYearMax("");
    setAttrs({});
    // Only the filter params — a non-vehicle page's grid drill-down (a Type
    // pick) stays put. On a page whose Brand/Model/Body Type selects this
    // dialog renders, clearing them is what "Clear" means there.
    const params = new URLSearchParams(searchParams.toString());
    for (const key of FILTER_PARAMS) params.delete(key);
    if (hasField("brand")) params.delete(AD_FIELD_PARAM);
    if (hasField("model")) params.delete(AD_MODEL_PARAM);
    if (hasField("bodyType") || hasField("vehicleType")) {
      params.delete(AD_TYPE_PARAM);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
    setOpen(false);
  };
  const activeCount = countActiveFilters(searchParams);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* ── Trigger ─────────────────────────────────────────────────────── */}
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="relative bg-muted rounded-sm h-12 px-3 type-nav cursor-pointer gap-2"
        >
          <IconFilterCog className="h-4 w-4 shrink-0" />
          <span>{t("Filters.more.title")}</span>
          {activeCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 type-photo-badge text-white">
              {activeCount}
            </span>
          )}
        </Button>
      </DialogTrigger>
      {/* ── Dialog ──────────────────────────────────────────────────────── */}
      <DialogContent
        showCloseButton={false}
        className="flex flex-col gap-0 p-0 max-w-[608px] w-full max-h-[90vh] rounded-sm overflow-hidden"
      >
        {/* Header — the mock's shape: ✕ left, centred title, Clear right. */}
        <DialogHeader className="grid grid-cols-[1fr_auto_1fr] items-center gap-0 px-5 py-4 border-b shrink-0">
          <DialogClose asChild>
            <button
              type="button"
              aria-label={t("Common.close")}
              className="justify-self-start flex size-8 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
            >
              <IconX className="size-4" />
            </button>
          </DialogClose>
          <DialogTitle className="type-card-heading justify-self-center">
            {t("Filters.more.title")}
          </DialogTitle>
          <button
            type="button"
            onClick={clearAll}
            className="justify-self-end type-button-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            {t("Filters.more.clear")}
          </button>
        </DialogHeader>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-5 py-5 space-y-5 flex-1">
          {/* Search */}
          <div className="space-y-1.5">
            <label className="type-nav text-foreground">
              {t("Filters.more.search")}
            </label>
            <Input
              placeholder={t("Filters.more.searchPlaceholder")}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              className="h-11 rounded-sm"
            />
          </div>
          {/* Sort */}
          <SelectField
            label={t("Filters.sort.label")}
            value={sort}
            onChange={(v) => setSort(v as SortValue)}
            options={sortOptionsFor(draftHasQuery).map((o) => ({
              value: o.value,
              label: t(o.labelKey),
            }))}
            placeholder={t("Filters.more.default")}
          />
          {/* Date */}
          <SelectField
            label={t("Filters.date.label")}
            value={date}
            onChange={(v) => setDate(v as DateValue)}
            options={DATE_OPTIONS.filter((o) => o.value !== "").map((o) => ({
              value: o.value,
              label: t(o.labelKey),
            }))}
            placeholder={t("Filters.date.allTime")}
          />
          {/* Location — cascading */}
          <div className="space-y-3">
            <SelectField
              label={t("Filters.more.cityProvince")}
              value={proId}
              onChange={handleProvinceChange}
              options={provinceOptions}
              placeholder={t("Filters.more.selectProvince")}
            />
            <SelectField
              label={t("Filters.more.khanDistrict")}
              value={disId}
              onChange={handleDistrictChange}
              options={districtOptions}
              disabled={!proId}
              placeholder={
                proId
                  ? t("Filters.more.selectDistrict")
                  : t("Filters.more.selectProvinceFirst")
              }
            />
            <SelectField
              label={t("Filters.more.sangkatCommune")}
              value={comId}
              onChange={setComId}
              options={communeOptions}
              disabled={!disId}
              placeholder={
                disId
                  ? t("Filters.more.selectCommune")
                  : t("Filters.more.selectDistrictFirst")
              }
            />
          </div>
          {/* Condition — contexts with no subcategory (search/all-ads) keep
              this plain select; a subcategory's own block renders it as the
              mock's segmented All | Used | New, next to its other fields. */}
          {!subcategorySlug && (
            <SelectField
              label={t("Filters.condition.label")}
              value={condition}
              onChange={setCondition}
              options={CONDITION_OPTIONS.map((o) => ({
                value: o.value,
                label: t(o.labelKey),
              }))}
              placeholder={t("Filters.more.any")}
            />
          )}
          {/* Price */}
          <div className="space-y-1.5">
            <label className="type-nav text-foreground ">
              {priceLabel ?? t("Filters.price.label")}
            </label>
            <div className="flex gap-3 mt-2">
              <Input
                type="number"
                placeholder={t("Filters.price.min")}
                value={minPrice}
                min={0}
                onChange={(e) => setMinPrice(e.target.value)}
                className="h-11 rounded-sm"
              />
              <Input
                type="number"
                placeholder={t("Filters.price.max")}
                value={maxPrice}
                min={0}
                onChange={(e) => setMaxPrice(e.target.value)}
                className="h-11 rounded-sm"
              />
            </div>
          </div>
          {/* Discount */}
          <ToggleField
            label={t("Filters.more.discount")}
            checked={discount}
            onChange={setDiscount}
          />
          {/* Free delivery */}
          <ToggleField
            label={t("Filters.more.freeDelivery")}
            checked={delivery}
            onChange={setDelivery}
          />

          {/* ── Schema block — every field is gated on the subcategory's own
                 `field_schema`, for every family: vehicles get Year/Tax/Color/
                 Transmission/Engine/Body Type, phones get Brand/Model/Storage/
                 Condition, laptops get Storage/Screen Size/RAM/CPU/VGA, and so
                 on. The non-dedicated selects are AND-ed through `attrs`. ── */}
          {hasField("brand") && (
            <SelectField
              label={t("Specs.brand")}
              value={brand}
              onChange={handleBrandChange}
              options={(options?.brands ?? []).map((b) => ({
                value: b.slug,
                label: b.name,
              }))}
              placeholder={t("PostForm.placeholders.chooseBrand")}
            />
          )}
          {hasField("model") && (
            <SelectField
              label={t("Specs.model")}
              value={model}
              onChange={setModel}
              options={modelRows.map((m) => ({
                value: m.slug,
                label: m.name,
              }))}
              disabled={!brand}
              placeholder={
                brand
                  ? t("PostForm.placeholders.chooseModel")
                  : t("Filters.more.selectBrandFirst")
              }
            />
          )}
          {hasField("year") && (
            <div className="space-y-1.5">
              <span className="type-nav text-foreground">
                {t("Filters.year.label")}
              </span>
              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  label=""
                  value={yearMin}
                  onChange={setYearMin}
                  options={(options?.years ?? []).map((y) => ({
                    value: y,
                    label: y,
                  }))}
                  placeholder={t("Filters.year.min")}
                />
                <SelectField
                  label=""
                  value={yearMax}
                  onChange={setYearMax}
                  options={(options?.years ?? []).map((y) => ({
                    value: y,
                    label: y,
                  }))}
                  placeholder={t("Filters.year.max")}
                />
              </div>
            </div>
          )}
          {hasField("taxType") && (
            <SegmentedField
              label={t("Specs.attributes.taxType")}
              value={taxType}
              onChange={setTaxType}
              options={segmented.taxType}
            />
          )}
          {(options?.selects ?? []).map((select) => (
            <SelectField
              key={select.key}
              label={
                ATTRIBUTE_LABEL_KEYS.has(select.key)
                  ? t(`Specs.attributes.${select.key}`)
                  : select.label
              }
              value={attrs[select.key] ?? ""}
              onChange={(value) =>
                setAttrs((prev) => ({ ...prev, [select.key]: value }))
              }
              options={select.options}
              placeholder={t("Filters.more.any")}
            />
          ))}
          {hasField("condition") && (
            <SegmentedField
              label={t("Filters.condition.label")}
              value={condition}
              onChange={setCondition}
              options={segmented.condition}
            />
          )}
          {hasField("color") && (
            <SelectField
              label={t("Specs.attributes.color")}
              value={color}
              onChange={setColor}
              options={(options?.colors ?? []).map((c) => ({
                value: c,
                label: c,
              }))}
              placeholder={t("PostForm.placeholders.chooseColor")}
            />
          )}
          {hasField("transmission") && (
            <SegmentedField
              label={t("Specs.attributes.transmission")}
              value={transmission}
              onChange={setTransmission}
              options={segmented.transmission}
            />
          )}
          {hasField("engineType") && (
            <SelectField
              label={t("Specs.attributes.engineType")}
              value={engine}
              onChange={setEngine}
              options={(options?.engineTypes ?? []).map((name) => ({
                value: name,
                label: ENGINE_LABEL_KEYS[name]
                  ? t(`PostForm.options.${ENGINE_LABEL_KEYS[name]}`)
                  : name,
              }))}
              placeholder={t("PostForm.placeholders.chooseEngine")}
            />
          )}
          {(hasField("bodyType") || hasField("vehicleType")) && (
            <SelectField
              label={t("Specs.attributes.bodyType")}
              value={bodyType}
              onChange={setBodyType}
              options={(options?.bodyTypes ?? []).map((b) => ({
                value: b.slug,
                label: b.name,
              }))}
              placeholder={t("PostForm.placeholders.chooseBodyType")}
            />
          )}
        </div>
        {/* Footer */}
        <DialogFooter className="p-8 rounded-none bg-background shrink-0 border-t sm:flex-row sm:justify-stretch">
          <Button
            onClick={applyFilters}
            className="w-full h-10 rounded-sm bg-orange-500 hover:bg-orange-600 text-white cursor-pointer"
          >
            {t("Common.applyFilter")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { IconLayoutGridFilled, IconListFilled } from "@tabler/icons-react";
import { Check } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LocationSelectorFilter } from "@/components/filter/LocationSelectorFilter";
import SortFilter from "@/components/filter/SortFilter";
import PriceFilter from "@/components/filter/PriceFilter";
import YearFilter from "@/components/filter/YearFilter";
import MoreFilters from "@/components/filter/MoreFilters";
import { cn } from "@/lib/utils";
import {
  CONDITION_OPTIONS,
  CONDITION_PARAM,
  ENGINE_LABEL_KEYS,
  ENGINE_PARAM,
} from "@/lib/search-params";

export interface LSPCYEHeaderProps {
  title: string;
  /** Optional chips — cars-for-sale renders all; subcategories hide the ones they don't have. */
  year?: boolean;
  engine?: boolean;
  /** Vehicles-for-rent and other L-S-P surfaces hide the Condition chip. */
  condition?: boolean;
  /** LS-group surfaces (services/properties) hide the Price chip. */
  price?: boolean;
  /** Jobs replaces "Price" with "Salary". */
  priceLabel?: string;
  /**
   * Engine type names from the `enginetypes` attribute set — the exact names
   * the post form stores in `attributes.engineType` (e.g. "Petrol").
   */
  engineOptions?: string[];
  /**
   * Model years from the generated `years` set (current year + 1 → 1980),
   * newest first — the Year chip's Minimum / Maximum options.
   */
  yearOptions?: string[];
}

interface ChipOption {
  /** Stable key; "" is the "all" row. */
  key: string;
  label: string;
}

/** One filter chip + its single-choice dropdown. */
function ChipSelect({
  label,
  activeLabel,
  options,
  value,
  onSelect,
}: {
  label: string;
  activeLabel?: string;
  options: ChipOption[];
  value: string;
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = value !== "";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "bg-muted rounded-sm h-12 p-2 px-3 cursor-pointer",
            active && "text-sky-500 hover:bg-muted/50 hover:text-sky-500",
          )}
        >
          <span className="font-medium whitespace-nowrap">
            {active ? (activeLabel ?? label) : label}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="rounded-sm w-48 p-1 mt-3 max-h-80 overflow-y-auto"
      >
        {options.map((opt) => (
          <button
            key={opt.key || "all"}
            type="button"
            onClick={() => {
              onSelect(opt.key);
              setOpen(false);
            }}
            className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left type-nav hover:bg-muted/60 transition-colors cursor-pointer"
          >
            <span>{opt.label}</span>
            {value === opt.key && <Check className="size-4 text-sky-600" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export default function LSPYCEHeader({
  title,
  year = true,
  engine = true,
  condition = true,
  price = true,
  priceLabel,
  engineOptions = [],
  yearOptions = [],
}: LSPCYEHeaderProps) {
  const t = useTranslations();
  const engineLabel = (value: string) => {
    const key = ENGINE_LABEL_KEYS[value];
    return key ? t(`PostForm.options.${key}`) : value;
  };
  const resolvedPriceLabel = priceLabel ?? t("Filters.price.label");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /** Apply param changes (null = remove) and keep every other filter. */
  const replaceParams = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  const conditionValue = searchParams.get(CONDITION_PARAM) ?? "";
  const engineValue = searchParams.get(ENGINE_PARAM) ?? "";
  const conditionOption = CONDITION_OPTIONS.find(
    (o) => o.value === conditionValue,
  );

  return (
    <>
      {/* HEADER */}
      <div className="px-6 py-3 bg-card rounded-t-sm border">
        <h1 className="type-page-title">
          {t("Common.inCambodia", { name: title })}
        </h1>
      </div>

      {/* FILTER BAR — sticky like the All Ads / category bar; the grid/list
          tabs switch the page's TabsContent views (the page owns the Tabs
          root). Every chip reads and writes the URL, which the page forwards
          to the feed (lib/search-params.ts). */}
      <div className="sticky top-16 z-40 flex items-center justify-between bg-card rounded-b-sm border px-4 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <LocationSelectorFilter />
          <SortFilter />
          {price && <PriceFilter label={resolvedPriceLabel} />}

          {year && yearOptions.length > 0 && (
            <YearFilter options={yearOptions} />
          )}

          {condition && (
            <ChipSelect
              label={t("Filters.condition.label")}
              activeLabel={
                conditionOption
                  ? t("Filters.condition.activeChip", {
                      label: t(conditionOption.labelKey),
                    })
                  : undefined
              }
              value={conditionValue}
              options={[
                { key: "", label: t("Filters.condition.all") },
                ...CONDITION_OPTIONS.map((o) => ({
                  key: o.value,
                  label: t(o.labelKey),
                })),
              ]}
              onSelect={(key) => replaceParams({ [CONDITION_PARAM]: key })}
            />
          )}

          {engine && engineOptions.length > 0 && (
            <ChipSelect
              label={t("Filters.engine.label")}
              activeLabel={
                engineValue
                  ? t("Filters.engine.activeChip", {
                      label: engineLabel(engineValue),
                    })
                  : undefined
              }
              value={engineValue}
              options={[
                { key: "", label: t("Filters.engine.all") },
                ...engineOptions.map((name) => ({
                  key: name,
                  label: engineLabel(name),
                })),
              ]}
              onSelect={(key) => replaceParams({ [ENGINE_PARAM]: key })}
            />
          )}

          <MoreFilters priceLabel={resolvedPriceLabel} />
        </div>
        <TabsList className="h-9 shrink-0">
          <TabsTrigger value="grid" className="cursor-pointer px-3">
            <IconLayoutGridFilled className="size-4" />
          </TabsTrigger>
          <TabsTrigger value="list" className="cursor-pointer px-3">
            <IconListFilled className="size-4" />
          </TabsTrigger>
        </TabsList>
      </div>
    </>
  );
}

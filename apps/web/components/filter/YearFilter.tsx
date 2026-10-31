"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { YEAR_MAX_PARAM, YEAR_MIN_PARAM } from "@/lib/search-params";

const YEAR_RE = /^\d{4}$/;

/**
 * Year range chip — Minimum / Maximum selects applied together. The options
 * are the backend's generated `years` set (current year + 1 → 1980), and the
 * chip label is derived from the two URL bounds, so unlike the old bucket list
 * there is no fixed option key to match back to.
 */
export default function YearFilter({ options }: { options: string[] }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);

  // The URL is the committed state; the selects are a draft until Apply.
  // Only 4-digit bounds count, and an inverted URL range is displayed swapped
  // the same way parseFeedParams swaps it for the feed.
  let minParam = searchParams.get(YEAR_MIN_PARAM) ?? "";
  let maxParam = searchParams.get(YEAR_MAX_PARAM) ?? "";
  if (!YEAR_RE.test(minParam)) minParam = "";
  if (!YEAR_RE.test(maxParam)) maxParam = "";
  if (minParam && maxParam && Number(minParam) > Number(maxParam)) {
    [minParam, maxParam] = [maxParam, minParam];
  }

  const [min, setMin] = useState(minParam);
  const [max, setMax] = useState(maxParam);

  // A hand-edited URL can carry a valid year outside the generated set; keep
  // it selectable so the controlled select never points at a missing option.
  const allOptions = Array.from(new Set([...options, minParam, maxParam]))
    .filter((year) => YEAR_RE.test(year))
    .sort((a, b) => Number(b) - Number(a));

  const hasActiveFilter = Boolean(minParam || maxParam);
  // Active chips follow the bar's `Label :value` pattern the mock uses for
  // every filter ("Year :2021-2027"), never a bare range.
  const yearLabel = t("Filters.year.label");
  const chipLabel =
    minParam && maxParam
      ? minParam === maxParam
        ? t("Filters.year.chipSingle", { label: yearLabel, year: minParam })
        : t("Filters.year.chipRange", {
            label: yearLabel,
            min: minParam,
            max: maxParam,
          })
      : minParam
        ? t("Filters.year.chipFrom", { label: yearLabel, min: minParam })
        : maxParam
          ? t("Filters.year.chipUpTo", { label: yearLabel, max: maxParam })
          : yearLabel;

  // Draft follows the committed URL each time the popover opens.
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      setMin(minParam);
      setMax(maxParam);
    }
  };

  function pushParams(nextMin: string, nextMax: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextMin) {
      params.set(YEAR_MIN_PARAM, nextMin);
    } else {
      params.delete(YEAR_MIN_PARAM);
    }
    if (nextMax) {
      params.set(YEAR_MAX_PARAM, nextMax);
    } else {
      params.delete(YEAR_MAX_PARAM);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  function applyFilter() {
    let nextMin = min;
    let nextMax = max;
    if (nextMin && nextMax && Number(nextMin) > Number(nextMax)) {
      [nextMin, nextMax] = [nextMax, nextMin];
    }
    pushParams(nextMin, nextMax);
    setOpen(false);
  }

  function removeFilter(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setMin("");
    setMax("");
    pushParams("", "");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "bg-muted rounded-sm h-12 p-2 px-3 pr-3 cursor-pointer",
            hasActiveFilter &&
              "text-sky-500 hover:bg-muted/50 hover:text-sky-500",
          )}
        >
          <span>{chipLabel}</span>
          {hasActiveFilter && (
            <span
              role="button"
              tabIndex={0}
              className="inline-flex rounded-sm p-0.5"
              onClick={removeFilter}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  removeFilter(e as unknown as React.MouseEvent);
                }
              }}
              aria-label={t("Filters.year.remove")}
            >
              <X className="size-4 text-foreground shrink-0" aria-hidden />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="rounded-sm w-xs p-0 mt-3 pb-3">
        <div className="space-y-4 px-4">
          <h3 className="text-center type-card-heading mt-3">
            {t("Filters.year.label")}
          </h3>
          <Separator />
          <div className="flex gap-3">
            <YearSelect
              label={t("Filters.year.min")}
              value={min}
              onChange={setMin}
              options={allOptions}
            />
            <YearSelect
              label={t("Filters.year.max")}
              value={max}
              onChange={setMax}
              options={allOptions}
            />
          </div>
          <Button
            className="rounded-sm h-9 w-full bg-orange-500 text-white hover:bg-orange-600 cursor-pointer"
            onClick={applyFilter}
          >
            {t("Common.applyFilter")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Native select styled like the filter bar's other selects (the `SelectField`
 * in MoreFilters) — the mock's plain Minimum / Maximum boxes. The empty
 * option is the placeholder and stays selectable, so one bound can be cleared
 * without using the chip's X.
 */
function YearSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="relative flex-1">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full cursor-pointer appearance-none rounded-sm border bg-background px-3 pr-8 type-nav transition-colors hover:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
      >
        <option value="">{label}</option>
        {options.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { MAX_AD_PRICE_PARAM, MIN_AD_PRICE_PARAM } from "@/lib/search-params";

// Re-exported for existing importers; the source of truth is lib/search-params.
export { MAX_AD_PRICE_PARAM, MIN_AD_PRICE_PARAM };

function formatChipValue(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString();
}

export default function PriceFilter({ label }: { label?: string } = {}) {
  const t = useTranslations();
  const resolvedLabel = label ?? t("Filters.price.label");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [open, setOpen] = useState(false);

  // Initializers re-derive the params on each render, so the URL values are
  // always in sync without a set-state effect.
  const minParam = searchParams.get(MIN_AD_PRICE_PARAM) ?? "";
  const maxParam = searchParams.get(MAX_AD_PRICE_PARAM) ?? "";

  const [min, setMin] = useState(minParam);
  const [max, setMax] = useState(maxParam);

  const hasActiveFilter = Boolean(minParam || maxParam);
  const priceLabel =
    minParam && maxParam
      ? t("Filters.price.chipRange", {
          label: resolvedLabel,
          min: formatChipValue(minParam),
          max: formatChipValue(maxParam),
        })
      : minParam
        ? t("Filters.price.chipFrom", {
            label: resolvedLabel,
            min: formatChipValue(minParam),
          })
        : maxParam
          ? t("Filters.price.chipUpTo", {
              label: resolvedLabel,
              max: formatChipValue(maxParam),
            })
          : resolvedLabel;

  function pushParams(nextMin: string, nextMax: string) {
    const params = new URLSearchParams(searchParams.toString());

    if (nextMin.trim()) {
      params.set(MIN_AD_PRICE_PARAM, nextMin.trim());
    } else {
      params.delete(MIN_AD_PRICE_PARAM);
    }
    if (nextMax.trim()) {
      params.set(MAX_AD_PRICE_PARAM, nextMax.trim());
    } else {
      params.delete(MAX_AD_PRICE_PARAM);
    }
    params.delete("min");
    params.delete("max");

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  function applyFilter() {
    pushParams(min, max);
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "bg-muted rounded-sm h-12 p-2 px-3 pr-3 cursor-pointer",
            hasActiveFilter &&
              "text-sky-500 hover:bg-muted/50 hover:text-sky-500",
          )}
        >
          <span>{priceLabel}</span>
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
              aria-label={t("Filters.price.remove")}
            >
              <X className="size-4 text-foreground shrink-0" aria-hidden />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="rounded-sm w-xs p-0 mt-3 pb-3">
        <div className="space-y-4 px-4">
          <h3 className="text-center type-card-heading mt-3">
            {resolvedLabel}
          </h3>
          <Separator />
          <div className="flex gap-3">
            <Input
              type="number"
              placeholder={t("Filters.price.min")}
              value={min}
              onChange={(e) => setMin(e.target.value)}
              className="rounded-sm h-9"
            />
            <Input
              type="number"
              placeholder={t("Filters.price.max")}
              value={max}
              onChange={(e) => setMax(e.target.value)}
              className="rounded-sm h-9"
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

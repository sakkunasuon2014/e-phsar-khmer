"use client";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import { IconCircleCheckFilled } from "@tabler/icons-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  SORT_OPTIONS,
  SORT_PARAM,
  defaultSortFor,
  hasQueryParam,
  parseSortParam,
  sortOptionsFor,
  type SortValue,
} from "@/lib/search-params";

// Re-exported for existing importers; the source of truth is lib/search-params.
export { SORT_OPTIONS, SORT_PARAM, parseSortParam };
export type { SortValue };

export default function SortFilter() {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // With a keyword the default is "Best match"; without one, "Latest Ads".
  const hasQuery = hasQueryParam(searchParams);
  const defaultSort = defaultSortFor(hasQuery);
  const options = sortOptionsFor(hasQuery);
  const sortParam = parseSortParam(searchParams.get(SORT_PARAM), hasQuery);
  const [open, setOpen] = useState(false);

  const hasActiveFilter = sortParam !== defaultSort;
  const option = SORT_OPTIONS.find((o) => o.value === sortParam);
  const adsLabel =
    sortParam === defaultSort
      ? t("Filters.sort.label")
      : t("Filters.sort.activeChip", {
          label: option ? t(option.labelKey) : t("Filters.sort.label"),
        });

  function pushSort(next: SortValue) {
    const params = new URLSearchParams(searchParams.toString());

    if (next === defaultSort) {
      params.delete(SORT_PARAM);
    } else {
      params.set(SORT_PARAM, next);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  function selectSort(value: SortValue) {
    pushSort(value);
    setOpen(false);
  }

  function removeFilter(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    pushSort(defaultSort);
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
            open && !hasActiveFilter && "",
          )}
        >
          <span>{adsLabel}</span>
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
              aria-label={t("Filters.sort.remove")}
            >
              <X className="size-4 shrink-0 text-foreground" aria-hidden />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="rounded-sm w-50 p-0 mt-3">
        <p className="type-card-heading text-foreground text-center pt-2 ">
          {t("Filters.sort.label")}
        </p>
        <ul className="">
          <div className="border-b border-gray-200" />
          {options.map((option) => {
            const isSelected = sortParam === option.value;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  onClick={() => selectSort(option.value)}
                  className="flex w-full items-center justify-between px-3 py-2.5 type-nav hover:bg-muted/60 transition-colors cursor-pointer"
                >
                  <span>{t(option.labelKey)}</span>
                  {isSelected && (
                    <IconCircleCheckFilled
                      className="size-5 shrink-0 text-sky-600"
                      aria-hidden
                    />
                  )}
                </button>
                <Separator />
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

"use client";
import * as React from "react";
import { ChevronRight, ChevronLeft, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  LOCATION_COM_PARAM,
  LOCATION_DIS_PARAM,
  LOCATION_PRO_PARAM,
} from "@/lib/search-params";
import {
  type Place,
  slugLabel,
  useCommunes,
  useDistricts,
  useProvinces,
} from "./use-locations";

// Re-exported for existing importers; the source of truth is lib/search-params.
export { LOCATION_PRO_PARAM, LOCATION_DIS_PARAM, LOCATION_COM_PARAM };

// ─── Step types ────────────────────────────────────────────────────────────────
type Step = "province" | "district" | "commune";
/** A chosen place: the slug is what the URL carries, the name what we show. */
interface Pick {
  slug: string;
  name: string;
}
interface Selection {
  province: Pick | null;
  district: Pick | null;
  commune: Pick | null;
}
const EMPTY: Selection = { province: null, district: null, commune: null };
const pick = (p: Place): Pick => ({ slug: p.slug, name: p.name });

// ─── Component ────────────────────────────────────────────────────────────────
interface LocationSelectorProps {
  placeholder?: string;
}
/**
 * Province → district → commune drill-down over the real geography
 * (`GET /locations/...`). The URL carries slugs (`loc_pro`/`loc_dis`/`loc_com`)
 * — the same slugs the feed's `provinceSlug`/`districtSlug`/`communeSlug`
 * filters resolve.
 */
export function LocationSelectorFilter({ placeholder }: LocationSelectorProps) {
  const t = useTranslations();
  const resolvedPlaceholder = placeholder ?? t("Filters.location.label");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const proParam = searchParams.get(LOCATION_PRO_PARAM);
  const disParam = proParam ? searchParams.get(LOCATION_DIS_PARAM) : null;
  const comParam = disParam ? searchParams.get(LOCATION_COM_PARAM) : null;

  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>("province");
  const listRef = React.useRef<HTMLDivElement | null>(null);

  // Each drill-down replaces the list; start it at the top so the "show all"
  // first row and the scrollbar are aligned when the step changes.
  React.useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
  }, [step]);
  // Local draft while the user is navigating the drill-down (before they commit)
  const [draft, setDraft] = React.useState<Selection>(EMPTY);

  // Names for the committed selection's label (cached, so usually instant).
  const provinces = useProvinces(open || !!proParam);
  const committedDistricts = useDistricts(disParam ? proParam : null);
  const committedCommunes = useCommunes(
    comParam ? proParam : null,
    comParam ? disParam : null,
  );
  // Lists for the step being browsed.
  const draftDistricts = useDistricts(
    open && step !== "province" ? draft.province?.slug : null,
  );
  const draftCommunes = useCommunes(
    open && step === "commune" ? draft.province?.slug : null,
    open && step === "commune" ? draft.district?.slug : null,
  );

  const nameOf = (list: Place[] | undefined, slug: string) =>
    list?.find((p) => p.slug === slug)?.name ?? slugLabel(slug);

  const selection: Selection = {
    province: proParam
      ? { slug: proParam, name: nameOf(provinces.data, proParam) }
      : null,
    district: disParam
      ? { slug: disParam, name: nameOf(committedDistricts.data, disParam) }
      : null,
    commune: comParam
      ? { slug: comParam, name: nameOf(committedCommunes.data, comParam) }
      : null,
  };

  // Sync draft when popover opens so it reflects the current URL state
  const handleOpenChange = (o: boolean) => {
    setOpen(o);
    if (o) {
      setDraft(selection);
      setStep(selection.province ? "district" : "province");
    }
  };
  // ── Write to URL ─────────────────────────────────────────────────────────────
  function pushLocation(sel: Selection) {
    const params = new URLSearchParams(searchParams.toString());
    const put = (key: string, p: Pick | null) =>
      p ? params.set(key, p.slug) : params.delete(key);
    put(LOCATION_PRO_PARAM, sel.province);
    put(LOCATION_DIS_PARAM, sel.district);
    put(LOCATION_COM_PARAM, sel.commune);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }
  // ── Step handlers ─────────────────────────────────────────────────────────────
  const selectProvince = (province: Place) => {
    setDraft({ province: pick(province), district: null, commune: null });
    setStep("district");
  };
  const selectDistrict = (district: Place) => {
    setDraft({ ...draft, district: pick(district), commune: null });
    setStep("commune");
  };
  const selectCommune = (commune: Place) => {
    pushLocation({ ...draft, commune: pick(commune) });
    setOpen(false);
  };
  // "Show all ads in <province/district>" — commits without going deeper
  const showAll = () => {
    if (step === "district") {
      pushLocation({ province: draft.province, district: null, commune: null });
    } else if (step === "commune") {
      pushLocation({ ...draft, commune: null });
    }
    setOpen(false);
  };
  const goBack = () => {
    if (step === "commune") setStep("district");
    else if (step === "district") setStep("province");
  };
  const clearSelection = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    pushLocation(EMPTY);
  };
  // ── Derived display values ────────────────────────────────────────────────────
  const hasSelection = !!selection.province;
  const locationLabel =
    selection.commune?.name ??
    selection.district?.name ??
    selection.province?.name ??
    resolvedPlaceholder;
  const showAllLabel: string | null = {
    province: null,
    district: draft.province?.name
      ? t("Filters.location.showAll", { place: draft.province.name })
      : null,
    commune: draft.district?.name
      ? t("Filters.location.showAll", { place: draft.district.name })
      : null,
  }[step];
  const current =
    step === "province"
      ? provinces
      : step === "district"
        ? draftDistricts
        : draftCommunes;
  const items = current.data ?? [];
  const onPick =
    step === "province"
      ? selectProvince
      : step === "district"
        ? selectDistrict
        : selectCommune;

  return (
    <div className="relative inline-flex items-center">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              "flex items-center bg-muted rounded-sm gap-2 h-12 py-1.5 type-nav cursor-pointer whitespace-nowrap",
              hasSelection ? "text-foreground border-muted pr-7 pl-3" : "px-3",
            )}
          >
            <MapPin
              className={cn(
                "h-4 w-4 shrink-0",
                hasSelection ? "text-sky-500" : "text-foreground",
              )}
            />
            <span className={hasSelection ? "text-sky-500" : ""}>
              {locationLabel}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="rounded-sm w-70 p-0 gap-0 mt-3"
          align="start"
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            {step !== "province" && (
              <button
                onClick={goBack}
                className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                aria-label={t("Filters.location.back")}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <span className="type-nav flex-1 text-center pr-4">
              {t("Filters.location.label")}
            </span>
          </div>
          <Separator />
          {/* Item list — the "show all" row is the first row so it scrolls
              with the list and the scrollbar starts at the top. */}
          <div ref={listRef} className="max-h-[320px] overflow-y-auto">
            {showAllLabel && (
              <button
                onClick={showAll}
                className="flex w-full items-center px-4 py-2.5 text-left type-nav text-[#00a0e9] border-b hover:bg-muted/50 transition-colors cursor-pointer"
              >
                {showAllLabel}
              </button>
            )}
            {current.isLoading && (
              <p className="px-4 py-2.5 type-body-sm text-muted-foreground">
                {t("Common.loading")}
              </p>
            )}
            {items.map((item) => (
              <button
                key={item.id}
                onClick={() => onPick(item)}
                className="flex items-center justify-between w-full px-4 py-2.5 type-nav hover:bg-muted/50 transition-colors text-left cursor-pointer"
              >
                <span>{item.name}</span>
                {step !== "commune" && (
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </button>
            ))}
          </div>
          <Separator />
        </PopoverContent>
      </Popover>
      {/* Clear (X) button — outside trigger so it doesn't open the popover */}
      {hasSelection && (
        <button
          type="button"
          onClick={clearSelection}
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-0.5 rounded-full hover:bg-background/80 transition-colors cursor-pointer"
          aria-label={t("Filters.location.clear")}
        >
          <X className="h-3.5 w-3.5 shrink-0 text-foreground" />
        </button>
      )}
    </div>
  );
}

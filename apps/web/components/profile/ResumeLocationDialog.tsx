"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronLeft, X } from "lucide-react";

import {
  useCommunes,
  useDistricts,
  useProvinces,
  type Place,
} from "@/components/filter/use-locations";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The resume builder's Location popup: the project's province → district →
 * commune drill-down (same data and flow as the post form's picker), styled as
 * a centered "Location" dialog — divider rows and a blue check on the row
 * that's currently chosen.
 */

export interface ResumeLocation {
  province: Place | null;
  district: Place | null;
  commune: Place | null;
}

export const EMPTY_RESUME_LOCATION: ResumeLocation = {
  province: null,
  district: null,
  commune: null,
};

/** "Phnom Penh, Boeng Keng Kang, Olympic" — largest to smallest. */
export function resumeLocationLabel(location: ResumeLocation): string {
  return [location.province, location.district, location.commune]
    .map((level) => level?.name)
    .filter(Boolean)
    .join(", ");
}

type Level = "province" | "district" | "commune";

export function ResumeLocationDialog({
  open,
  onOpenChange,
  value,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ResumeLocation;
  onChange: (location: ResumeLocation) => void;
}) {
  const t = useTranslations("Resume");
  // The parent remounts this dialog on every open (key), so `level` starts
  // fresh at "province" — re-opening never resumes a half-drilled level.
  const [level, setLevel] = useState<Level>("province");

  const provinces = useProvinces(open);
  const districts = useDistricts(
    open && level !== "province" ? value.province?.slug : null,
  );
  const communes = useCommunes(
    open && level === "commune" ? value.province?.slug : null,
    open && level === "commune" ? value.district?.slug : null,
  );

  const current =
    level === "province"
      ? provinces
      : level === "district"
        ? districts
        : communes;
  const rows: Place[] = current.data ?? [];
  const selected =
    level === "province"
      ? value.province
      : level === "district"
        ? value.district
        : value.commune;
  const title =
    level === "province"
      ? t("labels.location")
      : level === "district"
        ? (value.province?.name ?? t("labels.location"))
        : (value.district?.name ?? t("labels.location"));

  const pick = (row: Place) => {
    if (level === "province") {
      onChange({ province: row, district: null, commune: null });
      setLevel("district");
      return;
    }
    if (level === "district") {
      onChange({ ...value, district: row, commune: null });
      setLevel("commune");
      return;
    }
    onChange({ ...value, commune: row });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[85vh] max-h-[850px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]"
      >
        <div className="relative flex shrink-0 items-center justify-center border-b px-14 py-4">
          {level !== "province" && (
            <button
              type="button"
              aria-label={t("form.back")}
              onClick={() =>
                setLevel(level === "commune" ? "district" : "province")
              }
              className="absolute left-4 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-muted"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <DialogTitle>{title}</DialogTitle>
          <DialogClose asChild>
            <button
              type="button"
              aria-label={t("form.close")}
              className="absolute right-4 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-muted text-gray-500 transition-colors hover:bg-muted/70"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogClose>
        </div>
        <DialogDescription className="sr-only">
          {t("form.locationDescription")}
        </DialogDescription>

        <div className="min-h-0 flex-1 divide-y overflow-y-auto">
          {current.isLoading && rows.length === 0 ? (
            <p className="px-5 py-4 type-body-sm text-muted-foreground">
              {t("form.loading")}
            </p>
          ) : rows.length === 0 ? (
            <p className="px-5 py-4 type-body-sm text-muted-foreground">
              {t("form.nothingHere")}
            </p>
          ) : (
            rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => pick(row)}
                className="flex w-full cursor-pointer items-center justify-between px-5 py-4 text-left type-body-sm transition-colors hover:bg-muted/50"
              >
                <span>{row.name}</span>
                {selected?.id === row.id && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#00a0e9]">
                    <Check className="h-3 w-3 text-white" strokeWidth={3} />
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

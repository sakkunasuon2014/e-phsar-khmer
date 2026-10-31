"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconCheck, IconChevronDown, IconX } from "@tabler/icons-react";

import type { JobPreferenceEntry } from "@/components/profile/ResumePreview";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface PreferenceOptions {
  categories: string[];
  locations: string[];
  jobTypes: string[];
}

/**
 * The Job Preferences form — the captain's mock. Its own add/edit dialog, NOT
 * one of the wizard steps: an "Open Job" toggle, Preferred Position, and three
 * multi-select pickers (Categories / Locations / Job Type) whose options the
 * resume page loads from the backend. Picked values render as removable chips
 * on the field, and the list keeps circling the chosen ones.
 *
 * Validation: Preferred Position is required only while "Open Job" is on
 * ("Please enter the 'Position'", house click-then-flag style); off, nothing is
 * required. Edit mode only — there is no wizard counterpart.
 */
export function ResumeJobPreferencesDialog({
  open,
  onOpenChange,
  initial,
  options,
  onSubmit,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: JobPreferenceEntry | null;
  options: PreferenceOptions;
  /** Resolves `true` only once the preference was stored. */
  onSubmit: (entry: JobPreferenceEntry) => Promise<boolean>;
  onSave: () => void;
}) {
  const t = useTranslations("Resume");
  const [openJob, setOpenJob] = useState(false);
  const [position, setPosition] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [jobTypes, setJobTypes] = useState<string[]>([]);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [jobTypeOpen, setJobTypeOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const positionFieldRef = useRef<HTMLDivElement>(null);
  const draftId = useRef(crypto.randomUUID());

  // Loads the saved preference on open (blank for a fresh Add).
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!open) return;
    setOpenJob(initial?.openJob ?? false);
    setPosition(initial?.position ?? "");
    setCategories(initial?.category ?? []);
    setLocations(initial?.location ?? []);
    setJobTypes(initial?.jobType ?? []);
    setShowErrors(false);
    draftId.current = initial?.id ?? crypto.randomUUID();
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const positionMissing = openJob && position.trim() === "";

  async function handleSave() {
    if (positionMissing) {
      setShowErrors(true);
      positionFieldRef.current?.scrollIntoView({ block: "center" });
      return;
    }
    setSaving(true);
    const ok = await onSubmit({
      id: draftId.current,
      openJob,
      position,
      category: categories,
      location: locations,
      jobType: jobTypes,
    });
    setSaving(false);
    if (!ok) return;
    onSave();
  }

  const renderMultiSelect = (
    id: string,
    label: string,
    values: string[],
    setValues: (values: string[]) => void,
    openFlag: boolean,
    setOpenFlag: (open: boolean) => void,
    items: string[],
  ) => {
    const toggleValue = (item: string) =>
      setValues(
        values.includes(item)
          ? values.filter((v) => v !== item)
          : [...values, item],
      );
    return (
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <div className="relative">
          <Popover open={openFlag} onOpenChange={setOpenFlag}>
            <PopoverTrigger asChild>
              <button
                type="button"
                id={id}
                className="flex min-h-11 w-full cursor-pointer items-center rounded-sm border border-input bg-transparent px-2.5 py-1.5 pr-10 text-left type-body outline-none transition-colors focus-visible:border-[#00a0e9] focus-visible:ring-1 focus-visible:ring-[#00a0e9]"
              >
                {values.length === 0 ? (
                  <span className="text-muted-foreground">
                    {t("form.selectPlaceholder")}
                  </span>
                ) : (
                  <span className="flex flex-wrap items-center gap-1.5">
                    {values.map((value) => (
                      <span
                        key={value}
                        className="flex items-center gap-1 rounded-sm bg-[#00a0e9] px-2 py-1 type-nav text-white"
                      >
                        {value}
                        <span
                          role="button"
                          tabIndex={-1}
                          aria-label={t("form.removeValue", { value })}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleValue(value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.stopPropagation();
                              toggleValue(value);
                            }
                          }}
                          className="flex cursor-pointer items-center"
                        >
                          <IconX size={13} />
                        </span>
                      </span>
                    ))}
                  </span>
                )}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-[var(--radix-popover-trigger-width)] p-0"
            >
              <Command>
                <CommandList>
                  {items.map((item) => {
                    const selected = values.includes(item);
                    return (
                      <CommandItem
                        key={item}
                        value={item}
                        onSelect={() => toggleValue(item)}
                        className="cursor-pointer"
                      >
                        <span
                          className={cn(
                            "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border",
                            selected
                              ? "border-[#00a0e9] bg-[#00a0e9] text-white"
                              : "border-gray-400",
                          )}
                        >
                          {selected && <IconCheck size={12} />}
                        </span>
                        <span>{item}</span>
                      </CommandItem>
                    );
                  })}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          {/* Caret gives way to a clear-× once the field has values. */}
          {values.length > 0 ? (
            <button
              type="button"
              aria-label={t("form.clearField", { label })}
              onClick={() => setValues([])}
              className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-muted hover:text-gray-700"
            >
              <IconX size={18} />
            </button>
          ) : (
            <IconChevronDown
              size={16}
              className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-500"
            />
          )}
        </div>
      </Field>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[950px]"
      >
        <div className="flex shrink-0 items-center gap-3 border-b px-6 py-4">
          <DialogTitle>{t("form.titles.jobPrefs")}</DialogTitle>
          <DialogClose asChild>
            <button
              type="button"
              className="ml-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border text-gray-500 transition-colors hover:bg-muted"
            >
              <IconX size={18} />
              <span className="sr-only">{t("form.close")}</span>
            </button>
          </DialogClose>
        </div>
        <DialogDescription className="sr-only">
          {t("sections.jobPreferences.desc")}
        </DialogDescription>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <FieldGroup>
            <div className="flex h-11 items-center justify-between rounded-sm border border-input px-3">
              <span className="type-body text-foreground">
                {t("form.openJob")}
              </span>
              <Switch
                checked={openJob}
                onCheckedChange={setOpenJob}
                className="data-checked:bg-[#00a0e9]"
              />
            </div>

            <Field
              ref={positionFieldRef}
              data-invalid={showErrors && positionMissing}
            >
              <FieldLabel htmlFor="rjp-position">
                {t("form.preferredPosition")}
                {openJob && <span className="text-destructive"> *</span>}
              </FieldLabel>
              <Input
                id="rjp-position"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                aria-invalid={showErrors && positionMissing}
                className="h-11"
              />
              {showErrors && positionMissing && (
                <FieldError>
                  {t("form.validation.required", {
                    field: t("form.position"),
                  })}
                </FieldError>
              )}
            </Field>

            {renderMultiSelect(
              "rjp-category",
              t("form.categories"),
              categories,
              setCategories,
              categoryOpen,
              setCategoryOpen,
              options.categories,
            )}
            {renderMultiSelect(
              "rjp-location",
              t("form.locations"),
              locations,
              setLocations,
              locationOpen,
              setLocationOpen,
              options.locations,
            )}
            {renderMultiSelect(
              "rjp-jobtype",
              t("form.jobType"),
              jobTypes,
              setJobTypes,
              jobTypeOpen,
              setJobTypeOpen,
              options.jobTypes,
            )}
          </FieldGroup>
        </div>

        <div className="shrink-0 border-t px-6 py-4">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="h-12 w-full cursor-pointer rounded-sm bg-orange-500 type-nav text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {t("form.save")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

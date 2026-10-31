"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconArrowLeft, IconChevronDown, IconX } from "@tabler/icons-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { LanguageEntry } from "@/components/profile/ResumePreview";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Command, CommandItem, CommandList } from "@/components/ui/command";

/**
 * Resume builder — Step 6 of 8, "Languages".
 *
 * UI only for now: one language entry — Title* and Level* (Beginner /
 * Intermediate / Advanced / Native) — nothing saved. "Next to Hobbies &
 * Interests" validates like Steps 3–5: allow the click, flag the missing
 * fields in red, scroll to the first one, then advance to Step 7; Skip advances
 * without validating.
 */

const LEVELS = ["Beginner", "Intermediate", "Advanced", "Native"] as const;
const LEVEL_KEYS: Record<string, string> = {
  Beginner: "beginner",
  Intermediate: "intermediate",
  Advanced: "advanced",
  Native: "native",
};

export function ResumeLanguagesDialog({
  open,
  onOpenChange,
  onBack,
  onNext,
  onSkip,
  mode = "wizard",
  onSave,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  /** "wizard" = the guided flow; "edit" = the view's Add Language form. */
  mode?: "wizard" | "edit";
  onSave?: () => void;
  /** Pre-filled entry when opened via ⋮ → Edit; null for Add. */
  initial?: LanguageEntry | null;
  /** Resolves `true` only once the entry was stored. */
  onSubmit: (entry: LanguageEntry) => Promise<boolean>;
}) {
  const t = useTranslations("Resume");
  const [title, setTitle] = useState("");
  const [level, setLevel] = useState<string | undefined>(undefined);
  const [levelOpen, setLevelOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const titleFieldRef = useRef<HTMLDivElement>(null);
  const levelFieldRef = useRef<HTMLDivElement>(null);
  const draftId = useRef(crypto.randomUUID());

  // ⋮ → Edit loads that entry; Add loads blanks. Wizard mode keeps whatever is
  // on screen, so Back/Next never wipes a step in progress.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!open || mode !== "edit") return;
    setTitle(initial?.title ?? "");
    setLevel(initial?.level ?? undefined);
    setShowErrors(false);
    draftId.current = initial?.id ?? crypto.randomUUID();
  }, [open, mode]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const titleMissing = title.trim() === "";
  const levelMissing = !level;
  const valid = !titleMissing && !levelMissing;
  const titleError = showErrors && titleMissing;
  const levelError = showErrors && levelMissing;

  async function handleNext() {
    if (!valid) {
      setShowErrors(true);
      const firstMissing = titleMissing ? titleFieldRef : levelFieldRef;
      firstMissing.current?.scrollIntoView({ block: "center" });
      return;
    }
    setSaving(true);
    const ok = await onSubmit({
      id: draftId.current,
      title,
      level: level as string,
    });
    setSaving(false);
    if (!ok) return;
    if (mode === "edit") {
      onSave?.();
      return;
    }
    onNext();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[950px]"
      >
        <div className="flex shrink-0 items-center gap-3 border-b px-6 py-4">
          {mode === "wizard" && (
            <button
              type="button"
              onClick={onBack}
              aria-label={t("form.backSkills")}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted"
            >
              <IconArrowLeft size={20} />
            </button>
          )}
          <DialogTitle>
            {mode === "edit"
              ? t("form.titles.languagesEdit")
              : t("form.titles.languagesWizard")}
          </DialogTitle>
          {mode === "wizard" ? (
            <span className="ml-auto type-nav text-[#00a0e9]">
              {t("form.step", { current: 6, total: 8 })}
            </span>
          ) : (
            <DialogClose asChild>
              <button
                type="button"
                className="ml-auto flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border text-gray-500 transition-colors hover:bg-muted"
              >
                <IconX size={18} />
                <span className="sr-only">{t("form.close")}</span>
              </button>
            </DialogClose>
          )}
        </div>
        <DialogDescription className="sr-only">
          {t("form.stepDescription", {
            current: 6,
            total: 8,
            name: t("form.titles.languagesWizard"),
          })}
        </DialogDescription>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {mode === "wizard" && (
            <p className="type-body text-muted-foreground">
              {t("sections.languages.desc")}
            </p>
          )}

          <FieldGroup className="mt-4">
            <Field ref={titleFieldRef} data-invalid={titleError}>
              <FieldLabel htmlFor="rlg-title">
                {t("form.titleLabel")}{" "}
                <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="rlg-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={50}
                aria-invalid={titleError}
                className="h-11"
              />
              {titleError && (
                <FieldError>
                  {t("form.validation.required", {
                    field: t("form.titleLabel"),
                  })}
                </FieldError>
              )}
            </Field>

            <Field ref={levelFieldRef} data-invalid={levelError}>
              <FieldLabel htmlFor="rlg-level">
                {t("form.level")} <span className="text-destructive">*</span>
              </FieldLabel>
              <div className="relative">
                <Popover open={levelOpen} onOpenChange={setLevelOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      id="rlg-level"
                      data-invalid={levelError}
                      className="flex h-11 w-full cursor-pointer items-center rounded-sm border border-input bg-transparent px-2.5 pr-10 text-left type-body outline-none transition-colors focus-visible:border-[#00a0e9] focus-visible:ring-1 focus-visible:ring-[#00a0e9] data-[invalid=true]:border-destructive data-[invalid=true]:ring-3 data-[invalid=true]:ring-destructive/20"
                    >
                      <span className={level ? "" : "text-muted-foreground"}>
                        {level ?? ""}
                      </span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                  >
                    <Command>
                      <CommandList>
                        {LEVELS.map((option) => (
                          <CommandItem
                            key={option}
                            value={option}
                            onSelect={() => {
                              setLevel(option);
                              setLevelOpen(false);
                            }}
                            className="cursor-pointer"
                          >
                            <span>
                              {t(`form.options.${LEVEL_KEYS[option]}`)}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {level ? (
                  <button
                    type="button"
                    aria-label={t("form.clearLevel")}
                    onClick={() => setLevel(undefined)}
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
              {levelError && (
                <FieldError>
                  {t("form.validation.select", { field: t("form.level") })}
                </FieldError>
              )}
            </Field>
          </FieldGroup>
        </div>

        {mode === "wizard" ? (
          <div className="flex shrink-0 gap-4 border-t px-6 py-4">
            <button
              type="button"
              onClick={onSkip}
              className="h-12 w-[165px] cursor-pointer rounded-sm bg-gray-500 type-nav text-white transition-colors hover:bg-gray-600"
            >
              {t("form.skip")}
            </button>
            <button
              type="button"
              onClick={handleNext}
              disabled={saving}
              className="h-12 flex-1 cursor-pointer rounded-sm bg-[#00a0e9] type-nav text-white transition-colors hover:bg-[#00a0e9]/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("form.nextHobbies")}
            </button>
          </div>
        ) : (
          <div className="shrink-0 border-t px-6 py-4">
            <button
              type="button"
              onClick={handleNext}
              disabled={saving}
              className="h-12 w-full cursor-pointer rounded-sm bg-orange-500 type-nav text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("form.save")}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

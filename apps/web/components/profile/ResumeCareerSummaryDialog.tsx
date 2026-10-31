"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { IconArrowLeft, IconX } from "@tabler/icons-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Resume builder — Step 2 of 8, "Career Summary".
 *
 * UI only for now: the textarea's text lives in local state and is not saved.
 * The back arrow returns to Step 1 (all dialogs stay mounted, so every step
 * keeps its answers); "Skip" and "Next to Experiences" both advance to Step 3
 * without validating — nothing here is required.
 */
export function ResumeCareerSummaryDialog({
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
  /** "wizard" = the guided flow; "edit" = the view's Add Summary form. */
  mode?: "wizard" | "edit";
  onSave?: () => void;
  /** Pre-filled text when opened via ⋮ → Edit. */
  initial?: string | null;
  /** Resolves `true` only once the text was stored. */
  onSubmit: (text: string) => Promise<boolean>;
}) {
  const t = useTranslations("Resume");
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);

  // Opened via ⋮ → Edit: load the saved text (Add loads blank). Wizard mode
  // keeps whatever is on screen, so Back/Next never wipes a step in progress.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!open || mode !== "edit") return;
    setSummary(initial ?? "");
  }, [open, mode]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // Nothing here is required: both actions write the text, then advance.
  async function handleSubmit() {
    setSaving(true);
    const ok = await onSubmit(summary);
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
              aria-label={t("form.backPersonal")}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted"
            >
              <IconArrowLeft size={20} />
            </button>
          )}
          <DialogTitle>
            {mode === "edit"
              ? t("form.titles.summaryEdit")
              : t("form.titles.summaryWizard")}
          </DialogTitle>
          {mode === "wizard" ? (
            <span className="ml-auto type-nav text-[#00a0e9]">
              {t("form.step", { current: 2, total: 8 })}
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
            current: 2,
            total: 8,
            name: t("form.titles.summaryWizard"),
          })}
        </DialogDescription>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {mode === "wizard" && (
            <p className="type-body text-muted-foreground">
              {t("sections.summary.desc")}
            </p>
          )}
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            aria-label={t("form.careerSummary")}
            maxLength={1000}
            className="mt-4 h-[440px] w-full resize-y rounded-sm border border-input bg-transparent p-4 type-body outline-none transition-colors focus-visible:border-[#00a0e9] focus-visible:ring-1 focus-visible:ring-[#00a0e9]"
          />
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
              onClick={handleSubmit}
              disabled={saving}
              className="h-12 flex-1 cursor-pointer rounded-sm bg-[#00a0e9] type-nav text-white transition-colors hover:bg-[#00a0e9]/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {t("form.nextExperiences")}
            </button>
          </div>
        ) : (
          <div className="shrink-0 border-t px-6 py-4">
            <button
              type="button"
              onClick={handleSubmit}
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

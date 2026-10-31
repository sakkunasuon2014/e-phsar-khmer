"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconArrowLeft, IconMinus, IconPlus, IconX } from "@tabler/icons-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReferenceEntry } from "@/components/profile/ResumePreview";
import {
  isValidEmail,
  isValidPhone,
} from "@/components/profile/resume-validation";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Resume builder — Step 8 of 8, "References".
 *
 * UI only for now: one reference — Name*, Company*, Position*, Phone Number*
 * (up to 3 rows, same add/remove pattern as Step 1) and an optional Email —
 * nothing saved. "Finish" validates like the other steps: allow the click,
 * flag the missing fields in red, scroll to the first one; what happens after
 * a valid finish hands the finished resume view to the parent; Skip does the
 * same immediately.
 */

const MAX_PHONES = 3;

export function ResumeReferencesDialog({
  open,
  onOpenChange,
  onBack,
  onFinished,
  onSkip,
  mode = "wizard",
  onSave,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack: () => void;
  onFinished: () => void;
  onSkip: () => void;
  /** "wizard" = the guided flow; "edit" = the view's Add Reference form. */
  mode?: "wizard" | "edit";
  onSave?: () => void;
  /** Pre-filled entry when opened via ⋮ → Edit; null for Add. */
  initial?: ReferenceEntry | null;
  /** Resolves `true` only once the entry was stored. */
  onSubmit: (entry: ReferenceEntry) => Promise<boolean>;
}) {
  const t = useTranslations("Resume");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [phones, setPhones] = useState<string[]>([""]);
  const [email, setEmail] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameFieldRef = useRef<HTMLDivElement>(null);
  const companyFieldRef = useRef<HTMLDivElement>(null);
  const positionFieldRef = useRef<HTMLDivElement>(null);
  const phoneFieldRef = useRef<HTMLDivElement>(null);
  const emailFieldRef = useRef<HTMLDivElement>(null);
  const draftId = useRef(crypto.randomUUID());

  // ⋮ → Edit loads that entry; Add loads blanks. Wizard mode keeps whatever is
  // on screen, so Back/Next never wipes a step in progress.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!open || mode !== "edit") return;
    setName(initial?.name ?? "");
    setCompany(initial?.company ?? "");
    setPosition(initial?.position ?? "");
    setPhones(initial?.phones?.length ? [...initial.phones] : [""]);
    setEmail(initial?.email ?? "");
    setShowErrors(false);
    draftId.current = initial?.id ?? crypto.randomUUID();
  }, [open, mode]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  function updatePhone(index: number, value: string) {
    setPhones((prev) => prev.map((p, i) => (i === index ? value : p)));
  }

  function addPhone() {
    setPhones((prev) => (prev.length >= MAX_PHONES ? prev : [...prev, ""]));
  }

  function removePhone(index: number) {
    setPhones((prev) =>
      prev.length === 1 ? prev : prev.filter((_, i) => i !== index),
    );
  }

  const nameMissing = name.trim() === "";
  const companyMissing = company.trim() === "";
  const positionMissing = position.trim() === "";
  const phoneMissing = !phones.some((phone) => phone.trim() !== "");
  const phoneFormatInvalid = phones.some(
    (phone) => phone.trim() !== "" && !isValidPhone(phone),
  );
  const emailInvalid = email.trim() !== "" && !isValidEmail(email);
  const valid =
    !nameMissing &&
    !companyMissing &&
    !positionMissing &&
    !phoneMissing &&
    !phoneFormatInvalid &&
    !emailInvalid;
  const nameError = showErrors && nameMissing;
  const companyError = showErrors && companyMissing;
  const positionError = showErrors && positionMissing;
  const phoneError = showErrors && phoneMissing;
  const phoneFormatError = showErrors && phoneFormatInvalid;
  const emailError = showErrors && emailInvalid;

  async function handleNext() {
    if (!valid) {
      setShowErrors(true);
      const firstMissing = nameMissing
        ? nameFieldRef
        : companyMissing
          ? companyFieldRef
          : positionMissing
            ? positionFieldRef
            : phoneMissing || phoneFormatInvalid
              ? phoneFieldRef
              : emailFieldRef;
      firstMissing.current?.scrollIntoView({ block: "center" });
      return;
    }
    setSaving(true);
    const ok = await onSubmit({
      id: draftId.current,
      name,
      company,
      position,
      phones: phones.map((p) => p.trim()).filter((p) => p !== ""),
      email,
    });
    setSaving(false);
    if (!ok) return;
    if (mode === "edit") {
      onSave?.();
      return;
    }
    onFinished();
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
              aria-label={t("form.backHobbies")}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-foreground transition-colors hover:bg-muted"
            >
              <IconArrowLeft size={20} />
            </button>
          )}
          <DialogTitle>
            {mode === "edit"
              ? t("form.titles.referencesEdit")
              : t("form.titles.referencesWizard")}
          </DialogTitle>
          {mode === "wizard" ? (
            <span className="ml-auto type-nav text-[#00a0e9]">
              {t("form.step", { current: 8, total: 8 })}
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
            current: 8,
            total: 8,
            name: t("form.titles.referencesWizard"),
          })}
        </DialogDescription>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {mode === "wizard" && (
            <p className="type-body text-muted-foreground">
              {t("sections.references.desc")}
            </p>
          )}

          <FieldGroup className="mt-4">
            <Field ref={nameFieldRef} data-invalid={nameError}>
              <FieldLabel htmlFor="rrf-name">
                {t("form.name")} <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="rrf-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                aria-invalid={nameError}
                className="h-11"
              />
              {nameError && (
                <FieldError>
                  {t("form.validation.required", {
                    field: t("form.name"),
                  })}
                </FieldError>
              )}
            </Field>

            <Field ref={companyFieldRef} data-invalid={companyError}>
              <FieldLabel htmlFor="rrf-company">
                {t("form.company")} <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="rrf-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                maxLength={100}
                aria-invalid={companyError}
                className="h-11"
              />
              {companyError && (
                <FieldError>
                  {t("form.validation.required", {
                    field: t("form.company"),
                  })}
                </FieldError>
              )}
            </Field>

            <Field ref={positionFieldRef} data-invalid={positionError}>
              <FieldLabel htmlFor="rrf-position">
                {t("form.position")} <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="rrf-position"
                value={position}
                onChange={(e) => setPosition(e.target.value)}
                maxLength={100}
                aria-invalid={positionError}
                className="h-11"
              />
              {positionError && (
                <FieldError>
                  {t("form.validation.required", {
                    field: t("form.position"),
                  })}
                </FieldError>
              )}
            </Field>

            <Field
              ref={phoneFieldRef}
              data-invalid={phoneError || phoneFormatError}
            >
              <FieldLabel>
                {t("form.phoneNumber")}{" "}
                <span className="text-destructive">*</span>
              </FieldLabel>
              <div className="flex flex-col gap-3">
                {phones.map((phone, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="relative flex-1">
                      <Input
                        type="tel"
                        inputMode="tel"
                        value={phone}
                        onChange={(e) => updatePhone(index, e.target.value)}
                        placeholder={t("form.phonePlaceholder", {
                          number: index + 1,
                        })}
                        maxLength={15}
                        aria-invalid={
                          (phoneError && index === 0) ||
                          (showErrors &&
                            phone.trim() !== "" &&
                            !isValidPhone(phone))
                        }
                        className="h-11 pr-11"
                      />
                      {index > 0 && (
                        <button
                          type="button"
                          aria-label={t("form.removePhone", {
                            number: index + 1,
                          })}
                          onClick={() => removePhone(index)}
                          className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
                        >
                          <IconMinus size={16} />
                        </button>
                      )}
                    </div>
                    {index === phones.length - 1 &&
                      phones.length < MAX_PHONES && (
                        <button
                          type="button"
                          aria-label={t("form.addAnotherPhone")}
                          onClick={addPhone}
                          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#00a0e9] text-white transition-colors hover:bg-[#00a0e9]/90"
                        >
                          <IconPlus size={18} />
                        </button>
                      )}
                  </div>
                ))}
              </div>
              {phoneError && (
                <FieldError>{t("form.validation.phoneRequired")}</FieldError>
              )}
              {phoneFormatError && (
                <FieldError>{t("form.validation.phoneInvalid")}</FieldError>
              )}
            </Field>

            <Field ref={emailFieldRef} data-invalid={emailError}>
              <FieldLabel htmlFor="rrf-email">{t("form.email")}</FieldLabel>
              <Input
                id="rrf-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                maxLength={254}
                aria-invalid={emailError}
                className="h-11"
              />
              {emailError && (
                <FieldError>{t("form.validation.email")}</FieldError>
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
              {t("form.finish")}
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

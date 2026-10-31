"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import SettingSidebar from "./SettingSidebar";
import { changePassword } from "@/actions/settings";
import type { SettingsUser } from "@/lib/auth/current-user";

export default function ChangePassword({ me }: { me?: SettingsUser | null }) {
  const t = useTranslations("Settings.passwordPage");
  // ===== STATE =====
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [showCurrent, setShowCurrent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [touchedCurrent, setTouchedCurrent] = useState(false);
  const [touchedPassword, setTouchedPassword] = useState(false);
  const [touchedConfirm, setTouchedConfirm] = useState(false);
  const [saving, setSaving] = useState(false);

  // ===== VALIDATION =====
  const isCurrentInvalid = touchedCurrent && current.length === 0;
  const isPasswordInvalid = touchedPassword && password.length < 8;
  const isConfirmInvalid = touchedConfirm && confirmPassword !== password;

  const canSubmit =
    current.length > 0 &&
    password.length >= 8 &&
    confirmPassword === password &&
    !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);

    const result = await changePassword(current, password);
    setSaving(false);

    if (!result.success) {
      toast.error(result.error ?? t("failed"));
      return;
    }

    toast.success(t("changed"));
    setCurrent("");
    setPassword("");
    setConfirmPassword("");
    setTouchedCurrent(false);
    setTouchedPassword(false);
    setTouchedConfirm(false);
  }

  return (
    <div className="min-h-screen bg-muted pb-10 pt-4">
      <div className="max-w-6xl mx-auto  ">
        <div className="flex gap-5 ">
          <SettingSidebar me={me} />
          <main className="flex-1">
            <div className="bg-card border border-border rounded-sm ">
              <h1 className="type-page-title text-foreground mb-4 mt-12 text-center">
                {t("title")}
              </h1>
              <p className="text-center mb-6">{t("description")}</p>

              {/* Asking for the current password is what stops a borrowed,
                  still-signed-in session from locking the owner out. */}
              <Field className="w-full max-w-md mx-auto">
                <FieldLabel className="text-foreground tracking-tight">
                  {t("current")} <span className="text-destructive">*</span>
                </FieldLabel>

                <InputGroup>
                  <InputGroupInput
                    type={showCurrent ? "text" : "password"}
                    value={current}
                    onChange={(e) => {
                      setCurrent(e.target.value);
                      setTouchedCurrent(true);
                    }}
                    autoComplete="current-password"
                    className={`w-full rounded-md transition-all h-10 ${
                      isCurrentInvalid
                        ? "border-destructive ring-1 ring-destructive/20"
                        : ""
                    }`}
                  />
                  <InputGroupAddon
                    align="inline-end"
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCurrent(!showCurrent)}
                  >
                    {showCurrent ? (
                      <EyeIcon size={18} />
                    ) : (
                      <EyeOffIcon size={18} />
                    )}
                  </InputGroupAddon>
                </InputGroup>
                {isCurrentInvalid && (
                  <FieldDescription className="text-destructive">
                    {t("currentHelp")}
                  </FieldDescription>
                )}
              </Field>

              <Field className="w-full max-w-md mx-auto mt-6">
                <FieldLabel className="text-foreground tracking-tight">
                  {t("newPassword")} <span className="text-destructive">*</span>
                </FieldLabel>

                <InputGroup>
                  <InputGroupInput
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setTouchedPassword(true);
                    }}
                    autoComplete="new-password"
                    className={`w-full rounded-md transition-all h-10
                                             ${isPasswordInvalid ? "border-destructive ring-1 ring-destructive/20" : ""}
                                        `}
                  />
                  <InputGroupAddon
                    align="inline-end"
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeIcon size={18} />
                    ) : (
                      <EyeOffIcon size={18} />
                    )}
                  </InputGroupAddon>
                </InputGroup>
                {isPasswordInvalid && (
                  <FieldDescription className="text-destructive">
                    {t("newPasswordHelp")}
                  </FieldDescription>
                )}
              </Field>
              <Field className="w-full max-w-md mx-auto mt-6">
                <FieldLabel className="text-foreground tracking-tight">
                  {t("confirm")} <span className="text-destructive">*</span>
                </FieldLabel>

                <InputGroup>
                  <InputGroupInput
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setTouchedConfirm(true);
                    }}
                    autoComplete="new-password"
                    className={`h-full w-auto rounded-lg border-muted-foreground/30 transition-all ${
                      isConfirmInvalid
                        ? "border-destructive ring-1 ring-destructive/20"
                        : ""
                    }`}
                  />
                  <InputGroupAddon
                    align="inline-end"
                    className="cursor-pointer text-muted-foreground hover:text-foreground"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  >
                    {showConfirmPassword ? (
                      <EyeIcon size={18} />
                    ) : (
                      <EyeOffIcon size={18} />
                    )}
                  </InputGroupAddon>
                </InputGroup>

                {isConfirmInvalid && (
                  <FieldDescription className="text-destructive">
                    {t("confirmHelp")}
                  </FieldDescription>
                )}
              </Field>
              <div className="mx-auto w-full max-w-md mt-6 pb-10">
                <Button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!canSubmit}
                  className="w-full bg-orange-500  py-4 hover:bg-orange-600 text-card rounded-sm cursor-pointer"
                >
                  {saving ? t("saving") : t("submit")}
                </Button>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

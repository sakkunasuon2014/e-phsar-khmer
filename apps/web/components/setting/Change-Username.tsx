"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/routing";
import SettingSidebar from "./SettingSidebar";
import { changeUsername } from "@/actions/settings";
import type { SettingsUser } from "@/lib/auth/current-user";

/** Same charset the API accepts — letters, digits, dot, underscore, dash. */
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,50}$/;

export default function ChangeUsername({ me }: { me?: SettingsUser | null }) {
  const t = useTranslations("Settings.usernamePage");
  const router = useRouter();
  const [username, setUsername] = useState(me?.username ?? "");
  const [saving, setSaving] = useState(false);

  const trimmed = username.trim();
  const isValid = USERNAME_RE.test(trimmed);
  const isChanged = trimmed !== (me?.username ?? "");
  const canSubmit = isValid && isChanged && !saving;

  async function submit() {
    if (!canSubmit) return;
    setSaving(true);

    const result = await changeUsername(trimmed);
    setSaving(false);

    if (!result.success) {
      toast.error(result.error ?? t("failed"));
      return;
    }

    toast.success(t("updated"));
    router.refresh();
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

              <Field className="w-full max-w-md mx-auto mt-6">
                <FieldLabel className="text-foreground tracking-tight">
                  {t("label")} <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  id="username"
                  placeholder={t("label")}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  maxLength={50}
                  required
                />
                <FieldDescription className="type-body-sm">
                  {t("hint")}
                  {isValid && !isChanged ? ` ${t("current")}` : ""}
                </FieldDescription>
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

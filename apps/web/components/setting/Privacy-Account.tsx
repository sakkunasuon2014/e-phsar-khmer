"use client";
import * as React from "react";
import { useTranslations } from "next-intl";
import { Lock, Globe } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/routing";
import SettingSidebar from "./SettingSidebar";
import { Switch } from "@/components/ui/switch";
import { updateMyPrivacy, type PrivacyKey } from "@/actions/settings";
import type { SettingsUser } from "@/lib/auth/current-user";

interface PrivacyRowProps {
  title: string;
  settingKey: PrivacyKey;
  initialState: boolean;
}

const PrivacyRow = ({ title, settingKey, initialState }: PrivacyRowProps) => {
  const t = useTranslations("Settings.privacyPage");
  const router = useRouter();
  const [isPublic, setIsPublic] = React.useState(initialState);
  const [pending, setPending] = React.useState(false);

  async function handleCheckedChange(next: boolean) {
    const previous = isPublic;
    setIsPublic(next);
    setPending(true);

    const result = await updateMyPrivacy(settingKey, next);

    setPending(false);
    if (!result.success) {
      setIsPublic(previous);
      toast.error(result.error ?? t("updateFailed"));
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex items-center justify-between p-4 bg-muted rounded-sm transition-all">
      <div className="space-y-1">
        <p className="type-body-sm text-card-foreground/80">{title}</p>

        <div className="flex items-center gap-1.5">
          {isPublic ? (
            <>
              <Globe size={16} className="text-[#00a0e9]" />
              <span className="type-body-sm text-[#00a0e9]">{t("public")}</span>
            </>
          ) : (
            <>
              <Lock size={16} className="text-[#00a0e9]" />
              <span className="type-body-sm text-[#00a0e9]">{t("onlyMe")}</span>
            </>
          )}
        </div>
      </div>

      <Switch
        checked={isPublic}
        disabled={pending}
        onCheckedChange={(next) => void handleCheckedChange(next)}
        className="data-[state=checked]:bg-[#00a0e9] data-[state=unchecked]:bg-gray-300 scale-120"
      />
    </div>
  );
};

export default function AccountPrivacy({ me }: { me: SettingsUser }) {
  const t = useTranslations("Settings.privacyPage");
  return (
    <div className="min-h-screen bg-muted pb-10 pt-4">
      <div className="max-w-6xl mx-auto  ">
        <div className="flex gap-5 ">
          <SettingSidebar me={me} />
          <main className="flex-1">
            <div className="bg-card border border-border rounded-sm">
              <div>
                <h2 className="type-section-title text-foreground mb-4 mt-6 px-6">
                  {t("title")}
                </h2>

                <div className="px-6 pb-6 space-y-3">
                  <PrivacyRow
                    title={t("qGender")}
                    settingKey="discoverableByGender"
                    initialState={me.discoverableByGender}
                  />
                  <PrivacyRow
                    title={t("qDob")}
                    settingKey="discoverableByDateOfBirth"
                    initialState={me.discoverableByDateOfBirth}
                  />
                  <PrivacyRow
                    title={t("qPhone")}
                    settingKey="discoverableByPhone"
                    initialState={me.discoverableByPhone}
                  />
                  <PrivacyRow
                    title={t("qEmail")}
                    settingKey="discoverableByEmail"
                    initialState={me.discoverableByEmail}
                  />
                  <PrivacyRow
                    title={t("qLocation")}
                    settingKey="discoverableByLocation"
                    initialState={me.discoverableByLocation}
                  />
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

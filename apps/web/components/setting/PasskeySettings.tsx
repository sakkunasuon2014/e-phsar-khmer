import { Button } from "@/components/ui/button";

import { getTranslations } from "next-intl/server";
import SettingSidebar from "./SettingSidebar";
import { UserRoundKey, Plus } from "lucide-react";
import { getSettingsUser } from "@/lib/auth/current-user";

export default async function PasskeySettings() {
  // Passkeys are not built yet; the rail still shows the real account.
  const me = await getSettingsUser();
  const t = await getTranslations("Settings.passkeysPage");
  return (
    <div className="min-h-screen bg-muted pb-10 pt-4">
      <div className="max-w-6xl mx-auto  ">
        <div className="flex gap-5 ">
          <SettingSidebar me={me} />
          <main className="flex-1">
            <div className="bg-card border border-border rounded-sm">
              <h1 className="type-page-title text-foreground mb-4 mt-6 px-4">
                {t("title")}
              </h1>
              <div className="mt-2 px-4 space-y-4">
                <div className="flex items-start gap-3 p-4 bg-[#00a0e9]/5  rounded-sm">
                  <div className="flex-shrink-0 pt-1">
                    <UserRoundKey size={20} className="text-[#00a0e9]" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="type-body-sm text-card-foreground">
                      {t("description")}
                    </p>
                  </div>
                </div>

                <Button className="bg-[#00a0e9]/80 hover:bg-[#00a0e9]/60 text-card rounded-sm w-full h-10 cursor-pointer">
                  <Plus size={18} className="block mr-1 text-lg" />
                  <span className="type-body-sm">{t("add")}</span>
                </Button>

                <div className=" text-center type-body-sm text-muted-foreground pb-6">
                  <p>{t("note")}</p>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

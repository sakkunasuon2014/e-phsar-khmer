"use client";

import { useTranslations } from "next-intl";
import { AlertCircle, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useE2eBackupContext } from "@/components/chat/e2e-backup-provider";

/**
 * Chat-history backup banners for the thread column. The backup itself (and
 * every dialog) lives in the app-wide E2eBackupProvider; this panel only
 * surfaces state and opens the provider's flows:
 *  - this device can't read older history → restore with the backup passcode;
 *  - a restore just completed → restored count;
 *  - the status read failed → retry.
 *
 * A device that holds the key but has no passcode is forced to set one by the
 * provider's dialog, not by a dismissible banner.
 */
export function E2eBackupPanel() {
  const t = useTranslations("Chat.backup");
  const tMessage = useTranslations("Chat.message");
  const backup = useE2eBackupContext();

  if (!backup) return null;
  const { state } = backup;

  return (
    <>
      {state?.kind === "locked" && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-border bg-muted/60 px-4 py-3 type-body">
          <div className="flex items-start gap-2">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="font-medium">{t("lockedTitle")}</p>
              <p className="text-muted-foreground">
                {state.hasPasscode
                  ? t("lockedDescription")
                  : t("lockedNoPasscode")}
              </p>
            </div>
          </div>
          {state.hasPasscode && (
            <div className="flex flex-wrap gap-2 pl-6">
              <Button size="sm" onClick={backup.openRestore}>
                {t("enterPasscode")}
              </Button>
            </div>
          )}
        </div>
      )}

      {state?.kind === "error" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/60 px-4 py-2 type-body">
          <AlertCircle className="size-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">{t("genericError")}</span>
          <Button size="sm" variant="outline" onClick={backup.retry}>
            {tMessage("retry")}
          </Button>
        </div>
      )}

      {state?.kind === "ready" && backup.lastRestoredCount !== null && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/60 px-4 py-2 type-body">
          <ShieldCheck className="size-4 text-green-600" />
          <span>{t("restored", { count: backup.lastRestoredCount })}</span>
        </div>
      )}
    </>
  );
}

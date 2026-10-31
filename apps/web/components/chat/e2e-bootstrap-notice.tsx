"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getBootstrapHealth,
  shouldShowBootstrapNotice,
  subscribeBootstrapHealth,
} from "@/lib/e2e/bootstrap-health";
import type { BootstrapHealth } from "@/lib/e2e/bootstrap-health";

const HEALTHY: BootstrapHealth = { failures: 0, kind: null };

/**
 * One non-blocking notice when this browser keeps failing to set up its
 * encryption keys (private window with storage blocked, site data disabled,
 * disk full, or the server refusing registration). The engine keeps retrying
 * in the background; this only stops the failure from being invisible.
 * Dismissal lasts for this page view.
 */
export function E2eBootstrapNotice() {
  const t = useTranslations("Chat.e2eSetup");
  const health = useSyncExternalStore(
    subscribeBootstrapHealth,
    getBootstrapHealth,
    () => HEALTHY,
  );
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || !shouldShowBootstrapNotice(health)) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-start gap-2 border-b border-border bg-muted/60 px-4 py-3 text-sm"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("title")}</p>
        <p className="text-muted-foreground">
          {health.kind === "storage" ? t("storage") : t("generic")}
        </p>
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 shrink-0"
        aria-label={t("dismiss")}
        onClick={() => setDismissed(true)}
      >
        <X className="size-4" />
      </Button>
    </div>
  );
}

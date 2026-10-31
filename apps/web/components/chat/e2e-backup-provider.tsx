"use client";

import { createContext, useContext, useState } from "react";
import { useTranslations } from "next-intl";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useE2eEngine } from "@/hooks/use-e2e-engine";
import { useE2eBackup } from "@/hooks/use-e2e-backup";
import { useE2eCatchUp } from "@/hooks/use-e2e-catch-up";
import type { E2eBackupApi } from "@/hooks/use-e2e-backup";
import { MIN_PASSCODE_LENGTH } from "@/lib/e2e/backup-crypto";

const E2eBackupContext = createContext<E2eBackupApi | null>(null);

/**
 * Set by "Not now" on the passcode re-prompt (`message-thread.tsx` opens the
 * "enter" dialog whenever a thread with unavailable messages loads on a
 * locked, passcoded device). Session-scoped on purpose: the prompt is meant
 * to return on the next browser session, just not again in this one.
 */
export const E2E_RESTORE_SNOOZE_KEY = "chat:e2e-restore-snoozed";

function snoozeRestorePrompt(): void {
  try {
    sessionStorage.setItem(E2E_RESTORE_SNOOZE_KEY, "1");
  } catch {
    // Private mode / quota — the prompt returning next thread-open is harmless.
  }
}

/** The app-wide history-backup surface (null outside the provider). */
export function useE2eBackupContext(): E2eBackupApi | null {
  return useContext(E2eBackupContext);
}

/**
 * Mounted once per signed-in app shell (the (user) and (chat) layouts).
 *
 * The backup must run even when the chat page is closed: uploads, pulls and
 * the restore flows are all global. The provider owns the single
 * useE2eBackup instance, exposes it through context, and renders its dialogs
 * at the app root so any page can open the restore flow.
 */
export function E2eBackupProvider({
  userId,
  children,
}: {
  userId: string | null;
  children: React.ReactNode;
}) {
  const engine = useE2eEngine(userId);
  const backup = useE2eBackup(engine);
  // Decrypt what arrives even while no thread is open, so it reaches the backup.
  useE2eCatchUp(engine);

  return (
    <E2eBackupContext.Provider value={backup}>
      {children}
      <E2eBackupDialogs backup={backup} />
    </E2eBackupContext.Provider>
  );
}

/**
 * Renders the backup dialogs at the app root.
 *
 * A device that holds the backup key but has no passcode is forced to set one:
 * the passcode is the only way another device can restore the history, so a
 * backup without one is a dead end (there is no device-approval fallback).
 */
function E2eBackupDialogs({ backup }: { backup: E2eBackupApi }) {
  const passcodeMissing =
    backup.state?.kind === "ready" && !backup.state.hasPasscode;
  return (
    <>
      <RestoreDialog backup={backup} />
      <EnterPasscodeDialog
        open={backup.dialog === "enter"}
        onOpenChange={(open) => backup.setDialog(open ? "enter" : "none")}
        onSubmit={backup.enterPasscode}
      />
      <SetPasscodeDialog
        open={passcodeMissing}
        onSubmit={backup.savePasscode}
      />
    </>
  );
}

/**
 * Opened by openRestore() when this device cannot read older history.
 *
 * The passcode is the only way into the backup, so the action must not depend
 * on the device being in the "locked" state: on a device that already holds
 * the key the passcode still re-downloads the history, and the backup status
 * may not have loaded yet when the dialog opens.
 */
function RestoreDialog({ backup }: { backup: E2eBackupApi }) {
  const t = useTranslations("Chat.backup");
  const tMessage = useTranslations("Chat.message");
  const { state } = backup;
  // Ready or locked: both know whether the account has a passcode.
  const hasPasscode =
    state?.kind === "locked" || state?.kind === "ready"
      ? state.hasPasscode
      : false;

  return (
    <Dialog
      open={backup.dialog === "restore"}
      onOpenChange={(open) => backup.setDialog(open ? "restore" : "none")}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {state?.kind === "ready" ? t("readyTitle") : t("lockedTitle")}
          </DialogTitle>
          <DialogDescription>
            {state === null
              ? t("checkingBackup")
              : state.kind === "error"
                ? t("genericError")
                : state.kind === "ready"
                  ? t("readyDescription")
                  : hasPasscode
                    ? t("lockedDescription")
                    : t("lockedNoPasscode")}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          {state === null && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
          {state?.kind === "error" && (
            <Button variant="outline" onClick={backup.retry}>
              {tMessage("retry")}
            </Button>
          )}
          {hasPasscode && (
            <Button onClick={() => backup.setDialog("enter")}>
              <KeyRound className="size-4" />
              {t("enterPasscode")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EnterPasscodeDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: E2eBackupApi["enterPasscode"];
}) {
  const t = useTranslations("Chat.backup");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    const result = await onSubmit(value);
    setBusy(false);
    if (result.ok) {
      setValue("");
      onOpenChange(false);
      return;
    }
    if (result.reason === "wrong")
      setError(t("wrongPasscode", { count: result.attemptsLeft }));
    else if (result.reason === "locked")
      setError(
        t("lockedOut", {
          time: result.lockedUntil
            ? new Date(result.lockedUntil).toLocaleTimeString()
            : "—",
        }),
      );
    else setError(t("genericError"));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("enterTitle")}</DialogTitle>
            <DialogDescription>{t("enterDescription")}</DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoComplete="off"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t("passcodePlaceholder")}
            disabled={busy}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                snoozeRestorePrompt();
                onOpenChange(false);
              }}
            >
              {t("notNow")}
            </Button>
            <Button type="submit" disabled={!value || busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {busy ? t("unlocking") : t("unlock")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Forced: a device that holds the backup key but has no passcode cannot
 * dismiss this. The passcode is the only way another device ever gets the key.
 */
function SetPasscodeDialog({
  open,
  onSubmit,
}: {
  open: boolean;
  onSubmit: E2eBackupApi["savePasscode"];
}) {
  const t = useTranslations("Chat.backup");
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (first.length < MIN_PASSCODE_LENGTH)
      return setError(t("tooShort", { count: MIN_PASSCODE_LENGTH }));
    if (first !== second) return setError(t("mismatch"));
    setBusy(true);
    setError(null);
    const result = await onSubmit(first);
    setBusy(false);
    if (result.ok) {
      setFirst("");
      setSecond("");
    } else setError(t("genericError"));
  };

  return (
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent showCloseButton={false}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t("setTitle")}</DialogTitle>
            <DialogDescription>
              {t("setDescription", { count: MIN_PASSCODE_LENGTH })}
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            autoComplete="new-password"
            autoFocus
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            placeholder={t("passcodePlaceholder")}
            disabled={busy}
          />
          <Input
            type="password"
            autoComplete="new-password"
            value={second}
            onChange={(e) => setSecond(e.target.value)}
            placeholder={t("confirmPlaceholder")}
            disabled={busy}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

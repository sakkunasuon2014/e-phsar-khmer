"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteMyAccount } from "@/actions/settings";
import { userLogout } from "@/actions/logout";

/**
 * Two steps, matching the published help page: the terms of deactivation
 * first, then the password that confirms it. Deactivation is real — the
 * backend sets `deletedAt`, signing in again within 90 days undoes it, and
 * the 90-day sweeper deletes the account and everything cascading from it.
 */
export function DeleteAccountDialog({
  username,
  trigger,
}: {
  username: string;
  trigger: ReactNode;
}) {
  const t = useTranslations("Settings.deleteAccount");
  const tCommon = useTranslations("Common");
  const [step, setStep] = useState<"confirm" | "password">("confirm");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!password || busy) return;
    setBusy(true);

    const result = await deleteMyAccount(password);
    if (!result.success) {
      toast.error(result.error ?? t("failed"));
      setBusy(false);
      return;
    }

    toast.success(t("deactivated"));
    // Clears the session cookies; the account can no longer authenticate.
    await userLogout();
  }

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setStep("confirm");
          setPassword("");
          setBusy(false);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent className="sm:max-w-[550px] rounded-md p-6">
        <DialogHeader>
          <DialogTitle>
            {username ? `${username}: ` : ""}
            {t("title")}
          </DialogTitle>
          <DialogDescription className="mt-4 type-body-sm text-foreground/90">
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        {step === "password" && (
          <Field className="mt-2">
            <FieldLabel htmlFor="delete-account-password">
              {t("confirmPassword")}
            </FieldLabel>
            <Input
              id="delete-account-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
        )}

        <DialogFooter className="flex flex-row justify-end gap-3 mt-6">
          <DialogClose asChild>
            <Button
              variant="ghost"
              className="bg-[#eeeeee] hover:bg-gray-200 text-black px-6 rounded-sm font-medium cursor-pointer"
            >
              {tCommon("cancel")}
            </Button>
          </DialogClose>

          {step === "confirm" ? (
            <Button
              type="button"
              onClick={() => setStep("password")}
              className="bg-[#e3281b] hover:bg-red-700 text-white px-8 rounded-sm font-medium cursor-pointer"
            >
              {t("next")}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void submit()}
              disabled={busy || password.length === 0}
              className="bg-[#e3281b] hover:bg-red-700 text-white px-8 rounded-sm font-medium cursor-pointer"
            >
              {busy ? t("deleting") : t("delete")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

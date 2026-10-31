"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useRouter } from "@/i18n/routing";
import SettingSidebar from "./SettingSidebar";
import { requestPhoneChangeOtp, verifyPhoneChange } from "@/actions/settings";
import { formatPhoneLocal, normalizePhone } from "@/lib/phone";
import type { SettingsUser } from "@/lib/auth/current-user";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

export default function ChangePhone({ me }: { me?: SettingsUser | null }) {
  const t = useTranslations("Settings.phonePage");
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState(
    me?.primaryPhone ? formatPhoneLocal(me.primaryPhone) : "",
  );
  const [code, setCode] = useState("");
  const [touchedPhone, setTouchedPhone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // The same predicate the action applies before calling the API — a fixed
  // digit count would reject real numbers, since a Cambodian mobile is 9 or 10
  // digits locally (`099990004` is a valid one) and the API accepts either.
  const e164 = normalizePhone(phone);
  const isPhoneInvalid = touchedPhone && !e164;

  async function sendCode() {
    if (busy) return;
    setBusy(true);

    const result = await requestPhoneChangeOtp(phone);
    setBusy(false);

    if (!result.success) {
      toast.error(result.error ?? t("sendFailed"));
      return;
    }

    toast.success(t("codeSent"));
    setCode("");
    setStep("code");
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }

  async function confirm() {
    if (busy || code.length !== OTP_LENGTH) return;
    setBusy(true);

    const result = await verifyPhoneChange(phone, code);
    setBusy(false);

    if (!result.success) {
      toast.error(result.error ?? t("verifyFailed"));
      return;
    }

    toast.success(t("updated"));
    setStep("phone");
    setCode("");
    // The rail, the hub and the navbar all read the user row.
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
              <p className="text-center type-body w-full max-w-lg mx-auto mt-6 px-4">
                {step === "phone"
                  ? t("description")
                  : t("codeDescription", {
                      length: OTP_LENGTH,
                      phone,
                    })}
              </p>

              {step === "phone" ? (
                <>
                  <Field className="w-full max-w-md mx-auto mt-6">
                    <FieldLabel className="text-foreground tracking-tight">
                      {t("phoneNumber")}{" "}
                      <span className="text-destructive">*</span>
                    </FieldLabel>
                    <Input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      onBlur={() => setTouchedPhone(true)}
                      placeholder="090000000"
                      inputMode="tel"
                      autoComplete="tel"
                      required
                      aria-invalid={isPhoneInvalid}
                    />
                    {isPhoneInvalid && (
                      <FieldDescription className="text-destructive">
                        {t("invalidPhone")}
                      </FieldDescription>
                    )}
                  </Field>
                  <div className="mx-auto w-full max-w-md mt-6 pb-10">
                    <Button
                      type="button"
                      onClick={() => void sendCode()}
                      disabled={busy || !e164}
                      className="w-full bg-orange-500  py-4 hover:bg-orange-600 text-card rounded-sm cursor-pointer"
                    >
                      {busy ? t("sending") : t("submit")}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="mx-auto w-full max-w-md mt-6 pb-10 flex flex-col items-center gap-6">
                  <InputOTP
                    maxLength={OTP_LENGTH}
                    value={code}
                    onChange={setCode}
                    autoFocus
                  >
                    <InputOTPGroup>
                      {Array.from({ length: OTP_LENGTH }, (_, i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>

                  <Button
                    type="button"
                    onClick={() => void confirm()}
                    disabled={busy || code.length !== OTP_LENGTH}
                    className="w-full bg-orange-500  py-4 hover:bg-orange-600 text-card rounded-sm cursor-pointer"
                  >
                    {busy ? t("verifying") : t("verify")}
                  </Button>

                  <div className="flex items-center gap-4 type-body-sm">
                    <button
                      type="button"
                      className="text-muted-foreground hover:underline cursor-pointer"
                      onClick={() => {
                        setStep("phone");
                        setCode("");
                      }}
                    >
                      {t("differentNumber")}
                    </button>
                    <button
                      type="button"
                      disabled={cooldown > 0 || busy}
                      onClick={() => void sendCode()}
                      className="text-[#00a0e9] hover:underline disabled:text-muted-foreground disabled:no-underline cursor-pointer"
                    >
                      {cooldown > 0
                        ? t("resendIn", { seconds: cooldown })
                        : t("resend")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

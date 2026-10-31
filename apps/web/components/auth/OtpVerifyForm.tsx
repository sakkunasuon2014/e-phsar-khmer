"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, RefreshCwIcon } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useRouter } from "@/i18n/routing";
import { requestOtp, verifyOtp } from "@/actions/otp";
import { getDeviceIdentity } from "@/lib/device";
import { formatPhoneLocal } from "@/lib/phone";
import {
  clearOtpRegistration,
  readOtpRegistration,
} from "@/lib/otp-registration";
import { bootstrapE2eAfterAuth } from "@/lib/e2e/bootstrap-after-auth";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Survives a remount of this page — the verify server action sets session
 * cookies, which can refresh the route and give the component a fresh
 * `doneRef`. A full reload resets it, which is exactly when the registration
 * guard should run again.
 */
let verifiedPhone: string | null = null;

export function OtpVerifyForm({ phone }: { phone: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inFlightRef = useRef(false);
  const doneRef = useRef(false);

  // The code was just sent by the register step; count the resend cooldown down.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Verify needs the password handoff — without it (lost sessionStorage, new
  // tab) restart at the login form instead of dead-ending here. A successful
  // verify clears the handoff and may keep this page mounted (the new-device
  // dialog), so the done guard stops a re-run from bouncing the user to
  // /login after they have just logged in.
  useEffect(() => {
    if (doneRef.current || verifiedPhone === phone) return;
    if (!readOtpRegistration(phone)) router.replace("/login");
  }, [phone, router]);

  // Back-target depends on which flow stored the handoff.
  const goBack = useCallback(() => {
    const registration = readOtpRegistration(phone);
    verifiedPhone = null;
    clearOtpRegistration();
    router.push(registration?.mode === "register" ? "/register" : "/login");
  }, [phone, router]);

  const handleVerify = useCallback(
    async (token: string) => {
      if (
        inFlightRef.current ||
        doneRef.current ||
        token.length !== OTP_LENGTH
      ) {
        return;
      }
      inFlightRef.current = true;
      setVerifying(true);
      try {
        const registration = readOtpRegistration(phone);
        const device = getDeviceIdentity();
        const res = await verifyOtp(
          phone,
          token,
          registration ?? undefined,
          device ?? undefined,
        );
        if (res.success) {
          doneRef.current = true;
          verifiedPhone = phone;
          clearOtpRegistration();
          // Covers both OTP login and registration: the new account gets its
          // E2E device before any other page renders.
          bootstrapE2eAfterAuth(res.user.id);
          toast.success("Phone verified. Welcome!");
          router.push("/me");
        } else {
          toast.error(res.error);
          setValue("");
        }
      } catch {
        toast.error("Failed to verify. Please try again.");
      } finally {
        inFlightRef.current = false;
        setVerifying(false);
      }
    },
    [phone, router],
  );

  // Auto-submit as soon as the sixth digit lands.
  useEffect(() => {
    if (value.length === OTP_LENGTH && !doneRef.current) {
      void handleVerify(value);
    }
  }, [value, handleVerify]);

  const handleResend = useCallback(async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    try {
      const res = await requestOtp(phone);
      if (res.success) {
        setValue("");
        setCooldown(RESEND_COOLDOWN_SECONDS);
        toast.success("Code resent successfully!");
      } else {
        toast.error(res.error ?? "Failed to resend code.");
      }
    } catch {
      toast.error("Failed to resend code. Please try again.");
    } finally {
      setResending(false);
    }
  }, [cooldown, phone, resending]);

  return (
    <Card className="mx-auto w-full max-w-md bg-card p-2">
      <CardHeader>
        <div className="flex items-center gap-2 mb-1">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={goBack}
            className="h-8 w-8 -ml-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle>Verify your phone</CardTitle>
        </div>
        <CardDescription>
          We sent a 6-digit code via SMS to{" "}
          <span className="font-medium">{formatPhoneLocal(phone)}</span>. Enter
          the code to continue.
        </CardDescription>
      </CardHeader>

      {/* Wrapped in a standard form to catch enter keypress and submit events cleanly */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void handleVerify(value);
        }}
      >
        <CardContent>
          <Field>
            <div className="flex items-center justify-between mb-2">
              <FieldLabel htmlFor="otp-verification">
                Verification code
              </FieldLabel>
              <Button
                variant="outline"
                size="xs"
                type="button"
                onClick={() => void handleResend()}
                disabled={cooldown > 0 || resending}
              >
                <RefreshCwIcon className="mr-1 h-3 w-3" />
                {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
              </Button>
            </div>

            <div className="flex justify-center py-2">
              <InputOTP
                maxLength={OTP_LENGTH}
                id="otp-verification"
                value={value}
                onChange={(newValue) => setValue(newValue)}
                autoFocus
                required
                disabled={verifying}
              >
                <InputOTPGroup className="*:data-[slot=input-otp-slot]:h-12 *:data-[slot=input-otp-slot]:w-12 *:data-[slot=input-otp-slot]:text-xl">
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
          </Field>
        </CardContent>

        <CardFooter className="flex flex-col gap-4">
          <Button
            type="submit"
            className="w-full bg-orange-500 hover:bg-orange-600 text-white h-10 cursor-pointer"
            disabled={verifying || value.length !== OTP_LENGTH}
          >
            {verifying ? "Verifying…" : "Verify"}
          </Button>
          <div className="type-body-sm text-muted-foreground text-center">
            Wrong number?{" "}
            <button
              type="button"
              onClick={goBack}
              className="underline underline-offset-4 transition-colors hover:text-primary"
            >
              Go back
            </button>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}

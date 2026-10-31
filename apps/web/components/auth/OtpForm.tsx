"use client";

import { useState } from "react";
import { RefreshCwIcon, ArrowLeft } from "lucide-react";
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
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/components/ui/input-otp";

// Define props to communicate with your LoginForm
type InputOTPFormProps = {
  login: string;
  expectedOtp: string; // The actual OTP code from the user object (e.g., "666666")
  onSuccess: () => void; // Function to call when verification passes
  onBack: () => void; // Function to go back to the credentials layout
};

export function InputOTPForm({
  login,
  expectedOtp,
  onSuccess,
  onBack,
}: InputOTPFormProps) {
  // State to hold what the user types into the OTP slots
  const [value, setValue] = useState("");

  // Form submission handler
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (value.length < 6) {
      toast.error("Please enter the complete 6-digit verification code.");
      return;
    }

    // Compare what they typed with the expected mock OTP
    if (value === expectedOtp) {
      onSuccess();
    } else {
      toast.error("Invalid verification code. Please try again.");
    }
  };

  return (
    <Card className="mx-auto max-w-lg w-full bg-card p-2">
      <CardHeader>
        <div className="flex items-center gap-2 mb-1">
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={onBack}
            className="h-8 w-8 -ml-2"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle>Verify</CardTitle>
        </div>
        <CardDescription>
          We have just sent a verification code via Telegram to this {login}.
          Please enter the{" "}
          <span className="font-medium">
            code you received from Telegram here.
          </span>
        </CardDescription>
      </CardHeader>

      {/* Wrapped in a standard form to catch enter keypress and submit events cleanly */}
      <form onSubmit={handleSubmit}>
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
                onClick={() =>
                  toast.success("Code resent successfully!", {
                    position: "top-right",
                  })
                }
              >
                <RefreshCwIcon className="mr-1 h-3 w-3" />
                Resend Code
              </Button>
            </div>

            <div className="flex justify-center py-2">
              <InputOTP
                maxLength={6}
                id="otp-verification"
                value={value}
                onChange={(newValue) => setValue(newValue)}
                required
              >
                <InputOTPGroup className="*:data-[slot=input-otp-slot]:h-12 *:data-[slot=input-otp-slot]:w-12 *:data-[slot=input-otp-slot]:text-xl">
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPSeparator className="mx-2" />
                <InputOTPGroup className="*:data-[slot=input-otp-slot]:h-12 *:data-[slot=input-otp-slot]:w-12 *:data-[slot=input-otp-slot]:text-xl">
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>

            <FieldDescription className="mt-2">
              <a href="#" className="hover:underline">
                I no longer have access to this email address.
              </a>
            </FieldDescription>
          </Field>
        </CardContent>

        <CardFooter className="flex flex-col gap-4">
          <Button
            type="submit"
            className="w-full bg-orange-500 hover:bg-orange-600 text-white h-10 cursor-pointer"
          >
            Verify
          </Button>
          <div className="type-body-sm text-muted-foreground text-center">
            Having trouble signing in?{" "}
            <a
              href="#"
              className="underline underline-offset-4 transition-colors hover:text-primary"
            >
              Contact support
            </a>
          </div>
        </CardFooter>
      </form>
    </Card>
  );
}

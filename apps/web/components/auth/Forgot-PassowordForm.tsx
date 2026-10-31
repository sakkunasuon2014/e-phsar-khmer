"use client";

import type React from "react";
import { useState } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "../ui/button";

export function ForgotPasswordForm() {
  const [emailOrPhone, setEmailOrPhone] = useState("");

  // Split into two separate states so they don't trigger together
  const [isTooShort, setIsTooShort] = useState(false);
  const [isInvalidFormat, setIsInvalidFormat] = useState(false);
  const [isLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = emailOrPhone.trim();

    // Reset states before checking
    setIsTooShort(false);
    setIsInvalidFormat(false);

    // Condition 1: Less than 2 characters
    if (value.length < 2) {
      setIsTooShort(true);
      return; // Stop here (this prevents the top banner from showing)
    }

    // Regular expressions for format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^\+?[0-9\s\-]{8,15}$/;
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;

    const isValidFormat =
      emailRegex.test(value) ||
      phoneRegex.test(value) ||
      usernameRegex.test(value);

    // Condition 2: Not matching a valid format
    if (!isValidFormat) {
      setIsInvalidFormat(true);
      return;
    }

    console.log("Password reset requested for:", value);
    // Handle your backend API reset logic here
  };

  // Input has an error style if either condition is true
  const hasError = isTooShort || isInvalidFormat;

  return (
    <div className="h-[calc(100vh-144px)] mx-auto w-full bg-muted pt-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-xl mx-auto bg-card rounded-sm border border-border p-6"
      >
        <h1 className="type-page-title text-center mb-4 text-foreground">
          Forgot Password / Account
        </h1>
        <p className="type-body-sm text-gray-500 text-center mb-6">
          Enter your phone number or email address that you registered on
          <br />
          PhsarKhmer and we&apos;ll send the code to set the new password
        </p>

        {/* 1. Big Alert Banner - ONLY shows if the format is invalid */}
        {isInvalidFormat && (
          <div className="mb-4 bg-red-600 text-white type-body-sm p-3 rounded-sm flex flex-col gap-1">
            <span className="font-bold">⚠️ Forgot password failed!</span>
            <span>The Email, Phone number or Username is invalid.</span>
          </div>
        )}

        <Field>
          <FieldLabel htmlFor="input-required">
            Phone Number, Username or Email{" "}
            <span className="text-destructive">*</span>
          </FieldLabel>
          <Input
            id="input-required"
            type="text"
            value={emailOrPhone}
            onChange={(e) => {
              setEmailOrPhone(e.target.value);
              setIsTooShort(false);
              setIsInvalidFormat(false);
            }}
            className={`w-full h-10 bg-blue-50/50 border rounded ${
              hasError
                ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
            } focus:outline-none focus:ring-1 transition-colors type-body-sm`}
          />

          {/* 2. Short Error Message below the input */}
          {isTooShort && (
            <FieldDescription className="pt-1 text-red-500 type-body-sm">
              Phone Number, Username or Email must be at least 2 characters
              long.
            </FieldDescription>
          )}

          {/* 3. Format Error Message below the input */}
          {isInvalidFormat && (
            <FieldDescription className="pt-1 text-red-500 type-meta">
              Please enter a valid Phone Number, Username or Email address.
            </FieldDescription>
          )}
        </Field>
        <Button
          type="submit"
          disabled={isLoading}
          className="mt-6 bg-orange-500 rounded-sm text-white h-10 w-full hover:bg-orange-600 cursor-pointer font-medium"
        >
          {isLoading ? "Loading..." : "Submit"}
        </Button>
      </form>
    </div>
  );
}

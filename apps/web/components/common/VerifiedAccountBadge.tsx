"use client";

import { BadgeCheck } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * The paid-plan "Verified Account" mark, from the captain's khmer24
 * reference: white pill, purple check and purple label. Purple is deliberate
 * and local to verification — the app's `#00a0e9` accent stays for links and
 * CTAs — so a future re-colour is one file.
 */
export function VerifiedAccountBadge({
  className = "",
}: {
  className?: string;
}) {
  const t = useTranslations("Common");
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold leading-4 text-[#7C3AED] shadow-sm ring-1 ring-black/5 ${className}`}
    >
      <BadgeCheck className="size-3.5 shrink-0" aria-hidden />
      {t("verifiedAccount")}
    </span>
  );
}

/**
 * The bare check for name rows, where a full pill would crowd the heading.
 * `role="img"` + the translated label keep it announced, since the icon is
 * the only signal.
 */
export function VerifiedAccountCheck({
  className = "",
}: {
  className?: string;
}) {
  const t = useTranslations("Common");
  return (
    <span
      role="img"
      aria-label={t("verifiedAccount")}
      className={`inline-flex shrink-0 items-center text-[#7C3AED] ${className}`}
    >
      <BadgeCheck className="size-5" aria-hidden />
    </span>
  );
}

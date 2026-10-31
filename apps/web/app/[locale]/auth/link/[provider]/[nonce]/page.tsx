import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SocialCallback } from "@/components/auth/SocialCallback";
import { routing, type Locale } from "@/i18n/routing";
import { SOCIAL_STATE_PATTERN } from "@/lib/auth/social";

export const metadata: Metadata = {
  title: "Connecting account",
  description: "Completing social account linking",
  robots: { index: false, follow: false },
};

/**
 * The account-linking callback. The nonce segment is the same value stored in
 * the `social_link_pending` cookie when the flow started, so this URL is
 * single-use and only works in the browser that initiated it.
 */
export default async function SocialLinkCallbackPage({
  params,
}: {
  params: Promise<{ locale: string; provider: string; nonce: string }>;
}) {
  const { locale, provider, nonce } = await params;

  if (!routing.locales.includes(locale as Locale)) notFound();
  if (provider !== "google" && provider !== "facebook") notFound();
  if (!SOCIAL_STATE_PATTERN.test(nonce)) notFound();

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-md">
        <SocialCallback
          provider={provider}
          mode="link"
          nonce={nonce}
          locale={locale}
          loginHref={`/${locale}/settings`}
        />
      </div>
    </div>
  );
}

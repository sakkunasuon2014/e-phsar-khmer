import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SocialCallback } from "@/components/auth/SocialCallback";
import { routing, type Locale } from "@/i18n/routing";

export const metadata: Metadata = {
  title: "Signing in",
  description: "Completing social sign-in",
  robots: { index: false, follow: false },
};

/**
 * The user OAuth callback. Deliberately outside the `(user)` route group so
 * the exchange renders without the marketplace chrome (and without its
 * per-request profile fetch).
 */
export default async function SocialCallbackPage({
  params,
}: {
  params: Promise<{ locale: string; provider: string }>;
}) {
  const { locale, provider } = await params;

  if (!routing.locales.includes(locale as Locale)) notFound();
  if (provider !== "google" && provider !== "facebook") notFound();

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-md">
        <SocialCallback
          provider={provider}
          mode="user"
          locale={locale}
          loginHref={`/${locale}/login`}
        />
      </div>
    </div>
  );
}

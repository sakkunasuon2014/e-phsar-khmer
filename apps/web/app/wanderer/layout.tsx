import "@/styles/globals.css";
import type { Metadata } from "next";
import { kohSantepheap } from "@/lib/fonts";
import { NextIntlClientProvider } from "next-intl";
import { Toaster } from "@/components/ui/sonner";
import NextTopLoader from "nextjs-toploader";
import { ClientThemeProvider } from "@/components/client-theme-provider";
import { Providers } from "@/app/providers";
import { resolveAdminLocale } from "@/lib/auth/admin-locale";

export const metadata: Metadata = {
  title: { default: "Admin — PhsarKhmer", template: "%s — Admin" },
  description: "Admin dashboard",
};

/**
 * Root layout for the non-localized /wanderer/* admin surface. Mirrors the
 * [locale]/layout.tsx structure but sources the locale from the `admin_locale`
 * cookie (seeded at login from `users.preferredLanguage`) instead of the URL
 * segment — admin routes carry no locale prefix by design.
 */
export default async function WandererRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await resolveAdminLocale();
  const messages = (await import(`@/messages/${locale}.json`)).default;

  return (
    <html
      lang={locale}
      className={`${kohSantepheap.variable}`}
      suppressHydrationWarning
    >
      <body>
        <NextTopLoader
          color="#00a0e9"
          initialPosition={0.08}
          crawlSpeed={200}
          height={3}
          crawl
          easing="ease"
          speed={200}
          shadow="0 0 10px #00a0e9, 0 0 5px #00a0e9"
          showSpinner={false}
          zIndex={9999}
        />

        <ClientThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem={true}
          disableTransitionOnChange
        >
          <NextIntlClientProvider locale={locale} messages={messages}>
            <Providers>{children}</Providers>
            <Toaster />
          </NextIntlClientProvider>
        </ClientThemeProvider>
      </body>
    </html>
  );
}

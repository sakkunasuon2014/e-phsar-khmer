import "@/styles/globals.css";
import type { Metadata } from "next";
import { kohSantepheap } from "@/lib/fonts";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";
import { Locale, routing } from "@/i18n/routing";
import { Toaster } from "@/components/ui/sonner";
import NextTopLoader from "nextjs-toploader";
import { ClientThemeProvider } from "@/components/client-theme-provider";
import { Providers } from "@/app/providers";

export const metadata: Metadata = {
  title: {
    default: "PhsarKhmer, Buy and Sell Everything In Cambodia",
    template: "%s - PhsarKhmer",
  },
  description: "PhsarKhmer, Buy and Sell Everything In Cambodia",
};

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as Locale)) {
    notFound();
  }

  const messages = await getMessages();

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
          <NextIntlClientProvider messages={messages}>
            <Providers>{children}</Providers>
            <Toaster />
          </NextIntlClientProvider>
        </ClientThemeProvider>
      </body>
    </html>
  );
}

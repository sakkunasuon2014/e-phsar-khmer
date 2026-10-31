"use client";

import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { FaCamera } from "react-icons/fa";
import SearchBar from "./SearchBar";
import { SocialBar } from "./SocialBar";
import { MobileNavSheet } from "./MobileNavSheet";
import { SessionCacheGuard } from "./SessionCacheGuard";
import { BrandWordmark } from "./BrandWordmark";
import LocalSelector from "../LocalSelector";
import { useLocale, useTranslations } from "next-intl";
import { Suspense } from "react";

export type User = {
  username: string;
  role: string;
  email: string;
  profileImage: string;
  firstName: string | null;
  lastName: string | null;
  profilePhotoUrl: string | null;
};

export function NavBar({ user }: { user: User | null }) {
  const locale = useLocale();
  const t = useTranslations("Nav");
  const isLoggedIn = !!user;

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-card">
      <SessionCacheGuard identity={user?.username ?? null} />
      <div className="mx-auto max-w-7xl  py-2.5">
        <div className="flex items-center justify-between gap-4">
          <div className="hidden lg:flex items-center gap-3 flex-shrink-0">
            <Link href={`/`} className="flex items-center gap-2">
              <BrandWordmark className="text-3xl font-bold" />
            </Link>
            <div className="flex items-center gap-1">
              <LocalSelector defaultValue={locale} label={t("language")} />
              <ThemeSwitcher />
            </div>
          </div>
          {/* SearchBar reads the URL (useSearchParams), which needs a
              Suspense boundary so static pages can still prerender. */}
          <div className="hidden lg:block flex-1 max-w-lg">
            <Suspense fallback={<div className="flex-1 max-w-lg h-[42px]" />}>
              <SearchBar />
            </Suspense>
          </div>
          <div
            className={
              isLoggedIn
                ? "hidden lg:flex items-center gap-4 flex-shrink-0 ml-2"
                : "hidden lg:flex items-center gap-4 flex-shrink-0 ml-2"
            }
          >
            {isLoggedIn ? (
              <SocialBar user={user!} />
            ) : (
              <div className="flex items-center">
                <Button
                  asChild
                  variant="ghost"
                  className="h-[42px] px-4 rounded type-nav rounded text-[#00a0e9] bg-transparent border border-transparent transition-all duration-200 hover:bg-[#00a0e9]/80 hover:text-white"
                >
                  <Link href="/login">{t("login")}</Link>
                </Button>

                <Button
                  asChild
                  variant="ghost"
                  className="h-[42px] px-4 rounded type-nav text-[#00a0e9] bg-transparent border border-transparent transition-all duration-200 hover:bg-[#00a0e9]/80 hover:text-white"
                >
                  <Link href="/register">{t("register")}</Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  className="h-[42px] bg-[#f68b1e] text-white px-6 type-nav rounded transition-colors hover:bg-[#f68b1e]/80 hover:text-white"
                >
                  <Link href={`/login`}>
                    <FaCamera className="scale-120" strokeWidth={2.5} />
                    {t("sell")}
                  </Link>
                </Button>
              </div>
            )}
          </div>
          {/* Compact nav (<lg): logo + a single sheet trigger holding
              search/locale/theme/account — see MobileNavSheet. */}
          <div className="flex lg:hidden items-center justify-between w-full">
            <Link href={`/`} className="flex items-center gap-2">
              <div className="text-3xl font-bold whitespace-nowrap tracking-tight">
                <span className="text-foreground">PSA</span>
                <span className="text-[#00a0e9]">KHMER</span>
              </div>
            </Link>
            <MobileNavSheet user={user} />
          </div>
        </div>
      </div>
    </nav>
  );
}

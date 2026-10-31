"use client";

import { Suspense } from "react";
import { Menu } from "lucide-react";
import { FaCamera } from "react-icons/fa";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Link } from "@/i18n/routing";
import LocalSelector from "../LocalSelector";
import SearchBar from "./SearchBar";
import { SocialBar } from "./SocialBar";
import type { User } from "./NavBar";

/**
 * The compact-nav (<lg) trigger: a single icon button that opens a right-side
 * sheet holding everything the desktop row shows inline (search, locale,
 * theme, and account/auth links) — see mobile-fix-plan.md §3 W1.
 */
export function MobileNavSheet({ user }: { user: User | null }) {
  const locale = useLocale();
  const isLoggedIn = !!user;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-lg"
          className="h-11 w-11"
          aria-label="Open menu"
        >
          <Menu className="scale-125" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="gap-4 overflow-y-auto p-4">
        <SheetHeader className="sr-only">
          <SheetTitle>Menu</SheetTitle>
          <SheetDescription>
            Search, language, theme, and account links.
          </SheetDescription>
        </SheetHeader>
        <Suspense fallback={<div className="h-[42px]" />}>
          <SearchBar />
        </Suspense>
        <div className="flex items-center gap-1">
          <LocalSelector defaultValue={locale} label="Language" />
          <ThemeSwitcher />
        </div>
        <Separator />
        {isLoggedIn ? (
          <SocialBar user={user!} />
        ) : (
          <div className="flex flex-col items-stretch gap-2">
            <Button
              asChild
              variant="ghost"
              className="h-[42px] px-4 rounded text-base font-medium rounded text-[#00a0e9] bg-transparent border border-transparent transition-all duration-200 hover:bg-[#00a0e9]/80 hover:text-white"
            >
              <Link href="/login">Login</Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              className="h-[42px] px-4 rounded text-base font-medium text-[#00a0e9] bg-transparent border border-transparent transition-all duration-200 hover:bg-[#00a0e9]/80 hover:text-white"
            >
              <Link href="/register">Register</Link>
            </Button>
            <Button
              asChild
              variant="ghost"
              className="h-[42px] bg-[#f68b1e] text-white px-6 text-base font-medium rounded transition-colors hover:bg-[#f68b1e]/80 hover:text-white"
            >
              <Link href={`/login`}>
                <FaCamera className="scale-120" strokeWidth={2.5} />
                Sell
              </Link>
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

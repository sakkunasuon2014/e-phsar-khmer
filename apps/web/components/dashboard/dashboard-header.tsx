"use client";

import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeSwitcher } from "@/components/ui/theme-switcher";
import { LocaleSwitcher } from "./locale-switcher";
import Notifications from "./notifications";
import { NavUser } from "./nav-user";
import type { CurrentUser } from "@/actions/user";

export function DashboardHeader({ user }: { user: CurrentUser | null }) {
  return (
    <header className="flex items-center justify-between border-b px-6 py-4">
      <div className="flex items-center gap-4">
        <SidebarTrigger className="-ml-2" />
        <h1 className="type-page-title">DashBoard</h1>
      </div>

      <div className="ml-auto flex items-center gap-4">
        <ThemeSwitcher />
        <LocaleSwitcher />
        <Notifications />
        <NavUser user={user} />
      </div>
    </header>
  );
}

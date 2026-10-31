"use client";

import { AlertTriangleIcon, Bookmark, Forward, Link2 } from "lucide-react";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EllipsisVertical } from "lucide-react";
import { useState } from "react";
import { ReportAccount } from "@/components/report/ReportAccount";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { User } from "@/lib/user";

export function ThreeDotProfile({
  user,
  viewerId,
}: {
  user: User;
  viewerId?: string | null;
}) {
  const t = useTranslations("Common");
  const [reportOpen, setReportOpen] = useState(false);
  // Reporting yourself is a backend 400; don't offer it on your own profile.
  const isOwnProfile = viewerId != null && String(user.userId) === viewerId;
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="rounded-full border-muted-foreground/30 text-muted-foreground h-9 w-9"
          >
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuItem>
              <Bookmark />
              {t("save")}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Forward />
              {t("share")}
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Link2 />
              {t("copyLink")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {!isOwnProfile && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className="text-red-500"
                  onSelect={() => setReportOpen(true)}
                >
                  <AlertTriangleIcon />
                  {t("report")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ReportAccount
        open={reportOpen}
        onOpenChange={setReportOpen}
        user={user}
      />
    </>
  );
}

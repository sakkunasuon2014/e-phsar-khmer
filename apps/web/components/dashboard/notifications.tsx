"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bell, Flag, Loader2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import {
  getListingReports,
  getUserReports,
  type ListingReportView,
  type UserReportView,
} from "@/actions/admin-reports";

/**
 * The bell is the moderation review queue, not decoration: it reads the same
 * two report lists the queues themselves use (same react-query keys, so a page
 * visit and the bell share one fetch and an approve/reject refresh reaches
 * both). Nothing to review ⇒ no badge.
 */
type QueueItem = {
  id: string;
  kind: "user" | "listing";
  title: string;
  description: string;
  createdAt: string;
  href: string;
};

function timeAgo(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "";
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function buildQueue(
  userReports: UserReportView[],
  listingReports: ListingReportView[],
): QueueItem[] {
  const items: QueueItem[] = [
    ...userReports
      .filter((report) => report.status === "pending")
      .map((report) => ({
        id: report.id,
        kind: "user" as const,
        title: `Report on ${report.targetName}`,
        description: `${report.reasonText ?? "User report"} — reported by ${report.reporterName}`,
        createdAt: report.createdAt,
        href: "/wanderer/dashboard/report/users",
      })),
    ...listingReports
      .filter((report) => report.status === "pending")
      .map((report) => ({
        id: report.id,
        kind: "listing" as const,
        title: `Report on ${report.listingTitle ?? "listing"}`,
        description: `${report.reasonText ?? "Listing report"} — reported by ${report.reporterName}`,
        createdAt: report.createdAt,
        href: "/wanderer/dashboard/report/posts",
      })),
  ];
  return items
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 20);
}

export default function Notifications() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const { data: userReports, isLoading: loadingUserReports } = useQuery({
    queryKey: ["admin", "reports", "users"],
    queryFn: getUserReports,
    retry: false,
  });
  const { data: listingReports, isLoading: loadingListingReports } = useQuery({
    queryKey: ["admin", "reports", "listings"],
    queryFn: getListingReports,
    retry: false,
  });

  const isLoading = loadingUserReports || loadingListingReports;
  const items = useMemo(
    () => buildQueue(userReports ?? [], listingReports ?? []),
    [userReports, listingReports],
  );
  const pendingCount = items.length;

  const openQueue = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Drawer open={open} onOpenChange={setOpen} direction="right">
      <DrawerTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Notifications"
          className="relative cursor-pointer rounded-full hover:bg-muted/60"
        >
          <Bell className="size-5 text-muted-foreground" />
          {pendingCount > 0 ? (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 type-photo-badge text-white antialiased">
              {pendingCount > 99 ? "99+" : pendingCount}
            </span>
          ) : null}
        </Button>
      </DrawerTrigger>

      <DrawerContent className="ml-auto h-full w-full max-w-md border-l border-border bg-card">
        <DrawerHeader className="border-b border-border px-6 py-4">
          <DrawerTitle>Notifications</DrawerTitle>
          <DrawerDescription>
            {isLoading
              ? "Checking the review queues…"
              : pendingCount === 0
                ? "Nothing waiting — you're all caught up."
                : `${pendingCount} report${pendingCount === 1 ? "" : "s"} waiting for review.`}
          </DrawerDescription>
        </DrawerHeader>

        <div className="no-scrollbar space-y-2 overflow-y-auto px-3 py-3">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
              <Bell className="size-8" />
              <p className="type-body-sm">No pending reports.</p>
            </div>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openQueue(item.href)}
                className="flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted/50"
              >
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
                  {item.kind === "user" ? (
                    <UserRound className="size-4 text-[#00a0e9]" />
                  ) : (
                    <Flag className="size-4 text-orange-500" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium">{item.title}</span>
                    <span className="type-meta shrink-0 text-muted-foreground">
                      {timeAgo(item.createdAt)}
                    </span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 whitespace-normal type-meta text-muted-foreground">
                    {item.description}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

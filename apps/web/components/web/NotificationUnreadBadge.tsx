"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { getUnreadNotificationCount } from "@/actions/notifications";
import { notificationKeys } from "@/lib/notifications/queries";

/** Matches the chat badge's cadence; the feed page invalidates on mutations. */
const POLL_MS = 60_000;

/**
 * Nav badge for unread notifications. The /notifications page invalidates
 * this key after every mark-read/delete, so the number updates immediately
 * there; elsewhere the 60 s poll picks up notifications created by another
 * tab or device. A failed/expired session hides the badge rather than
 * flashing an error.
 */
export function NotificationUnreadBadge() {
  const t = useTranslations("Notifications");
  const { data } = useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: getUnreadNotificationCount,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 30 * 1000,
  });

  if (!data || data <= 0) return null;

  return (
    <span
      aria-label={t("unreadAria", { count: data })}
      className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-card bg-[#f04d4e] px-1 type-photo-badge text-white"
    >
      {data > 99 ? "99+" : data}
    </span>
  );
}

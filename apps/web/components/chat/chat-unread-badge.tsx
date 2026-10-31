"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { fetchUnreadCount } from "@/actions/chat";
import { chatKeys, unwrap } from "@/lib/chat/queries";
import { CHAT_POLL } from "@/hooks/use-chat-polling";
import { useTabAttending } from "@/hooks/use-tab-attention";
import { useChatRealtimeEvents } from "@/hooks/use-chat-ws";
import { cn } from "@/lib/utils";

/**
 * Nav badge for unread messages. Rides on `GET /chats/unread-count`, but
 * since this component is mounted on every page it also owns the shared chat
 * WebSocket's baseline subscription (see `use-chat-ws.ts`) — for a signed-in
 * user the socket ends up open sitewide, and `unread_count` pushes replace
 * the 60s poll. `enabled: true` means an anonymous visitor's browser still
 * attempts the connection; the server rejects it and the hook's bounded
 * retry (10 attempts, then it stops) caps the cost of that. Renders nothing
 * when there is nothing to show, including for signed-out visitors (the
 * count request 401s and we stay quiet rather than flashing an error).
 */
export function ChatUnreadBadge({ className }: { className?: string }) {
  const t = useTranslations("Chat");
  const queryClient = useQueryClient();
  const { isConnected } = useChatRealtimeEvents({
    enabled: true,
    onEvent: () => {
      void queryClient.invalidateQueries({ queryKey: chatKeys.unread() });
    },
  });
  // An abandoned tab has no socket either, so without `attending` the fallback
  // below would poll from a tab nobody is looking at.
  const attending = useTabAttending();
  const { data } = useQuery({
    queryKey: chatKeys.unread(),
    queryFn: async () => unwrap(await fetchUnreadCount()),
    refetchInterval:
      isConnected || !attending ? false : CHAT_POLL.unreadBadgeMs,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 30 * 1000,
  });

  if (!data || data <= 0) return null;

  return (
    <span
      aria-label={t("inbox.unreadCount", { count: data })}
      className={cn(
        "absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border-2 border-card bg-[#f04d4e] px-1 type-photo-badge  text-white",
        className,
      )}
    >
      {data > 99 ? "99+" : data}
    </span>
  );
}

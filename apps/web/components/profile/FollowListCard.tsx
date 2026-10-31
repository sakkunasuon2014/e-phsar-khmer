import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { UserCheck } from "lucide-react";
import UserAvatar from "@/components/common/UserAvatar";
import { Link } from "@/i18n/routing";
import type { FollowRowUser, FollowSide } from "@/lib/api/users";
import { FollowButton } from "./FollowButton";

type Href = ComponentProps<typeof Link>["href"];

type FollowListCardProps = {
  /** Which tab is showing. The heading follows it. */
  side: FollowSide;
  items: FollowRowUser[];
  /** Signed-in viewer; null renders the sign-in bounce on each toggle. */
  viewerId: string | null;
  /** True when the account has more rows than this page fetched. */
  hasMore?: boolean;
} & (
  | {
      /** The two tab destinations — `/me/...` or `/[username]/...`. */
      hrefs: Record<FollowSide, Href>;
      onSelectTab?: undefined;
    }
  | {
      /**
       * Swap lists in place instead of navigating — the profile's `?tab=`
       * panel. A union rather than two optional props so a caller cannot
       * render tabs that neither link nor switch.
       */
      onSelectTab: (side: FollowSide) => void;
      hrefs?: undefined;
    }
);

const TABS = [
  { key: "following", labelKey: "following" },
  { key: "followers", labelKey: "followers" },
] as const;

/**
 * The followers/following panel, shared by both profile surfaces: the same
 * card renders under `/me/*` and under a profile, so the two cannot drift.
 *
 * Its tabs are links by default — each list is its own shareable URL — and
 * become buttons only for a caller that passes `onSelectTab`, which is how the
 * profile swaps them under a `?tab=` URL without a navigation.
 */
export default function FollowListCard({
  side,
  hrefs,
  onSelectTab,
  items,
  viewerId,
  hasMore,
}: FollowListCardProps) {
  const t = useTranslations("Me.follows");
  const label = t(side === "following" ? "following" : "followers");

  const tabClass = (active: boolean) =>
    `relative pb-3 type-nav transition-colors ${
      active
        ? "text-[#00a0e9] after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:rounded-full after:bg-[#00a0e9]"
        : "text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <div className="rounded-lg bg-card p-6 shadow-sm">
        <h2 className="type-section-title text-foreground">{label}</h2>

        <div className="mt-2 flex items-center gap-6 border-b border-border">
          {TABS.map((tab) => {
            const active = tab.key === side;
            return onSelectTab ? (
              <button
                key={tab.key}
                type="button"
                onClick={() => onSelectTab(tab.key)}
                className={`cursor-pointer ${tabClass(active)}`}
              >
                {t(tab.labelKey)}
              </button>
            ) : (
              <Link
                key={tab.key}
                href={hrefs[tab.key]}
                className={tabClass(active)}
              >
                {t(tab.labelKey)}
              </Link>
            );
          })}
        </div>

        {items.length === 0 ? (
          <EmptyFollowState side={side} />
        ) : (
          <ul>
            {items.map((u) => (
              <li
                key={u.userId}
                className="flex items-center gap-3 border-b border-border/50 px-1 py-3 last:border-b-0 hover:bg-muted/40"
              >
                <Link
                  href={{
                    pathname: "/[username]",
                    params: { username: u.username },
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <UserAvatar
                    src={u.avatar}
                    name={u.name}
                    className="h-11 w-11 border border-border text-sm"
                  />
                  <div className="min-w-0">
                    <p className="truncate type-nav text-foreground">
                      {u.name}
                    </p>
                    <p className="truncate type-meta text-muted-foreground">
                      @{u.username}
                    </p>
                  </div>
                </Link>
                <FollowButton
                  key={u.userId}
                  userId={u.userId}
                  initialFollowing={u.isFollowing}
                  viewerId={viewerId}
                  variant="profile"
                  className="h-8 shrink-0 rounded-full px-4 type-nav"
                />
              </li>
            ))}
          </ul>
        )}

        {hasMore && (
          <p className="pt-4 text-center type-meta text-muted-foreground">
            {t("showingRecent", { count: items.length })}
          </p>
        )}
      </div>
    </div>
  );
}

/** The house empty state: muted circle, bold heading, one muted sentence. */
function EmptyFollowState({ side }: { side: "following" | "followers" }) {
  const t = useTranslations("Me.follows");
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="flex h-40 w-40 items-center justify-center rounded-full bg-muted">
        <UserCheck
          className="h-20 w-20 text-muted-foreground"
          strokeWidth={1.5}
        />
      </div>
      <p className="mt-6 type-nav text-foreground">
        {side === "following" ? t("notFollowingTitle") : t("noFollowersTitle")}
      </p>
      <p className="mt-1 type-meta text-muted-foreground">
        {side === "following" ? t("notFollowingBody") : t("noFollowersBody")}
      </p>
    </div>
  );
}

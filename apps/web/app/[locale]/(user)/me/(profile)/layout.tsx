import {
  MyProfileHeader,
  type ProfileUser,
} from "@/components/profile/MyProfileHeader";
import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/routing";
import { getCurrentUser, type SessionUser } from "@/lib/auth/current-user";
import { getMyFollowCounts } from "@/lib/api/users";
import { MONTH_LABELS } from "@/lib/locale-labels";

function toProfileUser(
  me: SessionUser,
  counts: { followers: number; following: number } | null,
  locale: string,
  fallbackName: string,
): ProfileUser {
  const name =
    [me.firstName, me.lastName].filter(Boolean).join(" ").trim() ||
    me.username ||
    fallbackName;
  const avatar = me.profilePhotoUrl ?? "";
  const created = new Date(me.createdAt);
  const month =
    (MONTH_LABELS[locale] ?? MONTH_LABELS.en)[created.getMonth()] ?? "";
  const joinDate = `${created.getDate()} ${month} ${created.getFullYear()}`;
  return {
    name,
    username: me.username ?? "",
    avatar,
    cover: me.coverPhotoUrl ?? "",
    // Real counts. A failed fetch degrades to 0 rather than to a made-up
    // number — a wrong count is worse than a missing one.
    following: counts?.following ?? 0,
    follower: counts?.followers ?? 0,
    joinDate,
    verifiedAccount: me.verifiedAccount ?? false,
  };
}

export default async function MyProfileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentUser();
  const locale = await getLocale();
  if (!me) return redirect({ href: "/login", locale });

  const [counts, t] = await Promise.all([
    getMyFollowCounts(),
    getTranslations("Nav"),
  ]);

  return (
    <>
      <MyProfileHeader
        user={toProfileUser(me, counts, locale, t("myAccount"))}
        isOwnProfile
      />
      {children}
    </>
  );
}

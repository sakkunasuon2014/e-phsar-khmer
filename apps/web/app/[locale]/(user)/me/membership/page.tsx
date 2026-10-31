import Subscription from "@/components/profile/Subscription";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Me.metadata");
  return { title: t("membership"), description: t("membership") };
}

/**
 * The Membership plan screen — the viewer's held plans plus the Free sheet.
 * `/me/subscriptions` is the subscriptions list; this page is not reachable
 * from it, and it renders standalone (own breadcrumbs, no profile tab bar).
 */
export default function MembershipPage() {
  return <Subscription />;
}

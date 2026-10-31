import Subscriptions from "@/components/profile/Subscriptions";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Me.metadata");
  return { title: t("subscriptions"), description: t("subscriptions") };
}

export default async function SubscriptionsPage() {
  // The profile layout already gates the route; the header's Account ID line
  // wants the handle, and the list itself is fetched in the client component.
  const me = await getCurrentUser();
  return <Subscriptions username={me?.username ?? ""} />;
}

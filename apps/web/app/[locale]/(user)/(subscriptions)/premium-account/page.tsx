import { BadgeCheck, ChevronRight } from "lucide-react";
import { Link } from "@/i18n/routing";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import {
  getMySubscriptions,
  getSubscriptionCatalog,
} from "@/actions/subscriptions";
import { activeSubscriptions, daysUntil } from "@/lib/subscription-pricing";

export default async function PremiumAccountPage() {
  const [catalog, subscriptions] = await Promise.all([
    getSubscriptionCatalog().catch(() => []),
    getMySubscriptions().catch(() => []),
  ]);
  // One subscription per group, held side by side.
  const heldByGroup = new Map(
    activeSubscriptions(subscriptions).flatMap((item) =>
      item.groupId ? [[item.groupId, item]] : [],
    ),
  );

  // The catalog arrives in admin sort order, so first-seen order is the
  // order the groups are listed in.
  const groups = new Map<
    string,
    { id: string; name: string; slug: string; description: string | null }
  >();
  for (const item of catalog) {
    if (!groups.has(item.groupId)) {
      groups.set(item.groupId, {
        id: item.groupId,
        name: item.groupName,
        slug: item.groupSlug,
        description: item.groupDescription,
      });
    }
  }

  return (
    <div className="min-h-screen bg-muted pb-10">
      <div className="mx-auto max-w-7xl px-4 py-4">
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Profile", href: "/me" },
            { label: "Membership", href: "/me/membership" },
            { label: "Premium Account" },
          ]}
        />
      </div>

      <main className="mx-auto max-w-4xl px-4">
        <div className="space-y-2 py-4">
          <h1 className="text-xl font-semibold">
            Increase your sales with PSA Khmer Premium Service!
          </h1>
          <span className="block py-1 text-sm text-foreground">
            Choose the right category for your ads and start selling faster.
          </span>

          {groups.size === 0 ? (
            <div className="rounded-sm border bg-card p-10 text-center">
              <h2 className="font-semibold text-foreground">
                No plans available
              </h2>
              <p className="mt-1 text-sm text-foreground">
                Please check back later.
              </p>
            </div>
          ) : (
            [...groups.values()].map((group) => {
              const mine = heldByGroup.get(group.id);
              return (
                <div
                  key={group.id}
                  className="space-y-2 rounded-sm border bg-card p-4 py-3 pb-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{group.name}</h2>
                    {mine && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                        <BadgeCheck className="size-3" />
                        {mine.packageName ?? "Active"} ·{" "}
                        {daysUntil(mine.expiresAt)} days left
                      </span>
                    )}
                  </div>
                  {group.description && (
                    <p className="text-sm text-foreground">
                      {group.description}
                    </p>
                  )}

                  <Link
                    href={{
                      pathname: "/premium-account/[category]",
                      params: { category: group.slug },
                    }}
                    className="flex items-center text-sm font-semibold text-[#00a0e9] underline"
                  >
                    {mine ? "Upgrade" : "Subscribe"}
                    <ChevronRight size={16} className="block text-[#00a0e9]" />
                  </Link>
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}

import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/routing";
import { getCurrentUser } from "@/lib/auth/current-user";
import { loadInsightSummary } from "@/actions/insights";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import type { InsightSummary } from "@/types/insights";

/**
 * The account-wide interaction summary for the signed-in user's listings.
 * Every number is real: `GET /insights/me` aggregates the listing_events
 * table, and a failed read renders `—` rather than a fabricated zero.
 */
const METRICS = [
  {
    key: "impression",
    labelKey: "metrics.impression.label",
    descriptionKey: "metrics.impression.description",
  },
  {
    key: "engagement",
    labelKey: "metrics.engagement.label",
    descriptionKey: "metrics.engagement.description",
  },
  {
    key: "view",
    labelKey: "metrics.view.label",
    descriptionKey: "metrics.view.description",
  },
  {
    key: "chat",
    labelKey: "metrics.chat.label",
    descriptionKey: "metrics.chat.description",
  },
  {
    key: "call",
    labelKey: "metrics.call.label",
    descriptionKey: "metrics.call.description",
  },
  {
    key: "showContact",
    labelKey: "metrics.showContact.label",
    descriptionKey: "metrics.showContact.description",
  },
  {
    key: "applyJob",
    labelKey: "metrics.applyJob.label",
    descriptionKey: "metrics.applyJob.description",
  },
] satisfies ReadonlyArray<{
  key: keyof InsightSummary;
  labelKey: string;
  descriptionKey: string;
}>;

export default async function InsightPage() {
  const me = await getCurrentUser();
  const locale = await getLocale();
  const t = await getTranslations();
  const tInsight = await getTranslations("Insight");
  if (!me) return redirect({ href: "/login", locale });

  const summary = await loadInsightSummary();

  return (
    <div className="min-h-screen bg-muted pb-10">
      <div className="max-w-7xl mx-auto py-8">
        <Breadcrumbs
          items={[
            { label: t("Search.home"), href: "/" },
            { label: t("Me.profile"), href: "/me" },
            { label: tInsight("title") },
          ]}
        />
      </div>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4">
        <h1 className="type-page-title text-foreground mb-4">
          {tInsight("title")}
        </h1>
        <div className="bg-card border rounded-sm shadow-sm overflow-hidden">
          {/* Section Header */}
          <div className="px-4 py-4">
            <h2 className="type-section-title text-foreground">
              {tInsight("summary")}
            </h2>
            {summary === null ? (
              <p className="text-sm text-muted-foreground mt-1">
                {tInsight("error")}
              </p>
            ) : null}
          </div>
          {/* Metrics List */}
          <div className="divide-y divide-muted">
            {METRICS.map((item) => (
              <div
                key={item.key}
                className="px-4 py-4 flex items-start justify-between group transition-colors"
              >
                <div className="space-y-1">
                  <h3 className="type-card-heading text-foreground">
                    {tInsight(item.labelKey)}
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-md">
                    {tInsight(item.descriptionKey)}
                  </p>
                </div>
                <div className="text-lg font-medium text-foreground">
                  {summary === null ? "—" : summary[item.key]}
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

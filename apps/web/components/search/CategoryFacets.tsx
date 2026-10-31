import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import type { BackendCategory, ListingsFeed } from "@/lib/api/categories";
import { CATEGORY_PARAM, SUB_PARAM, queryWith } from "@/lib/search-params";
import { cn } from "@/lib/utils";

interface CategoryFacetsProps {
  /** Localized category tree — facets carry slugs only. */
  tree: BackendCategory[];
  facets: ListingsFeed["facets"];
  activeCategory?: string;
  activeSub?: string;
  /** The page's raw search params; every link keeps all other filters. */
  current: Record<string, string | string[] | undefined>;
  variant: "sidebar" | "chips";
}

interface Row {
  key: string;
  label: string;
  count: number;
  active: boolean;
  query: Record<string, string>;
  depth: 0 | 1;
}

/**
 * Per-category result counts for the current search (backend `meta.facets`).
 * The counts ignore the category choice itself, so picking one never hides
 * the others. Categories keep catalogue order (not count order) so the list
 * does not reshuffle while the user filters; empty ones are hidden unless
 * selected, so a selection can always be seen and undone.
 */
export async function CategoryFacets({
  tree,
  facets,
  activeCategory,
  activeSub,
  current,
  variant,
}: CategoryFacetsProps) {
  const t = await getTranslations("Search");
  const catCounts = new Map(facets?.categories.map((f) => [f.slug, f.count]));
  const subCounts = new Map(
    facets?.subcategories?.map((f) => [f.slug, f.count]),
  );
  const allCount = facets?.categories.reduce((n, f) => n + f.count, 0) ?? 0;

  const rows: Row[] = [
    {
      key: "all",
      label: t("allCategories"),
      count: allCount,
      active: !activeCategory && !activeSub,
      query: queryWith(current, { [CATEGORY_PARAM]: null, [SUB_PARAM]: null }),
      depth: 0,
    },
  ];
  for (const cat of tree) {
    const count = catCounts.get(cat.slug) ?? 0;
    const isActive = cat.slug === activeCategory;
    if (count === 0 && !isActive) continue;
    rows.push({
      key: cat.slug,
      label: cat.name,
      count,
      active: isActive && !activeSub,
      query: queryWith(current, {
        [CATEGORY_PARAM]: cat.slug,
        [SUB_PARAM]: null,
      }),
      depth: 0,
    });
    if (!isActive) continue;
    for (const sub of cat.subcategories) {
      const subCount = subCounts.get(sub.slug) ?? 0;
      if (subCount === 0 && sub.slug !== activeSub) continue;
      rows.push({
        key: `${cat.slug}/${sub.slug}`,
        label: sub.name,
        count: subCount,
        active: sub.slug === activeSub,
        query: queryWith(current, {
          [CATEGORY_PARAM]: cat.slug,
          [SUB_PARAM]: sub.slug,
        }),
        depth: 1,
      });
    }
  }

  if (variant === "chips") {
    const top = rows.filter((r) => r.depth === 0);
    const subs = rows.filter((r) => r.depth === 1);
    return (
      <nav aria-label={t("categories")} className="space-y-2">
        {[top, subs]
          .filter((group) => group.length > 0)
          .map((group, i) => (
            <div key={i} className="flex gap-2 overflow-x-auto pb-1">
              {group.map((r) => (
                <Link
                  key={r.key}
                  href={{ pathname: "/search", query: r.query }}
                  aria-current={r.active ? "page" : undefined}
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full border bg-card px-3 py-1.5 type-nav transition-colors hover:bg-muted",
                    r.active && "border-sky-500 text-sky-600 font-medium",
                  )}
                >
                  {r.label}{" "}
                  <span className="text-muted-foreground tabular-nums">
                    ({r.count.toLocaleString()})
                  </span>
                </Link>
              ))}
            </div>
          ))}
      </nav>
    );
  }

  return (
    <nav aria-label={t("categories")} className="rounded-sm border bg-card p-2">
      <p className="px-3 pt-1 pb-2 type-nav">{t("categories")}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.key}>
            <Link
              href={{ pathname: "/search", query: r.query }}
              aria-current={r.active ? "page" : undefined}
              className={cn(
                "flex items-center justify-between gap-3 rounded-sm px-3 py-2 type-nav transition-colors hover:bg-muted",
                r.depth === 1 && "pl-7",
                r.active && "bg-muted text-sky-600 font-semibold",
              )}
            >
              <span className="min-w-0 truncate">{r.label}</span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {r.count.toLocaleString()}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import {
  IconLayoutGridFilled,
  IconListFilled,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LocationSelectorFilter } from "@/components/filter/LocationSelectorFilter";
import SortFilter from "@/components/filter/SortFilter";
import PriceFilter from "@/components/filter/PriceFilter";
import MoreFilters from "@/components/filter/MoreFilters";
import { FeedResults } from "@/components/search/FeedResults";
import { CategoryFacets } from "@/components/search/CategoryFacets";
import { ProductCard } from "@/components/product/ProductCard";
import {
  getAllCategories,
  getListingsFeed,
  toCardPost,
  type ListingsFeedParams,
} from "@/lib/api/categories";
import { getProducts } from "@/lib/api/products";
import {
  CATEGORY_PARAM,
  FILTER_PARAMS,
  Q_PARAM,
  SUB_PARAM,
  feedQueryKey,
  normalizeQuery,
  parseFeedParams,
  queryWith,
} from "@/lib/search-params";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<Metadata> {
  const t = await getTranslations("Search");
  const q = normalizeQuery(first((await searchParams)[Q_PARAM]));
  return {
    title: q ? t("metaTitle", { q }) : t("metaTitleAll"),
    // Result pages are endless query permutations — keep them out of the index.
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const locale = await getLocale();
  const t = await getTranslations("Search");

  const query: ListingsFeedParams = parseFeedParams(sp, { withCategory: true });
  const [feed, tree, products] = await Promise.all([
    getListingsFeed(
      { ...query, includeTotal: true, includeFacets: true },
      locale,
    ),
    getAllCategories(locale),
    // Trusted product pages: only a keyword search has something to match on.
    query.q ? getProducts(query.q, 6) : Promise.resolve([]),
  ]);
  const categories = tree ?? [];
  const posts = (feed?.items ?? []).map(toCardPost);
  const total = feed?.total ?? posts.length;

  // A lone `sub` still belongs to a category — highlight and expand it.
  const activeCategory =
    query.categorySlug ??
    categories.find((c) =>
      c.subcategories.some((s) => s.slug === query.subcategorySlug),
    )?.slug;
  const activeCat = categories.find((c) => c.slug === activeCategory);
  const activeSub = activeCat?.subcategories.find(
    (s) => s.slug === query.subcategorySlug,
  );

  const q = query.q ?? "";
  const chips = [
    activeCat && {
      key: "category",
      label: activeCat.name,
      query: queryWith(sp, { [CATEGORY_PARAM]: null, [SUB_PARAM]: null }),
    },
    activeSub && {
      key: "sub",
      label: activeSub.name,
      query: queryWith(sp, { [SUB_PARAM]: null }),
    },
  ].filter(
    (c): c is { key: string; label: string; query: Record<string, string> } =>
      !!c,
  );

  // "Clear filters" keeps the keyword and category; "Clear search" resets all.
  const clearFilters = queryWith(
    sp,
    Object.fromEntries(
      FILTER_PARAMS.filter((k) => k !== Q_PARAM).map((k) => [k, null]),
    ),
  );

  return (
    <main className="min-h-screen flex flex-col bg-muted">
      <div className="px-4 py-4">
        <Breadcrumbs
          className="max-w-7xl mx-auto w-full"
          items={[{ label: t("home"), href: "/" }, { label: t("search") }]}
        />
      </div>

      <Tabs
        defaultValue="grid"
        className="max-w-7xl mx-auto w-full px-4 xl:px-0 pb-8"
      >
        {/* HEADER */}
        <div className="px-6 py-3 bg-card rounded-t-sm border flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="type-page-title min-w-0 break-words">
            {q ? t("resultsFor", { q }) : t("allAds")}
          </h1>
          <p className="type-meta text-muted-foreground tabular-nums">
            {t("resultCount", { count: total })}
          </p>
        </div>

        {/* FILTER BAR — same sticky bar as the category pages. */}
        <div className="sticky top-16 z-40 flex items-center justify-between gap-2 bg-card rounded-b-sm border px-4 p-3">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <LocationSelectorFilter />
            <SortFilter />
            <PriceFilter />
            <MoreFilters />
          </div>
          <TabsList className="h-9 shrink-0">
            <TabsTrigger value="grid" className="cursor-pointer px-3">
              <IconLayoutGridFilled className="size-4" />
            </TabsTrigger>
            <TabsTrigger value="list" className="cursor-pointer px-3">
              <IconListFilled className="size-4" />
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Mobile: the category counts as a scrolling chip row. */}
        <div className="lg:hidden mt-3">
          <CategoryFacets
            variant="chips"
            tree={categories}
            facets={feed?.facets}
            activeCategory={activeCategory}
            activeSub={activeSub?.slug}
            current={sp}
          />
        </div>

        <div className="flex gap-4 mt-4 items-start">
          <aside className="hidden lg:block w-64 shrink-0 sticky top-36">
            <CategoryFacets
              variant="sidebar"
              tree={categories}
              facets={feed?.facets}
              activeCategory={activeCategory}
              activeSub={activeSub?.slug}
              current={sp}
            />
          </aside>

          <section className="flex-1 min-w-0">
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {chips.map((c) => (
                  <Link
                    key={c.key}
                    href={{ pathname: "/search", query: c.query }}
                    aria-label={t("removeFilter", { name: c.label })}
                    className="inline-flex items-center gap-1.5 rounded-full border border-sky-500 bg-card px-3 py-1 type-nav text-sky-600 hover:bg-muted transition-colors"
                  >
                    {c.label}
                    <IconX className="size-3.5" aria-hidden />
                  </Link>
                ))}
              </div>
            )}

            {feed?.fuzzy && posts.length > 0 && (
              <p
                role="status"
                className="mt-3 rounded-sm border border-amber-300 bg-amber-50 px-4 py-2.5 type-body-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
              >
                {t("fuzzyNotice", { q })}
              </p>
            )}

            {q && products.length > 0 && (
              <section className="mt-4 rounded-sm border bg-card p-4">
                <h2 className="type-section-title">{t("products")}</h2>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      viewSpecsLabel={t("viewSpecs")}
                    />
                  ))}
                </div>
              </section>
            )}

            {posts.length === 0 ? (
              <div className="mt-4 flex flex-col items-center gap-3 rounded-sm border bg-card px-6 py-16 text-center">
                <IconSearch
                  className="size-10 text-muted-foreground"
                  aria-hidden
                />
                <h2 className="type-section-title break-words max-w-full">
                  {q ? t("emptyTitle", { q }) : t("emptyTitleNoQuery")}
                </h2>
                <p className="type-meta text-muted-foreground">
                  {t("emptyHint")}
                </p>
                <div className="flex flex-wrap justify-center gap-4 pt-2 type-nav">
                  <Link
                    href={{ pathname: "/search", query: clearFilters }}
                    className="text-sky-600 hover:underline"
                  >
                    {t("clearFilters")}
                  </Link>
                  <Link href="/search" className="text-sky-600 hover:underline">
                    {t("clearSearch")}
                  </Link>
                </div>
              </div>
            ) : (
              <FeedResults
                key={feedQueryKey(query)}
                initialPosts={posts}
                initialCursor={feed?.nextCursor ?? null}
                query={query}
                locale={locale}
                gridClassName="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
              />
            )}
          </section>
        </div>
      </Tabs>
    </main>
  );
}

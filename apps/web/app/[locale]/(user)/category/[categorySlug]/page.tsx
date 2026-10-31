import { getLocale, getTranslations } from "next-intl/server";
import AdvertisementCarousel from "@/components/ads/AdvertisementCarousel";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import CommonCategoryLayout from "@/components/category-layouts/CommonCategoryLayout";
import ServicesCategoryLayout from "@/components/category-layouts/ServicesCategoryLayout";
import JobsCategoryLayout from "@/components/category-layouts/JobsCategoryLayout";
import CarsCategoryLayout from "@/components/category-layouts/CarsCategoryLayout";
import SubcategoryGrid from "@/components/category-layouts/SubcategoryGrid";
import { GridCardSell } from "@/components/ads/GridCardSell";
import { ListCardSell } from "@/components/ads/ListCardSell";
import { Tabs } from "@/components/ui/tabs";
import { FeedResults } from "@/components/search/FeedResults";
import {
  getCategoryWithSubcategories,
  getListingsFeed,
  toCardPost,
  type ListingsFeedParams,
} from "@/lib/api/categories";
import { getAdvertisements } from "@/lib/api/advertisements";
import { feedQueryKey, parseFeedParams } from "@/lib/search-params";

const SUBCATEGORY_LAYOUT: Record<string, number> = {
  "cars-and-vehicles": 5,
  "phones-and-tablets": 5,
  "computers-and-accessories": 7,
  "electronics-and-appliances": 6,
  "home-and-land": 6,
  jobs: 8,
  services: 8,
  "fashion-and-beauty": 6,
  "furniture-and-decor": 5,
  "books-sports-and-hobbies": 7,
  pets: 7,
  foods: 5,
};

// Categories with special layouts
const COMMON_CATEGORIES = [
  "phones-and-tablets",
  "computers-and-accessories",
  "electronics-and-appliances",
  "home-and-land",
  "fashion-and-beauty",
  "furniture-and-decor",
  "books-sports-and-hobbies",
  "pets",
  "foods",
];
const CARS_CATEGORIES = ["cars-and-vehicles"];
const SERVICES_CATEGORIES = ["services"];
const JOBS_CATEGORIES = ["jobs"];

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ categorySlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { categorySlug } = await params;
  const locale = await getLocale();
  const t = await getTranslations();

  const category = await getCategoryWithSubcategories(categorySlug, locale);

  if (!category) {
    return (
      <div className="container mx-auto px-4 py-8">
        {t("Category.notFound")}
      </div>
    );
  }

  let Layout;

  if (COMMON_CATEGORIES.includes(category.slug)) {
    Layout = CommonCategoryLayout;
  } else if (SERVICES_CATEGORIES.includes(category.slug)) {
    Layout = ServicesCategoryLayout;
  } else if (JOBS_CATEGORIES.includes(category.slug)) {
    Layout = JobsCategoryLayout;
  } else if (CARS_CATEGORIES.includes(category.slug)) {
    Layout = CarsCategoryLayout;
  } else {
    Layout = CommonCategoryLayout;
  }

  //  FIXED
  const cols = SUBCATEGORY_LAYOUT[category.slug] ?? 6;

  // Real active listings feed for every category, filtered by the filter
  // bar's URL params (location, price, sort, keyword, …). Cards render through
  // the GridCardPost / ListCardPost templates via the toCardPost adapter.
  const feedQuery: ListingsFeedParams = {
    ...parseFeedParams(await searchParams),
    categorySlug,
  };
  const [feed, banners] = await Promise.all([
    getListingsFeed(feedQuery, locale),
    getAdvertisements("category"),
  ]);
  const feedPosts = (feed?.items ?? []).map(toCardPost);

  return (
    <main className="min-h-screen flex flex-col bg-muted">
      {banners.length > 0 && (
        <div className="w-full flex justify-center py-6">
          <div className="w-full max-w-4xl">
            <AdvertisementCarousel banners={banners} priority />
          </div>
        </div>
      )}

      <div className="px-4 py-2">
        <div className="max-w-7xl mx-auto w-full pb-1">
          <Breadcrumbs
            items={[
              { label: t("Search.home"), href: "/" },
              { label: t("Common.inCambodia", { name: category.name }) },
            ]}
          />
        </div>
      </div>

      {/* The grid/list toggle in the layout above drives these two views:
          grid → grid post cards, list → list post cards (All Ads behaviour).
          The layout is NOT wrapped in a short div — the bar inside it is
          sticky and needs the tall Tabs root as its containing block. */}
      <Tabs defaultValue="grid" className="max-w-7xl mx-auto w-full pb-2">
        <Layout category={category} />
        <div>
          <SubcategoryGrid
            categorySlug={category.slug}
            subcategories={category.subcategories}
            cols={cols}
          />
        </div>
        {/* Sell-banner card + the posts feed, as grid cards (grid view) or
            list cards (list view), with "Load more" past the first page. */}
        <FeedResults
          key={feedQueryKey(feedQuery)}
          initialPosts={feedPosts}
          initialCursor={feed?.nextCursor ?? null}
          query={feedQuery}
          locale={locale}
          gridLead={<GridCardSell />}
          listLead={<ListCardSell />}
        />
      </Tabs>
    </main>
  );
}

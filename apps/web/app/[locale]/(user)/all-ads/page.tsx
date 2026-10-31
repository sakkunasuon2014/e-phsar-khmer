import AdvertisementCarousel from "@/components/ads/AdvertisementCarousel";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { getLocale, getTranslations } from "next-intl/server";
import AllAdsCategories from "@/components/all-ads/AllAdsCategories";
import AllAdsFeed from "@/components/all-ads/AllAdsFeed";
import {
  getListingsFeed,
  getProvinces,
  toCardPost,
  type BackendPlace,
} from "@/lib/api/categories";
import { getAdvertisements } from "@/lib/api/advertisements";
import { ALL_ADS_PAGE_SIZE, parseAllAdsFilters } from "@/lib/all-ads";

export default async function AllAdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const locale = await getLocale();
  const filters = parseAllAdsFilters(sp);

  // A province-scoped visit shows the province in the heading. The name comes
  // from the same DB list the homepage links from; an unknown slug falls back
  // to the generic heading (the feed is empty either way).
  const [tAll, tSearch, feed, provinces, banners] = await Promise.all([
    getTranslations("AllAds"),
    getTranslations("Search"),
    getListingsFeed({ ...filters, limit: ALL_ADS_PAGE_SIZE }, locale),
    filters.provinceSlug
      ? getProvinces()
      : Promise.resolve([] as BackendPlace[]),
    getAdvertisements("all_ads"),
  ]);
  const province = filters.provinceSlug
    ? (provinces.find((p) => p.slug === filters.provinceSlug) ?? null)
    : null;
  const provinceName = province
    ? locale === "km"
      ? (province.nameKm ?? province.name)
      : province.name
    : null;
  const heading = provinceName
    ? tAll("headingInPlace", { place: provinceName })
    : tAll("heading");

  // The whole active catalogue, first screen only — AllAdsFeed appends the
  // rest from the feed's own cursor as the visitor reaches the bottom. There
  // are no highlight/top-ad blocks here: Trending is the home page's strip,
  // and this page stays the plain active catalogue.
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
        <div className="max-w-7xl mx-auto w-full pb-2">
          <Breadcrumbs
            items={[{ label: tSearch("home"), href: "/" }, { label: heading }]}
          />
        </div>
      </div>
      <div className="max-w-7xl mx-auto w-full pb-2">
        {/* Keyed on the filters: a filter change re-renders this page, and the
            key makes the accumulated screens reset with the new first one. */}
        <AllAdsFeed
          key={JSON.stringify(filters)}
          initialPosts={(feed?.items ?? []).map(toCardPost)}
          initialCursor={feed?.nextCursor ?? null}
          filters={filters}
          heading={heading}
          locale={locale}
        >
          <AllAdsCategories />
        </AllAdsFeed>
      </div>
    </main>
  );
}

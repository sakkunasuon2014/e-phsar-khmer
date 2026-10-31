import CategoryGrid from "@/components/home/CategoryGrid";
import TrendingAds from "@/components/ads/TrendingAds";
import BrowseByLocation from "@/components/home/BrowseByLocation";
// import FeedbackButton from "@/components/ui/FeedBackButton";
import { Link } from "@/i18n/routing";

import AdvertisementCarousel from "@/components/ads/AdvertisementCarousel";
import { GridCardPost } from "@/components/ads/GridCardPost";
import { GridCardSell } from "@/components/ads/GridCardSell";
import { getTranslations, getLocale } from "next-intl/server";
import { getListingsFeed, toCardPost } from "@/lib/api/categories";
import { getAdvertisements } from "@/lib/api/advertisements";

export default async function HomePage() {
  const t = await getTranslations("HomePage");
  const locale = await getLocale();

  // Real Latest Ads feed (all active listings); Trending ranks engagement
  // separately and falls back to the newest live ads in its tail.
  const [feedPosts, homeBanners] = await Promise.all([
    getListingsFeed({}, locale).then((feed) =>
      (feed?.items ?? []).map(toCardPost),
    ),
    getAdvertisements("home"),
  ]);

  return (
    <>
      {/* `home-type` is the one place the display sizes survive: h1 24, h2 20
          (captain, 2026-10-26); every other page runs the 20/16 scale. */}
      <main className="home-type min-h-screen flex flex-col bg-muted">
        {homeBanners.length > 0 && (
          <div className="w-auto flex justify-center py-6">
            <div className="w-full max-w-4xl">
              <AdvertisementCarousel banners={homeBanners} priority />
            </div>
          </div>
        )}

        <div className="px-6 py-8 md:px-12 md:py-6">
          <div className="max-w-7xl mx-auto space-y-4">
            {/* The welcome line keeps normal weight (captain, 2026-10-23);
                page titles elsewhere keep their bold `type-page-title` role. */}
            <h1 className="type-page-title font-normal text-foreground">
              {t("welcome.title")}
            </h1>
            <CategoryGrid />
            <TrendingAds />
            <h2 className="type-section-title">{t("latestads")}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <GridCardSell />
              {feedPosts.map((post) => (
                <GridCardPost key={post.postId} post={post} />
              ))}
            </div>
          </div>
        </div>
        <div className="flex justify-center">
          <Link
            href="/all-ads"
            className="max-w-5xl px-6 py-2.5 bg-[#00a7e1] hover:bg-[#0095ca] type-nav text-white text-center rounded transition-colors"
          >
            {t("viewall")}
          </Link>
        </div>
        <div className="flex justify-center py-6 pb-30">
          <div className="w-full max-w-7xl">
            <BrowseByLocation />
          </div>
        </div>
        {/* <FeedbackButton /> */}
      </main>
    </>
  );
}

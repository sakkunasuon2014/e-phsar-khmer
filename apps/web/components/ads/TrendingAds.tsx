import { getTranslations, getLocale } from "next-intl/server";
import { getTrendingListings } from "@/lib/api/categories";
import { GridCardPost } from "./GridCardPost";

export default async function TrendingAds() {
  const t = await getTranslations("HomePage");
  const locale = await getLocale();
  const posts = await getTrendingListings(locale, 10);

  // The backend fills the tail with the newest live ads, so empty here means
  // the marketplace has no live ads at all — no shell around an empty rail.
  if (posts.length === 0) return null;

  return (
    <div className=" rounded bg-gradient-to-b from-[#00a0e9] from-0% via-[#00a0e9] via-[60px] to-card dark:from-primary-900 dark:to-black overflow-hidden">
      <h2 className="type-section-title pb-3 px-4 pt-3">{t("trending")}</h2>
      <div className="flex gap-3 overflow-x-auto px-4 pb-4 snap-x">
        {posts.map((post) => (
          // The horizontal carousel owns the card width: a flex child would
          // otherwise shrink to its content.
          <div key={post.postId} className="w-[260px] shrink-0">
            <GridCardPost post={post} />
          </div>
        ))}
      </div>
    </div>
  );
}

import { Link } from "@/i18n/routing";
import { getLocale, getTranslations } from "next-intl/server";
import { getProvinces } from "@/lib/api/categories";
import { LOCATION_PRO_PARAM } from "@/lib/search-params";

/**
 * The province list comes from the seeded geography
 * (`GET /locations/provinces`), not the old mock `lib/location` array — the DB
 * is the single source of truth for slugs, and the same list drives the filter
 * bar and the post form.
 *
 * Names double as translation keys under `HomePage.BrowseByLocation`; a newly
 * seeded province needs a key in `messages/*.json`. A failed read hides the
 * section rather than 500ing the homepage (same rule as CategoryGrid).
 */
export default async function BrowseByLocation() {
  const [t, provinces, locale] = await Promise.all([
    getTranslations("HomePage.BrowseByLocation"),
    getProvinces(),
    getLocale(),
  ]);
  if (provinces.length === 0) return null;

  return (
    <div className="bg-card rounded border border-border p-6">
      <h2 className="type-section-title text-foreground mb-4">{t("title")}</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-x-9 gap-y-3">
        {provinces.map((province) => (
          <Link
            key={province.slug}
            href={{
              pathname: "/all-ads",
              query: {
                [LOCATION_PRO_PARAM]: province.slug,
              },
            }}
            className="text-foreground hover:text-[#0095ca] type-body-sm"
          >
            {locale === "km" && province.nameKm
              ? province.nameKm
              : t.has(province.name)
                ? t(province.name)
                : province.name}
          </Link>
        ))}
      </div>
    </div>
  );
}

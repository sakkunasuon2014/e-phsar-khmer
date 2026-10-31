import { Link } from "@/i18n/routing";
import CategoryTileBody from "@/components/common/CategoryTileBody";
import { API_URL } from "@/lib/api/client";
import { getLocale, getTranslations } from "next-intl/server";

/**
 * Minimal slice of GET /api/v1/categories items. Deliberately local: the web
 * app is standalone and the mock `Category` (cateId/cateIcon) must not be
 * confused with this wire shape (id/icon).
 */
interface BackendCategory {
  slug: string;
  name: string;
  icon: string | null;
}

export default async function CategoryGrid() {
  const [t, locale] = await Promise.all([
    getTranslations("HomePage.BrowseByCategory"),
    getLocale(),
  ]);

  let items: BackendCategory[] = [];
  try {
    const res = await fetch(`${API_URL}/categories`, {
      headers: { "Accept-Language": locale },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      success: boolean;
      data?: BackendCategory[];
    };
    items = body.success ? (body.data ?? []) : [];
  } catch {
    // backend unavailable — hide the section, never 500 the homepage
    return null;
  }
  if (items.length === 0) return null;

  return (
    <div className="w-full flex justify-center mt-4">
      <div className="w-full max-w-7xl bg-card border rounded-sm pt-4 pb-8">
        <h2 className="type-section-title text-foreground mb-6 px-4">
          {t("title")}
        </h2>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-y-8 gap-x-8 px-2">
          {items.map((category) => (
            <Link
              key={category.slug}
              href={{
                pathname: "/category/[categorySlug]",
                params: { categorySlug: category.slug },
              }}
              className="flex flex-col items-center text-center group"
            >
              <CategoryTileBody name={category.name} icon={category.icon} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

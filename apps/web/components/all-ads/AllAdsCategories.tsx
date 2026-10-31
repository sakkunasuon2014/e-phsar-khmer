import { Link } from "@/i18n/routing";
import { LayoutGrid } from "lucide-react";
import { getLocale } from "next-intl/server";
import DbImage from "@/components/common/DbImage";
import { getAllCategories } from "@/lib/api/categories";

/**
 * The All Ads category strip — the real category list, same source the home
 * page's CategoryGrid reads (it used to be the mock `lib/categories`, which
 * drew third-party icons and looked each name up as a translation key).
 *
 * Same design rule as every other icon surface: the row's own `icon` decides
 * the design. A category with no icon shows the glyph; one whose stored object
 * is gone shows an empty circle, never a stand-in.
 */
export default async function AllAdsCategories() {
  const locale = await getLocale();
  const categories = await getAllCategories(locale);
  if (!categories?.length) return null;

  return (
    <div>
      <ul className="bg-muted text-center grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
        {categories.map((category) => (
          <li key={category.slug}>
            <Link
              href={{
                pathname: "/category/[categorySlug]",
                params: { categorySlug: category.slug },
              }}
              className="block h-full group bg-card rounded cursor-pointer active:opacity-50 pt-4 pb-4"
            >
              <div className="mx-auto flex items-center justify-center bg-blue-50 rounded-full w-16 h-16 group-hover:bg-blue-100 transition-colors">
                {category.icon ? (
                  <DbImage
                    src={category.icon}
                    alt={category.name}
                    width={120}
                    height={120}
                    className="object-contain"
                  />
                ) : (
                  <LayoutGrid
                    className="h-8 w-8 text-blue-500/70"
                    aria-hidden
                  />
                )}
              </div>
              <p className="mt-3 type-body-sm ">{category.name}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

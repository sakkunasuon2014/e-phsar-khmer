import { Link } from "@/i18n/routing";
import { getLocale } from "next-intl/server";
import { LayoutGrid } from "lucide-react";
import DbImage from "@/components/common/DbImage";
import { getAllCategories } from "@/lib/api/categories";
import NotFoundIllustration from "./NotFoundIllustration";
import NotFoundTitle from "./NotFoundTitle";

/** Same glyph the home category grid falls back to — a category with no icon
 *  value keeps the circle and shows this, never a stand-in logo. */
const CategoryIconFallback = () => (
  <LayoutGrid className="h-8 w-8 text-blue-500/70" aria-hidden />
);

/**
 * The shared "not found" body — one design for every dead URL: an unknown
 * slug, an unknown category/subcategory, and a listing that is gone.
 *
 * Rendered by both not-found boundaries (`app/[locale]/not-found.tsx` and
 * `app/[locale]/(user)/not-found.tsx`); the latter is the one that normally
 * wins and wraps it in the site's navbar and footer.
 *
 * Copy is deliberately English-only, matching the rest of the storefront's
 * hardcoded surfaces — no `NotFound` i18n namespace exists.
 */
export default async function NotFoundPage() {
  const locale = await getLocale();
  // A 404 must never 500: no backend, no categories section.
  const categories = (await getAllCategories(locale)) ?? [];

  return (
    <main className="min-h-screen bg-muted py-6">
      <NotFoundTitle />
      <div className="mx-auto w-full max-w-7xl border bg-card">
        <div className="flex flex-col items-center px-4 pt-10 pb-12 text-center">
          <h2 className="type-section-title text-foreground">
            The product you are looking for is sold out (or deleted).
          </h2>

          <NotFoundIllustration className="mt-8 h-[240px] w-auto max-w-full" />

          <Link
            href="/all-ads"
            className="mt-8 type-nav text-[#00a0e9] hover:underline"
          >
            Click here to find other new products currently on sale on
            PhsarKhmer.com.
          </Link>
          <Link
            href="/"
            className="mt-3 type-nav text-foreground hover:underline"
          >
            Click here to go to PhsarKhmer.com Home Page
          </Link>
        </div>

        {categories.length > 0 && (
          <>
            <div className="border-t" />
            <div className="px-4 pt-8 pb-12">
              <h3 className="type-card-heading text-center text-foreground">
                Find Product by Categories
              </h3>
              <div className="mt-8 grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 md:grid-cols-6">
                {categories.map((category) => (
                  <Link
                    key={category.slug}
                    href={{
                      pathname: "/category/[categorySlug]",
                      params: { categorySlug: category.slug },
                    }}
                    className="group flex flex-col items-center text-center"
                  >
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 transition group-hover:bg-blue-200">
                      {category.icon ? (
                        <DbImage
                          src={category.icon}
                          alt={category.name}
                          width={120}
                          height={120}
                          className="object-contain"
                        />
                      ) : (
                        <CategoryIconFallback />
                      )}
                    </div>
                    <span className="mt-4 type-body-sm text-foreground">
                      {category.name}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

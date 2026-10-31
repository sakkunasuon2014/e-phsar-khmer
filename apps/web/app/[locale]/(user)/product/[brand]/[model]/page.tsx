import type { Metadata } from "next";
import { BadgeCheck } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import DbImage from "@/components/common/DbImage";
import { GridCardPost } from "@/components/ads/GridCardPost";
import { getListingsFeed, toCardPost } from "@/lib/api/categories";
import { getProduct } from "@/lib/api/products";

const FAMILY_LABELS: Record<string, string> = {
  car: "Cars",
  motorcycle: "Motorcycles",
  phone: "Phones",
  tablet: "Tablets",
  smartwatch: "Smart Watches",
};

/** Best-effort powertrain chip from the spec sheet's own Fuel Type row. */
function fuelTypeOf(
  groups: { rows: { label: string; value: string }[] }[],
): string | null {
  for (const group of groups) {
    for (const row of group.rows) {
      if (/^fuel(?:\s+type)?$/i.test(row.label.trim())) return row.value;
    }
  }
  return null;
}

/**
 * Fold consecutive rows sharing a label into one entry. A multi-value field
 * (a phone's 4G bands per regional model) is stored as several rows with the
 * same label; the page shows the label once and each value on its own line.
 */
function foldRows(rows: { label: string; value: string }[]): {
  label: string;
  values: string[];
}[] {
  const out: { label: string; values: string[] }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.label === row.label) last.values.push(row.value);
    else out.push({ label: row.label, values: [row.value] });
  }
  return out;
}

type ProductPageParams = Promise<{ brand: string; model: string }>;

export async function generateMetadata({
  params,
}: {
  params: ProductPageParams;
}): Promise<Metadata> {
  const { brand, model } = await params;
  const [product, t] = await Promise.all([
    getProduct(brand, model),
    getTranslations("Product"),
  ]);
  if (!product) return { title: t("notFound") };
  return {
    title: t("metaTitle", {
      brand: product.brandName,
      model: product.modelName,
    }),
    description: t("metaDescription", {
      brand: product.brandName,
      model: product.modelName,
    }),
  };
}

export default async function ProductPage({
  params,
}: {
  params: ProductPageParams;
}) {
  const { brand, model } = await params;
  const locale = await getLocale();
  const [product, t] = await Promise.all([
    getProduct(brand, model),
    getTranslations("Product"),
  ]);
  if (!product) notFound();

  const feed = await getListingsFeed(
    { brand: product.brandName, model: product.modelName, limit: 4 },
    locale,
  );
  const posts = (feed?.items ?? []).map(toCardPost);
  const fuelType = fuelTypeOf(product.specGroups);

  return (
    <main className="product-type min-h-screen bg-muted pb-8">
      <div className="px-4 py-4">
        <Breadcrumbs
          className="mx-auto w-full max-w-7xl"
          items={[
            { label: t("home"), href: "/" },
            { label: `${product.brandName} ${product.modelName}` },
          ]}
        />
      </div>

      <div className="mx-auto w-full max-w-7xl space-y-4 px-4 xl:px-0">
        <header className="overflow-hidden rounded-sm border border-border bg-card">
          <div className="grid gap-6 p-6 md:grid-cols-[minmax(320px,420px)_1fr] md:items-center">
            <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md bg-muted/40 p-4">
              <DbImage
                src={product.image ?? ""}
                alt={`${product.brandName} ${product.modelName}`}
                width={768}
                height={512}
                className="h-full w-full object-contain"
                fallback={
                  <span className="type-page-title text-muted-foreground">
                    {product.brandName.charAt(0).toUpperCase()}
                  </span>
                }
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <p className="type-body-sm uppercase tracking-[0.08em] text-muted-foreground">
                  {product.brandName}
                </p>
                <span className="inline-flex items-center gap-1 rounded-full border border-[#00a0e9]/30 bg-[#00a0e9]/10 px-2.5 py-1 type-meta text-[#00a0e9]">
                  <BadgeCheck className="size-3.5" />
                  {t("trustedBadge")}
                </span>
              </div>
              <h1 className="type-page-title mt-2 text-foreground">
                {product.modelName}
              </h1>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-3 py-1 type-meta text-foreground">
                  {FAMILY_LABELS[product.family] ?? product.family}
                </span>
                {fuelType ? (
                  <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-3 py-1 type-meta text-foreground">
                    {fuelType}
                  </span>
                ) : null}
              </div>
              <p className="type-body-sm mt-4 max-w-prose text-muted-foreground">
                {t("trustedNote")}
              </p>
            </div>
          </div>
        </header>

        <section className="rounded-sm border border-border bg-card p-6">
          <h2 className="type-section-title text-foreground">
            {t("specifications")}
          </h2>
          {/* One section per row, full width (captain, 2026-10-31): stacked
              cards read as one continuous spec sheet, not a two-column
              comparison of unrelated sections. */}
          <div className="mt-5 space-y-4">
            {product.specGroups.map((group, groupIndex) => (
              <div
                key={`${group.title}-${groupIndex}`}
                className="rounded-md border border-border/70 bg-background/40 p-4"
              >
                <h3 className="type-card-heading flex items-center gap-2 text-foreground">
                  <span
                    className="inline-block h-4 w-1 rounded-full bg-[#00a0e9]"
                    aria-hidden
                  />
                  {group.title}
                </h3>
                <dl className="mt-2 divide-y divide-border">
                  {foldRows(group.rows).map((row, rowIndex) => (
                    <div
                      key={`${row.label}-${rowIndex}`}
                      className="grid grid-cols-[minmax(120px,40%)_1fr] gap-4 py-2.5"
                    >
                      <dt className="type-body-sm text-muted-foreground">
                        {row.label}
                      </dt>
                      <dd className="type-body flex flex-col divide-y divide-border text-foreground">
                        {row.values.map((value, valueIndex) => (
                          // The divider matches the row separators and spans
                          // the value column only (the `dd`), with breathing
                          // room above and below instead of touching the text.
                          <span
                            key={valueIndex}
                            className="block py-2 first:pt-0 last:pb-0"
                          >
                            {value}
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-sm border border-border bg-card p-4">
          <h2 className="type-section-title text-foreground">
            {t("activeAds")}
          </h2>
          {posts.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
              {posts.map((post) => (
                <GridCardPost key={post.postId} post={post} />
              ))}
            </div>
          ) : (
            <p className="mt-2 type-body-sm text-muted-foreground">
              {t("noActiveAds")}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

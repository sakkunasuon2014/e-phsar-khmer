import { Link } from "@/i18n/routing";
import DbImage from "@/components/common/DbImage";
import type { ProductSummary } from "@/types/product";

/**
 * A trusted spec page in search results. Server component: the label is passed
 * in by the page so this file stays free of i18n hooks.
 */
export function ProductCard({
  product,
  viewSpecsLabel,
}: {
  product: ProductSummary;
  viewSpecsLabel: string;
}) {
  return (
    <Link
      href={{
        pathname: "/product/[brand]/[model]",
        params: { brand: product.brandSlug, model: product.modelSlug },
      }}
      className="group flex flex-col overflow-hidden rounded-sm border border-border bg-card transition-shadow hover:shadow-sm"
    >
      <div className="flex aspect-square items-center justify-center bg-muted/40 p-4">
        <DbImage
          src={product.image ?? ""}
          alt={product.modelName}
          width={160}
          height={160}
          className="object-contain"
          fallback={
            <span className="type-page-title text-muted-foreground">
              {product.brandName.charAt(0).toUpperCase()}
            </span>
          }
        />
      </div>
      <div className="space-y-1 p-3">
        <p className="type-meta text-muted-foreground">{product.brandName}</p>
        <p className="type-card-heading line-clamp-1 text-foreground">
          {product.modelName}
        </p>
        <p className="type-body-sm text-sky-600 group-hover:underline">
          {viewSpecsLabel}
        </p>
      </div>
    </Link>
  );
}

import { notFound } from "next/navigation";
import { ProductSpecsPage } from "@/components/dashboard/product-specs-page";
import { familyPage } from "@/lib/product-spec-families";

/** Five fixed family pages; anything else is a 404. */
export default async function ProductSpecsRoute({
  params,
}: {
  params: Promise<{ family: string }>;
}) {
  const { family } = await params;
  const config = familyPage(family);
  if (!config) notFound();

  return (
    <ProductSpecsPage
      family={config.family}
      label={config.label}
      subcategorySlug={config.subcategorySlug}
    />
  );
}

CREATE TYPE "public"."product_spec_family" AS ENUM('car', 'motorcycle', 'phone', 'tablet', 'smartwatch');--> statement-breakpoint
ALTER TABLE "product_specs" ADD COLUMN "family" "product_spec_family";--> statement-breakpoint
UPDATE "product_specs" ps
SET "family" = CASE sub.slug
  WHEN 'cars-for-sale' THEN 'car'::"public"."product_spec_family"
  WHEN 'motorcycles-for-sale' THEN 'motorcycle'::"public"."product_spec_family"
  WHEN 'phones' THEN 'phone'::"public"."product_spec_family"
  WHEN 'tablets' THEN 'tablet'::"public"."product_spec_family"
  WHEN 'smart-watches' THEN 'smartwatch'::"public"."product_spec_family"
  ELSE 'phone'::"public"."product_spec_family"
END
FROM (
  SELECT msl.model_id, min(s.slug) AS slug
  FROM model_subcategory_links msl
  JOIN subcategories s ON s.id = msl.subcategory_id
  WHERE s.slug IN ('cars-for-sale','motorcycles-for-sale','phones','tablets','smart-watches')
  GROUP BY msl.model_id
  HAVING count(DISTINCT s.slug) = 1
) sub
WHERE ps.model_id = sub.model_id;--> statement-breakpoint
UPDATE "product_specs" SET "family" = 'phone' WHERE "family" IS NULL;--> statement-breakpoint
ALTER TABLE "product_specs" ALTER COLUMN "family" SET NOT NULL;
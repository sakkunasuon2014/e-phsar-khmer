CREATE TYPE "public"."subscription_tier" AS ENUM('bronze', 'silver', 'gold');--> statement-breakpoint
ALTER TABLE "subscription_packages" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "subscription_packages" ADD COLUMN "tier" "public"."subscription_tier";--> statement-breakpoint
-- Guard: every package must map cleanly to a (group, tier) pair. Fail loudly
-- before any data is rewritten rather than guessing a name or tripping the
-- unique index halfway through.
DO $$
DECLARE
  bad text;
  dup text;
BEGIN
  SELECT string_agg(DISTINCT format('%s (%s/%s)', p."name", c."name", p."slug"), ', ')
    INTO bad
  FROM "subscription_plans" p
  JOIN "subscription_categories" c ON c."id" = p."category_id"
  JOIN "subscription_packages" k ON k."plan_id" = p."id"
  WHERE lower(btrim(p."name")) NOT IN ('bronze', 'silver', 'gold');

  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'subscription collapse: plan name(s) cannot map to a tier: %', bad;
  END IF;

  SELECT string_agg(format('%s/%s x%s', c."name", d."tier", d."n"), ', ')
    INTO dup
  FROM (
    SELECT p."category_id", lower(btrim(p."name")) AS "tier", count(*) AS "n"
    FROM "subscription_packages" k
    JOIN "subscription_plans" p ON p."id" = k."plan_id"
    GROUP BY 1, 2
    HAVING count(*) > 1
  ) d
  JOIN "subscription_categories" c ON c."id" = d."category_id";

  IF dup IS NOT NULL THEN
    RAISE EXCEPTION
      'subscription collapse: multiple packages map to one category/tier: %', dup;
  END IF;
END $$;--> statement-breakpoint
UPDATE "subscription_packages" AS k
SET "category_id" = p."category_id",
    "tier" = lower(btrim(p."name"))::"public"."subscription_tier"
FROM "subscription_plans" AS p
WHERE k."plan_id" = p."id";--> statement-breakpoint
ALTER TABLE "subscription_packages" ALTER COLUMN "category_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_packages" ALTER COLUMN "tier" SET NOT NULL;--> statement-breakpoint
-- All seeded packages had sort_order 0; make tier order the catalog order.
UPDATE "subscription_packages"
SET "sort_order" = CASE "tier"
  WHEN 'bronze' THEN 0 WHEN 'silver' THEN 1 ELSE 2 END;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_packages" ADD CONSTRAINT "subscription_packages_category_id_subscription_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."subscription_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_packages_category_id_idx" ON "subscription_packages" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_packages_category_tier_uq" ON "subscription_packages" USING btree ("category_id","tier");--> statement-breakpoint
-- The offer catalog now sells fixed 3/6/12-month terms: normalize year terms
-- to months, then retire everything else (rows kept; live subscriptions keep
-- working through their frozen offer snapshot).
UPDATE "subscription_terms"
SET "duration_value" = "duration_value" * 12,
    "duration_unit" = 'month'
WHERE "duration_unit" = 'year';--> statement-breakpoint
UPDATE "subscription_terms"
SET "is_active" = false
WHERE NOT ("duration_unit" = 'month' AND "duration_value" IN (3, 6, 12));--> statement-breakpoint
UPDATE "subscription_terms"
SET "sort_order" = CASE "duration_value"
  WHEN 3 THEN 0 WHEN 6 THEN 1 WHEN 12 THEN 2 END
WHERE "duration_unit" = 'month' AND "duration_value" IN (3, 6, 12);--> statement-breakpoint
ALTER TABLE "subscription_packages" DROP CONSTRAINT "subscription_packages_plan_id_subscription_plans_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "subscription_packages_plan_id_idx";--> statement-breakpoint
ALTER TABLE "subscription_packages" DROP COLUMN IF EXISTS "plan_id";--> statement-breakpoint
DROP TABLE "subscription_plans" CASCADE;

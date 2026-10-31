CREATE TABLE IF NOT EXISTS "free_plan_ad_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid,
	"subcategory_id" uuid,
	"ads" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "free_plan_ad_limits_one_scope" CHECK (("free_plan_ad_limits"."category_id" is null) <> ("free_plan_ad_limits"."subcategory_id" is null)),
	CONSTRAINT "free_plan_ad_limits_ads_nonnegative" CHECK ("free_plan_ad_limits"."ads" >= 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "free_plan_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"photos" integer DEFAULT 0 NOT NULL,
	"renews" integer DEFAULT 0 NOT NULL,
	"auto_renews" integer DEFAULT 0 NOT NULL,
	"videos" integer DEFAULT 0 NOT NULL,
	"other_ads" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "free_plan_settings_singleton" CHECK ("free_plan_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_category_subcategories" (
	"subscription_category_id" uuid NOT NULL,
	"subcategory_id" uuid NOT NULL,
	CONSTRAINT "subscription_category_subcategories_subscription_category_id_subcategory_id_pk" PRIMARY KEY("subscription_category_id","subcategory_id")
);
--> statement-breakpoint
DROP INDEX IF EXISTS "user_subscriptions_one_current_uq";--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN "subscription_category_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "free_plan_ad_limits" ADD CONSTRAINT "free_plan_ad_limits_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "free_plan_ad_limits" ADD CONSTRAINT "free_plan_ad_limits_subcategory_id_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."subcategories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_category_subcategories" ADD CONSTRAINT "subscription_category_subcategories_subscription_category_id_subscription_categories_id_fk" FOREIGN KEY ("subscription_category_id") REFERENCES "public"."subscription_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_category_subcategories" ADD CONSTRAINT "subscription_category_subcategories_subcategory_id_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."subcategories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "free_plan_ad_limits_category_uq" ON "free_plan_ad_limits" USING btree ("category_id") WHERE "free_plan_ad_limits"."category_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "free_plan_ad_limits_subcategory_uq" ON "free_plan_ad_limits" USING btree ("subcategory_id") WHERE "free_plan_ad_limits"."subcategory_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_category_subcategories_subcategory_uq" ON "subscription_category_subcategories" USING btree ("subcategory_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_subscriptions" ADD CONSTRAINT "user_subscriptions_subscription_category_id_subscription_categories_id_fk" FOREIGN KEY ("subscription_category_id") REFERENCES "public"."subscription_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Backfill each subscription's group through its term; a row whose term was
-- deleted stays NULL (it no longer covers anything).
UPDATE "user_subscriptions" us
SET "subscription_category_id" = p."category_id"
FROM "subscription_terms" t
JOIN "subscription_packages" k ON k."id" = t."package_id"
JOIN "subscription_plans" p ON p."id" = k."plan_id"
WHERE us."term_id" = t."id" AND us."subscription_category_id" IS NULL;--> statement-breakpoint
-- Retire extra current rows per (user, group) before enforcing one: keep the
-- row that runs latest, supersede the rest as history (never delete).
WITH ranked AS (
	SELECT "id", "expires_at",
		row_number() OVER (PARTITION BY "user_id", "subscription_category_id" ORDER BY "expires_at" DESC, "subscribed_at" DESC) AS rn
	FROM "user_subscriptions"
	WHERE "superseded_at" IS NULL AND "subscription_category_id" IS NOT NULL
)
UPDATE "user_subscriptions" us
SET "superseded_at" = now(),
	"superseded_reason" = CASE WHEN ranked."expires_at" <= now() THEN 'expired' ELSE 'replaced' END
FROM ranked
WHERE us."id" = ranked."id" AND ranked.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_subscriptions_one_current_per_group_uq" ON "user_subscriptions" USING btree ("user_id","subscription_category_id") WHERE "user_subscriptions"."superseded_at" is null;
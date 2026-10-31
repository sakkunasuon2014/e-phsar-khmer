CREATE TYPE "public"."advertisement_placement" AS ENUM('home', 'all_ads', 'category', 'subcategory', 'listing_detail');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "advertisements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"placement" "advertisement_placement" NOT NULL,
	"image_path" text NOT NULL,
	"link_url" text,
	"alt_text" varchar(200) DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "advertisements" ADD CONSTRAINT "advertisements_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "advertisements_placement_idx" ON "advertisements" USING btree ("placement","is_active","sort_order");
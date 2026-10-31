CREATE TABLE IF NOT EXISTS "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" varchar(150) NOT NULL,
	"phone" varchar(32) NOT NULL,
	"email" varchar(255),
	"description" text NOT NULL,
	"image_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "moderated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "moderated_by_id" uuid;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "moderation_reason" varchar(500);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_created_at_idx" ON "feedback" USING btree ("created_at");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_moderated_by_id_users_id_fk" FOREIGN KEY ("moderated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Before enforcing one pending report per (reporter, target): keep the oldest
-- pending duplicate open and close the rest as rejected (never delete).
WITH ranked AS (
	SELECT "id", row_number() OVER (PARTITION BY "reporter_id", "listing_id" ORDER BY "created_at", "id") AS rn
	FROM "listing_reports" WHERE "status" = 'pending'
)
UPDATE "listing_reports" r SET "status" = 'rejected' FROM ranked WHERE r."id" = ranked."id" AND ranked.rn > 1;--> statement-breakpoint
WITH ranked AS (
	SELECT "id", row_number() OVER (PARTITION BY "reporter_id", "target_user_id" ORDER BY "created_at", "id") AS rn
	FROM "user_reports" WHERE "status" = 'pending'
)
UPDATE "user_reports" r SET "status" = 'rejected' FROM ranked WHERE r."id" = ranked."id" AND ranked.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "listing_reports_pending_uq" ON "listing_reports" USING btree ("reporter_id","listing_id") WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_reports_pending_uq" ON "user_reports" USING btree ("reporter_id","target_user_id") WHERE status = 'pending';
ALTER TYPE "public"."listing_status" ADD VALUE 'restricted';--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "renew_count" integer DEFAULT 0 NOT NULL;
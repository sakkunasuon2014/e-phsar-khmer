CREATE TABLE IF NOT EXISTS "product_specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"spec_groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "product_model_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "product_specs" ADD CONSTRAINT "product_specs_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "product_specs_model_id_uq" ON "product_specs" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "product_specs_is_published_idx" ON "product_specs" USING btree ("is_published");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_product_model_id_models_id_fk" FOREIGN KEY ("product_model_id") REFERENCES "public"."models"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_product_model_id_idx" ON "listings" USING btree ("product_model_id");
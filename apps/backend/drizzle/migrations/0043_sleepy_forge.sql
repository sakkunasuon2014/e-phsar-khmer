CREATE TABLE IF NOT EXISTS "billing_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" varchar(80) NOT NULL,
	"category" varchar(16) NOT NULL,
	"name" varchar(200) NOT NULL,
	"company" varchar(200),
	"email" varchar(254),
	"phone" varchar(32) NOT NULL,
	"address" text NOT NULL,
	"province_id" uuid,
	"district_id" uuid,
	"commune_id" uuid,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"tax_id" varchar(60),
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_addresses_category_check" CHECK ("billing_addresses"."category" in ('home', 'work', 'other'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_addresses" ADD CONSTRAINT "billing_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_addresses" ADD CONSTRAINT "billing_addresses_province_id_provinces_id_fk" FOREIGN KEY ("province_id") REFERENCES "public"."provinces"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_addresses" ADD CONSTRAINT "billing_addresses_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_addresses" ADD CONSTRAINT "billing_addresses_commune_id_communes_id_fk" FOREIGN KEY ("commune_id") REFERENCES "public"."communes"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_addresses_user_id_idx" ON "billing_addresses" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_addresses_default_uq" ON "billing_addresses" USING btree ("user_id") WHERE "billing_addresses"."is_default";
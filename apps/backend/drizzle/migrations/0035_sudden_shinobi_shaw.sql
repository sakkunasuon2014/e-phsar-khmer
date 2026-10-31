CREATE TYPE "public"."subscription_purchase_kind" AS ENUM('initial', 'upgrade', 'manual_comp');--> statement-breakpoint
CREATE TYPE "public"."subscription_purchase_status" AS ENUM('pending', 'paid', 'failed', 'cancelled', 'refunded');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscription_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"term_id" uuid,
	"payment_transaction_id" uuid,
	"kind" "subscription_purchase_kind" DEFAULT 'initial' NOT NULL,
	"status" "subscription_purchase_status" DEFAULT 'pending' NOT NULL,
	"amount_usd" numeric(10, 2) NOT NULL,
	"credit_usd" numeric(10, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"offer_snapshot" jsonb NOT NULL,
	"replaces_subscription_id" uuid,
	"subscription_id" uuid,
	"idempotency_key" varchar(200),
	"paid_at" timestamp with time zone,
	"refund_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_purchases_payment_transaction_id_unique" UNIQUE("payment_transaction_id"),
	CONSTRAINT "subscription_purchases_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN "superseded_reason" varchar(40);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_purchases" ADD CONSTRAINT "subscription_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_purchases" ADD CONSTRAINT "subscription_purchases_term_id_subscription_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."subscription_terms"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_purchases" ADD CONSTRAINT "subscription_purchases_replaces_subscription_id_user_subscriptions_id_fk" FOREIGN KEY ("replaces_subscription_id") REFERENCES "public"."user_subscriptions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscription_purchases" ADD CONSTRAINT "subscription_purchases_subscription_id_user_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."user_subscriptions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_purchases_user_idx" ON "subscription_purchases" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_purchases_status_idx" ON "subscription_purchases" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_subscriptions_active_idx" ON "user_subscriptions" USING btree ("user_id","expires_at") WHERE "user_subscriptions"."superseded_at" is null;
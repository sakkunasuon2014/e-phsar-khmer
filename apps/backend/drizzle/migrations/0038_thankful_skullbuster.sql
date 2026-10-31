-- Retire extra current rows before enforcing one per user: keep the row that
-- runs latest, supersede the rest as history (never delete).
WITH ranked AS (
	SELECT "id", "expires_at",
		row_number() OVER (PARTITION BY "user_id" ORDER BY "expires_at" DESC, "subscribed_at" DESC) AS rn
	FROM "user_subscriptions"
	WHERE "superseded_at" IS NULL
)
UPDATE "user_subscriptions" us
SET "superseded_at" = now(),
	"superseded_reason" = CASE WHEN ranked."expires_at" <= now() THEN 'expired' ELSE 'replaced' END
FROM ranked
WHERE us."id" = ranked."id" AND ranked.rn > 1;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_subscriptions_one_current_uq" ON "user_subscriptions" USING btree ("user_id") WHERE "user_subscriptions"."superseded_at" is null;

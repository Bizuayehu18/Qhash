CREATE TABLE IF NOT EXISTS "profiles" (
	"id" text PRIMARY KEY,
	"username" text NOT NULL UNIQUE,
	"phone" text NOT NULL UNIQUE,
	"referred_by" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"referrer_id" text NOT NULL,
	"referred_user_id" text NOT NULL,
	"level" integer NOT NULL,
	"total_investment_rewards" double precision DEFAULT 0 NOT NULL,
	"total_mining_rewards" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_referral_pair" UNIQUE("referrer_id","referred_user_id"),
	CONSTRAINT "chk_no_self_refer" CHECK ("referrer_id" <> "referred_user_id"),
	CONSTRAINT "chk_level_range" CHECK ("level" >= 1 AND "level" <= 3)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_referrals_referrer_id" ON "referrals" ("referrer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_referrals_referred_user_id" ON "referrals" ("referred_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_referrals_referred_user_level" ON "referrals" ("referred_user_id","level");

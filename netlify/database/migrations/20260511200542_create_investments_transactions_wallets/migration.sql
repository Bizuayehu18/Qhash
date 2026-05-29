CREATE TYPE "investment_status" AS ENUM('active', 'completed');--> statement-breakpoint
CREATE TYPE "transaction_status" AS ENUM('completed', 'pending', 'failed');--> statement-breakpoint
CREATE TYPE "transaction_type" AS ENUM('deposit', 'withdrawal', 'investment', 'earning', 'referral', 'admin_adjustment');--> statement-breakpoint
CREATE TABLE "investments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"invested_amount" double precision NOT NULL,
	"daily_earning" double precision NOT NULL,
	"start_date" timestamp DEFAULT now() NOT NULL,
	"end_date" timestamp NOT NULL,
	"status" "investment_status" DEFAULT 'active'::"investment_status" NOT NULL,
	"last_earning_at" timestamp,
	"total_earned" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"type" "transaction_type" NOT NULL,
	"amount" double precision NOT NULL,
	"status" "transaction_status" DEFAULT 'completed'::"transaction_status" NOT NULL,
	"description" text,
	"reference_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"user_id" text PRIMARY KEY,
	"balance" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

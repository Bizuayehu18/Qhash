ALTER TABLE "transactions" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "transaction_type";--> statement-breakpoint
CREATE TYPE "transaction_type" AS ENUM('deposit', 'withdrawal', 'investment', 'earning', 'admin_adjustment');--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "type" SET DATA TYPE "transaction_type" USING "type"::"transaction_type";
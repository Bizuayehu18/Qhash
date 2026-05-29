ALTER TYPE "investment_status" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE INDEX "investments_user_id_idx" ON "investments" ("user_id");--> statement-breakpoint
CREATE INDEX "investments_user_status_idx" ON "investments" ("user_id","status");--> statement-breakpoint
CREATE INDEX "transactions_user_id_idx" ON "transactions" ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_user_type_idx" ON "transactions" ("user_id","type");
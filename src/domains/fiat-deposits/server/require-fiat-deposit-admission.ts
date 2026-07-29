import type { SupabaseClient } from "@supabase/supabase-js";
import { readGlobalDepositAdmission } from "../../deposits/server.ts";
import type { Database } from "../../../lib/database.types.ts";
import { throwSafe } from "../../../lib/errors.ts";

export async function requireFiatDepositAdmission(
  admin: SupabaseClient<Database>,
): Promise<void> {
  const decision = await readGlobalDepositAdmission(admin);
  if (decision.status === "open") return;

  if (decision.status === "paused") {
    throwSafe(
      "DEPOSIT",
      "Deposits are currently paused. Please try again later.",
      "Global deposit pause is enabled",
    );
  }

  throwSafe(
    "DEPOSIT",
    "Deposits are temporarily unavailable. Please try again later.",
    decision.reason === "read_failed"
      ? "Deposit availability configuration is unavailable"
      : "Deposit availability configuration is malformed",
  );
}

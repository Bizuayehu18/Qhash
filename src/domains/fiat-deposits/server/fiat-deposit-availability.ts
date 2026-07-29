import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../lib/database.types.js";
import { throwSafe } from "../../../lib/errors.js";

export async function requireFiatDepositsAvailable(
  admin: SupabaseClient<Database>,
): Promise<void> {
  const { data: depositSettings, error: depositSettingsError } = await admin
    .from("app_settings")
    .select("key, value")
    .eq("key", "deposits_paused")
    .limit(2);

  if (
    depositSettingsError
    || !Array.isArray(depositSettings)
    || depositSettings.length !== 1
  ) {
    throwSafe(
      "DEPOSIT",
      "Deposits are temporarily unavailable. Please try again later.",
      "Deposit availability configuration is unavailable",
    );
  }

  const depositPauseValue = depositSettings[0]?.value;
  if (depositPauseValue === "true") {
    throwSafe(
      "DEPOSIT",
      "Deposits are currently paused. Please try again later.",
      "Global deposit pause is enabled",
    );
  }

  if (depositPauseValue !== "false") {
    throwSafe(
      "DEPOSIT",
      "Deposits are temporarily unavailable. Please try again later.",
      "Deposit availability configuration is malformed",
    );
  }
}

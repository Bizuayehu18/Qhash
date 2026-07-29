import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../lib/database.types.ts";
import {
  GLOBAL_DEPOSIT_PAUSE_SETTING_KEY,
  GLOBAL_DEPOSIT_PAUSE_SETTING_LIMIT,
  parseGlobalDepositAdmission,
  type DepositAdmissionDecision,
} from "../domain/deposit-admission-policy.ts";

export async function readGlobalDepositAdmission(
  admin: SupabaseClient<Database>,
): Promise<DepositAdmissionDecision> {
  try {
    const { data, error } = await admin
      .from("app_settings")
      .select("key, value")
      .eq("key", GLOBAL_DEPOSIT_PAUSE_SETTING_KEY)
      .limit(GLOBAL_DEPOSIT_PAUSE_SETTING_LIMIT);

    if (error) {
      return { status: "unavailable", reason: "read_failed" };
    }

    return parseGlobalDepositAdmission(data);
  } catch {
    return { status: "unavailable", reason: "read_failed" };
  }
}

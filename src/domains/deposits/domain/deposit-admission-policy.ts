import { isNonNullNonArrayObject } from "../../../shared/validation/non-null-non-array-object.ts";

export const GLOBAL_DEPOSIT_PAUSE_SETTING_KEY = "deposits_paused" as const;
export const GLOBAL_DEPOSIT_PAUSE_SETTING_LIMIT = 2 as const;

export type DepositAdmissionDecision =
  | Readonly<{ status: "open" }>
  | Readonly<{ status: "paused" }>
  | Readonly<{
      status: "unavailable";
      reason: "read_failed" | "invalid_configuration";
    }>;

export function parseGlobalDepositAdmission(
  rows: unknown,
): DepositAdmissionDecision {
  if (
    !Array.isArray(rows)
    || rows.length !== 1
    || !isNonNullNonArrayObject(rows[0])
  ) {
    return { status: "unavailable", reason: "invalid_configuration" };
  }

  const row = rows[0];
  if (
    row.key !== GLOBAL_DEPOSIT_PAUSE_SETTING_KEY
    || (row.value !== "true" && row.value !== "false")
  ) {
    return { status: "unavailable", reason: "invalid_configuration" };
  }

  return row.value === "true" ? { status: "paused" } : { status: "open" };
}

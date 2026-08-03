import type { NowpaymentsAdminWithdrawalStatus } from "../../application/admin-usdt-withdrawal-browser-service.js";

const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;

export const ADMIN_USDT_WITHDRAWAL_FILTERS = [
  "pending",
  "completed",
  "rejected",
] as const satisfies readonly NowpaymentsAdminWithdrawalStatus[];

export const ADMIN_USDT_WITHDRAWAL_STATUS_LABELS: Record<
  NowpaymentsAdminWithdrawalStatus,
  string
> = {
  pending: "Pending",
  completed: "Completed",
  rejected: "Rejected",
};

export const ADMIN_USDT_WITHDRAWAL_STATUS_VARIANTS: Record<
  NowpaymentsAdminWithdrawalStatus,
  "warning" | "success" | "default"
> = {
  pending: "warning",
  completed: "success",
  rejected: "default",
};

export function formatAdminUsdtSix(value: string): string {
  if (!DECIMAL_PATTERN.test(value)) return "0";
  const [integer, fraction = ""] = value.split(".");
  const flooredFraction = fraction.slice(0, 6).padEnd(6, "0").replace(/0+$/, "");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return flooredFraction ? `${grouped}.${flooredFraction}` : grouped;
}

export function normalizeOptionalAdminUsdtTransactionHash(
  value: string,
): string | null {
  const normalized = value.trim().toLowerCase();
  return normalized === "" || HASH_PATTERN.test(normalized)
    ? normalized
    : null;
}

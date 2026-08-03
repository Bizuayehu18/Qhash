import type { AdminFiatDepositStatusFilter } from "../../application/admin-fiat-deposit-operations-auth-lifecycle.js";

export const ADMIN_FIAT_DEPOSIT_FILTERS: ReadonlyArray<Readonly<{
  key: AdminFiatDepositStatusFilter;
  label: string;
}>> = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

export const ADMIN_FIAT_DEPOSIT_METHOD_LABELS: Readonly<
  Record<string, string>
> = {
  cbe: "CBE",
  telebirr: "TeleBirr",
};

export const ADMIN_FIAT_DEPOSIT_STATUS: Readonly<Record<
  string,
  Readonly<{
    label: string;
    variant: "success" | "warning" | "danger" | "default";
  }>
>> = {
  approved: { label: "Approved", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  rejected: { label: "Rejected", variant: "danger" },
};

export function parseAdminFiatDepositVerifiedAmount(
  value: string,
): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function requiresManualFiatDepositReview(
  adminNote: string | null | undefined,
): boolean {
  return adminNote?.startsWith("Verifier review:") === true;
}

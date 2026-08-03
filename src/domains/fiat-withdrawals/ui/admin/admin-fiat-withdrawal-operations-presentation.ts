import type { AdminFiatWithdrawalStatusFilter } from "../../application/admin-fiat-withdrawal-operations-auth-lifecycle.js";

export const ADMIN_FIAT_WITHDRAWAL_METHOD_LABELS: Record<string, string> = {
  cbe: "CBE",
  telebirr: "TeleBirr",
};

export const ADMIN_FIAT_WITHDRAWAL_FILTERS: ReadonlyArray<Readonly<{
  key: AdminFiatWithdrawalStatusFilter;
  label: string;
}>> = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

export const ADMIN_FIAT_WITHDRAWAL_STATUS: Record<string, Readonly<{
  label: string;
  variant: "success" | "warning" | "danger" | "default";
}>> = {
  approved: { label: "Approved", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  rejected: { label: "Rejected", variant: "danger" },
};

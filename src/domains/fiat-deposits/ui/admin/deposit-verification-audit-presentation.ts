import type { DepositVerificationAuditPaymentType } from "../../application/deposit-verification-audit-browser-service.ts";

export const DEPOSIT_VERIFICATION_AUDIT_PAYMENT_TYPES = [
  "all",
  "cbe",
  "telebirr",
] as const satisfies readonly DepositVerificationAuditPaymentType[];

export const DEPOSIT_VERIFICATION_AUDIT_METHOD_LABELS: Readonly<
  Record<Exclude<DepositVerificationAuditPaymentType, "all">, string>
> = {
  cbe: "CBE",
  telebirr: "TeleBirr",
};

export const DEPOSIT_VERIFICATION_AUDIT_ACTION_VARIANTS: Readonly<
  Record<string, "success" | "warning" | "danger" | "default">
> = {
  approve: "success",
  reject: "danger",
  manual_review: "warning",
  skipped: "default",
  error: "danger",
};

export function formatDepositVerificationAuditEntityId(
  id: string | null,
): string {
  if (!id) return "—";
  return id.length <= 8 ? id : id.slice(0, 8);
}

export function formatDepositVerificationAuditPaymentType(
  paymentType: string | null,
): string {
  if (!paymentType) return "—";
  return paymentType === "cbe" || paymentType === "telebirr"
    ? DEPOSIT_VERIFICATION_AUDIT_METHOD_LABELS[paymentType]
    : paymentType;
}

export function formatDepositVerificationAuditEtb(value: number): string {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

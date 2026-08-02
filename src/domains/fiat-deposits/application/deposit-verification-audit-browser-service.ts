import { getDepositVerificationLogsFn } from "@/lib/server/deposit-audit-logs.js";

export const DEPOSIT_VERIFICATION_AUDIT_LIMIT = 100;

export type DepositVerificationAuditPaymentType =
  | "all"
  | "cbe"
  | "telebirr";

export type DepositVerificationAuditLog = Awaited<
  ReturnType<typeof getDepositVerificationLogsFn>
>[number];

export function loadDepositVerificationAudit(
  accessToken: string,
  paymentType: DepositVerificationAuditPaymentType,
): Promise<DepositVerificationAuditLog[]> {
  return getDepositVerificationLogsFn({
    data: {
      accessToken,
      paymentType: paymentType === "all" ? undefined : paymentType,
      limit: DEPOSIT_VERIFICATION_AUDIT_LIMIT,
    },
  });
}

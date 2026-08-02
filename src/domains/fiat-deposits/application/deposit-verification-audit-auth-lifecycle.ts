import {
  createAuthenticatedScopedRequestKey,
  createLatestAuthenticatedScopedRequestGuard,
  createRequestRetryPolicy,
  isSameAuthenticatedScopedRequestKey,
  type AuthenticatedScopedRequestKey,
} from "../../../shared/requests/authenticated-request-lifecycle.ts";
import type { DepositVerificationAuditPaymentType } from "./deposit-verification-audit-browser-service.ts";

export type DepositVerificationAuditRequestKey =
  AuthenticatedScopedRequestKey<DepositVerificationAuditPaymentType>;

export function createDepositVerificationAuditRequestKey(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
  paymentType: DepositVerificationAuditPaymentType,
): DepositVerificationAuditRequestKey | null {
  return createAuthenticatedScopedRequestKey(userId, accessToken, paymentType);
}

export function isSameDepositVerificationAuditRequestKey(
  current: DepositVerificationAuditRequestKey | null,
  expected: DepositVerificationAuditRequestKey | null,
): boolean {
  return isSameAuthenticatedScopedRequestKey(current, expected);
}

export function createLatestDepositVerificationAuditRequestGuard() {
  return createLatestAuthenticatedScopedRequestGuard<
    DepositVerificationAuditPaymentType
  >();
}

export function createDepositVerificationAuditRetryPolicy(
  maxAutoRetries: number,
) {
  return createRequestRetryPolicy(maxAutoRetries);
}

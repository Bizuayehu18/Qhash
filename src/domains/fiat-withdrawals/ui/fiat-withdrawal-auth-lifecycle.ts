import {
  createAuthenticatedRequestIdentity,
  createLatestAuthenticatedRequestGuard,
  isSameAuthenticatedRequestIdentity,
  type AuthenticatedRequestIdentity,
} from "../../../shared/requests/authenticated-request-lifecycle.ts";

export type FiatWithdrawalAuthIdentity = AuthenticatedRequestIdentity;

export function createFiatWithdrawalAuthIdentity(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
): FiatWithdrawalAuthIdentity | null {
  return createAuthenticatedRequestIdentity(userId, accessToken);
}

export function isSameFiatWithdrawalAuthIdentity(
  current: FiatWithdrawalAuthIdentity | null,
  expected: FiatWithdrawalAuthIdentity | null,
): boolean {
  return isSameAuthenticatedRequestIdentity(current, expected);
}

export function createLatestFiatWithdrawalRequestGuard() {
  return createLatestAuthenticatedRequestGuard();
}

export function fiatWithdrawalAuthIdentityMatches(
  current: FiatWithdrawalAuthIdentity | null,
  expected: FiatWithdrawalAuthIdentity | null,
): boolean {
  return current === null && expected === null
    ? true
    : isSameFiatWithdrawalAuthIdentity(current, expected);
}

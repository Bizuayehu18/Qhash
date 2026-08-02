import {
  createAuthenticatedRequestIdentity,
  createLatestAuthenticatedRequestGuard,
  createRequestRetryPolicy,
  isSameAuthenticatedRequestIdentity,
  type AuthenticatedRequestIdentity,
} from "../../../shared/requests/authenticated-request-lifecycle.ts";

export type ReferralsAuthIdentity = AuthenticatedRequestIdentity;

export function createReferralsAuthIdentity(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
): ReferralsAuthIdentity | null {
  return createAuthenticatedRequestIdentity(userId, accessToken);
}

export function isSameReferralsAuthIdentity(
  current: ReferralsAuthIdentity | null,
  expected: ReferralsAuthIdentity | null,
): boolean {
  return isSameAuthenticatedRequestIdentity(current, expected);
}

export function createLatestReferralsRequestGuard() {
  return createLatestAuthenticatedRequestGuard();
}

export function createReferralsRetryPolicy(maxAutoRetries: number) {
  return createRequestRetryPolicy(maxAutoRetries);
}

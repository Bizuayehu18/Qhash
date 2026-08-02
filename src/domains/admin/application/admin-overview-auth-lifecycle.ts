import {
  createAuthenticatedRequestIdentity,
  createLatestAuthenticatedRequestGuard,
  createRequestRetryPolicy,
  isSameAuthenticatedRequestIdentity,
  type AuthenticatedRequestIdentity,
} from "../../../shared/requests/authenticated-request-lifecycle.ts";

export type AdminOverviewAuthIdentity = AuthenticatedRequestIdentity;

export function createAdminOverviewAuthIdentity(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
): AdminOverviewAuthIdentity | null {
  return createAuthenticatedRequestIdentity(userId, accessToken);
}

export function isSameAdminOverviewAuthIdentity(
  current: AdminOverviewAuthIdentity | null,
  expected: AdminOverviewAuthIdentity | null,
): boolean {
  return isSameAuthenticatedRequestIdentity(current, expected);
}

export function createLatestAdminOverviewRequestGuard() {
  return createLatestAuthenticatedRequestGuard();
}

export function createAdminOverviewRetryPolicy(maxAutoRetries: number) {
  return createRequestRetryPolicy(maxAutoRetries);
}

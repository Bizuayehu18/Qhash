import {
  createAuthenticatedRequestIdentity,
  createLatestAuthenticatedRequestGuard,
  createRequestRetryPolicy,
  isSameAuthenticatedRequestIdentity,
  type AuthenticatedRequestIdentity,
} from "../../../shared/requests/authenticated-request-lifecycle.ts";

export type NotificationsAuthIdentity = AuthenticatedRequestIdentity;

export function createNotificationsAuthIdentity(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
): NotificationsAuthIdentity | null {
  return createAuthenticatedRequestIdentity(userId, accessToken);
}

export function isSameNotificationsAuthIdentity(
  current: NotificationsAuthIdentity | null,
  expected: NotificationsAuthIdentity | null,
): boolean {
  return isSameAuthenticatedRequestIdentity(current, expected);
}

export function createLatestNotificationsRequestGuard() {
  return createLatestAuthenticatedRequestGuard();
}

export function createNotificationsRetryPolicy(maxAutoRetries: number) {
  return createRequestRetryPolicy(maxAutoRetries);
}

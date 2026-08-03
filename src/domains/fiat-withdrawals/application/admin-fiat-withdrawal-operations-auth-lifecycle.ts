import {
  createAuthenticatedRequestIdentity,
  createAuthenticatedScopedRequestKey,
  createLatestAuthenticatedRequestGuard,
  createLatestAuthenticatedScopedRequestGuard,
  createRequestRetryPolicy,
  isSameAuthenticatedRequestIdentity,
  isSameAuthenticatedScopedRequestKey,
  type AuthenticatedRequestIdentity,
  type AuthenticatedScopedRequestKey,
} from "../../../shared/requests/authenticated-request-lifecycle.ts";

export type AdminFiatWithdrawalStatusFilter =
  | "all"
  | "pending"
  | "approved"
  | "rejected";

export type AdminFiatWithdrawalAuthIdentity = AuthenticatedRequestIdentity;
export type AdminFiatWithdrawalCatalogKey =
  AuthenticatedScopedRequestKey<AdminFiatWithdrawalStatusFilter>;

export function createAdminFiatWithdrawalAuthIdentity(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
): AdminFiatWithdrawalAuthIdentity | null {
  return createAuthenticatedRequestIdentity(userId, accessToken);
}

export function isSameAdminFiatWithdrawalAuthIdentity(
  current: AdminFiatWithdrawalAuthIdentity | null,
  expected: AdminFiatWithdrawalAuthIdentity | null,
): boolean {
  return isSameAuthenticatedRequestIdentity(current, expected);
}

export function createAdminFiatWithdrawalCatalogKey(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
  statusFilter: AdminFiatWithdrawalStatusFilter,
): AdminFiatWithdrawalCatalogKey | null {
  return createAuthenticatedScopedRequestKey(
    userId,
    accessToken,
    statusFilter,
  );
}

export function isSameAdminFiatWithdrawalCatalogKey(
  current: AdminFiatWithdrawalCatalogKey | null,
  expected: AdminFiatWithdrawalCatalogKey | null,
): boolean {
  return isSameAuthenticatedScopedRequestKey(current, expected);
}

export function createLatestAdminFiatWithdrawalCatalogGuard() {
  return createLatestAuthenticatedScopedRequestGuard<
    AdminFiatWithdrawalStatusFilter
  >();
}

export function createLatestAdminFiatWithdrawalReviewGuard() {
  return createLatestAuthenticatedRequestGuard();
}

export function createAdminFiatWithdrawalRetryPolicy(maxRetries: number) {
  return createRequestRetryPolicy(maxRetries);
}

export type AdminFiatWithdrawalScopedValue<T> = Readonly<{
  identity: AdminFiatWithdrawalAuthIdentity;
  value: T;
}>;

export function createAdminFiatWithdrawalScopedValue<T>(
  identity: AdminFiatWithdrawalAuthIdentity,
  value: T,
): AdminFiatWithdrawalScopedValue<T> {
  return { identity, value };
}

export function readAdminFiatWithdrawalScopedValue<T>(
  scopedValue: AdminFiatWithdrawalScopedValue<T> | null,
  identity: AdminFiatWithdrawalAuthIdentity | null,
): T | null {
  return scopedValue
    && isSameAdminFiatWithdrawalAuthIdentity(scopedValue.identity, identity)
    ? scopedValue.value
    : null;
}

export type AdminFiatWithdrawalReviewKey = Readonly<{
  fingerprint: string;
  identity: AdminFiatWithdrawalAuthIdentity;
  withdrawalId: string;
}>;

type AdminFiatWithdrawalReviewFlight<T> = Readonly<{
  key: AdminFiatWithdrawalReviewKey;
  promise: Promise<T>;
}>;

export function createAdminFiatWithdrawalReviewFlights() {
  let active: AdminFiatWithdrawalReviewFlight<unknown>[] = [];

  const sameCommand = (
    current: AdminFiatWithdrawalReviewKey,
    expected: AdminFiatWithdrawalReviewKey,
  ) => current.identity.userId === expected.identity.userId
    && current.withdrawalId === expected.withdrawalId;

  const waitForMatchingFlights = async (
    matches: (flight: AdminFiatWithdrawalReviewFlight<unknown>) => boolean,
  ): Promise<void> => {
    while (true) {
      const matchingFlights = active.filter(matches);
      if (matchingFlights.length === 0) return;

      await Promise.all(matchingFlights.map((flight) => flight.promise.then(
        () => undefined,
        () => undefined,
      )));
    }
  };

  return {
    run<T>(
      key: AdminFiatWithdrawalReviewKey,
      operation: () => Promise<T>,
    ): Promise<T> | null {
      const existing = active.find((flight) => sameCommand(flight.key, key));
      if (existing) {
        return existing.key.fingerprint === key.fingerprint
          ? existing.promise as Promise<T>
          : null;
      }

      const promise = Promise.resolve().then(operation);
      const flight: AdminFiatWithdrawalReviewFlight<T> = { key, promise };
      active = [...active, flight];
      void promise.finally(() => {
        active = active.filter((candidate) => candidate !== flight);
      }).catch(() => {
        // The caller observes the original rejection; this handles cleanup only.
      });
      return promise;
    },
    async whenIdle(
      identity?: AdminFiatWithdrawalAuthIdentity,
    ): Promise<void> {
      return waitForMatchingFlights((flight) => (
        identity
          ? (
            isSameAdminFiatWithdrawalAuthIdentity(
              flight.key.identity,
              identity,
            )
          )
          : true
      ));
    },
    async whenUserIdle(userId: string): Promise<void> {
      return waitForMatchingFlights(
        (flight) => flight.key.identity.userId === userId,
      );
    },
  };
}

export const adminFiatWithdrawalGlobalReviewFlights =
  createAdminFiatWithdrawalReviewFlights();

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

export type AdminFiatDepositStatusFilter =
  | "all"
  | "pending"
  | "approved"
  | "rejected";

export type AdminFiatDepositAuthIdentity = AuthenticatedRequestIdentity;
export type AdminFiatDepositCatalogKey =
  AuthenticatedScopedRequestKey<AdminFiatDepositStatusFilter>;

export function createAdminFiatDepositAuthIdentity(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
): AdminFiatDepositAuthIdentity | null {
  return createAuthenticatedRequestIdentity(userId, accessToken);
}

export function isSameAdminFiatDepositAuthIdentity(
  current: AdminFiatDepositAuthIdentity | null,
  expected: AdminFiatDepositAuthIdentity | null,
): boolean {
  return isSameAuthenticatedRequestIdentity(current, expected);
}

export function createAdminFiatDepositCatalogKey(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
  statusFilter: AdminFiatDepositStatusFilter,
): AdminFiatDepositCatalogKey | null {
  return createAuthenticatedScopedRequestKey(
    userId,
    accessToken,
    statusFilter,
  );
}

export function isSameAdminFiatDepositCatalogKey(
  current: AdminFiatDepositCatalogKey | null,
  expected: AdminFiatDepositCatalogKey | null,
): boolean {
  return isSameAuthenticatedScopedRequestKey(current, expected);
}

export function createLatestAdminFiatDepositCatalogGuard() {
  return createLatestAuthenticatedScopedRequestGuard<
    AdminFiatDepositStatusFilter
  >();
}

export function createLatestAdminFiatDepositReviewGuard() {
  return createLatestAuthenticatedRequestGuard();
}

export function createAdminFiatDepositRetryPolicy(maxRetries: number) {
  return createRequestRetryPolicy(maxRetries);
}

export type AdminFiatDepositScopedValue<T> = Readonly<{
  identity: AdminFiatDepositAuthIdentity;
  value: T;
}>;

export function createAdminFiatDepositScopedValue<T>(
  identity: AdminFiatDepositAuthIdentity,
  value: T,
): AdminFiatDepositScopedValue<T> {
  return { identity, value };
}

export function readAdminFiatDepositScopedValue<T>(
  scopedValue: AdminFiatDepositScopedValue<T> | null,
  identity: AdminFiatDepositAuthIdentity | null,
): T | null {
  return scopedValue
    && isSameAdminFiatDepositAuthIdentity(scopedValue.identity, identity)
    ? scopedValue.value
    : null;
}

export type AdminFiatDepositReviewKey = Readonly<{
  fingerprint: string;
  identity: AdminFiatDepositAuthIdentity;
}>;

type AdminFiatDepositReviewFlight<T> = Readonly<{
  key: AdminFiatDepositReviewKey;
  promise: Promise<T>;
}>;

export function createAdminFiatDepositReviewFlights() {
  let active: AdminFiatDepositReviewFlight<unknown>[] = [];

  const sameKey = (
    current: AdminFiatDepositReviewKey,
    expected: AdminFiatDepositReviewKey,
  ) => current.fingerprint === expected.fingerprint
    && isSameAdminFiatDepositAuthIdentity(
      current.identity,
      expected.identity,
    );

  return {
    run<T>(
      key: AdminFiatDepositReviewKey,
      operation: () => Promise<T>,
    ): Promise<T> {
      const existing = active.find((flight) => sameKey(flight.key, key));
      if (existing) return existing.promise as Promise<T>;

      const promise = Promise.resolve().then(operation);
      const flight: AdminFiatDepositReviewFlight<T> = { key, promise };
      active = [...active, flight];
      void promise.finally(() => {
        active = active.filter((candidate) => candidate !== flight);
      }).catch(() => {
        // The caller observes the original rejection; this handles cleanup only.
      });
      return promise;
    },
    async whenIdle(): Promise<void> {
      while (active.length > 0) {
        await Promise.all(active.map((flight) => flight.promise.then(
          () => undefined,
          () => undefined,
        )));
      }
    },
  };
}

export const adminFiatDepositGlobalReviewFlights =
  createAdminFiatDepositReviewFlights();

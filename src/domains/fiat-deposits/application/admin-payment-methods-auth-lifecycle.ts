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

export type AdminPaymentMethodsArchiveFilter =
  | "visible"
  | "archived"
  | "all";

export type AdminPaymentMethodsAuthIdentity = AuthenticatedRequestIdentity;
export type AdminPaymentMethodsRequestKey =
  AuthenticatedScopedRequestKey<AdminPaymentMethodsArchiveFilter>;

export function createAdminPaymentMethodsAuthIdentity(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
): AdminPaymentMethodsAuthIdentity | null {
  return createAuthenticatedRequestIdentity(userId, accessToken);
}

export function isSameAdminPaymentMethodsAuthIdentity(
  current: AdminPaymentMethodsAuthIdentity | null,
  expected: AdminPaymentMethodsAuthIdentity | null,
): boolean {
  return isSameAuthenticatedRequestIdentity(current, expected);
}

export function createAdminPaymentMethodsRequestKey(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
  archiveFilter: AdminPaymentMethodsArchiveFilter,
): AdminPaymentMethodsRequestKey | null {
  return createAuthenticatedScopedRequestKey(
    userId,
    accessToken,
    archiveFilter,
  );
}

export function isSameAdminPaymentMethodsRequestKey(
  current: AdminPaymentMethodsRequestKey | null,
  expected: AdminPaymentMethodsRequestKey | null,
): boolean {
  return isSameAuthenticatedScopedRequestKey(current, expected);
}

export function createLatestAdminPaymentMethodsRequestGuard() {
  return createLatestAuthenticatedRequestGuard();
}

export function createLatestAdminPaymentMethodsCatalogGuard() {
  return createLatestAuthenticatedScopedRequestGuard<
    AdminPaymentMethodsArchiveFilter
  >();
}

export function createAdminPaymentMethodsRetryPolicy(maxRetries: number) {
  return createRequestRetryPolicy(maxRetries);
}

export type AdminPaymentMethodsScopedValue<T> = Readonly<{
  identity: AdminPaymentMethodsAuthIdentity;
  value: T;
}>;

export function createAdminPaymentMethodsScopedValue<T>(
  identity: AdminPaymentMethodsAuthIdentity,
  value: T,
): AdminPaymentMethodsScopedValue<T> {
  return { identity, value };
}

export function readAdminPaymentMethodsScopedValue<T>(
  scopedValue: AdminPaymentMethodsScopedValue<T> | null,
  identity: AdminPaymentMethodsAuthIdentity | null,
): T | null {
  return scopedValue
    && isSameAdminPaymentMethodsAuthIdentity(scopedValue.identity, identity)
    ? scopedValue.value
    : null;
}

export type AdminPaymentMethodsMutationKey = Readonly<{
  fingerprint: string;
  identity: AdminPaymentMethodsAuthIdentity;
}>;

type MutationFlight<T> = Readonly<{
  key: AdminPaymentMethodsMutationKey;
  promise: Promise<T>;
}>;

export function createAdminPaymentMethodsMutationFlights() {
  let active: MutationFlight<unknown>[] = [];

  const sameKey = (
    current: AdminPaymentMethodsMutationKey,
    expected: AdminPaymentMethodsMutationKey,
  ) => current.fingerprint === expected.fingerprint
    && isSameAdminPaymentMethodsAuthIdentity(
      current.identity,
      expected.identity,
    );

  return {
    run<T>(
      key: AdminPaymentMethodsMutationKey,
      operation: () => Promise<T>,
    ): Promise<T> {
      const existing = active.find((flight) => sameKey(flight.key, key));
      if (existing) return existing.promise as Promise<T>;

      const promise = Promise.resolve().then(operation);
      const flight: MutationFlight<T> = { key, promise };
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
        await Promise.all(active.map((flight) => (
          flight.promise.then(
            () => undefined,
            () => undefined,
          )
        )));
      }
    },
  };
}

export const adminPaymentMethodsGlobalMutationFlights =
  createAdminPaymentMethodsMutationFlights();

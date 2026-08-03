import {
  createAuthenticatedRequestIdentity,
  createLatestAuthenticatedRequestGuard,
  isSameAuthenticatedRequestIdentity,
  type AuthenticatedRequestIdentity,
} from "../../../shared/requests/authenticated-request-lifecycle.ts";

export type AdminSupportSettingsAuthIdentity = AuthenticatedRequestIdentity;

export function createAdminSupportSettingsAuthIdentity(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
): AdminSupportSettingsAuthIdentity | null {
  return createAuthenticatedRequestIdentity(userId, accessToken);
}

export function isSameAdminSupportSettingsAuthIdentity(
  current: AdminSupportSettingsAuthIdentity | null,
  expected: AdminSupportSettingsAuthIdentity | null,
): boolean {
  return isSameAuthenticatedRequestIdentity(current, expected);
}

export function createLatestAdminSupportSettingsRequestGuard() {
  return createLatestAuthenticatedRequestGuard();
}

type SaveFlight<T> = Readonly<{
  identity: AdminSupportSettingsAuthIdentity;
  promise: Promise<T>;
}>;

export type AdminSupportSettingsScopedValue<T> = Readonly<{
  identity: AdminSupportSettingsAuthIdentity;
  value: T;
}>;

export function createAdminSupportSettingsScopedValue<T>(
  identity: AdminSupportSettingsAuthIdentity,
  value: T,
): AdminSupportSettingsScopedValue<T> {
  return { identity, value };
}

export function readAdminSupportSettingsScopedValue<T>(
  scopedValue: AdminSupportSettingsScopedValue<T> | null,
  identity: AdminSupportSettingsAuthIdentity | null,
): T | null {
  return scopedValue
    && isSameAdminSupportSettingsAuthIdentity(scopedValue.identity, identity)
    ? scopedValue.value
    : null;
}

export function createAdminSupportSettingsSaveFlight() {
  let active: SaveFlight<unknown> | null = null;
  let tail: Promise<void> = Promise.resolve();

  return {
    run<T>(
      identity: AdminSupportSettingsAuthIdentity,
      operation: () => Promise<T>,
    ): Promise<T> {
      if (
        active
        && isSameAdminSupportSettingsAuthIdentity(active.identity, identity)
      ) {
        return active.promise as Promise<T>;
      }

      const predecessor = tail;
      const promise = predecessor.then(operation, operation);
      active = { identity, promise };
      tail = promise.then(
        () => undefined,
        () => undefined,
      );
      void promise.finally(() => {
        if (active?.promise === promise) active = null;
      }).catch(() => {
        // The caller observes the original rejection; this handles cleanup only.
      });
      return promise;
    },
    whenIdle(): Promise<void> {
      return tail;
    },
  };
}

export const adminSupportSettingsGlobalSaveFlight =
  createAdminSupportSettingsSaveFlight();

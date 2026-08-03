import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import {
  adminPaymentMethodsGlobalMutationFlights,
  createAdminPaymentMethodsScopedValue,
  createLatestAdminPaymentMethodsRequestGuard,
  isSameAdminPaymentMethodsAuthIdentity,
  readAdminPaymentMethodsScopedValue,
  type AdminPaymentMethodsAuthIdentity,
  type AdminPaymentMethodsScopedValue,
} from "../../application/admin-payment-methods-auth-lifecycle.js";
import {
  setAdminPaymentMethodActive,
  setAdminPaymentMethodArchived,
  type AdminPaymentMethod,
} from "../../application/admin-payment-methods-browser-service.js";

type RowActionsInput = Readonly<{
  identity: AdminPaymentMethodsAuthIdentity | null;
  identityRef: Readonly<{
    current: AdminPaymentMethodsAuthIdentity | null;
  }>;
  mountedRef: Readonly<{ current: boolean }>;
  reloadCurrentCatalog: () => void;
  requireIdentity: () => AdminPaymentMethodsAuthIdentity | null;
  restoreVisibleFilter: () => void;
  userIdRef: Readonly<{ current: string | null }>;
}>;

export function useAdminPaymentMethodRowActions({
  identity,
  identityRef,
  mountedRef,
  reloadCurrentCatalog,
  requireIdentity,
  restoreVisibleFilter,
  userIdRef,
}: RowActionsInput) {
  const [togglingState, setTogglingState] =
    useState<AdminPaymentMethodsScopedValue<string | null> | null>(null);
  const [archivingState, setArchivingState] =
    useState<AdminPaymentMethodsScopedValue<string | null> | null>(null);
  const toggleGuardRef = useRef(createLatestAdminPaymentMethodsRequestGuard());
  const archiveGuardRef = useRef(createLatestAdminPaymentMethodsRequestGuard());

  const toggleActive = useCallback(async (method: AdminPaymentMethod) => {
    const requestIdentity = requireIdentity();
    if (!requestIdentity) return false;
    const nextActive = !method.is_active;
    const accepted = await adminPaymentMethodsGlobalMutationFlights.run(
      {
        identity: requestIdentity,
        fingerprint: JSON.stringify(["toggle", method.id, nextActive]),
      },
      async () => {
        const request = toggleGuardRef.current.begin(requestIdentity);
        setTogglingState(
          createAdminPaymentMethodsScopedValue(requestIdentity, method.id),
        );
        try {
          await setAdminPaymentMethodActive(
            requestIdentity.accessToken,
            method.id,
            nextActive,
          );
          if (mountedRef.current && request.isCurrent(identityRef.current)) {
            toast.success(method.is_active ? "Disabled." : "Enabled.");
          }
          return true;
        } catch (error) {
          if (mountedRef.current && request.isCurrent(identityRef.current)) {
            toast.error(getSafeErrorMessage(error, "PAYMENT").message);
          }
          return false;
        } finally {
          if (mountedRef.current && request.isCurrent(identityRef.current)) {
            setTogglingState(
              createAdminPaymentMethodsScopedValue(requestIdentity, null),
            );
          }
        }
      },
    );
    if (
      accepted
      && mountedRef.current
      && isSameAdminPaymentMethodsAuthIdentity(identityRef.current, requestIdentity)
    ) reloadCurrentCatalog();
    return accepted;
  }, [identityRef, mountedRef, reloadCurrentCatalog, requireIdentity]);

  const setArchived = useCallback(async (
    method: AdminPaymentMethod,
    archived: boolean,
  ) => {
    if (!userIdRef.current) return false;
    const actionLabel = archived ? "archive" : "restore";
    if (!window.confirm(
      `Are you sure you want to ${actionLabel} this payment account?`,
    )) return false;

    const requestIdentity = requireIdentity();
    if (!requestIdentity) return false;
    const accepted = await adminPaymentMethodsGlobalMutationFlights.run(
      {
        identity: requestIdentity,
        fingerprint: JSON.stringify(["archive", method.id, archived]),
      },
      async () => {
        const request = archiveGuardRef.current.begin(requestIdentity);
        setArchivingState(
          createAdminPaymentMethodsScopedValue(requestIdentity, method.id),
        );
        try {
          await setAdminPaymentMethodArchived(
            requestIdentity.accessToken,
            method.id,
            archived,
          );
          if (mountedRef.current && request.isCurrent(identityRef.current)) {
            toast.success(
              archived
                ? "Payment account archived."
                : "Payment account restored.",
            );
          }
          return true;
        } catch (error) {
          if (mountedRef.current && request.isCurrent(identityRef.current)) {
            toast.error(getSafeErrorMessage(error, "PAYMENT").message);
          }
          return false;
        } finally {
          if (mountedRef.current && request.isCurrent(identityRef.current)) {
            setArchivingState(
              createAdminPaymentMethodsScopedValue(requestIdentity, null),
            );
          }
        }
      },
    );
    if (
      accepted
      && mountedRef.current
      && isSameAdminPaymentMethodsAuthIdentity(identityRef.current, requestIdentity)
    ) {
      if (archived) reloadCurrentCatalog();
      else restoreVisibleFilter();
    }
    return accepted;
  }, [identityRef, mountedRef, reloadCurrentCatalog, requireIdentity, restoreVisibleFilter, userIdRef]);

  useEffect(() => {
    toggleGuardRef.current.invalidate();
    archiveGuardRef.current.invalidate();
    setTogglingState(null);
    setArchivingState(null);
  }, [identity]);

  useEffect(() => () => {
    toggleGuardRef.current.invalidate();
    archiveGuardRef.current.invalidate();
  }, []);

  return {
    archivingId: readAdminPaymentMethodsScopedValue(
      archivingState,
      identity,
    ),
    setArchived,
    toggleActive,
    togglingId: readAdminPaymentMethodsScopedValue(
      togglingState,
      identity,
    ),
  };
}

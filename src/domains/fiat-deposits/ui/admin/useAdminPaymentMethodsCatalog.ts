import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "@/lib/async.js";
import {
  adminPaymentMethodsGlobalMutationFlights,
  createAdminPaymentMethodsRequestKey,
  createAdminPaymentMethodsRetryPolicy,
  createLatestAdminPaymentMethodsCatalogGuard,
  isSameAdminPaymentMethodsRequestKey,
  type AdminPaymentMethodsArchiveFilter,
  type AdminPaymentMethodsRequestKey,
} from "../../application/admin-payment-methods-auth-lifecycle.js";
import {
  loadAdminPaymentMethods,
  type AdminPaymentMethod,
} from "../../application/admin-payment-methods-browser-service.js";

const ADMIN_PAYMENT_METHODS_TIMEOUT_MS = 10_000;
const ADMIN_PAYMENT_METHODS_RETRY_DELAY_MS = 1_500;
const ADMIN_PAYMENT_METHODS_MAX_AUTO_RETRIES = 2;

type CatalogSnapshot = Readonly<{
  key: AdminPaymentMethodsRequestKey;
  methods: AdminPaymentMethod[];
}>;

export type AdminPaymentMethodsCatalogLoadOptions = Readonly<{
  forceNewFlight?: boolean;
  resetRetryCount?: boolean;
}>;

type CatalogFlight = Readonly<{
  key: AdminPaymentMethodsRequestKey;
  promise: Promise<boolean>;
  token: symbol;
}>;

export function useAdminPaymentMethodsCatalog(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
  archiveFilter: AdminPaymentMethodsArchiveFilter,
) {
  const requestKey = useMemo(
    () => createAdminPaymentMethodsRequestKey(
      userId,
      accessToken,
      archiveFilter,
    ),
    [accessToken, archiveFilter, userId],
  );
  const requestKeyRef = useRef(requestKey);
  const userIdRef = useRef(userId ?? null);
  const archiveFilterRef = useRef(archiveFilter);
  requestKeyRef.current = requestKey;
  userIdRef.current = userId ?? null;
  archiveFilterRef.current = archiveFilter;

  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const mountedRef = useRef(false);
  const retryPolicyRef = useRef(
    createAdminPaymentMethodsRetryPolicy(
      ADMIN_PAYMENT_METHODS_MAX_AUTO_RETRIES,
    ),
  );
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestGuardRef = useRef(createLatestAdminPaymentMethodsCatalogGuard());
  const activeLoadRef = useRef<CatalogFlight | null>(null);
  const loadRef = useRef<(
    options?: AdminPaymentMethodsCatalogLoadOptions,
  ) => Promise<boolean>>(() => Promise.resolve(false));

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback((retry: () => void) => {
    clearRetryTimer();
    if (!retryPolicyRef.current.reserveRetry()) return;
    retryTimerRef.current = setTimeout(
      retry,
      ADMIN_PAYMENT_METHODS_RETRY_DELAY_MS,
    );
  }, [clearRetryTimer]);

  const load = useCallback((
    options?: AdminPaymentMethodsCatalogLoadOptions,
  ): Promise<boolean> => {
    const expectedKey = requestKeyRef.current;
    const expectedUserId = userIdRef.current;
    const expectedFilter = archiveFilterRef.current;

    if (!expectedKey) {
      if (!expectedUserId) return Promise.resolve(false);

      retryPolicyRef.current.admitLoad({
        coalescesWithActiveFlight: false,
        resetRetryCount: options?.resetRetryCount,
      });
      scheduleRetry(() => {
        if (
          mountedRef.current
          && userIdRef.current === expectedUserId
          && archiveFilterRef.current === expectedFilter
        ) {
          void loadRef.current();
        }
      });
      return Promise.resolve(false);
    }

    const activeLoad = activeLoadRef.current;
    if (
      !options?.forceNewFlight
      && activeLoad
      && isSameAdminPaymentMethodsRequestKey(activeLoad.key, expectedKey)
    ) {
      retryPolicyRef.current.admitLoad({
        coalescesWithActiveFlight: true,
        resetRetryCount: options?.resetRetryCount,
      });
      return activeLoad.promise;
    }

    retryPolicyRef.current.admitLoad({
      coalescesWithActiveFlight: false,
      resetRetryCount: options?.resetRetryCount,
    });
    clearRetryTimer();
    const request = requestGuardRef.current.begin(expectedKey);
    const flightToken = Symbol("admin-payment-methods-catalog-flight");

    const promise = (async () => {
      try {
        await adminPaymentMethodsGlobalMutationFlights.whenIdle();
        if (!mountedRef.current || !request.isCurrent(requestKeyRef.current)) {
          return false;
        }

        const methods = await withTimeout(
          loadAdminPaymentMethods(
            expectedKey.identity.accessToken,
            expectedKey.scope,
          ),
          ADMIN_PAYMENT_METHODS_TIMEOUT_MS,
          "Admin payment methods request timed out.",
        );
        if (!mountedRef.current || !request.isCurrent(requestKeyRef.current)) {
          return false;
        }

        setSnapshot({ key: expectedKey, methods });
        retryPolicyRef.current.reset();
        return true;
      } catch (error) {
        if (!mountedRef.current || !request.isCurrent(requestKeyRef.current)) {
          return false;
        }

        console.error(
          "[QHash] Admin payment methods background refresh failed:",
          error,
        );
        scheduleRetry(() => {
          if (
            mountedRef.current
            && isSameAdminPaymentMethodsRequestKey(
              requestKeyRef.current,
              expectedKey,
            )
          ) {
            void loadRef.current({ forceNewFlight: true });
          }
        });
        return false;
      } finally {
        if (activeLoadRef.current?.token === flightToken) {
          activeLoadRef.current = null;
        }
      }
    })();

    activeLoadRef.current = {
      key: expectedKey,
      promise,
      token: flightToken,
    };
    return promise;
  }, [clearRetryTimer, scheduleRetry]);
  loadRef.current = load;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGuardRef.current.invalidate();
      activeLoadRef.current = null;
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  useEffect(() => {
    requestGuardRef.current.invalidate();
    activeLoadRef.current = null;
    clearRetryTimer();
    retryPolicyRef.current.reset();
    setSnapshot(null);
    void load({ forceNewFlight: true, resetRetryCount: true });

    return () => {
      requestGuardRef.current.invalidate();
      activeLoadRef.current = null;
      clearRetryTimer();
    };
  }, [archiveFilter, clearRetryTimer, load, requestKey, userId]);

  useEffect(() => {
    const refresh = () => void load({ resetRetryCount: true });
    const handleVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", refresh);
    };
  }, [load]);

  const visibleSnapshot = snapshot
    && isSameAdminPaymentMethodsRequestKey(snapshot.key, requestKey)
    ? snapshot
    : null;

  return {
    methods: visibleSnapshot?.methods ?? [],
    methodsLoaded: visibleSnapshot !== null,
    reload: load,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "@/lib/async.js";
import {
  adminFiatDepositGlobalReviewFlights,
  createAdminFiatDepositCatalogKey,
  createAdminFiatDepositRetryPolicy,
  createLatestAdminFiatDepositCatalogGuard,
  isSameAdminFiatDepositCatalogKey,
  type AdminFiatDepositCatalogKey,
  type AdminFiatDepositStatusFilter,
} from "../../application/admin-fiat-deposit-operations-auth-lifecycle.js";
import {
  loadAdminFiatDeposits,
  type AdminFiatDeposit,
} from "../../application/admin-fiat-deposit-operations-browser-service.js";

const ADMIN_FIAT_DEPOSIT_LOAD_TIMEOUT_MS = 10_000;
const ADMIN_FIAT_DEPOSIT_RETRY_DELAY_MS = 1_500;
const ADMIN_FIAT_DEPOSIT_MAX_AUTO_RETRIES = 2;

type AdminFiatDepositSnapshot = Readonly<{
  deposits: AdminFiatDeposit[];
  key: AdminFiatDepositCatalogKey;
}>;

export type AdminFiatDepositLoadOptions = Readonly<{
  forceNewFlight?: boolean;
  resetRetryCount?: boolean;
}>;

type AdminFiatDepositLoadFlight = Readonly<{
  key: AdminFiatDepositCatalogKey;
  promise: Promise<boolean>;
  token: symbol;
}>;

export function useAdminFiatDepositCatalog(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
  statusFilter: AdminFiatDepositStatusFilter,
) {
  const requestKey = useMemo(
    () => createAdminFiatDepositCatalogKey(
      userId,
      accessToken,
      statusFilter,
    ),
    [accessToken, statusFilter, userId],
  );
  const requestKeyRef = useRef(requestKey);
  const userIdRef = useRef(userId ?? null);
  const statusFilterRef = useRef(statusFilter);
  requestKeyRef.current = requestKey;
  userIdRef.current = userId ?? null;
  statusFilterRef.current = statusFilter;

  const [snapshot, setSnapshot] = useState<AdminFiatDepositSnapshot | null>(null);
  const mountedRef = useRef(false);
  const retryPolicyRef = useRef(
    createAdminFiatDepositRetryPolicy(
      ADMIN_FIAT_DEPOSIT_MAX_AUTO_RETRIES,
    ),
  );
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestGuardRef = useRef(createLatestAdminFiatDepositCatalogGuard());
  const activeLoadRef = useRef<AdminFiatDepositLoadFlight | null>(null);
  const loadRef = useRef<(
    options?: AdminFiatDepositLoadOptions,
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
      ADMIN_FIAT_DEPOSIT_RETRY_DELAY_MS,
    );
  }, [clearRetryTimer]);

  const load = useCallback((
    options?: AdminFiatDepositLoadOptions,
  ): Promise<boolean> => {
    const expectedKey = requestKeyRef.current;
    const expectedUserId = userIdRef.current;
    const expectedFilter = statusFilterRef.current;

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
          && statusFilterRef.current === expectedFilter
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
      && isSameAdminFiatDepositCatalogKey(activeLoad.key, expectedKey)
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
    const flightToken = Symbol("admin-fiat-deposit-catalog-flight");

    const promise = (async () => {
      try {
        await adminFiatDepositGlobalReviewFlights.whenIdle();
        if (!mountedRef.current || !request.isCurrent(requestKeyRef.current)) {
          return false;
        }

        const deposits = await withTimeout(
          loadAdminFiatDeposits(
            expectedKey.identity.accessToken,
            expectedKey.scope,
          ),
          ADMIN_FIAT_DEPOSIT_LOAD_TIMEOUT_MS,
          "Admin deposits request timed out.",
        );

        if (!mountedRef.current || !request.isCurrent(requestKeyRef.current)) {
          return false;
        }

        setSnapshot({ deposits, key: expectedKey });
        retryPolicyRef.current.reset();
        return true;
      } catch (error) {
        if (!mountedRef.current || !request.isCurrent(requestKeyRef.current)) {
          return false;
        }

        console.error(
          "[QHash] Admin deposits background refresh failed:",
          error,
        );
        scheduleRetry(() => {
          if (
            mountedRef.current
            && isSameAdminFiatDepositCatalogKey(
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
  }, [clearRetryTimer, load, requestKey]);

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
    && isSameAdminFiatDepositCatalogKey(snapshot.key, requestKey)
    ? snapshot
    : null;

  return {
    deposits: visibleSnapshot?.deposits ?? [],
    depositsLoaded: visibleSnapshot !== null,
    refreshDeposits: load,
  };
}

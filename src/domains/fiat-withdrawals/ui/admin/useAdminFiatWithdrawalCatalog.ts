import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "@/lib/async.js";
import {
  adminFiatWithdrawalGlobalReviewFlights,
  createAdminFiatWithdrawalCatalogKey,
  createAdminFiatWithdrawalRetryPolicy,
  createLatestAdminFiatWithdrawalCatalogGuard,
  isSameAdminFiatWithdrawalCatalogKey,
  type AdminFiatWithdrawalCatalogKey,
  type AdminFiatWithdrawalStatusFilter,
} from "../../application/admin-fiat-withdrawal-operations-auth-lifecycle.js";
import {
  loadAdminFiatWithdrawals,
  type AdminFiatWithdrawal,
} from "../../application/admin-fiat-withdrawal-operations-browser-service.js";

const ADMIN_FIAT_WITHDRAWAL_LOAD_TIMEOUT_MS = 10_000;
const ADMIN_FIAT_WITHDRAWAL_REVIEW_WAIT_TIMEOUT_MS = 2_000;
const ADMIN_FIAT_WITHDRAWAL_RETRY_DELAY_MS = 1_500;
const ADMIN_FIAT_WITHDRAWAL_MAX_AUTO_RETRIES = 2;

type AdminFiatWithdrawalSnapshot = Readonly<{
  key: AdminFiatWithdrawalCatalogKey;
  withdrawals: AdminFiatWithdrawal[];
}>;

export type AdminFiatWithdrawalLoadOptions = Readonly<{
  forceNewFlight?: boolean;
  resetRetryCount?: boolean;
}>;

type AdminFiatWithdrawalLoadFlight = Readonly<{
  key: AdminFiatWithdrawalCatalogKey;
  promise: Promise<boolean>;
  token: symbol;
}>;

export function useAdminFiatWithdrawalCatalog(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
  statusFilter: AdminFiatWithdrawalStatusFilter,
) {
  const requestKey = useMemo(
    () => createAdminFiatWithdrawalCatalogKey(
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

  const [snapshot, setSnapshot] = useState<AdminFiatWithdrawalSnapshot | null>(null);
  const mountedRef = useRef(false);
  const retryPolicyRef = useRef(createAdminFiatWithdrawalRetryPolicy(
    ADMIN_FIAT_WITHDRAWAL_MAX_AUTO_RETRIES,
  ));
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestGuardRef = useRef(createLatestAdminFiatWithdrawalCatalogGuard());
  const activeLoadRef = useRef<AdminFiatWithdrawalLoadFlight | null>(null);
  const loadRef = useRef<(
    options?: AdminFiatWithdrawalLoadOptions,
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
      ADMIN_FIAT_WITHDRAWAL_RETRY_DELAY_MS,
    );
  }, [clearRetryTimer]);

  const load = useCallback((
    options?: AdminFiatWithdrawalLoadOptions,
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
      && isSameAdminFiatWithdrawalCatalogKey(activeLoad.key, expectedKey)
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
    const flightToken = Symbol("admin-fiat-withdrawal-catalog-flight");

    const promise = (async () => {
      try {
        const reviewBarrier = adminFiatWithdrawalGlobalReviewFlights
          .whenUserIdle(expectedKey.identity.userId);
        let reviewBarrierSettled = true;
        try {
          await withTimeout(
            reviewBarrier,
            ADMIN_FIAT_WITHDRAWAL_REVIEW_WAIT_TIMEOUT_MS,
            "Admin withdrawal review wait timed out.",
          );
        } catch {
          reviewBarrierSettled = false;
        }

        if (!reviewBarrierSettled) {
          void reviewBarrier.then(() => {
            if (
              mountedRef.current
              && isSameAdminFiatWithdrawalCatalogKey(
                requestKeyRef.current,
                expectedKey,
              )
            ) {
              void loadRef.current({
                forceNewFlight: true,
                resetRetryCount: true,
              });
            }
          });
        }
        if (!mountedRef.current || !request.isCurrent(requestKeyRef.current)) {
          return false;
        }

        const withdrawals = await withTimeout(
          loadAdminFiatWithdrawals(
            expectedKey.identity.accessToken,
            expectedKey.scope,
          ),
          ADMIN_FIAT_WITHDRAWAL_LOAD_TIMEOUT_MS,
          "Admin withdrawals request timed out.",
        );

        if (!mountedRef.current || !request.isCurrent(requestKeyRef.current)) {
          return false;
        }

        setSnapshot({ key: expectedKey, withdrawals });
        retryPolicyRef.current.reset();
        return true;
      } catch (error) {
        if (!mountedRef.current || !request.isCurrent(requestKeyRef.current)) {
          return false;
        }

        console.error(
          "[QHash] Admin withdrawals background refresh failed:",
          error,
        );
        scheduleRetry(() => {
          if (
            mountedRef.current
            && isSameAdminFiatWithdrawalCatalogKey(
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
    && isSameAdminFiatWithdrawalCatalogKey(snapshot.key, requestKey)
    ? snapshot
    : null;

  return {
    refreshWithdrawals: load,
    withdrawals: visibleSnapshot?.withdrawals ?? [],
    withdrawalsLoaded: visibleSnapshot !== null,
  };
}

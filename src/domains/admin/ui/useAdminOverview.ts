import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "@/lib/async.js";
import {
  createAdminOverviewAuthIdentity,
  createAdminOverviewRetryPolicy,
  createLatestAdminOverviewRequestGuard,
  isSameAdminOverviewAuthIdentity,
  type AdminOverviewAuthIdentity,
} from "../application/admin-overview-auth-lifecycle.js";
import {
  loadAdminOverview,
  type AdminOverviewStats,
} from "../application/admin-overview-browser-service.js";

const ADMIN_OVERVIEW_LOAD_TIMEOUT_MS = 10_000;
const ADMIN_OVERVIEW_AUTO_RETRY_DELAY_MS = 1_500;
const ADMIN_OVERVIEW_MAX_AUTO_RETRIES = 2;

type AdminOverviewSnapshot = Readonly<{
  identity: AdminOverviewAuthIdentity;
  stats: AdminOverviewStats;
}>;

type AdminOverviewLoadOptions = Readonly<{
  forceNewFlight?: boolean;
  resetRetryCount?: boolean;
}>;

type AdminOverviewFlight = Readonly<{
  identity: AdminOverviewAuthIdentity;
  promise: Promise<boolean>;
  token: symbol;
}>;

export function useAdminOverview(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
) {
  const identity = useMemo(
    () => createAdminOverviewAuthIdentity(userId, accessToken),
    [accessToken, userId],
  );
  const identityRef = useRef(identity);
  const userIdRef = useRef(userId ?? null);
  identityRef.current = identity;
  userIdRef.current = userId ?? null;

  const [snapshot, setSnapshot] = useState<AdminOverviewSnapshot | null>(null);
  const mountedRef = useRef(false);
  const retryPolicyRef = useRef(
    createAdminOverviewRetryPolicy(ADMIN_OVERVIEW_MAX_AUTO_RETRIES),
  );
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestGuardRef = useRef(createLatestAdminOverviewRequestGuard());
  const activeLoadRef = useRef<AdminOverviewFlight | null>(null);
  const loadRef = useRef<(
    options?: AdminOverviewLoadOptions,
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
      ADMIN_OVERVIEW_AUTO_RETRY_DELAY_MS,
    );
  }, [clearRetryTimer]);

  const load = useCallback((
    options?: AdminOverviewLoadOptions,
  ): Promise<boolean> => {
    const requestIdentity = identityRef.current;
    const requestUserId = userIdRef.current;

    if (!requestIdentity) {
      if (!requestUserId) return Promise.resolve(false);

      retryPolicyRef.current.admitLoad({
        coalescesWithActiveFlight: false,
        resetRetryCount: options?.resetRetryCount,
      });
      scheduleRetry(() => {
        if (mountedRef.current && userIdRef.current === requestUserId) {
          void loadRef.current();
        }
      });
      return Promise.resolve(false);
    }

    const activeLoad = activeLoadRef.current;
    if (
      !options?.forceNewFlight
      && activeLoad
      && isSameAdminOverviewAuthIdentity(activeLoad.identity, requestIdentity)
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
    const request = requestGuardRef.current.begin(requestIdentity);
    const flightToken = Symbol("admin-overview-load-flight");

    const promise = (async () => {
      try {
        const stats = await withTimeout(
          loadAdminOverview(requestIdentity.accessToken),
          ADMIN_OVERVIEW_LOAD_TIMEOUT_MS,
          "Admin overview request timed out.",
        );

        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        setSnapshot({ identity: requestIdentity, stats });
        retryPolicyRef.current.reset();
        return true;
      } catch (error) {
        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        console.error("[QHash] Admin overview background refresh failed:", error);
        scheduleRetry(() => {
          if (
            mountedRef.current
            && isSameAdminOverviewAuthIdentity(
              identityRef.current,
              requestIdentity,
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
      identity: requestIdentity,
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
  }, [clearRetryTimer, identity, load]);

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
    && isSameAdminOverviewAuthIdentity(snapshot.identity, identity)
    ? snapshot
    : null;

  return {
    stats: visibleSnapshot?.stats ?? null,
    statsLoaded: visibleSnapshot !== null,
  };
}

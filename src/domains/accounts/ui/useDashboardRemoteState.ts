import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "@/lib/async.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import type { Plan } from "@/lib/database.types.js";
import {
  loadAuthenticatedDashboard,
  loadDashboardPlans,
  type DashboardData,
} from "../application/dashboard-browser-service.js";
import {
  createAuthenticatedRequestIdentity,
  createLatestAuthenticatedRequestGuard,
  isSameAuthenticatedRequestIdentity,
  type AuthenticatedRequestIdentity,
} from "../application/authenticated-request-lifecycle.js";

const DASHBOARD_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

type DashboardRemoteSnapshot = {
  data: DashboardData | null;
  identity: AuthenticatedRequestIdentity;
  plans: Plan[];
};

export function useDashboardRemoteState() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const accessToken = useAuthStore((state) => state.session?.access_token ?? null);
  const walletBalance = useWalletStore((state) =>
    state.activeUserId === userId ? state.balance : null,
  );
  const setWalletBalance = useWalletStore((state) => state.setBalanceForUser);
  const identity = useMemo(
    () => createAuthenticatedRequestIdentity(userId, accessToken),
    [accessToken, userId],
  );
  const identityRef = useRef(identity);
  const requestGuardRef = useRef(createLatestAuthenticatedRequestGuard());
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardRemoteSnapshot | null>(null);

  identityRef.current = identity;

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const scheduleRetry = useCallback((loadFn: () => void) => {
    clearRetryTimer();
    if (retryCountRef.current >= MAX_AUTO_RETRIES) return;
    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(loadFn, AUTO_RETRY_DELAY_MS);
  }, [clearRetryTimer]);

  const load = useCallback(async (options?: { resetRetryCount?: boolean }) => {
    if (!identity || !isSameAuthenticatedRequestIdentity(identityRef.current, identity)) return;
    if (options?.resetRetryCount) retryCountRef.current = 0;

    clearRetryTimer();
    const request = requestGuardRef.current.begin(identity);
    let dashboardResult: PromiseSettledResult<DashboardData>;
    let plansResult: PromiseSettledResult<Plan[]>;

    try {
      [dashboardResult, plansResult] = await Promise.allSettled([
        withTimeout(
          loadAuthenticatedDashboard(identity.accessToken),
          DASHBOARD_LOAD_TIMEOUT_MS,
          "Dashboard request timed out.",
        ),
        withTimeout(loadDashboardPlans(), DASHBOARD_LOAD_TIMEOUT_MS, "Plans request timed out."),
      ]);
    } catch (error) {
      if (!request.isCurrent(identityRef.current)) return;
      console.error("[QHash] Dashboard background refresh failed:", error);
      scheduleRetry(() => void load());
      return;
    }

    if (!request.isCurrent(identityRef.current)) return;

    setSnapshot((current) => {
      const previous = current && isSameAuthenticatedRequestIdentity(current.identity, identity)
        ? current
        : { data: null, identity, plans: [] };
      return {
        data: dashboardResult.status === "fulfilled" ? dashboardResult.value : previous.data,
        identity,
        plans: plansResult.status === "fulfilled" ? plansResult.value : previous.plans,
      };
    });

    if (dashboardResult.status === "fulfilled") {
      setWalletBalance(identity.userId, dashboardResult.value.wallet.balance);
      retryCountRef.current = 0;
    } else {
      console.error("[QHash] Dashboard background refresh failed:", dashboardResult.reason);
      scheduleRetry(() => void load());
    }

    if (plansResult.status === "rejected") {
      console.error("[QHash] Dashboard plans background refresh failed:", plansResult.reason);
    }
  }, [clearRetryTimer, identity, scheduleRetry, setWalletBalance]);

  useEffect(() => {
    requestGuardRef.current.invalidate();
    clearRetryTimer();
    retryCountRef.current = 0;
    setSnapshot(null);
    void load();

    return () => {
      requestGuardRef.current.invalidate();
      clearRetryTimer();
    };
  }, [clearRetryTimer, load]);

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

  const currentSnapshot = snapshot
    && isSameAuthenticatedRequestIdentity(snapshot.identity, identity)
    ? snapshot
    : null;
  const data = currentSnapshot?.data ?? null;

  return {
    balance: walletBalance ?? data?.wallet.balance ?? null,
    data,
    plans: currentSnapshot?.plans ?? [],
  };
}

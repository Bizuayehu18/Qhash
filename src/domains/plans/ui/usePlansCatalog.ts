import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { isTimeoutError, withTimeout } from "@/lib/async.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import {
  createLatestPlansRequestGuard,
  createPlansAuthIdentity,
  createPlansPurchaseFlightGuard,
  isSamePlansAuthIdentity,
  reconcilePlansPurchaseFlight,
  type PlansAuthIdentity,
} from "../application/plans-auth-lifecycle.js";
import {
  loadPlansWithEligibility,
  purchasePlan,
} from "../application/plans-browser-service.js";
import type { PlanCatalogItem } from "../domain/plan-catalog.js";

const PLAN_LOAD_TIMEOUT_MS = 10_000;
const PURCHASE_TIMEOUT_MS = 15_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

type PlansSnapshot = {
  identity: PlansAuthIdentity;
  loaded: boolean;
  plans: PlanCatalogItem[];
};

type PlanSelection = {
  identity: PlansAuthIdentity;
  plan: PlanCatalogItem;
};

type CatalogFlight = {
  identity: PlansAuthIdentity;
  promise: Promise<boolean>;
  token: symbol;
};

export function usePlansCatalog() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const accessToken = useAuthStore((state) => state.session?.access_token ?? null);
  const walletBalance = useWalletStore((state) =>
    state.activeUserId === userId ? state.balance : null,
  );
  const loadingBalance = useWalletStore((state) => state.loading);
  const setWalletBalance = useWalletStore((state) => state.setBalanceForUser);
  const fetchWallet = useWalletStore((state) => state.fetchWallet);
  const identity = useMemo(
    () => createPlansAuthIdentity(userId, accessToken),
    [accessToken, userId],
  );
  const mountedRef = useRef(false);
  const identityRef = useRef(identity);
  const catalogGuardRef = useRef(createLatestPlansRequestGuard());
  const purchaseGuardRef = useRef(createLatestPlansRequestGuard());
  const purchaseFlightGuardRef = useRef(createPlansPurchaseFlightGuard());
  const catalogFlightRef = useRef<CatalogFlight | null>(null);
  const loadPlansRef = useRef<(options?: {
    forceNewFlight?: boolean;
    resetLoaded?: boolean;
    resetRetryCount?: boolean;
  }) => Promise<boolean>>(() => Promise.resolve(false));
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [snapshot, setSnapshot] = useState<PlansSnapshot | null>(null);
  const [selection, setSelection] = useState<PlanSelection | null>(null);
  const [, setPurchaseFlightVersion] = useState(0);

  identityRef.current = identity;

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const scheduleRetry = useCallback((load: () => void) => {
    clearRetryTimer();
    if (retryCountRef.current >= MAX_AUTO_RETRIES) return;
    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(load, AUTO_RETRY_DELAY_MS);
  }, [clearRetryTimer]);

  const loadPlans = useCallback((options?: {
    forceNewFlight?: boolean;
    resetLoaded?: boolean;
    resetRetryCount?: boolean;
  }): Promise<boolean> => {
    if (!identity || !isSamePlansAuthIdentity(identityRef.current, identity)) {
      return Promise.resolve(false);
    }

    const activeFlight = catalogFlightRef.current;
    if (
      !options?.forceNewFlight
      && activeFlight
      && isSamePlansAuthIdentity(activeFlight.identity, identity)
    ) {
      return activeFlight.promise;
    }

    if (options?.resetRetryCount) retryCountRef.current = 0;
    if (options?.resetLoaded) {
      setSnapshot({ identity, loaded: false, plans: [] });
      setSelection(null);
    }

    clearRetryTimer();
    const request = catalogGuardRef.current.begin(identity);
    const flightToken = Symbol("plans-catalog-flight");

    const promise = (async () => {
      try {
        const rows = await withTimeout(
          loadPlansWithEligibility(identity.accessToken),
          PLAN_LOAD_TIMEOUT_MS,
          "Plans request timed out.",
        );

        if (!request.isCurrent(identityRef.current)) return false;
        setSnapshot({ identity, loaded: true, plans: rows });
        setSelection((current) => {
          if (!current || !isSamePlansAuthIdentity(current.identity, identity)) return current;
          const refreshedPlan = rows.find((plan) => plan.id === current.plan.id);
          return refreshedPlan ? { identity, plan: refreshedPlan } : null;
        });
        retryCountRef.current = 0;
        return true;
      } catch (error) {
        if (!request.isCurrent(identityRef.current)) return false;
        console.error("[QHash] Plans background refresh failed:", error);
        scheduleRetry(() => { void loadPlans(); });
        return false;
      } finally {
        if (catalogFlightRef.current?.token === flightToken) catalogFlightRef.current = null;
      }
    })();

    const flight = { identity, promise, token: flightToken };
    catalogFlightRef.current = flight;
    return promise;
  }, [clearRetryTimer, identity, scheduleRetry]);

  loadPlansRef.current = loadPlans;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    catalogGuardRef.current.invalidate();
    purchaseGuardRef.current.invalidate();
    catalogFlightRef.current = null;
    clearRetryTimer();
    retryCountRef.current = 0;
    setSnapshot(null);
    setSelection(null);
    void loadPlans({ resetLoaded: true, resetRetryCount: true });

    return () => {
      catalogGuardRef.current.invalidate();
      purchaseGuardRef.current.invalidate();
      catalogFlightRef.current = null;
      clearRetryTimer();
    };
  }, [clearRetryTimer, loadPlans]);

  useEffect(() => {
    const refresh = () => { void loadPlans({ resetRetryCount: true }); };
    const handleVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", refresh);
    };
  }, [loadPlans]);

  useEffect(() => {
    if (userId && walletBalance === null) void fetchWallet(userId);
  }, [fetchWallet, userId, walletBalance]);

  const visibleSnapshot = snapshot && isSamePlansAuthIdentity(snapshot.identity, identity)
    ? snapshot
    : null;
  const selectedPlan = selection && isSamePlansAuthIdentity(selection.identity, identity)
    ? selection.plan
    : null;
  const purchasing = purchaseFlightGuardRef.current.isActiveFor(userId);
  const visibleWalletBalance = walletBalance !== null && !loadingBalance ? walletBalance : null;

  const selectPlan = useCallback((plan: PlanCatalogItem) => {
    if (!identity || !isSamePlansAuthIdentity(identityRef.current, identity)) return;
    setSelection({ identity, plan });
  }, [identity]);

  const closePlan = useCallback(() => {
    setSelection(null);
  }, []);

  const handlePurchase = useCallback(async () => {
    if (!identity || !selectedPlan || purchasing || !selectedPlan.eligibility.isEligible) return;

    const flight = purchaseFlightGuardRef.current.begin(identity.userId);
    if (!flight) return;

    const request = purchaseGuardRef.current.begin(identity);
    setPurchaseFlightVersion((current) => current + 1);
    const commandPromise = Promise.resolve().then(() => (
      purchasePlan(selectedPlan.id, identity.accessToken)
    ));

    const settlePurchaseFlight = async () => {
      try {
        await reconcilePlansPurchaseFlight({
          getCurrentIdentity: () => identityRef.current,
          isMounted: () => mountedRef.current,
          refreshCatalog: () => loadPlansRef.current({
            forceNewFlight: true,
            resetRetryCount: true,
          }),
          refreshWallet: () => useWalletStore.getState().fetchWallet(
            identity.userId,
            { force: true },
          ),
          userId: identity.userId,
          waitBeforeRetry: () => new Promise((resolve) => {
            setTimeout(resolve, AUTO_RETRY_DELAY_MS);
          }),
          waitForPriorCatalog: async (purchaseUserId) => {
            const priorFlight = catalogFlightRef.current;
            if (priorFlight?.identity.userId === purchaseUserId) {
              await priorFlight.promise;
            }
          },
        });
      } finally {
        const settled = flight.settle();
        if (mountedRef.current && settled) {
          setPurchaseFlightVersion((current) => current + 1);
        }
      }
    };

    void commandPromise.then(
      () => settlePurchaseFlight(),
      () => settlePurchaseFlight(),
    );

    try {
      const result = await withTimeout(
        commandPromise,
        PURCHASE_TIMEOUT_MS,
        "Purchase request timed out.",
      );
      if (!request.isCurrent(identityRef.current)) return;

      setWalletBalance(identity.userId, result.newBalance);
      toast.success(`${selectedPlan.name} activated. Mining starts now.`);
      setSelection(null);
      void loadPlans({ resetRetryCount: true });
    } catch (error: unknown) {
      if (!request.isCurrent(identityRef.current)) return;
      if (isTimeoutError(error)) {
        toast.error("Purchase is taking too long. Please check your connection and try again.");
      } else {
        toast.error(getSafeErrorMessage(error, "PURCHASE").message);
        void loadPlans({ resetRetryCount: true });
      }
    }
  }, [fetchWallet, identity, loadPlans, purchasing, selectedPlan, setWalletBalance]);

  return {
    closePlan,
    handlePurchase,
    loaded: visibleSnapshot?.loaded ?? false,
    plans: visibleSnapshot?.plans ?? [],
    purchasing,
    selectPlan,
    selectedPlan,
    walletBalance: visibleWalletBalance,
  };
}

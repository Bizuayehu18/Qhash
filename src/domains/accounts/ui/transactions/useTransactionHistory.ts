import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "@/lib/async.js";
import { useAuthStore } from "@/store/authStore.js";
import {
  loadTransactionHistory,
  type TransactionHistoryRow,
} from "../../application/transaction-history-browser-service.js";
import {
  createAuthenticatedScopedRequestKey,
  createLatestAuthenticatedScopedRequestGuard,
  createRequestRetryPolicy,
  isSameAuthenticatedScopedRequestKey,
  type AuthenticatedScopedRequestKey,
} from "../../application/authenticated-request-lifecycle.js";
import type { TransactionHistoryFilter } from "../../domain/transaction-history.js";

const TRANSACTIONS_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

type TransactionHistorySnapshot = {
  key: AuthenticatedScopedRequestKey<TransactionHistoryFilter>;
  rows: TransactionHistoryRow[];
};

type ActiveFlight = {
  key: AuthenticatedScopedRequestKey<TransactionHistoryFilter>;
  promise: Promise<void>;
  token: symbol;
};

export function useTransactionHistory() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const accessToken = useAuthStore((state) => state.session?.access_token ?? null);
  const [activeFilter, setActiveFilter] = useState<TransactionHistoryFilter>("all");
  const requestKey = useMemo(
    () => createAuthenticatedScopedRequestKey(userId, accessToken, activeFilter),
    [accessToken, activeFilter, userId],
  );
  const keyRef = useRef(requestKey);
  const requestGuardRef = useRef(
    createLatestAuthenticatedScopedRequestGuard<TransactionHistoryFilter>(),
  );
  const retryPolicyRef = useRef(createRequestRetryPolicy(MAX_AUTO_RETRIES));
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeFlightRef = useRef<ActiveFlight | null>(null);
  const [snapshot, setSnapshot] = useState<TransactionHistorySnapshot | null>(null);

  keyRef.current = requestKey;

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const load = useCallback((options?: { resetRetryCount?: boolean }) => {
    const key = requestKey;
    if (!key || !isSameAuthenticatedScopedRequestKey(keyRef.current, key)) {
      clearRetryTimer();
      return Promise.resolve();
    }

    const activeFlight = activeFlightRef.current;
    const coalescesWithActiveFlight = Boolean(
      activeFlight && isSameAuthenticatedScopedRequestKey(activeFlight.key, key),
    );
    const admitted = retryPolicyRef.current.admitLoad({
      coalescesWithActiveFlight,
      resetRetryCount: options?.resetRetryCount === true,
    });
    if (!admitted && activeFlight) return activeFlight.promise;

    clearRetryTimer();
    const request = requestGuardRef.current.begin(key);
    const flightToken = Symbol("transaction-history-flight");
    const promise = (async () => {
      try {
        const rows = await withTimeout(
          loadTransactionHistory(key.identity.accessToken, key.scope),
          TRANSACTIONS_LOAD_TIMEOUT_MS,
          "Transactions request timed out.",
        );
        if (!request.isCurrent(keyRef.current)) return;

        setSnapshot({ key, rows });
        retryPolicyRef.current.reset();
      } catch (error) {
        if (!request.isCurrent(keyRef.current)) return;
        console.error("[QHash] Transactions background refresh failed:", error);

        if (retryPolicyRef.current.reserveRetry()) {
          clearRetryTimer();
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (!isSameAuthenticatedScopedRequestKey(keyRef.current, key)) return;
            void load();
          }, AUTO_RETRY_DELAY_MS);
        }
      } finally {
        if (activeFlightRef.current?.token === flightToken) {
          activeFlightRef.current = null;
        }
      }
    })();

    activeFlightRef.current = { key, promise, token: flightToken };
    return promise;
  }, [clearRetryTimer, requestKey]);

  useEffect(() => {
    requestGuardRef.current.invalidate();
    clearRetryTimer();
    retryPolicyRef.current.reset();
    activeFlightRef.current = null;
    setSnapshot(null);
    void load({ resetRetryCount: true });

    return () => {
      requestGuardRef.current.invalidate();
      clearRetryTimer();
      activeFlightRef.current = null;
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
    && isSameAuthenticatedScopedRequestKey(snapshot.key, requestKey)
    ? snapshot
    : null;

  return {
    activeFilter,
    loaded: currentSnapshot !== null,
    rows: currentSnapshot?.rows ?? [],
    setActiveFilter,
  };
}

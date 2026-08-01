import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "@/lib/async.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import {
  loadFiatWithdrawalSecurityStatus,
  loadUserFiatWithdrawals,
} from "../application/fiat-withdrawal-browser-service.js";
import {
  createFiatWithdrawalAuthIdentity,
  createLatestFiatWithdrawalRequestGuard,
  isSameFiatWithdrawalAuthIdentity,
  type FiatWithdrawalAuthIdentity,
} from "./fiat-withdrawal-auth-lifecycle.js";
import type {
  FiatWithdrawalSecurityStatus,
  UserFiatWithdrawal,
} from "./fiat-withdrawal-types.js";

const HISTORY_LOAD_TIMEOUT_MS = 10_000;
const SECURITY_STATUS_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

type FiatWithdrawalRemoteSnapshot = {
  identity: FiatWithdrawalAuthIdentity | null;
  historyLoaded: boolean;
  loadingSecurityStatus: boolean;
  securityStatus: FiatWithdrawalSecurityStatus | null;
  withdrawals: UserFiatWithdrawal[];
};

function createEmptyRemoteSnapshot(
  identity: FiatWithdrawalAuthIdentity | null,
): FiatWithdrawalRemoteSnapshot {
  return {
    identity,
    historyLoaded: false,
    loadingSecurityStatus: identity !== null,
    securityStatus: null,
    withdrawals: [],
  };
}

function snapshotBelongsToIdentity(
  snapshotIdentity: FiatWithdrawalAuthIdentity | null,
  currentIdentity: FiatWithdrawalAuthIdentity | null,
): boolean {
  return snapshotIdentity === null && currentIdentity === null
    ? true
    : isSameFiatWithdrawalAuthIdentity(snapshotIdentity, currentIdentity);
}

export function useFiatWithdrawalRemoteState() {
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.session?.access_token ?? null);
  const walletBalance = useWalletStore((state) =>
    state.activeUserId === user?.id ? state.balance : null,
  );
  const fetchWallet = useWalletStore((state) => state.fetchWallet);
  const authIdentity = useMemo(
    () => createFiatWithdrawalAuthIdentity(user?.id, accessToken),
    [accessToken, user?.id],
  );
  const [snapshot, setSnapshot] = useState<FiatWithdrawalRemoteSnapshot>(() =>
    createEmptyRemoteSnapshot(authIdentity),
  );
  const mountedRef = useRef(true);
  const authIdentityRef = useRef(authIdentity);
  const historyGuardRef = useRef(createLatestFiatWithdrawalRequestGuard());
  const securityGuardRef = useRef(createLatestFiatWithdrawalRequestGuard());
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  authIdentityRef.current = authIdentity;

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const loadWithdrawals = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      const requestIdentity = authIdentity;
      if (!requestIdentity) return;
      if (options?.resetRetryCount) retryCountRef.current = 0;

      clearRetryTimer();
      const ticket = historyGuardRef.current.begin(requestIdentity);
      try {
        const rows = await withTimeout(
          loadUserFiatWithdrawals(requestIdentity.accessToken),
          HISTORY_LOAD_TIMEOUT_MS,
          "Withdrawal history request timed out.",
        );
        if (!mountedRef.current || !ticket.isCurrent(authIdentityRef.current)) return;

        setSnapshot((current) => ({
          ...current,
          identity: requestIdentity,
          historyLoaded: true,
          withdrawals: rows,
        }));
        retryCountRef.current = 0;
      } catch (error) {
        if (!mountedRef.current || !ticket.isCurrent(authIdentityRef.current)) return;

        console.error("[QHash] Withdrawal history background refresh failed:", error);
        if (retryCountRef.current < MAX_AUTO_RETRIES) {
          retryCountRef.current += 1;
          retryTimerRef.current = setTimeout(() => {
            if (isSameFiatWithdrawalAuthIdentity(authIdentityRef.current, requestIdentity)) {
              void loadWithdrawals();
            }
          }, AUTO_RETRY_DELAY_MS);
        }
      }
    },
    [authIdentity, clearRetryTimer],
  );

  const loadSecurityStatus = useCallback(async () => {
    const requestIdentity = authIdentity;
    if (!requestIdentity) return;

    const ticket = securityGuardRef.current.begin(requestIdentity);
    setSnapshot((current) =>
      snapshotBelongsToIdentity(current.identity, requestIdentity)
        ? { ...current, loadingSecurityStatus: true }
        : createEmptyRemoteSnapshot(requestIdentity),
    );

    try {
      const result = await withTimeout(
        loadFiatWithdrawalSecurityStatus(requestIdentity.accessToken),
        SECURITY_STATUS_TIMEOUT_MS,
        "Security status request timed out.",
      );
      if (!mountedRef.current || !ticket.isCurrent(authIdentityRef.current)) return;

      setSnapshot((current) => ({
        ...current,
        identity: requestIdentity,
        loadingSecurityStatus: false,
        securityStatus: result,
      }));
    } catch (error) {
      if (!mountedRef.current || !ticket.isCurrent(authIdentityRef.current)) return;

      console.error("[QHash] Withdrawal security status load failed:", error);
      setSnapshot((current) => ({
        ...current,
        identity: requestIdentity,
        loadingSecurityStatus: false,
        securityStatus: null,
      }));
    }
  }, [authIdentity]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      historyGuardRef.current.invalidate();
      securityGuardRef.current.invalidate();
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  useEffect(() => {
    historyGuardRef.current.invalidate();
    securityGuardRef.current.invalidate();
    clearRetryTimer();
    retryCountRef.current = 0;
    setSnapshot(createEmptyRemoteSnapshot(authIdentity));

    if (authIdentity) {
      void loadWithdrawals({ resetRetryCount: true });
      void loadSecurityStatus();
    }

    return () => {
      historyGuardRef.current.invalidate();
      securityGuardRef.current.invalidate();
      clearRetryTimer();
    };
  }, [authIdentity, clearRetryTimer, loadSecurityStatus, loadWithdrawals]);

  useEffect(() => {
    if (user?.id && walletBalance === null) void fetchWallet(user.id);
  }, [fetchWallet, user?.id, walletBalance]);

  useEffect(() => {
    const refresh = () => {
      void loadWithdrawals({ resetRetryCount: true });
      void loadSecurityStatus();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
    };
  }, [loadSecurityStatus, loadWithdrawals]);

  const refreshWallet = useCallback(
    (force = false) => {
      if (!authIdentity) return;
      void fetchWallet(
        authIdentity.userId,
        force ? { force: true } : undefined,
      );
    },
    [authIdentity, fetchWallet],
  );

  const visibleSnapshot = snapshotBelongsToIdentity(snapshot.identity, authIdentity)
    ? snapshot
    : createEmptyRemoteSnapshot(authIdentity);

  return {
    accessToken,
    authIdentity,
    historyLoaded: visibleSnapshot.historyLoaded,
    loadingSecurityStatus: visibleSnapshot.loadingSecurityStatus,
    refreshSecurityStatus: loadSecurityStatus,
    refreshWallet,
    refreshWithdrawals: loadWithdrawals,
    securityStatus: visibleSnapshot.securityStatus,
    userId: user?.id ?? null,
    walletBalance,
    withdrawals: visibleSnapshot.withdrawals,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "@/lib/async.js";
import { useAuthStore } from "@/store/authStore.js";
import {
  createLatestReferralsRequestGuard,
  createReferralsAuthIdentity,
  createReferralsRetryPolicy,
  isSameReferralsAuthIdentity,
  type ReferralsAuthIdentity,
} from "../application/referrals-auth-lifecycle.js";
import { loadReferralStats } from "../application/referrals-browser-service.js";
import {
  EMPTY_REFERRAL_STATS,
  normalizeReferralStats,
  type ReferralStats,
} from "../domain/referral-team.js";

const REFERRAL_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

type ReferralSnapshot = Readonly<{
  identity: ReferralsAuthIdentity;
  loaded: boolean;
  stats: ReferralStats;
}>;

type ReferralLoadOptions = Readonly<{
  forceNewFlight?: boolean;
  resetRetryCount?: boolean;
}>;

type ReferralFlight = Readonly<{
  identity: ReferralsAuthIdentity;
  promise: Promise<boolean>;
  token: symbol;
}>;

export function useReferralData() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const profile = useAuthStore((state) => state.profile);
  const accessToken = useAuthStore(
    (state) => state.session?.access_token ?? null,
  );
  const identity = useMemo(
    () => createReferralsAuthIdentity(userId, accessToken),
    [accessToken, userId],
  );
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const [snapshot, setSnapshot] = useState<ReferralSnapshot | null>(null);
  const mountedRef = useRef(false);
  const retryPolicyRef = useRef(createReferralsRetryPolicy(MAX_AUTO_RETRIES));
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestGuardRef = useRef(createLatestReferralsRequestGuard());
  const activeFlightRef = useRef<ReferralFlight | null>(null);
  const loadRef = useRef<(
    options?: ReferralLoadOptions,
  ) => Promise<boolean>>(() => Promise.resolve(false));

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback((requestIdentity: ReferralsAuthIdentity) => {
    clearRetryTimer();
    if (!retryPolicyRef.current.reserveRetry()) return;
    retryTimerRef.current = setTimeout(() => {
      if (
        !mountedRef.current
        || !isSameReferralsAuthIdentity(identityRef.current, requestIdentity)
      ) {
        return;
      }

      void loadRef.current({ forceNewFlight: true });
    }, AUTO_RETRY_DELAY_MS);
  }, [clearRetryTimer]);

  const load = useCallback((options?: ReferralLoadOptions): Promise<boolean> => {
    const requestIdentity = identityRef.current;
    if (!requestIdentity) return Promise.resolve(false);

    const activeFlight = activeFlightRef.current;
    if (
      !options?.forceNewFlight
      && activeFlight
      && isSameReferralsAuthIdentity(activeFlight.identity, requestIdentity)
    ) {
      retryPolicyRef.current.admitLoad({
        coalescesWithActiveFlight: true,
        resetRetryCount: options?.resetRetryCount,
      });
      return activeFlight.promise;
    }
    retryPolicyRef.current.admitLoad({
      coalescesWithActiveFlight: false,
      resetRetryCount: options?.resetRetryCount,
    });

    clearRetryTimer();
    const request = requestGuardRef.current.begin(requestIdentity);
    const flightToken = Symbol("referrals-stats-flight");

    const promise = (async () => {
      try {
        const result = await withTimeout(
          loadReferralStats(requestIdentity.accessToken),
          REFERRAL_LOAD_TIMEOUT_MS,
          "Team stats request timed out.",
        );

        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        setSnapshot({
          identity: requestIdentity,
          loaded: true,
          stats: normalizeReferralStats(result),
        });
        retryPolicyRef.current.reset();
        return true;
      } catch (error) {
        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        console.error("[QHash] Referral stats background refresh failed:", error);
        scheduleRetry(requestIdentity);
        return false;
      } finally {
        if (activeFlightRef.current?.token === flightToken) {
          activeFlightRef.current = null;
        }
      }
    })();

    activeFlightRef.current = {
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
      activeFlightRef.current = null;
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  useEffect(() => {
    requestGuardRef.current.invalidate();
    activeFlightRef.current = null;
    clearRetryTimer();
    retryPolicyRef.current.reset();
    setSnapshot(null);

    if (identity) {
      void load({ forceNewFlight: true, resetRetryCount: true });
    }

    return () => {
      requestGuardRef.current.invalidate();
      activeFlightRef.current = null;
      clearRetryTimer();
    };
  }, [clearRetryTimer, identity, load]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void load({ resetRetryCount: true });
      }
    };
    const handleOnline = () => {
      void load({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [load]);

  const visibleSnapshot = snapshot && isSameReferralsAuthIdentity(
    snapshot.identity,
    identity,
  )
    ? snapshot
    : null;

  return {
    stats: visibleSnapshot?.stats ?? EMPTY_REFERRAL_STATS,
    statsLoaded: visibleSnapshot?.loaded ?? false,
    username: identity && profile?.id === identity.userId
      ? profile.username
      : null,
  };
}

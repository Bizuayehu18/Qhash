import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "@/lib/async.js";
import {
  createDepositVerificationAuditRequestKey,
  createDepositVerificationAuditRetryPolicy,
  createLatestDepositVerificationAuditRequestGuard,
  isSameDepositVerificationAuditRequestKey,
  type DepositVerificationAuditRequestKey,
} from "../../application/deposit-verification-audit-auth-lifecycle.js";
import {
  loadDepositVerificationAudit,
  type DepositVerificationAuditLog,
  type DepositVerificationAuditPaymentType,
} from "../../application/deposit-verification-audit-browser-service.js";

const DEPOSIT_VERIFICATION_AUDIT_TIMEOUT_MS = 10_000;
const DEPOSIT_VERIFICATION_AUDIT_RETRY_DELAY_MS = 1_500;
const DEPOSIT_VERIFICATION_AUDIT_MAX_AUTO_RETRIES = 2;

type DepositVerificationAuditSnapshot = Readonly<{
  key: DepositVerificationAuditRequestKey;
  logs: DepositVerificationAuditLog[];
}>;

type DepositVerificationAuditLoadOptions = Readonly<{
  forceNewFlight?: boolean;
  resetRetryCount?: boolean;
}>;

type DepositVerificationAuditFlight = Readonly<{
  key: DepositVerificationAuditRequestKey;
  promise: Promise<boolean>;
  token: symbol;
}>;

export function useDepositVerificationAudit(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
  paymentType: DepositVerificationAuditPaymentType,
) {
  const requestKey = useMemo(
    () => createDepositVerificationAuditRequestKey(
      userId,
      accessToken,
      paymentType,
    ),
    [accessToken, paymentType, userId],
  );
  const requestKeyRef = useRef(requestKey);
  const userIdRef = useRef(userId ?? null);
  const paymentTypeRef = useRef(paymentType);
  requestKeyRef.current = requestKey;
  userIdRef.current = userId ?? null;
  paymentTypeRef.current = paymentType;

  const [snapshot, setSnapshot] =
    useState<DepositVerificationAuditSnapshot | null>(null);
  const mountedRef = useRef(false);
  const retryPolicyRef = useRef(
    createDepositVerificationAuditRetryPolicy(
      DEPOSIT_VERIFICATION_AUDIT_MAX_AUTO_RETRIES,
    ),
  );
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestGuardRef = useRef(
    createLatestDepositVerificationAuditRequestGuard(),
  );
  const activeLoadRef = useRef<DepositVerificationAuditFlight | null>(null);
  const loadRef = useRef<(
    options?: DepositVerificationAuditLoadOptions,
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
      DEPOSIT_VERIFICATION_AUDIT_RETRY_DELAY_MS,
    );
  }, [clearRetryTimer]);

  const load = useCallback((
    options?: DepositVerificationAuditLoadOptions,
  ): Promise<boolean> => {
    const expectedKey = requestKeyRef.current;
    const expectedUserId = userIdRef.current;
    const expectedPaymentType = paymentTypeRef.current;

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
          && paymentTypeRef.current === expectedPaymentType
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
      && isSameDepositVerificationAuditRequestKey(activeLoad.key, expectedKey)
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
    const flightToken = Symbol("deposit-verification-audit-flight");

    const promise = (async () => {
      try {
        const logs = await withTimeout(
          loadDepositVerificationAudit(
            expectedKey.identity.accessToken,
            expectedKey.scope,
          ),
          DEPOSIT_VERIFICATION_AUDIT_TIMEOUT_MS,
          "Admin audit logs request timed out.",
        );

        if (!mountedRef.current || !request.isCurrent(requestKeyRef.current)) {
          return false;
        }

        setSnapshot({ key: expectedKey, logs });
        retryPolicyRef.current.reset();
        return true;
      } catch (error) {
        if (!mountedRef.current || !request.isCurrent(requestKeyRef.current)) {
          return false;
        }

        console.error(
          "[QHash] Admin audit logs background refresh failed:",
          error,
        );
        scheduleRetry(() => {
          if (
            mountedRef.current
            && isSameDepositVerificationAuditRequestKey(
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
    && isSameDepositVerificationAuditRequestKey(snapshot.key, requestKey)
    ? snapshot
    : null;

  return {
    logs: visibleSnapshot?.logs ?? [],
    logsLoaded: visibleSnapshot !== null,
  };
}

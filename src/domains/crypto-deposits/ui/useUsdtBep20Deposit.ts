import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createNowpaymentsOverviewRequestGate,
  createSingleFlight,
  fetchNowpaymentsDepositOverview,
  isNowpaymentsAuthGenerationCurrent,
  NowpaymentsDepositUiError,
  requestNowpaymentsDepositSession,
} from "./nowpayments-deposit-ui.js";
import {
  INITIAL_NOWPAYMENTS_DEPOSIT_UI_STATE,
  nowpaymentsDepositUiReducer,
} from "./usdt-bep20-deposit-state.js";
import { useUsdtBep20AddressPresentation } from "./useUsdtBep20AddressPresentation.js";

const OVERVIEW_TIMEOUT_MS = 12_000;
const OVERVIEW_REFRESH_INTERVAL_MS = 15_000;

export function useUsdtBep20Deposit(accessToken: string | null) {
  const [{
    overview,
    loading,
    error,
    copyFeedback,
    qrDataUrl,
  }, dispatchUi] = useReducer(
    nowpaymentsDepositUiReducer,
    INITIAL_NOWPAYMENTS_DEPOSIT_UI_STATE,
  );
  const [generating, setGenerating] = useState(false);
  const mountedRef = useRef(true);
  const accessTokenRef = useRef(accessToken);
  const authGenerationRef = useRef(0);
  const overviewRequestGateRef = useRef<ReturnType<
    typeof createNowpaymentsOverviewRequestGate
  > | null>(null);
  const submissionControllerRef = useRef<AbortController | null>(null);
  const submissionBusyRef = useRef(false);
  accessTokenRef.current = accessToken;
  if (!overviewRequestGateRef.current) {
    overviewRequestGateRef.current = createNowpaymentsOverviewRequestGate();
  }

  const activeSession = overview?.active_session ?? null;
  const {
    addressSendable,
    clearAddressPresentation,
    handleCopy,
    nowMs,
  } = useUsdtBep20AddressPresentation({
    activeSession,
    dispatchUi,
    featureEnabled: overview?.feature_enabled === true,
    mountedRef,
  });

  const loadOverviewForGeneration = useCallback(async ({
    allowDuringSubmission = false,
    authGeneration = authGenerationRef.current,
  }: {
    allowDuringSubmission?: boolean;
    authGeneration?: number;
  } = {}): Promise<boolean> => {
    if (
      !mountedRef.current
      || !isNowpaymentsAuthGenerationCurrent(
        accessTokenRef.current,
        authGenerationRef.current,
        accessToken,
        authGeneration,
      )
      || (submissionBusyRef.current && !allowDuringSubmission)
    ) {
      return false;
    }
    const ticket = overviewRequestGateRef.current!.begin();
    if (!accessToken) {
      if (
        !mountedRef.current
        || !isNowpaymentsAuthGenerationCurrent(
          accessTokenRef.current,
          authGenerationRef.current,
          accessToken,
          authGeneration,
        )
        || !overviewRequestGateRef.current!.isCurrent(ticket.generation)
      ) {
        return false;
      }
      clearAddressPresentation();
      dispatchUi({ type: "overview_failure" });
      return false;
    }
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      ticket.abort();
    }, OVERVIEW_TIMEOUT_MS);
    dispatchUi({ type: "overview_loading" });
    try {
      const result = await fetchNowpaymentsDepositOverview(
        accessToken,
        fetch,
        ticket.signal,
      );
      if (
        !mountedRef.current
        || !isNowpaymentsAuthGenerationCurrent(
          accessTokenRef.current,
          authGenerationRef.current,
          accessToken,
          authGeneration,
        )
        || !overviewRequestGateRef.current!.isCurrent(ticket.generation)
      ) {
        return false;
      }
      clearAddressPresentation();
      dispatchUi({ type: "overview_success", overview: result });
      return true;
    } catch {
      if (
        !mountedRef.current
        || !isNowpaymentsAuthGenerationCurrent(
          accessTokenRef.current,
          authGenerationRef.current,
          accessToken,
          authGeneration,
        )
        || !overviewRequestGateRef.current!.isCurrent(ticket.generation)
        || (ticket.signal.aborted && !timedOut)
      ) {
        return false;
      }
      clearAddressPresentation();
      dispatchUi({ type: "overview_failure" });
      return false;
    } finally {
      clearTimeout(timeout);
      if (
        mountedRef.current
        && isNowpaymentsAuthGenerationCurrent(
          accessTokenRef.current,
          authGenerationRef.current,
          accessToken,
          authGeneration,
        )
        && overviewRequestGateRef.current!.isCurrent(ticket.generation)
      ) {
        dispatchUi({ type: "set_loading", loading: false });
      }
    }
  }, [accessToken, clearAddressPresentation]);

  const loadOverview = useCallback(
    async (): Promise<void> => {
      await loadOverviewForGeneration();
    },
    [loadOverviewForGeneration],
  );

  useEffect(() => {
    mountedRef.current = true;
    authGenerationRef.current += 1;
    const authGeneration = authGenerationRef.current;
    overviewRequestGateRef.current?.invalidate();
    submissionControllerRef.current?.abort();
    submissionControllerRef.current = null;
    submissionBusyRef.current = false;
    setGenerating(false);
    clearAddressPresentation();
    dispatchUi({ type: "auth_reset" });
    void loadOverviewForGeneration({ authGeneration, allowDuringSubmission: true });
    return () => {
      mountedRef.current = false;
      authGenerationRef.current += 1;
      overviewRequestGateRef.current?.invalidate();
      submissionControllerRef.current?.abort();
      submissionControllerRef.current = null;
      submissionBusyRef.current = false;
    };
  }, [accessToken, clearAddressPresentation, loadOverviewForGeneration]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void loadOverview();
    };
    const refreshTimer = setInterval(refresh, OVERVIEW_REFRESH_INTERVAL_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [loadOverview]);

  useEffect(() => {
    if (
      activeSession?.address_lifecycle === "pending_activation"
      && !addressSendable
    ) {
      void loadOverview();
    }
  }, [activeSession, addressSendable, loadOverview]);

  const performGenerate = useCallback(async () => {
    if (!accessToken || !overview?.feature_enabled) return;
    const token = accessToken;
    const authGeneration = authGenerationRef.current;
    const isCurrentAuthGeneration = () =>
      mountedRef.current
      && isNowpaymentsAuthGenerationCurrent(
        accessTokenRef.current,
        authGenerationRef.current,
        token,
        authGeneration,
      );
    if (!isCurrentAuthGeneration() || submissionBusyRef.current) return;

    overviewRequestGateRef.current?.invalidate();
    const controller = new AbortController();
    submissionControllerRef.current = controller;
    submissionBusyRef.current = true;
    setGenerating(true);
    dispatchUi({ type: "set_error", error: false });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, OVERVIEW_TIMEOUT_MS);
    try {
      await requestNowpaymentsDepositSession(token, fetch, controller.signal);
      if (!isCurrentAuthGeneration()) return;
      const refreshed = await loadOverviewForGeneration({
        allowDuringSubmission: true,
        authGeneration,
      });
      if (!isCurrentAuthGeneration() || !refreshed) return;
      toast.success("Your USDT BEP20 deposit address is ready.");
    } catch (requestError) {
      if (!isCurrentAuthGeneration() || (controller.signal.aborted && !timedOut)) {
        return;
      }
      if (
        requestError instanceof NowpaymentsDepositUiError
        && requestError.kind === "disabled"
      ) {
        clearAddressPresentation();
        dispatchUi({ type: "confirmed_disabled" });
        toast.error("Crypto deposits are unavailable.");
      } else {
        clearAddressPresentation();
        dispatchUi({ type: "overview_failure" });
        toast.error("The deposit address is temporarily unavailable. Please try again.");
      }
    } finally {
      clearTimeout(timeout);
      if (isCurrentAuthGeneration()) {
        if (submissionControllerRef.current === controller) {
          submissionControllerRef.current = null;
        }
        submissionBusyRef.current = false;
        setGenerating(false);
      }
    }
  }, [
    accessToken,
    clearAddressPresentation,
    loadOverviewForGeneration,
    overview?.feature_enabled,
  ]);

  const handleGenerate = useMemo(
    () => createSingleFlight(performGenerate),
    [performGenerate],
  );

  return {
    addressSendable,
    copied: copyFeedback.copied,
    copyAnnouncement: copyFeedback.announcement,
    error,
    generating,
    handleCopy,
    handleGenerate,
    loadOverview,
    loading,
    nowMs,
    overview,
    qrDataUrl,
  };
}

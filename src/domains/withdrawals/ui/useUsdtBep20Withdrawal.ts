import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CROSS_RAIL_WITHDRAWAL_POLICY_MESSAGE,
  formatWithdrawalCooldownMessage,
} from "@/lib/withdrawal-policy.js";
import {
  calculateWithdrawalPreview,
  createLatestWithdrawalOverviewRequestGuard,
  createWithdrawalAttemptKeyManager,
  floorUsdtToSix,
  isMinimumWithdrawal,
  isValidBep20Address,
  NowpaymentsWithdrawalUiError,
  parseUsdtMicros,
  runSingleFlight,
  fetchNowpaymentsWithdrawalOverview,
  submitNowpaymentsWithdrawalRequest,
  type NowpaymentsWithdrawalOverview,
} from "@/lib/nowpayments-withdrawal-ui.js";

const HISTORY_PREVIEW_LIMIT = 8;

export function useUsdtBep20Withdrawal({
  accessToken,
  userId,
}: {
  accessToken: string | null;
  userId: string | null;
}) {
  const authIdentity = useMemo(
    () => (accessToken && userId ? { userId } : null),
    [accessToken, userId],
  );
  const [overviewState, setOverviewState] = useState<{
    identity: object | null;
    overview: NowpaymentsWithdrawalOverview | null;
    loading: boolean;
    loadError: boolean;
  }>({
    identity: null,
    overview: null,
    loading: true,
    loadError: false,
  });
  const [grossAmount, setGrossAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [fundPassword, setFundPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const mountedRef = useRef(true);
  const authIdentityRef = useRef(authIdentity);
  authIdentityRef.current = authIdentity;
  const overviewRequestsRef = useRef<ReturnType<
    typeof createLatestWithdrawalOverviewRequestGuard
  > | null>(null);
  if (overviewRequestsRef.current === null) {
    overviewRequestsRef.current = createLatestWithdrawalOverviewRequestGuard();
  }
  const submitPromiseRef = useRef<Promise<void> | null>(null);
  const attemptKeysRef = useRef<ReturnType<typeof createWithdrawalAttemptKeyManager> | null>(null);
  if (attemptKeysRef.current === null) {
    attemptKeysRef.current = createWithdrawalAttemptKeyManager();
  }
  const visibleOverviewState = overviewState.identity === authIdentity
    ? overviewState
    : {
        identity: authIdentity,
        overview: null,
        loading: authIdentity !== null,
        loadError: authIdentity === null,
      };
  const {
    overview,
    loading,
    loadError,
  } = visibleOverviewState;

  const loadOverview = useCallback(async () => {
    if (!accessToken || !authIdentity) {
      overviewRequestsRef.current!.invalidate();
      if (mountedRef.current) {
        setOverviewState({
          identity: null,
          overview: null,
          loading: false,
          loadError: true,
        });
      }
      return;
    }
    const request = overviewRequestsRef.current!.begin(authIdentity);
    if (mountedRef.current && request.isCurrent()) {
      setOverviewState((current) => ({
        identity: authIdentity,
        overview: current.identity === authIdentity ? current.overview : null,
        loading: true,
        loadError: false,
      }));
    }
    try {
      const nextOverview = await fetchNowpaymentsWithdrawalOverview(
        accessToken,
        fetch,
        request.signal,
      );
      if (mountedRef.current && request.isCurrent()) {
        setOverviewState({
          identity: authIdentity,
          overview: nextOverview,
          loading: false,
          loadError: false,
        });
      }
    } catch {
      if (mountedRef.current && request.isCurrent()) {
        setOverviewState((current) => ({
          identity: authIdentity,
          overview: current.identity === authIdentity ? current.overview : null,
          loading: false,
          loadError: true,
        }));
      }
    }
  }, [accessToken, authIdentity]);

  useEffect(() => {
    mountedRef.current = true;
    setGrossAmount("");
    setDestination("");
    setFundPassword("");
    setSubmitting(false);
    attemptKeysRef.current!.clear();
    submitPromiseRef.current = null;
    void loadOverview();
    return () => {
      mountedRef.current = false;
      overviewRequestsRef.current!.invalidate();
    };
  }, [loadOverview]);

  const preview = useMemo(() => calculateWithdrawalPreview(grossAmount), [grossAmount]);
  const availableMicros = useMemo(
    () => overview
      ? parseUsdtMicros(floorUsdtToSix(overview.available_balance_usdt) ?? "0") ?? 0n
      : 0n,
    [overview],
  );
  const amountValid = preview !== null && isMinimumWithdrawal(grossAmount);
  const addressValid = isValidBep20Address(destination);
  const fundPasswordValid = /^[0-9]{4}$/.test(fundPassword);
  const sufficientBalance = preview !== null && preview.grossMicros <= availableMicros;
  const controlsEnabled = overview?.withdrawals_enabled === true && !loading && !submitting;
  const canSubmit = controlsEnabled
    && amountValid
    && addressValid
    && fundPasswordValid
    && sufficientBalance;
  const visibleHistory = overview?.history.slice(
    0,
    historyExpanded ? undefined : HISTORY_PREVIEW_LIMIT,
  ) ?? [];
  const historyExpandable = (overview?.history.length ?? 0) > HISTORY_PREVIEW_LIMIT;

  const handleMax = () => {
    if (!controlsEnabled || !overview) return;
    setGrossAmount(floorUsdtToSix(overview.available_balance_usdt) ?? "0");
  };

  const submit = async () => {
    if (!accessToken || !authIdentity || !overview?.withdrawals_enabled) return;
    if (!amountValid) {
      toast.error("Enter at least 2 USDT with no more than six decimals.");
      return;
    }
    if (!addressValid) {
      toast.error("Enter a valid USDT BEP20 destination address.");
      return;
    }
    if (!fundPasswordValid) {
      toast.error("Enter your four-digit Fund PIN.");
      return;
    }
    if (!sufficientBalance) {
      toast.error("Insufficient available USDT balance.");
      return;
    }

    const normalizedAddress = destination.toLowerCase();
    const idempotencyKey = attemptKeysRef.current!.keyFor(
      grossAmount,
      normalizedAddress,
      fundPassword,
    );
    const submissionIdentity = authIdentity;
    overviewRequestsRef.current!.invalidate();
    setOverviewState((current) => ({
      ...current,
      loading: false,
    }));
    setSubmitting(true);
    try {
      await submitNowpaymentsWithdrawalRequest(accessToken, {
        gross_amount_usdt: grossAmount,
        destination_address: normalizedAddress,
        fund_password: fundPassword,
        idempotency_key: idempotencyKey,
      });
      if (!mountedRef.current || authIdentityRef.current !== submissionIdentity) return;
      attemptKeysRef.current!.clear();
      setGrossAmount("");
      setDestination("");
      setFundPassword("");
      toast.success("USDT withdrawal submitted.");
      await loadOverview();
    } catch (error) {
      if (!mountedRef.current || authIdentityRef.current !== submissionIdentity) return;
      if (error instanceof NowpaymentsWithdrawalUiError) {
        const messages: Record<NowpaymentsWithdrawalUiError["kind"], string> = {
          authentication: "Your session has expired. Please sign in again.",
          disabled: "USDT withdrawals are temporarily unavailable.",
          cooldown: `${CROSS_RAIL_WITHDRAWAL_POLICY_MESSAGE}.`,
          conflict: "A withdrawal is already in progress or this request changed. Refresh and review it.",
          insufficient_balance: "Insufficient available USDT balance.",
          invalid_destination: "Use a valid external USDT BEP20 destination address.",
          fund_password_not_set: "Create your four-digit Fund PIN in Security first.",
          incorrect_fund_password: "Incorrect Fund PIN.",
          fund_password_locked: "Fund PIN verification is temporarily locked. Try again later.",
          validation: "Check the withdrawal amount, destination, and Fund PIN.",
          unavailable: "USDT withdrawal could not be submitted. You can retry safely.",
        };
        toast.error(
          error.kind === "cooldown"
            ? formatWithdrawalCooldownMessage(error.nextAllowedAt)
            : messages[error.kind],
        );
      } else {
        toast.error("USDT withdrawal could not be submitted. You can retry safely.");
      }
    } finally {
      if (mountedRef.current && authIdentityRef.current === submissionIdentity) {
        setSubmitting(false);
      }
    }
  };

  const handleSubmit = () => runSingleFlight(submitPromiseRef, submit);

  return {
    canSubmit,
    controlsEnabled,
    destination,
    fundPassword,
    grossAmount,
    handleMax,
    handleSubmit,
    historyExpandable,
    historyExpanded,
    loadError,
    loadOverview,
    loading,
    overview,
    preview,
    setDestination,
    setFundPassword,
    setGrossAmount,
    setHistoryExpanded,
    submitting,
    sufficientBalance,
    visibleHistory,
  };
}

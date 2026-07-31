import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { withTimeout } from "@/lib/async.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { submitDepositFn, getUserDepositsFn } from "@/lib/server/deposits.js";
import { getPaymentMethodsFn } from "@/lib/server/payment-methods.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import { getFiatDepositMethodMeta, getFiatDepositMethodOrder } from "./fiat-deposit-providers.js";
import type {
  FiatDepositMethodOption,
  FiatDepositStep,
  FiatPaymentMethod,
  UserFiatDeposit,
} from "./fiat-deposit-types.js";

const METHOD_LOAD_TIMEOUT_MS = 10_000;
const HISTORY_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

function parseOptionalAmount(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;

  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

export function useFiatDeposit() {
  const user = useAuthStore((state) => state.user);
  const accessToken = useAuthStore((state) => state.session?.access_token ?? null);
  const fetchWallet = useWalletStore((state) => state.fetchWallet);

  const [methods, setMethods] = useState<FiatPaymentMethod[]>([]);
  const [methodsLoaded, setMethodsLoaded] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<FiatPaymentMethod | null>(null);
  const [amount, setAmount] = useState("");
  const [txReference, setTxReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deposits, setDeposits] = useState<UserFiatDeposit[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [step, setStep] = useState<FiatDepositStep>("select");

  const mountedRef = useRef(true);
  const methodsLoadingRef = useRef(false);
  const methodsRetryCountRef = useRef(0);
  const methodsRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyLoadingRef = useRef(false);
  const historyRetryCountRef = useRef(0);
  const historyRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMethodsRetryTimer = useCallback(() => {
    if (methodsRetryTimerRef.current) {
      clearTimeout(methodsRetryTimerRef.current);
      methodsRetryTimerRef.current = null;
    }
  }, []);

  const clearHistoryRetryTimer = useCallback(() => {
    if (historyRetryTimerRef.current) {
      clearTimeout(historyRetryTimerRef.current);
      historyRetryTimerRef.current = null;
    }
  }, []);

  const scheduleMethodsRetry = useCallback(
    (loadFn: () => void) => {
      clearMethodsRetryTimer();
      if (methodsRetryCountRef.current >= MAX_AUTO_RETRIES) return;

      methodsRetryCountRef.current += 1;
      methodsRetryTimerRef.current = setTimeout(loadFn, AUTO_RETRY_DELAY_MS);
    },
    [clearMethodsRetryTimer],
  );

  const scheduleHistoryRetry = useCallback(
    (loadFn: () => void) => {
      clearHistoryRetryTimer();
      if (historyRetryCountRef.current >= MAX_AUTO_RETRIES) return;

      historyRetryCountRef.current += 1;
      historyRetryTimerRef.current = setTimeout(loadFn, AUTO_RETRY_DELAY_MS);
    },
    [clearHistoryRetryTimer],
  );

  const loadMethods = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (methodsLoadingRef.current) return;
      if (options?.resetRetryCount) methodsRetryCountRef.current = 0;

      clearMethodsRetryTimer();
      methodsLoadingRef.current = true;

      try {
        const result = await withTimeout(
          getPaymentMethodsFn({ data: { activeOnly: true } }),
          METHOD_LOAD_TIMEOUT_MS,
          "Payment methods request timed out.",
        );
        if (!mountedRef.current) return;

        setMethods(result as FiatPaymentMethod[]);
        setMethodsLoaded(true);
        methodsRetryCountRef.current = 0;
      } catch (error) {
        console.error("[QHash] Deposit payment methods background refresh failed:", error);
        if (!mountedRef.current) return;
        scheduleMethodsRetry(() => void loadMethods());
      } finally {
        methodsLoadingRef.current = false;
      }
    },
    [clearMethodsRetryTimer, scheduleMethodsRetry],
  );

  const loadHistory = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (historyLoadingRef.current) return;
      if (options?.resetRetryCount) historyRetryCountRef.current = 0;
      if (!user?.id || !accessToken) return;

      clearHistoryRetryTimer();
      historyLoadingRef.current = true;

      try {
        const result = await withTimeout(
          getUserDepositsFn({ data: { accessToken } }),
          HISTORY_LOAD_TIMEOUT_MS,
          "Deposit history request timed out.",
        );
        if (!mountedRef.current) return;

        setDeposits(result);
        setHistoryLoaded(true);
        historyRetryCountRef.current = 0;
      } catch (error) {
        console.error("[QHash] Deposit history background refresh failed:", error);
        if (!mountedRef.current) return;
        scheduleHistoryRetry(() => void loadHistory());
      } finally {
        historyLoadingRef.current = false;
      }
    },
    [accessToken, clearHistoryRetryTimer, scheduleHistoryRetry, user?.id],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadMethods({ resetRetryCount: true });
    void loadHistory({ resetRetryCount: true });

    return () => {
      mountedRef.current = false;
      clearMethodsRetryTimer();
      clearHistoryRetryTimer();
    };
  }, [clearHistoryRetryTimer, clearMethodsRetryTimer, loadHistory, loadMethods]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void loadMethods({ resetRetryCount: true });
        void loadHistory({ resetRetryCount: true });
      }
    };
    const handleOnline = () => {
      void loadMethods({ resetRetryCount: true });
      void loadHistory({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadHistory, loadMethods]);

  const resetForm = useCallback(() => {
    setStep("select");
    setSelectedMethod(null);
    setAmount("");
    setTxReference("");
  }, []);

  const selectMethod = useCallback((method: FiatPaymentMethod) => {
    setSelectedMethod(method);
    setStep("form");
  }, []);

  const submit = useCallback(async () => {
    if (!user?.id || !selectedMethod || submitting) return;

    const meta = getFiatDepositMethodMeta(selectedMethod.type);
    const reference = txReference.trim().toUpperCase();
    if (!reference) {
      toast.error("Enter your transaction ID.");
      return;
    }
    if (!reference.startsWith(meta.refPrefix)) {
      toast.error(meta.refError);
      return;
    }

    const amountInput = amount.trim();
    const parsedAmount = parseOptionalAmount(amountInput);
    if (amountInput && (!Number.isFinite(parsedAmount) || parsedAmount <= 0)) {
      toast.error("Enter a valid amount or leave it blank.");
      return;
    }
    if (!accessToken) {
      toast.error("Session expired. Please sign in again.");
      return;
    }

    setSubmitting(true);
    try {
      await submitDepositFn({
        data: {
          accessToken,
          amount: parsedAmount,
          paymentMethodId: selectedMethod.id,
          transactionReference: reference,
        },
      });
      toast.success(meta.successToast);
      resetForm();
      void loadHistory({ resetRetryCount: true });
      void fetchWallet(user.id);
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "DEPOSIT").message);
    } finally {
      setSubmitting(false);
    }
  }, [
    accessToken,
    amount,
    fetchWallet,
    loadHistory,
    resetForm,
    selectedMethod,
    submitting,
    txReference,
    user?.id,
  ]);

  const methodOptions = useMemo<FiatDepositMethodOption[]>(
    () =>
      Object.entries(
        methods.reduce(
          (accountsByType, method) => {
            if (!accountsByType[method.type]) accountsByType[method.type] = [];
            accountsByType[method.type].push(method);
            return accountsByType;
          },
          {} as Record<string, FiatPaymentMethod[]>,
        ),
      )
        .sort(([left], [right]) =>
          getFiatDepositMethodOrder(left) - getFiatDepositMethodOrder(right))
        .flatMap(([, accounts]) =>
          accounts.map((method, index) => ({ method, index, total: accounts.length }))),
    [methods],
  );

  return {
    amount,
    deposits,
    historyLoaded,
    methodOptions,
    methodsCount: methods.length,
    methodsLoaded,
    resetForm,
    selectMethod,
    selectedMethod,
    setAmount,
    setTxReference,
    step,
    submit,
    submitting,
    txReference,
  };
}

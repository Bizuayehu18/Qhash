import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { formatWithdrawalCooldownMessage } from "@/lib/withdrawal-policy.js";
import { submitFiatWithdrawal } from "../application/fiat-withdrawal-browser-service.js";
import {
  createLatestFiatWithdrawalRequestGuard,
  fiatWithdrawalAuthIdentityMatches,
  type FiatWithdrawalAuthIdentity,
} from "./fiat-withdrawal-auth-lifecycle.js";
import { getFiatWithdrawalSpecificErrorMessage } from "./fiat-withdrawal-errors.js";
import { onlyFourDigits } from "./fiat-withdrawal-format.js";
import { getFiatWithdrawalMethodMeta } from "./fiat-withdrawal-providers.js";
import type { FiatWithdrawalMethod } from "./fiat-withdrawal-provider.js";
import type { FiatWithdrawalStep } from "./fiat-withdrawal-types.js";
import {
  ETHIOPIA_MIN_WITHDRAWAL_AMOUNT_ETB,
  ETHIOPIA_WITHDRAWAL_FEE_PERCENT,
} from "./providers/et/ethiopia-withdrawal-policy.js";
import { useFiatWithdrawalRemoteState } from "./useFiatWithdrawalRemoteState.js";

export function useFiatWithdrawal() {
  const navigate = useNavigate();
  const remote = useFiatWithdrawalRemoteState();
  const [formIdentity, setFormIdentity] =
    useState<FiatWithdrawalAuthIdentity | null>(remote.authIdentity);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<FiatWithdrawalMethod | null>(null);
  const [withdrawalStep, setWithdrawalStep] = useState<FiatWithdrawalStep>("details");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [fundPassword, setFundPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const mountedRef = useRef(true);
  const authIdentityRef = useRef(remote.authIdentity);
  const submissionGuardRef = useRef(createLatestFiatWithdrawalRequestGuard());
  const submissionPromiseRef = useRef<Promise<void> | null>(null);

  authIdentityRef.current = remote.authIdentity;

  const formBelongsToCurrentIdentity = fiatWithdrawalAuthIdentityMatches(
    formIdentity,
    remote.authIdentity,
  );
  const visibleAmount = formBelongsToCurrentIdentity ? amount : "";
  const visibleMethod = formBelongsToCurrentIdentity ? method : null;
  const visibleAccountName = formBelongsToCurrentIdentity ? accountName : "";
  const visibleAccountNumber = formBelongsToCurrentIdentity ? accountNumber : "";
  const visibleFundPassword = formBelongsToCurrentIdentity ? fundPassword : "";

  const parsedAmount = useMemo(() => {
    const value = Number(visibleAmount);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [visibleAmount]);
  const feeAmount = useMemo(
    () =>
      parsedAmount > 0
        ? (parsedAmount * ETHIOPIA_WITHDRAWAL_FEE_PERCENT) / 100
        : 0,
    [parsedAmount],
  );
  const netAmount = useMemo(
    () => Math.max(parsedAmount - feeAmount, 0),
    [feeAmount, parsedAmount],
  );
  const hasEnoughBalance =
    remote.walletBalance === null || parsedAmount <= remote.walletBalance;
  const selectedMeta = visibleMethod ? getFiatWithdrawalMethodMeta(visibleMethod) : null;

  const resetForm = useCallback(() => {
    setAmount("");
    setMethod(null);
    setWithdrawalStep("details");
    setAccountName("");
    setAccountNumber("");
    setFundPassword("");
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      submissionGuardRef.current.invalidate();
      submissionPromiseRef.current = null;
    };
  }, []);

  useEffect(() => {
    submissionGuardRef.current.invalidate();
    submissionPromiseRef.current = null;
    setSubmitting(false);
    setFormIdentity(remote.authIdentity);
    resetForm();
  }, [remote.authIdentity, resetForm]);

  const changeMethod = useCallback(() => {
    setMethod(null);
    setWithdrawalStep("details");
    setAccountName("");
    setAccountNumber("");
    setFundPassword("");
  }, []);

  const goToFundPasswordSetup = useCallback(() => {
    void navigate({ to: "/profile/security/fund-password" });
  }, [navigate]);

  const selectMethod = useCallback(
    (nextMethod: FiatWithdrawalMethod) => {
      if (remote.loadingSecurityStatus) {
        toast.info("Checking withdrawal security. Please try again in a moment.");
        return;
      }
      if (!remote.securityStatus) {
        toast.error("Unable to verify withdrawal security. Please try again.");
        void remote.refreshSecurityStatus();
        return;
      }
      if (remote.securityStatus.isFundPasswordLocked) {
        toast.error("Withdrawal security is temporarily locked. Please try again later.");
        return;
      }
      if (!remote.securityStatus.hasFundPassword) {
        toast.error("Please set your fund password first.");
        goToFundPasswordSetup();
        return;
      }

      setFormIdentity(remote.authIdentity);
      setMethod(nextMethod);
      setWithdrawalStep("details");
      setFundPassword("");
    },
    [
      goToFundPasswordSetup,
      remote.authIdentity,
      remote.loadingSecurityStatus,
      remote.refreshSecurityStatus,
      remote.securityStatus,
    ],
  );

  const validateDetails = useCallback((): string | null => {
    if (!formBelongsToCurrentIdentity || !visibleMethod) {
      return "Please choose a withdrawal method.";
    }
    if (!remote.userId) return "Please log in again.";
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return "Please enter a valid withdrawal amount.";
    }
    if (parsedAmount < ETHIOPIA_MIN_WITHDRAWAL_AMOUNT_ETB) {
      return `Minimum withdrawal amount is ${ETHIOPIA_MIN_WITHDRAWAL_AMOUNT_ETB} ETB.`;
    }
    if (!hasEnoughBalance) return "Insufficient wallet balance.";
    if (visibleAccountName.trim().length < 2) {
      return "Please enter a valid account name.";
    }
    if (visibleAccountNumber.trim().length < 5) {
      return "Please enter a valid account number.";
    }
    return null;
  }, [
    formBelongsToCurrentIdentity,
    hasEnoughBalance,
    parsedAmount,
    remote.userId,
    visibleAccountName,
    visibleAccountNumber,
    visibleMethod,
  ]);

  const continueToConfirm = useCallback(() => {
    const validationMessage = validateDetails();
    if (validationMessage) return toast.error(validationMessage);

    setFundPassword("");
    setWithdrawalStep("confirm");
  }, [validateDetails]);

  const backToDetails = useCallback(() => {
    setFundPassword("");
    setWithdrawalStep("details");
  }, []);

  const submit = useCallback((): Promise<void> => {
    if (submissionPromiseRef.current) return submissionPromiseRef.current;

    const validationMessage = validateDetails();
    if (validationMessage) {
      toast.error(validationMessage);
      return Promise.resolve();
    }
    if (visibleFundPassword.length !== 4) {
      toast.error("Enter your 4-digit fund password.");
      return Promise.resolve();
    }

    const requestIdentity = remote.authIdentity;
    if (!requestIdentity || !visibleMethod) {
      toast.error("Your session has expired. Please log in again.");
      return Promise.resolve();
    }

    const ticket = submissionGuardRef.current.begin(requestIdentity);
    const isCurrentSubmission = () =>
      mountedRef.current && ticket.isCurrent(authIdentityRef.current);
    const request = Promise.resolve().then(async () => {
      if (!isCurrentSubmission()) return;
      setSubmitting(true);

      try {
        const result = await submitFiatWithdrawal({
          accessToken: requestIdentity.accessToken,
          amount: parsedAmount,
          method: visibleMethod,
          accountName: visibleAccountName.trim(),
          accountNumber: visibleAccountNumber.trim(),
          fundPassword: visibleFundPassword,
        });
        if (!isCurrentSubmission()) return;

        if (result?.success !== true) {
          if (result?.code === "withdrawal_cooldown_active") {
            toast.error(formatWithdrawalCooldownMessage(result.next_allowed_at));
            return;
          }
          toast.error(
            typeof result?.message === "string" && result.message.trim().length > 0
              ? result.message
              : "Withdrawal request failed. Please try again.",
          );
          return;
        }

        toast.success("Withdrawal request submitted.");
        resetForm();
        void remote.refreshWithdrawals({ resetRetryCount: true });
        void remote.refreshSecurityStatus();
        remote.refreshWallet(true);
      } catch (error) {
        if (!isCurrentSubmission()) return;

        const specificMessage = getFiatWithdrawalSpecificErrorMessage(error);
        toast.error(
          specificMessage ?? getSafeErrorMessage(error, "WITHDRAWAL").message,
        );
      } finally {
        if (isCurrentSubmission()) {
          submissionPromiseRef.current = null;
          setSubmitting(false);
        }
      }
    });

    submissionPromiseRef.current = request;
    return request;
  }, [
    parsedAmount,
    remote,
    resetForm,
    validateDetails,
    visibleAccountName,
    visibleAccountNumber,
    visibleFundPassword,
    visibleMethod,
  ]);

  return {
    accountName: visibleAccountName,
    accountNumber: visibleAccountNumber,
    amount: visibleAmount,
    backToDetails,
    changeMethod,
    continueToConfirm,
    feeAmount,
    fundPassword: visibleFundPassword,
    hasEnoughBalance,
    historyLoaded: remote.historyLoaded,
    loadingSecurityStatus: remote.loadingSecurityStatus,
    method: visibleMethod,
    netAmount,
    parsedAmount,
    securityStatus: remote.securityStatus,
    selectMethod,
    selectedMeta,
    setAccountName,
    setAccountNumber,
    setAmount,
    setFundPassword: (value: string) => setFundPassword(onlyFourDigits(value)),
    setUpFundPassword: goToFundPasswordSetup,
    submit,
    submitting,
    walletBalance: remote.walletBalance,
    withdrawals: remote.withdrawals,
    withdrawalStep,
  };
}

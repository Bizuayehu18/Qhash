import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import {
  ArrowLeft,
  Building2,
  CheckCircle,
  ChevronRight,
  Clock,
  Info,
  Smartphone,
  Wallet,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { withTimeout } from "@/lib/async.js";
import {
  getSecurityStatusFn,
  type SecurityStatus,
} from "@/lib/server/security.js";
import { submitWithdrawalFn, getUserWithdrawalsFn } from "@/lib/server/withdrawals.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";

export const Route = createFileRoute("/_app/withdraw")({ component: WithdrawPage });

type WithdrawalMethod = "cbe" | "telebirr";
type UserWithdrawal = Awaited<ReturnType<typeof getUserWithdrawalsFn>>[number];

type MethodMeta = {
  label: string;
  title: string;
  nameLabel: string;
  numberLabel: string;
  numberPlaceholder: string;
  submitLabel: string;
  icon: React.ReactNode;
};

const MIN_WITHDRAWAL_AMOUNT = 200;
const WITHDRAWAL_FEE_PERCENT = 5;
const HISTORY_LOAD_TIMEOUT_MS = 10_000;
const SECURITY_STATUS_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;
const DAILY_WITHDRAWAL_LIMIT_MESSAGE = "You can only submit one withdrawal request per day. Please try again tomorrow.";

const METHOD_LABELS: Record<WithdrawalMethod, string> = {
  cbe: "CBE",
  telebirr: "TeleBirr",
};

const METHOD_META: Record<WithdrawalMethod, MethodMeta> = {
  cbe: {
    label: "Bank transfer",
    title: "CBE Withdrawal",
    nameLabel: "CBE Account Name",
    numberLabel: "CBE Account Number",
    numberPlaceholder: "Enter CBE account number",
    submitLabel: "Submit CBE Withdrawal",
    icon: <Building2 size={16} />,
  },
  telebirr: {
    label: "Mobile wallet",
    title: "TeleBirr Withdrawal",
    nameLabel: "TeleBirr Account Name",
    numberLabel: "TeleBirr Phone Number",
    numberPlaceholder: "Enter TeleBirr phone number",
    submitLabel: "Submit TeleBirr Withdrawal",
    icon: <Smartphone size={16} />,
  },
};

function collectErrorText(error: unknown): string {
  const seen = new Set<unknown>();
  const values: string[] = [];

  const collect = (value: unknown) => {
    if (value === null || value === undefined || seen.has(value)) return;

    if (["string", "number", "boolean"].includes(typeof value)) {
      values.push(String(value));
      return;
    }

    if (typeof value !== "object") return;

    seen.add(value);

    if (value instanceof Error) {
      values.push(value.message, value.name);
    }

    Object.values(value as Record<string, unknown>).forEach(collect);
  };

  collect(error);

  return values.join(" ").toLowerCase();
}

function isDailyWithdrawalLimitError(error: unknown): boolean {
  const text = collectErrorText(error);
  return text.includes(DAILY_WITHDRAWAL_LIMIT_MESSAGE.toLowerCase()) || text.includes("daily withdrawal limit reached");
}

function getWithdrawalSpecificErrorMessage(error: unknown): string | null {
  const text = collectErrorText(error);

  if (text.includes("fund_password_not_set") || text.includes("please create your fund password first")) {
    return "Please create your fund password first from Profile → Security.";
  }

  if (text.includes("incorrect_fund_password") || text.includes("incorrect fund password")) {
    return "Incorrect fund password.";
  }

  if (
    text.includes("fund_password_locked") ||
    text.includes("fund password is temporarily locked") ||
    text.includes("too many incorrect attempts")
  ) {
    return "Fund password is temporarily locked. Please try again later.";
  }

  if (text.includes("invalid fund password format") || text.includes("fund password must be exactly 4 digits")) {
    return "Enter your 4-digit fund password.";
  }

  return null;
}

function onlyFourDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

function WithdrawPage() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const walletBalance = useWalletStore((s) => s.balance);
  const fetchWallet = useWalletStore((s) => s.fetchWallet);
  const navigate = useNavigate();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<WithdrawalMethod | null>(null);
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [fundPassword, setFundPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [withdrawals, setWithdrawals] = useState<UserWithdrawal[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus | null>(null);
  const [loadingSecurityStatus, setLoadingSecurityStatus] = useState(true);

  const mountedRef = useRef(true);
  const historyLoadingRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parsedAmount = useMemo(() => {
    const value = Number(amount);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [amount]);

  const feeAmount = useMemo(
    () => (parsedAmount > 0 ? (parsedAmount * WITHDRAWAL_FEE_PERCENT) / 100 : 0),
    [parsedAmount],
  );

  const netAmount = useMemo(() => Math.max(parsedAmount - feeAmount, 0), [parsedAmount, feeAmount]);
  const hasEnoughBalance = walletBalance === null || parsedAmount <= walletBalance;
  const selectedMeta = method ? METHOD_META[method] : null;

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const scheduleRetry = useCallback(
    (loadFn: () => void) => {
      clearRetryTimer();

      if (retryCountRef.current >= MAX_AUTO_RETRIES) return;

      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(loadFn, AUTO_RETRY_DELAY_MS);
    },
    [clearRetryTimer],
  );

  const loadWithdrawals = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (historyLoadingRef.current) return;

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (!user?.id || !accessToken) return;

      clearRetryTimer();
      historyLoadingRef.current = true;

      try {
        const rows = await withTimeout(
          getUserWithdrawalsFn({ data: { accessToken } }),
          HISTORY_LOAD_TIMEOUT_MS,
          "Withdrawal history request timed out.",
        );

        if (!mountedRef.current) return;

        setWithdrawals(rows);
        setHistoryLoaded(true);
        retryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Withdrawal history background refresh failed:", err);

        if (mountedRef.current) {
          scheduleRetry(() => void loadWithdrawals());
        }
      } finally {
        historyLoadingRef.current = false;
      }
    },
    [accessToken, clearRetryTimer, scheduleRetry, user?.id],
  );

  const loadSecurityStatus = useCallback(async () => {
    if (!user?.id || !accessToken) {
      if (mountedRef.current) {
        setSecurityStatus(null);
        setLoadingSecurityStatus(false);
      }
      return;
    }

    setLoadingSecurityStatus(true);

    try {
      const result = await withTimeout(
        getSecurityStatusFn({ data: { accessToken } }),
        SECURITY_STATUS_TIMEOUT_MS,
        "Security status request timed out.",
      );

      if (!mountedRef.current) return;

      setSecurityStatus(result);
    } catch (err) {
      console.error("[QHash] Withdrawal security status load failed:", err);

      if (mountedRef.current) {
        setSecurityStatus(null);
      }
    } finally {
      if (mountedRef.current) {
        setLoadingSecurityStatus(false);
      }
    }
  }, [accessToken, user?.id]);

  useEffect(() => {
    if (user?.id && walletBalance === null) {
      void fetchWallet(user.id);
    }
  }, [user?.id, walletBalance, fetchWallet]);

  useEffect(() => {
    mountedRef.current = true;
    void loadWithdrawals({ resetRetryCount: true });
    void loadSecurityStatus();

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer, loadSecurityStatus, loadWithdrawals]);

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

  const resetForm = () => {
    setAmount("");
    setMethod(null);
    setAccountName("");
    setAccountNumber("");
    setFundPassword("");
  };

  const changeMethod = () => {
    setMethod(null);
    setAccountName("");
    setAccountNumber("");
    setFundPassword("");
  };

  const goToFundPasswordSetup = useCallback(() => {
    void navigate({ to: "/profile/security/fund-password" });
  }, [navigate]);

  const handleMethodSelect = useCallback(
    (nextMethod: WithdrawalMethod) => {
      if (loadingSecurityStatus) {
        toast.info("Checking withdrawal security. Please try again in a moment.");
        return;
      }

      if (!securityStatus) {
        toast.error("Unable to verify withdrawal security. Please try again.");
        void loadSecurityStatus();
        return;
      }

      if (securityStatus.isFundPasswordLocked) {
        toast.error("Withdrawal security is temporarily locked. Please try again later.");
        return;
      }

      if (!securityStatus.hasFundPassword) {
        toast.error("Please set your fund password first.");
        goToFundPasswordSetup();
        return;
      }

      setMethod(nextMethod);
    },
    [goToFundPasswordSetup, loadSecurityStatus, loadingSecurityStatus, securityStatus],
  );

  const handleSubmit = async () => {
    if (submitting) return;

    const trimmedAccountName = accountName.trim();
    const trimmedAccountNumber = accountNumber.trim();

    if (!method) return toast.error("Please choose a withdrawal method.");
    if (!user?.id) return toast.error("Please log in again.");
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return toast.error("Please enter a valid withdrawal amount.");
    if (parsedAmount < MIN_WITHDRAWAL_AMOUNT) return toast.error(`Minimum withdrawal amount is ${MIN_WITHDRAWAL_AMOUNT} ETB.`);
    if (!hasEnoughBalance) return toast.error("Insufficient wallet balance.");
    if (trimmedAccountName.length < 2) return toast.error("Please enter a valid account name.");
    if (trimmedAccountNumber.length < 5) return toast.error("Please enter a valid account number.");
    if (fundPassword.length !== 4) return toast.error("Enter your 4-digit fund password.");
    if (!accessToken) return toast.error("Your session has expired. Please log in again.");

    setSubmitting(true);

    try {
      const result = await submitWithdrawalFn({
        data: {
          accessToken,
          amount: parsedAmount,
          method,
          accountName: trimmedAccountName,
          accountNumber: trimmedAccountNumber,
          fundPassword,
        },
      });

      if (result?.success !== true) {
        toast.error(
          typeof result?.message === "string" && result.message.trim().length > 0
            ? result.message
            : "Withdrawal request failed. Please try again.",
        );
        return;
      }

      toast.success("Withdrawal request submitted.");
      resetForm();
      void loadWithdrawals({ resetRetryCount: true });
      void loadSecurityStatus();
      void fetchWallet(user.id);
    } catch (err) {
      console.error("[QHash] Withdrawal submit failed:", err);

      if (isDailyWithdrawalLimitError(err)) {
        return toast.error(DAILY_WITHDRAWAL_LIMIT_MESSAGE);
      }

      const specificMessage = getWithdrawalSpecificErrorMessage(err);
      toast.error(specificMessage ?? getSafeErrorMessage(err, "WITHDRAWAL").message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 pb-20 lg:mx-auto lg:grid lg:max-w-5xl lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0">
      <div className="lg:col-span-12">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
          Withdrawal Center
        </p>
        <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">Withdraw</h1>
        <p className="mt-1 text-xs text-gray-500">
          Request a withdrawal to your CBE or TeleBirr account.
        </p>
      </div>

      <div className="space-y-3 lg:col-span-7 xl:col-span-8">
        <BalanceStrip walletBalance={walletBalance} />

        {!method ? (
          <>
            <MethodPicker onSelect={handleMethodSelect} />
            <FundPasswordStatusLine
              securityStatus={securityStatus}
              loading={loadingSecurityStatus}
              onSetNow={goToFundPasswordSetup}
            />
            <NoticeLine />
          </>
        ) : (
          <WithdrawalForm
            method={method}
            selectedMeta={selectedMeta}
            amount={amount}
            accountName={accountName}
            accountNumber={accountNumber}
            fundPassword={fundPassword}
            parsedAmount={parsedAmount}
            feeAmount={feeAmount}
            netAmount={netAmount}
            hasEnoughBalance={hasEnoughBalance}
            submitting={submitting}
            onAmountChange={setAmount}
            onAccountNameChange={setAccountName}
            onAccountNumberChange={setAccountNumber}
            onFundPasswordChange={(value) => setFundPassword(onlyFourDigits(value))}
            onChangeMethod={changeMethod}
            onSubmit={handleSubmit}
          />
        )}
      </div>

      <div className="lg:col-span-5 xl:col-span-4">
        <WithdrawalHistory withdrawals={withdrawals} historyLoaded={historyLoaded} />
      </div>
    </div>
  );
}

function BalanceStrip({ walletBalance }: { walletBalance: number | null }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[rgba(0,255,65,0.16)] bg-[#111] px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.07)]">
          <Wallet size={15} className="text-[#00ff41]" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#00ff41]/70">
            Available
          </p>
          <p className="text-[10px] text-gray-600">Wallet balance</p>
        </div>
      </div>

      {walletBalance === null ? (
        <span className="skeleton inline-block h-5 w-24 rounded" aria-label="Loading available balance" />
      ) : (
        <div className="shrink-0 text-right">
          <span className="text-base font-black leading-none text-[#00ff41]">
            {formatMoney(walletBalance)}
          </span>
          <span className="ml-1 text-[10px] font-semibold text-gray-500">ETB</span>
        </div>
      )}
    </div>
  );
}

function MethodPicker({ onSelect }: { onSelect: (method: WithdrawalMethod) => void }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-100">Choose Method</h2>
        <Badge variant="neon" className="shrink-0 text-[9px]">2 options</Badge>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111]">
        {(["cbe", "telebirr"] as WithdrawalMethod[]).map((value, index) => (
          <MethodSelectorRow
            key={value}
            method={value}
            isLast={index === 1}
            onClick={() => onSelect(value)}
          />
        ))}
      </div>
    </section>
  );
}

function FundPasswordStatusLine({
  securityStatus,
  loading,
  onSetNow,
}: {
  securityStatus: SecurityStatus | null;
  loading: boolean;
  onSetNow: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-[#1a1a1a] bg-[#111] px-3 py-2.5">
        <Info size={13} className="mt-0.5 shrink-0 text-gray-500" />
        <p className="text-[10px] leading-relaxed text-gray-500">
          Checking fund password status…
        </p>
      </div>
    );
  }

  if (!securityStatus) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5">
        <Info size={13} className="mt-0.5 shrink-0 text-yellow-400" />
        <p className="text-[10px] leading-relaxed text-yellow-300">
          Unable to verify withdrawal security. Please try again.
        </p>
      </div>
    );
  }

  if (securityStatus.isFundPasswordLocked) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5">
        <Info size={13} className="mt-0.5 shrink-0 text-yellow-400" />
        <p className="text-[10px] leading-relaxed text-yellow-300">
          Fund password is temporarily locked. Please try again later.
        </p>
      </div>
    );
  }

  if (!securityStatus.hasFundPassword) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <Info size={13} className="mt-0.5 shrink-0 text-yellow-400" />
          <p className="text-[10px] leading-relaxed text-yellow-300">
            Fund password required before withdrawing.
          </p>
        </div>
        <button
          type="button"
          onClick={onSetNow}
          className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-[#00ff41] card-press"
        >
          Set now
          <ChevronRight size={12} />
        </button>
      </div>
    );
  }

  return null;
}

function NoticeLine() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.035)] px-3 py-2.5">
      <Info size={13} className="mt-0.5 shrink-0 text-[#00ff41]" />
      <p className="text-[10px] leading-relaxed text-gray-500">
        <span className="font-semibold text-[#00ff41]">24h processing</span>
        <span> · Min {MIN_WITHDRAWAL_AMOUNT} ETB · {WITHDRAWAL_FEE_PERCENT}% fee · One request/day</span>
      </p>
    </div>
  );
}

function WithdrawalForm({
  method,
  selectedMeta,
  amount,
  accountName,
  accountNumber,
  fundPassword,
  parsedAmount,
  feeAmount,
  netAmount,
  hasEnoughBalance,
  submitting,
  onAmountChange,
  onAccountNameChange,
  onAccountNumberChange,
  onFundPasswordChange,
  onChangeMethod,
  onSubmit,
}: {
  method: WithdrawalMethod;
  selectedMeta: MethodMeta | null;
  amount: string;
  accountName: string;
  accountNumber: string;
  fundPassword: string;
  parsedAmount: number;
  feeAmount: number;
  netAmount: number;
  hasEnoughBalance: boolean;
  submitting: boolean;
  onAmountChange: (value: string) => void;
  onAccountNameChange: (value: string) => void;
  onAccountNumberChange: (value: string) => void;
  onFundPasswordChange: (value: string) => void;
  onChangeMethod: () => void;
  onSubmit: () => void;
}) {
  const canSubmit =
    !submitting &&
    parsedAmount >= MIN_WITHDRAWAL_AMOUNT &&
    hasEnoughBalance &&
    accountName.trim().length >= 2 &&
    accountNumber.trim().length >= 5 &&
    fundPassword.length === 4;

  return (
    <section className="overflow-hidden rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111]">
      <div className="border-b border-[#1a1a1a] px-3.5 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onChangeMethod}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] text-gray-400 transition-colors hover:border-[rgba(0,255,65,0.35)] hover:text-[#00ff41] card-press"
            aria-label="Change withdrawal method"
          >
            <ArrowLeft size={14} />
          </button>

          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
            {selectedMeta?.icon}
          </div>

          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold leading-tight text-gray-100">
              {selectedMeta?.title}
            </h2>
          </div>

          <Badge variant="neon" className="shrink-0 text-[9px]">
            {METHOD_LABELS[method]}
          </Badge>
        </div>
      </div>

      <div className="space-y-3.5 p-3.5">
        <Input
          label="Amount (ETB)"
          type="text"
          placeholder="0.00"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          inputMode="decimal"
          hint={`Minimum withdrawal is ${MIN_WITHDRAWAL_AMOUNT} ETB.`}
        />

        <Input
          label={selectedMeta?.nameLabel ?? "Account Name"}
          type="text"
          placeholder="Enter account holder name"
          value={accountName}
          onChange={(e) => onAccountNameChange(e.target.value)}
        />

        <Input
          label={selectedMeta?.numberLabel ?? "Account Number"}
          type="text"
          placeholder={selectedMeta?.numberPlaceholder ?? "Enter account number"}
          value={accountNumber}
          onChange={(e) => onAccountNumberChange(e.target.value)}
        />

        <Input
          label="Fund Password"
          type="password"
          placeholder="Enter 4-digit fund password"
          value={fundPassword}
          onChange={(e) => onFundPasswordChange(e.target.value)}
          inputMode="numeric"
          maxLength={4}
          autoComplete="current-password"
          hint="Required for every withdrawal."
        />

        {parsedAmount > 0 && (
          <SummaryCard amount={parsedAmount} fee={feeAmount} net={netAmount} />
        )}

        {!hasEnoughBalance && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-[11px] leading-relaxed text-red-400">
            Insufficient wallet balance for this withdrawal amount.
          </div>
        )}

        <Button
          fullWidth
          loading={submitting}
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          {selectedMeta?.submitLabel ?? "Submit Withdrawal"}
        </Button>
      </div>
    </section>
  );
}

function MethodSelectorRow({
  method,
  onClick,
  isLast,
}: {
  method: WithdrawalMethod;
  onClick: () => void;
  isLast: boolean;
}) {
  const meta = METHOD_META[method];

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "group w-full px-3.5 py-3 text-left transition-colors hover:bg-[rgba(0,255,65,0.035)] card-press",
        isLast ? "" : "border-b border-[#1a1a1a]",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.045)] text-[#00ff41]">
          {meta.icon}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-gray-100">{METHOD_LABELS[method]}</span>
          <span className="mt-0.5 block text-[11px] text-gray-500">{meta.label}</span>
        </span>

        <ChevronRight
          size={15}
          className="shrink-0 text-gray-600 transition-colors group-hover:text-[#00ff41]"
        />
      </div>
    </button>
  );
}

function SummaryCard({ amount, fee, net }: { amount: number; fee: number; net: number }) {
  return (
    <div className="space-y-2 rounded-xl border border-[#1f1f1f] bg-[#0b0b0b] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-gray-200">Summary</span>
        <span className="text-[10px] text-gray-600">Fee {WITHDRAWAL_FEE_PERCENT}%</span>
      </div>

      <SummaryRow label="Amount" value={`${formatMoney(amount)} ETB`} />
      <SummaryRow label="Fee" value={`${formatMoney(fee)} ETB`} />
      <div className="border-t border-[#1a1a1a] pt-2">
        <SummaryRow label="You receive" value={`${formatMoney(net)} ETB`} highlight />
      </div>
    </div>
  );
}

function WithdrawalHistory({
  withdrawals,
  historyLoaded,
}: {
  withdrawals: UserWithdrawal[];
  historyLoaded: boolean;
}) {
  return (
    <section className="mt-1 space-y-2.5 lg:mt-0">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-100">Withdrawal History</h2>

        {withdrawals.length > 0 && (
          <Badge variant="default" className="shrink-0 text-[9px]">
            {withdrawals.length}
          </Badge>
        )}
      </div>

      {!historyLoaded && withdrawals.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : historyLoaded && withdrawals.length === 0 ? (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-6 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-[#1a1a1a] bg-[#0b0b0b]">
            <Clock size={17} className="text-gray-600" />
          </div>
          <p className="mt-3 text-sm font-semibold text-gray-300">No withdrawals yet</p>
          <p className="mt-1 text-xs text-gray-600">
            Submitted requests will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111] divide-y divide-[#1a1a1a]">
          {withdrawals.map((withdrawal) => (
            <WithdrawalHistoryItem key={withdrawal.id} withdrawal={withdrawal} />
          ))}
        </div>
      )}
    </section>
  );
}

function WithdrawalHistoryItem({ withdrawal }: { withdrawal: UserWithdrawal }) {
  const fee = withdrawal.fee_amount ?? 0;
  const net = withdrawal.net_amount ?? Math.max(withdrawal.amount - fee, 0);

  return (
    <div className="space-y-2.5 px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="font-mono text-sm font-semibold text-red-400">
            -{formatMoney(withdrawal.amount)} ETB
          </span>
          <p className="mt-0.5 text-[10px] text-gray-600">{formatDate(withdrawal.created_at)}</p>
        </div>

        <WithdrawalStatusBadge status={withdrawal.status} />
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-500">
        <HistoryDetail label="Method" value={METHOD_LABELS[withdrawal.method] ?? withdrawal.method} />
        <HistoryDetail
          label="Account"
          value={`${withdrawal.account_name}${withdrawal.account_last4 ? ` • ${withdrawal.account_last4}` : ""}`}
        />
        <HistoryDetail label="Fee" value={`${formatMoney(fee)} ETB`} />
        <HistoryDetail label="Net" value={`${formatMoney(net)} ETB`} />
      </div>
    </div>
  );
}

function HistoryDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#1a1a1a] bg-[#0b0b0b] px-2.5 py-2">
      <span className="block text-gray-600">{label}</span>
      <p className="mt-0.5 truncate text-gray-400">{value}</p>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={highlight ? "font-semibold text-[#00ff41]" : "text-gray-300"}>
        {value}
      </span>
    </div>
  );
}

function WithdrawalStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "success" | "warning" | "danger" | "default"; icon: React.ReactNode }> = {
    approved: { label: "Approved", variant: "success", icon: <CheckCircle size={12} /> },
    pending: { label: "Pending", variant: "warning", icon: <Clock size={12} /> },
    rejected: { label: "Rejected", variant: "danger", icon: <XCircle size={12} /> },
  };

  const item = config[status] ?? {
    label: status,
    variant: "default" as const,
    icon: <Clock size={12} />,
  };

  return (
    <Badge variant={item.variant} className="gap-1">
      {item.icon}
      {item.label}
    </Badge>
  );
}

function formatMoney(value: number): string {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | null): string {
  if (!value) return "";

  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

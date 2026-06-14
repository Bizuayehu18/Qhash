import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { Spinner } from "@/components/ui/Spinner.js";
import {
  ArrowUpCircle,
  Building2,
  CheckCircle,
  Clock,
  Info,
  Smartphone,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { submitWithdrawalFn, getUserWithdrawalsFn } from "@/lib/server/withdrawals.js";
import { withTimeout } from "@/lib/async.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";

export const Route = createFileRoute("/_app/withdraw")({
  component: WithdrawPage,
});

type WithdrawalMethod = "cbe" | "telebirr";
type UserWithdrawal = Awaited<ReturnType<typeof getUserWithdrawalsFn>>[number];

const MIN_WITHDRAWAL_AMOUNT = 200;
const WITHDRAWAL_FEE_PERCENT = 5;
const HISTORY_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;
const DAILY_WITHDRAWAL_LIMIT_MESSAGE =
  "You can only submit one withdrawal request per day. Please try again tomorrow.";

const METHOD_LABELS: Record<WithdrawalMethod, string> = {
  cbe: "CBE",
  telebirr: "TeleBirr",
};

const METHOD_ICONS: Record<WithdrawalMethod, React.ReactNode> = {
  cbe: <Building2 size={14} />,
  telebirr: <Smartphone size={14} />,
};

function isDailyWithdrawalLimitError(error: unknown): boolean {
  const seen = new Set<unknown>();
  const values: string[] = [];

  const collect = (value: unknown) => {
    if (value === null || value === undefined || seen.has(value)) return;

    if (typeof value === "string") {
      values.push(value);
      return;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      values.push(String(value));
      return;
    }

    if (typeof value !== "object") return;

    seen.add(value);

    if (value instanceof Error) {
      values.push(value.message);
      values.push(value.name);
    }

    for (const item of Object.values(value as Record<string, unknown>)) {
      collect(item);
    }
  };

  collect(error);

  const combined = values.join(" ").toLowerCase();
  return (
    combined.includes(DAILY_WITHDRAWAL_LIMIT_MESSAGE.toLowerCase()) ||
    combined.includes("daily withdrawal limit reached")
  );
}

function onlyFourDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

function getWithdrawalSpecificErrorMessage(error: unknown): string | null {
  const seen = new Set<unknown>();
  const values: string[] = [];

  const collect = (value: unknown) => {
    if (value === null || value === undefined || seen.has(value)) return;

    if (typeof value === "string") {
      values.push(value);
      return;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      values.push(String(value));
      return;
    }

    if (typeof value !== "object") return;

    seen.add(value);

    if (value instanceof Error) {
      values.push(value.message);
      values.push(value.name);
    }

    for (const item of Object.values(value as Record<string, unknown>)) {
      collect(item);
    }
  };

  collect(error);

  const combined = values.join(" ").toLowerCase();

  if (
    combined.includes("fund_password_not_set") ||
    combined.includes("please create your fund password first")
  ) {
    return "Please create your fund password first from Profile → Security.";
  }

  if (
    combined.includes("incorrect_fund_password") ||
    combined.includes("incorrect fund password")
  ) {
    return "Incorrect fund password.";
  }

  if (
    combined.includes("fund_password_locked") ||
    combined.includes("fund password is temporarily locked") ||
    combined.includes("too many incorrect attempts")
  ) {
    return "Fund password is temporarily locked. Please try again later.";
  }

  if (
    combined.includes("invalid fund password format") ||
    combined.includes("fund password must be exactly 4 digits")
  ) {
    return "Enter your 4-digit fund password.";
  }

  return null;
}

function WithdrawPage() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const walletBalance = useWalletStore((s) => s.balance);
  const loadingBalance = useWalletStore((s) => s.loading);
  const fetchWallet = useWalletStore((s) => s.fetchWallet);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<WithdrawalMethod>("cbe");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [fundPassword, setFundPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [withdrawals, setWithdrawals] = useState<UserWithdrawal[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const mountedRef = useRef(true);
  const historyLoadingRef = useRef(false);
  const historyRetryCountRef = useRef(0);
  const historyRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parsedAmount = useMemo(() => {
    const value = Number(amount);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [amount]);

  const feeAmount = useMemo(
    () => (parsedAmount > 0 ? (parsedAmount * WITHDRAWAL_FEE_PERCENT) / 100 : 0),
    [parsedAmount],
  );

  const netAmount = useMemo(
    () => Math.max(parsedAmount - feeAmount, 0),
    [parsedAmount, feeAmount],
  );

  const hasEnoughBalance = walletBalance === null || parsedAmount <= walletBalance;

  const clearHistoryRetryTimer = useCallback(() => {
    if (historyRetryTimerRef.current) {
      clearTimeout(historyRetryTimerRef.current);
      historyRetryTimerRef.current = null;
    }
  }, []);

  const scheduleHistoryRetry = useCallback(
    (loadFn: () => void) => {
      clearHistoryRetryTimer();

      if (historyRetryCountRef.current >= MAX_AUTO_RETRIES) return;

      historyRetryCountRef.current += 1;
      historyRetryTimerRef.current = setTimeout(loadFn, AUTO_RETRY_DELAY_MS);
    },
    [clearHistoryRetryTimer],
  );

  useEffect(() => {
    if (user?.id && walletBalance === null) {
      void fetchWallet(user.id);
    }
  }, [user?.id, walletBalance, fetchWallet]);

  const loadWithdrawals = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (historyLoadingRef.current) return;

      if (options?.resetRetryCount) {
        historyRetryCountRef.current = 0;
      }

      if (!user?.id || !accessToken) return;

      clearHistoryRetryTimer();
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
        historyRetryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Withdrawal history background refresh failed:", err);

        if (!mountedRef.current) return;

        scheduleHistoryRetry(() => {
          void loadWithdrawals();
        });
      } finally {
        historyLoadingRef.current = false;
      }
    },
    [accessToken, clearHistoryRetryTimer, scheduleHistoryRetry, user?.id],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadWithdrawals({ resetRetryCount: true });

    return () => {
      mountedRef.current = false;
      clearHistoryRetryTimer();
    };
  }, [clearHistoryRetryTimer, loadWithdrawals]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void loadWithdrawals({ resetRetryCount: true });
      }
    };

    const handleOnline = () => {
      void loadWithdrawals({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadWithdrawals]);

  const resetForm = () => {
    setAmount("");
    setMethod("cbe");
    setAccountName("");
    setAccountNumber("");
    setFundPassword("");
  };

  const getTxPlaceholder = () =>
    method === "telebirr" ? "Enter TeleBirr phone number" : "Enter CBE account number";

  const handleSubmit = async () => {
    if (submitting) return;

    const trimmedAccountName = accountName.trim();
    const trimmedAccountNumber = accountNumber.trim();

    if (!user?.id) {
      toast.error("Please log in again.");
      return;
    }

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error("Please enter a valid withdrawal amount.");
      return;
    }

    if (parsedAmount < MIN_WITHDRAWAL_AMOUNT) {
      toast.error(`Minimum withdrawal amount is ${MIN_WITHDRAWAL_AMOUNT} ETB.`);
      return;
    }

    if (!hasEnoughBalance) {
      toast.error("Insufficient wallet balance.");
      return;
    }

    if (trimmedAccountName.length < 2) {
      toast.error("Please enter a valid account name.");
      return;
    }

    if (trimmedAccountNumber.length < 5) {
      toast.error("Please enter a valid account number.");
      return;
    }

    if (fundPassword.length !== 4) {
      toast.error("Enter your 4-digit fund password.");
      return;
    }

    if (!accessToken) {
      toast.error("Your session has expired. Please log in again.");
      return;
    }

    setSubmitting(true);

    try {
      await submitWithdrawalFn({
        data: {
          accessToken,
          amount: parsedAmount,
          method,
          accountName: trimmedAccountName,
          accountNumber: trimmedAccountNumber,
          fundPassword,
        },
      });

      toast.success("Withdrawal request submitted.");
      resetForm();
      void loadWithdrawals({ resetRetryCount: true });
      void fetchWallet(user.id);
    } catch (err) {
      console.error("[QHash] Withdrawal submit failed:", err);

      if (isDailyWithdrawalLimitError(err)) {
        toast.error(DAILY_WITHDRAWAL_LIMIT_MESSAGE);
        return;
      }

      const specificMessage = getWithdrawalSpecificErrorMessage(err);

      if (specificMessage) {
        toast.error(specificMessage);
        return;
      }

      toast.error(getSafeErrorMessage(err, "WITHDRAWAL").message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Withdraw</h1>
        <p className="text-xs text-gray-500 mt-1">Request a withdrawal to your CBE or TeleBirr account</p>
      </div>

      <div className="bg-[rgba(0,255,65,0.04)] rounded-xl border border-[rgba(0,255,65,0.2)] p-4 flex gap-2.5">
        <Info size={15} className="text-[#00ff41] shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-[#00ff41]">Withdrawals are processed within 24 hours.</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Minimum withdrawal is {MIN_WITHDRAWAL_AMOUNT} ETB. A {WITHDRAWAL_FEE_PERCENT}% withdrawal fee applies.
          </p>
        </div>
      </div>

      <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-4 flex items-center justify-between">
        <span className="text-xs text-gray-500">Available Balance</span>
        {loadingBalance && walletBalance === null ? (
          <Spinner size="sm" />
        ) : (
          <span className="text-sm font-bold text-[#00ff41]">
            {walletBalance === null ? "—" : formatMoney(walletBalance)} ETB
          </span>
        )}
      </div>

      <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <ArrowUpCircle size={14} className="text-[#00ff41]" />
          <span className="text-xs font-semibold">Withdrawal Request</span>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-300">Withdrawal Method</label>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {(["cbe", "telebirr"] as WithdrawalMethod[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMethod(value)}
                className={[
                  "h-10 rounded-lg border text-sm flex items-center justify-center gap-2 transition-all",
                  method === value
                    ? "border-[rgba(0,255,65,0.55)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
                    : "border-[#2a2a2a] bg-[#0b0b0b] text-gray-400 hover:border-[#3a3a3a]",
                ].join(" ")}
              >
                {METHOD_ICONS[value]}
                {METHOD_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <Input
          label="Amount (ETB)"
          type="number"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min={MIN_WITHDRAWAL_AMOUNT}
          step="0.01"
          inputMode="decimal"
        />

        <Input
          label={method === "cbe" ? "CBE Account Name" : "TeleBirr Account Name"}
          type="text"
          placeholder="Enter account holder name"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
        />

        <Input
          label={method === "cbe" ? "CBE Account Number" : "TeleBirr Phone Number"}
          type="text"
          placeholder={getTxPlaceholder()}
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value)}
        />

        <Input
          label="Fund Password"
          type="password"
          placeholder="Enter 4-digit fund password"
          value={fundPassword}
          onChange={(e) => setFundPassword(onlyFourDigits(e.target.value))}
          inputMode="numeric"
          maxLength={4}
          autoComplete="current-password"
          hint="Required for every withdrawal. Manage it from Profile → Security."
        />

        {parsedAmount > 0 && (
          <div className="rounded-xl border border-[#1a1a1a] bg-[#0b0b0b] p-3 space-y-2">
            <SummaryRow label="Withdrawal amount" value={`${formatMoney(parsedAmount)} ETB`} />
            <SummaryRow label={`${WITHDRAWAL_FEE_PERCENT}% fee`} value={`${formatMoney(feeAmount)} ETB`} />
            <div className="border-t border-[#1a1a1a] pt-2">
              <SummaryRow label="You will receive" value={`${formatMoney(netAmount)} ETB`} highlight />
            </div>
          </div>
        )}

        {!hasEnoughBalance && (
          <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/20 text-[11px] text-red-400">
            Insufficient wallet balance for this withdrawal amount.
          </div>
        )}

        <div className="p-3 rounded-xl bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.1)] flex gap-2 text-[11px] text-gray-400">
          <Info size={13} className="text-[#00ff41] shrink-0 mt-0.5" />
          <span>Withdrawals are processed within 24 hours.</span>
        </div>

        <Button
          fullWidth
          loading={submitting}
          disabled={
            submitting ||
            parsedAmount < MIN_WITHDRAWAL_AMOUNT ||
            !hasEnoughBalance ||
            accountName.trim().length < 2 ||
            accountNumber.trim().length < 5 ||
            fundPassword.length !== 4
          }
          onClick={handleSubmit}
        >
          Submit Withdrawal
        </Button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Withdrawal History</h2>
        </div>

        {!historyLoaded && withdrawals.length === 0 ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
          </div>
        ) : historyLoaded && withdrawals.length === 0 ? (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-8 text-center text-xs text-gray-600">
            No withdrawals yet
          </div>
        ) : (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
            {withdrawals.map((withdrawal) => (
              <div key={withdrawal.id} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-mono text-red-400">
                      -{formatMoney(withdrawal.amount)} ETB
                    </span>
                    <p className="text-[10px] text-gray-600 mt-0.5">
                      {formatDate(withdrawal.created_at)}
                    </p>
                  </div>
                  <WithdrawalStatusBadge status={withdrawal.status} />
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-500">
                  <div>
                    <span className="text-gray-600">Method</span>
                    <p className="text-gray-400">{METHOD_LABELS[withdrawal.method] ?? withdrawal.method}</p>
                  </div>
                  <div>
                    <span className="text-gray-600">Account</span>
                    <p className="text-gray-400">
                      {withdrawal.account_name}
                      {withdrawal.account_last4 ? ` • ${withdrawal.account_last4}` : ""}
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-600">Fee</span>
                    <p className="text-gray-400">
                      {formatMoney(withdrawal.fee_amount ?? 0)} ETB
                    </p>
                  </div>
                  <div>
                    <span className="text-gray-600">Net</span>
                    <p className="text-gray-400">
                      {formatMoney(withdrawal.net_amount ?? Math.max(withdrawal.amount - (withdrawal.fee_amount ?? 0), 0))} ETB
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={highlight ? "font-semibold text-[#00ff41]" : "text-gray-300"}>
        {value}
      </span>
    </div>
  );
}

function WithdrawalStatusBadge({ status }: { status: string }) {
  const config: Record<string, {
    label: string;
    variant: "success" | "warning" | "danger" | "default";
    icon: React.ReactNode;
  }> = {
    approved: {
      label: "Approved",
      variant: "success",
      icon: <CheckCircle size={12} />,
    },
    pending: {
      label: "Pending",
      variant: "warning",
      icon: <Clock size={12} />,
    },
    rejected: {
      label: "Rejected",
      variant: "danger",
      icon: <XCircle size={12} />,
    },
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

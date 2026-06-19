import { createFileRoute } from "@tanstack/react-router";
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
  ShieldCheck,
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
  cbe: <Building2 size={18} />,
  telebirr: <Smartphone size={18} />,
};

const METHOD_META: Record<
  WithdrawalMethod,
  {
    title: string;
    subtitle: string;
    formTitle: string;
    formDescription: string;
    accountNameLabel: string;
    accountNumberLabel: string;
    accountNumberPlaceholder: string;
    submitLabel: string;
    badge: string;
  }
> = {
  cbe: {
    title: "CBE Bank Transfer",
    subtitle: "Withdraw to your CBE bank account with your account name and number.",
    formTitle: "CBE Withdrawal",
    formDescription: "Send your withdrawal to a verified CBE bank account.",
    accountNameLabel: "CBE Account Name",
    accountNumberLabel: "CBE Account Number",
    accountNumberPlaceholder: "Enter CBE account number",
    submitLabel: "Submit CBE Withdrawal",
    badge: "Bank Transfer",
  },
  telebirr: {
    title: "TeleBirr Wallet",
    subtitle: "Withdraw to your TeleBirr wallet using your wallet name and phone number.",
    formTitle: "TeleBirr Withdrawal",
    formDescription: "Send your withdrawal to a TeleBirr wallet.",
    accountNameLabel: "TeleBirr Account Name",
    accountNumberLabel: "TeleBirr Phone Number",
    accountNumberPlaceholder: "Enter TeleBirr phone number",
    submitLabel: "Submit TeleBirr Withdrawal",
    badge: "Mobile Wallet",
  },
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
  const fetchWallet = useWalletStore((s) => s.fetchWallet);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<WithdrawalMethod | null>(null);
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

  const selectedMeta = method ? METHOD_META[method] : null;

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

  const handleSubmit = async () => {
    if (submitting) return;

    const trimmedAccountName = accountName.trim();
    const trimmedAccountNumber = accountNumber.trim();

    if (!method) {
      toast.error("Please choose a withdrawal method.");
      return;
    }

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
        <p className="text-xs text-gray-500 mt-1">
          Request a withdrawal to your CBE or TeleBirr account
        </p>
      </div>

      <div className="bg-[rgba(0,255,65,0.04)] rounded-xl border border-[rgba(0,255,65,0.2)] p-4 flex gap-2.5">
        <Info size={15} className="text-[#00ff41] shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-[#00ff41]">
            Withdrawals are processed within 24 hours.
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Minimum withdrawal is {MIN_WITHDRAWAL_AMOUNT} ETB. A{" "}
            {WITHDRAWAL_FEE_PERCENT}% withdrawal fee applies.
          </p>
        </div>
      </div>

      <BalanceCard walletBalance={walletBalance} />

      {!method ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Choose Withdrawal Method</h2>
              <p className="text-[11px] text-gray-500 mt-0.5">
                Select where you want to receive your funds.
              </p>
            </div>
            <Badge variant="neon">Secure</Badge>
          </div>

          <div className="grid gap-3">
            {(["cbe", "telebirr"] as WithdrawalMethod[]).map((value) => (
              <MethodChoiceCard
                key={value}
                method={value}
                onClick={() => setMethod(value)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-4">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={changeMethod}
              className="mt-0.5 grid h-8 w-8 place-items-center rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] text-gray-500 hover:border-[rgba(0,255,65,0.35)] hover:text-[#00ff41] transition-colors card-press"
              aria-label="Change withdrawal method"
            >
              <ArrowLeft size={14} />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[rgba(0,255,65,0.08)] text-[#00ff41]">
                  {METHOD_ICONS[method]}
                </span>
                <div>
                  <h2 className="text-sm font-semibold">{selectedMeta?.formTitle}</h2>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    {selectedMeta?.formDescription}
                  </p>
                </div>
              </div>
            </div>

            <Badge variant="neon" className="shrink-0">
              {METHOD_LABELS[method]}
            </Badge>
          </div>

          <div className="grid gap-4 pt-1">
            <SectionLabel title="Withdrawal Details" />

            <Input
              label="Amount (ETB)"
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min={MIN_WITHDRAWAL_AMOUNT}
              step="0.01"
              inputMode="decimal"
              hint={`Minimum withdrawal is ${MIN_WITHDRAWAL_AMOUNT} ETB.`}
            />

            <Input
              label={selectedMeta?.accountNameLabel ?? "Account Name"}
              type="text"
              placeholder="Enter account holder name"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
            />

            <Input
              label={selectedMeta?.accountNumberLabel ?? "Account Number"}
              type="text"
              placeholder={selectedMeta?.accountNumberPlaceholder ?? "Enter account number"}
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
            />

            <SectionLabel title="Security Verification" />

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
              <div className="rounded-xl border border-[rgba(0,255,65,0.15)] bg-[#0b0b0b] p-3 space-y-2">
                <div className="flex items-center gap-2 pb-1">
                  <ShieldCheck size={13} className="text-[#00ff41]" />
                  <span className="text-xs font-semibold text-gray-200">
                    Withdrawal Summary
                  </span>
                </div>
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
              <span>
                {METHOD_LABELS[method]} withdrawals are reviewed and processed within 24 hours.
              </span>
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
              {selectedMeta?.submitLabel ?? "Submit Withdrawal"}
            </Button>
          </div>
        </div>
      )}

      <WithdrawalHistory withdrawals={withdrawals} historyLoaded={historyLoaded} />
    </div>
  );
}

function BalanceCard({ walletBalance }: { walletBalance: number | null }) {
  return (
    <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-4 flex items-center justify-between">
      <span className="text-xs text-gray-500">Available Balance</span>
      {walletBalance === null ? (
        <span
          className="skeleton inline-block h-4 w-24 rounded"
          aria-label="Loading available balance"
        />
      ) : (
        <span className="text-sm font-bold text-[#00ff41]">
          {formatMoney(walletBalance)} ETB
        </span>
      )}
    </div>
  );
}

function MethodChoiceCard({
  method,
  onClick,
}: {
  method: WithdrawalMethod;
  onClick: () => void;
}) {
  const meta = METHOD_META[method];

  return (
    <button
      type="button"
      onClick={onClick}
      className="group w-full rounded-xl border border-[#1f1f1f] bg-[#111] p-4 text-left transition-all hover:border-[rgba(0,255,65,0.35)] hover:bg-[rgba(0,255,65,0.03)] card-press"
    >
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
          {METHOD_ICONS[method]}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-100">{meta.title}</h3>
            <Badge variant="default" className="text-[9px]">
              {meta.badge}
            </Badge>
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed mt-1">
            {meta.subtitle}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-3">
            <span className="rounded-full border border-[#1f1f1f] px-2 py-1 text-[10px] text-gray-500">
              24h Processing
            </span>
            <span className="rounded-full border border-[#1f1f1f] px-2 py-1 text-[10px] text-gray-500">
              {WITHDRAWAL_FEE_PERCENT}% Fee
            </span>
            <span className="rounded-full border border-[#1f1f1f] px-2 py-1 text-[10px] text-gray-500">
              Min {MIN_WITHDRAWAL_AMOUNT} ETB
            </span>
          </div>
        </div>

        <ChevronRight
          size={16}
          className="mt-1 shrink-0 text-gray-600 transition-colors group-hover:text-[#00ff41]"
        />
      </div>
    </button>
  );
}

function SectionLabel({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-px flex-1 bg-[#1a1a1a]" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-600">
        {title}
      </span>
      <span className="h-px flex-1 bg-[#1a1a1a]" />
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
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">Withdrawal History</h2>
      </div>

      {!historyLoaded && withdrawals.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
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
                  <p className="text-gray-400">
                    {METHOD_LABELS[withdrawal.method] ?? withdrawal.method}
                  </p>
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
                    {formatMoney(
                      withdrawal.net_amount ??
                        Math.max(withdrawal.amount - (withdrawal.fee_amount ?? 0), 0),
                    )}{" "}
                    ETB
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
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
  const config: Record<
    string,
    {
      label: string;
      variant: "success" | "warning" | "danger" | "default";
      icon: React.ReactNode;
    }
  > = {
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

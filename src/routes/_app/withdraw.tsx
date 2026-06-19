import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { ArrowLeft, Building2, CheckCircle, ChevronRight, Clock, Info, ShieldCheck, Smartphone, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { withTimeout } from "@/lib/async.js";
import { submitWithdrawalFn, getUserWithdrawalsFn } from "@/lib/server/withdrawals.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";

export const Route = createFileRoute("/_app/withdraw")({ component: WithdrawPage });

type WithdrawalMethod = "cbe" | "telebirr";
type UserWithdrawal = Awaited<ReturnType<typeof getUserWithdrawalsFn>>[number];

const MIN_WITHDRAWAL_AMOUNT = 200;
const WITHDRAWAL_FEE_PERCENT = 5;
const HISTORY_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;
const DAILY_WITHDRAWAL_LIMIT_MESSAGE = "You can only submit one withdrawal request per day. Please try again tomorrow.";

const METHOD_LABELS: Record<WithdrawalMethod, string> = { cbe: "CBE", telebirr: "TeleBirr" };
const METHOD_META: Record<WithdrawalMethod, {
  label: string;
  title: string;
  description: string;
  nameLabel: string;
  numberLabel: string;
  numberPlaceholder: string;
  submitLabel: string;
  icon: React.ReactNode;
}> = {
  cbe: {
    label: "Bank transfer",
    title: "CBE Withdrawal",
    description: "Send your withdrawal to a verified CBE account.",
    nameLabel: "CBE Account Name",
    numberLabel: "CBE Account Number",
    numberPlaceholder: "Enter CBE account number",
    submitLabel: "Submit CBE Withdrawal",
    icon: <Building2 size={16} />,
  },
  telebirr: {
    label: "Mobile wallet",
    title: "TeleBirr Withdrawal",
    description: "Send your withdrawal to a TeleBirr wallet.",
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
  if (text.includes("fund_password_not_set") || text.includes("please create your fund password first")) return "Please create your fund password first from Profile → Security.";
  if (text.includes("incorrect_fund_password") || text.includes("incorrect fund password")) return "Incorrect fund password.";
  if (text.includes("fund_password_locked") || text.includes("fund password is temporarily locked") || text.includes("too many incorrect attempts")) return "Fund password is temporarily locked. Please try again later.";
  if (text.includes("invalid fund password format") || text.includes("fund password must be exactly 4 digits")) return "Enter your 4-digit fund password.";
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
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const parsedAmount = useMemo(() => {
    const value = Number(amount);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [amount]);
  const feeAmount = useMemo(() => parsedAmount > 0 ? (parsedAmount * WITHDRAWAL_FEE_PERCENT) / 100 : 0, [parsedAmount]);
  const netAmount = useMemo(() => Math.max(parsedAmount - feeAmount, 0), [parsedAmount, feeAmount]);
  const hasEnoughBalance = walletBalance === null || parsedAmount <= walletBalance;
  const selectedMeta = method ? METHOD_META[method] : null;

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const scheduleRetry = useCallback((loadFn: () => void) => {
    clearRetryTimer();
    if (retryCountRef.current >= MAX_AUTO_RETRIES) return;
    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(loadFn, AUTO_RETRY_DELAY_MS);
  }, [clearRetryTimer]);

  const loadWithdrawals = useCallback(async (options?: { resetRetryCount?: boolean }) => {
    if (historyLoadingRef.current) return;
    if (options?.resetRetryCount) retryCountRef.current = 0;
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
      if (mountedRef.current) scheduleRetry(() => void loadWithdrawals());
    } finally {
      historyLoadingRef.current = false;
    }
  }, [accessToken, clearRetryTimer, scheduleRetry, user?.id]);

  useEffect(() => {
    if (user?.id && walletBalance === null) void fetchWallet(user.id);
  }, [user?.id, walletBalance, fetchWallet]);

  useEffect(() => {
    mountedRef.current = true;
    void loadWithdrawals({ resetRetryCount: true });
    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer, loadWithdrawals]);

  useEffect(() => {
    const refresh = () => void loadWithdrawals({ resetRetryCount: true });
    const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", refresh);
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
        data: { accessToken, amount: parsedAmount, method, accountName: trimmedAccountName, accountNumber: trimmedAccountNumber, fundPassword },
      });
      if (result?.success !== true) {
        toast.error(typeof result?.message === "string" && result.message.trim().length > 0 ? result.message : "Withdrawal request failed. Please try again.");
        return;
      }
      toast.success("Withdrawal request submitted.");
      resetForm();
      void loadWithdrawals({ resetRetryCount: true });
      void fetchWallet(user.id);
    } catch (err) {
      console.error("[QHash] Withdrawal submit failed:", err);
      if (isDailyWithdrawalLimitError(err)) return toast.error(DAILY_WITHDRAWAL_LIMIT_MESSAGE);
      const specificMessage = getWithdrawalSpecificErrorMessage(err);
      toast.error(specificMessage ?? getSafeErrorMessage(err, "WITHDRAWAL").message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 pb-20">
      <div>
        <h1 className="text-lg font-bold">Withdraw</h1>
        <p className="text-xs text-gray-500 mt-1">Request a withdrawal to your CBE or TeleBirr account</p>
      </div>

      <NoticeCard />
      <BalanceCard walletBalance={walletBalance} />

      {!method ? (
        <section className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Method</h2>
              <p className="text-[11px] text-gray-500 mt-0.5">Choose where to receive your funds.</p>
            </div>
            <Badge variant="neon" className="text-[9px]">Secure</Badge>
          </div>
          <div className="overflow-hidden rounded-xl border border-[#1f1f1f] bg-[#111]">
            {(["cbe", "telebirr"] as WithdrawalMethod[]).map((value, index) => (
              <MethodSelectorRow key={value} method={value} isLast={index === 1} onClick={() => setMethod(value)} />
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111] p-3.5 space-y-3.5">
          <div className="flex items-center gap-3">
            <button type="button" onClick={changeMethod} className="grid h-8 w-8 place-items-center rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] text-gray-500 transition-colors hover:border-[rgba(0,255,65,0.35)] hover:text-[#00ff41] card-press" aria-label="Change withdrawal method">
              <ArrowLeft size={14} />
            </button>
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-[rgba(0,255,65,0.07)] text-[#00ff41]">{selectedMeta?.icon}</div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold leading-tight">{selectedMeta?.title}</h2>
              <p className="text-[10px] text-gray-500 mt-0.5">{selectedMeta?.description}</p>
            </div>
            <Badge variant="neon" className="shrink-0 text-[9px]">{method ? METHOD_LABELS[method] : ""}</Badge>
          </div>

          <div className="grid gap-3.5">
            <SectionLabel title="Withdrawal Details" />
            <Input label="Amount (ETB)" type="text" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" hint={`Minimum withdrawal is ${MIN_WITHDRAWAL_AMOUNT} ETB.`} />
            <Input label={selectedMeta?.nameLabel ?? "Account Name"} type="text" placeholder="Enter account holder name" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            <Input label={selectedMeta?.numberLabel ?? "Account Number"} type="text" placeholder={selectedMeta?.numberPlaceholder ?? "Enter account number"} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} />
            <SectionLabel title="Security Verification" />
            <Input label="Fund Password" type="password" placeholder="Enter 4-digit fund password" value={fundPassword} onChange={(e) => setFundPassword(onlyFourDigits(e.target.value))} inputMode="numeric" maxLength={4} autoComplete="current-password" hint="Required for every withdrawal. Manage it from Profile → Security." />
            {parsedAmount > 0 && <SummaryCard amount={parsedAmount} fee={feeAmount} net={netAmount} />}
            {!hasEnoughBalance && <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-[11px] text-red-400">Insufficient wallet balance for this withdrawal amount.</div>}
            <Button fullWidth loading={submitting} disabled={submitting || parsedAmount < MIN_WITHDRAWAL_AMOUNT || !hasEnoughBalance || accountName.trim().length < 2 || accountNumber.trim().length < 5 || fundPassword.length !== 4} onClick={handleSubmit}>
              {selectedMeta?.submitLabel ?? "Submit Withdrawal"}
            </Button>
          </div>
        </section>
      )}

      <WithdrawalHistory withdrawals={withdrawals} historyLoaded={historyLoaded} />
    </div>
  );
}

function NoticeCard() {
  return (
    <div className="rounded-xl border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.035)] p-3 flex gap-2.5">
      <Info size={14} className="text-[#00ff41] shrink-0 mt-0.5" />
      <div>
        <p className="text-[11px] font-semibold text-[#00ff41]">Withdrawals are processed within 24 hours.</p>
        <p className="text-[10px] text-gray-500 mt-0.5">Minimum {MIN_WITHDRAWAL_AMOUNT} ETB · {WITHDRAWAL_FEE_PERCENT}% fee</p>
      </div>
    </div>
  );
}

function BalanceCard({ walletBalance }: { walletBalance: number | null }) {
  return (
    <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-3.5 flex items-center justify-between">
      <span className="text-[11px] text-gray-500">Available Balance</span>
      {walletBalance === null ? <span className="skeleton inline-block h-4 w-24 rounded" aria-label="Loading available balance" /> : <span className="text-sm font-bold text-[#00ff41]">{formatMoney(walletBalance)} ETB</span>}
    </div>
  );
}

function MethodSelectorRow({ method, onClick, isLast }: { method: WithdrawalMethod; onClick: () => void; isLast: boolean }) {
  const meta = METHOD_META[method];
  return (
    <button type="button" onClick={onClick} className={["group w-full px-3.5 py-3 text-left transition-colors hover:bg-[rgba(0,255,65,0.035)] card-press", isLast ? "" : "border-b border-[#1a1a1a]"].join(" ")}>
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.045)] text-[#00ff41]">{meta.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-100">{METHOD_LABELS[method]}</span>
          <span className="block text-[11px] text-gray-500 mt-0.5">{meta.label}</span>
        </span>
        <ChevronRight size={15} className="shrink-0 text-gray-600 transition-colors group-hover:text-[#00ff41]" />
      </div>
    </button>
  );
}

function SectionLabel({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-px flex-1 bg-[#1a1a1a]" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">{title}</span>
      <span className="h-px flex-1 bg-[#1a1a1a]" />
    </div>
  );
}

function SummaryCard({ amount, fee, net }: { amount: number; fee: number; net: number }) {
  return (
    <div className="rounded-xl border border-[#1f1f1f] bg-[#0b0b0b] p-3 space-y-2">
      <div className="flex items-center gap-2"><ShieldCheck size={13} className="text-[#00ff41]" /><span className="text-xs font-semibold text-gray-200">Summary</span></div>
      <SummaryRow label="Amount" value={`${formatMoney(amount)} ETB`} />
      <SummaryRow label="Fee" value={`${formatMoney(fee)} ETB`} />
      <div className="border-t border-[#1a1a1a] pt-2"><SummaryRow label="You receive" value={`${formatMoney(net)} ETB`} highlight /></div>
    </div>
  );
}

function WithdrawalHistory({ withdrawals, historyLoaded }: { withdrawals: UserWithdrawal[]; historyLoaded: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2.5"><h2 className="text-sm font-semibold">Withdrawal History</h2></div>
      {!historyLoaded && withdrawals.length === 0 ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
      ) : historyLoaded && withdrawals.length === 0 ? (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-7 text-center text-xs text-gray-600">No withdrawals yet</div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111] divide-y divide-[#1a1a1a]">
          {withdrawals.map((withdrawal) => (
            <div key={withdrawal.id} className="px-3.5 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div><span className="text-xs font-mono text-red-400">-{formatMoney(withdrawal.amount)} ETB</span><p className="text-[10px] text-gray-600 mt-0.5">{formatDate(withdrawal.created_at)}</p></div>
                <WithdrawalStatusBadge status={withdrawal.status} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-500">
                <div><span className="text-gray-600">Method</span><p className="text-gray-400">{METHOD_LABELS[withdrawal.method] ?? withdrawal.method}</p></div>
                <div><span className="text-gray-600">Account</span><p className="text-gray-400">{withdrawal.account_name}{withdrawal.account_last4 ? ` • ${withdrawal.account_last4}` : ""}</p></div>
                <div><span className="text-gray-600">Fee</span><p className="text-gray-400">{formatMoney(withdrawal.fee_amount ?? 0)} ETB</p></div>
                <div><span className="text-gray-600">Net</span><p className="text-gray-400">{formatMoney(withdrawal.net_amount ?? Math.max(withdrawal.amount - (withdrawal.fee_amount ?? 0), 0))} ETB</p></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return <div className="flex items-center justify-between text-xs"><span className="text-gray-500">{label}</span><span className={highlight ? "font-semibold text-[#00ff41]" : "text-gray-300"}>{value}</span></div>;
}

function WithdrawalStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "success" | "warning" | "danger" | "default"; icon: React.ReactNode }> = {
    approved: { label: "Approved", variant: "success", icon: <CheckCircle size={12} /> },
    pending: { label: "Pending", variant: "warning", icon: <Clock size={12} /> },
    rejected: { label: "Rejected", variant: "danger", icon: <XCircle size={12} /> },
  };
  const item = config[status] ?? { label: status, variant: "default" as const, icon: <Clock size={12} /> };
  return <Badge variant={item.variant} className="gap-1">{item.icon}{item.label}</Badge>;
}

function formatMoney(value: number): string {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

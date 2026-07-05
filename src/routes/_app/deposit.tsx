import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownCircle,
  Building2,
  Check,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Info,
  Smartphone,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import {
  getPaymentMethodsFn,
  submitDepositFn,
  getUserDepositsFn,
} from "@/lib/server/deposits.js";
import { withTimeout } from "@/lib/async.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { formatDateTime } from "@/lib/format.js";

export const Route = createFileRoute("/_app/deposit")({
  component: DepositPage,
});

type PaymentMethod = Awaited<ReturnType<typeof getPaymentMethodsFn>>[number];
type UserDeposit = Awaited<ReturnType<typeof getUserDepositsFn>>[number];

const METHODS_TIMEOUT_MS = 10_000;
const HISTORY_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;
const HISTORY_PREVIEW_LIMIT = 3;

type MethodType = "cbe" | "telebirr";

type MethodMeta = {
  label: string;
  sublabel: string;
  pageSubtitle: string;
  accountLabel: string;
  numberLabel: string;
  refLabel: string;
  refPrefix: string;
  refPlaceholder: string;
  refHint: string;
  refError: string;
  successToast: string;
};

const METHOD_META: Record<MethodType, MethodMeta> = {
  cbe: {
    label: "CBE",
    sublabel: "Bank Transfer",
    pageSubtitle: "Bank transfer · verified automatically",
    accountLabel: "Receiving Account",
    numberLabel: "Account Number",
    refLabel: "CBE Transaction ID",
    refPrefix: "FT",
    refPlaceholder: "e.g. FT24XXXXXXX",
    refHint: 'Starts with "FT" — from your CBE receipt',
    refError: 'CBE transaction IDs start with "FT". Check your receipt and try again.',
    successToast: "Deposit submitted — verifying your CBE transfer.",
  },
  telebirr: {
    label: "TeleBirr",
    sublabel: "Wallet Transfer",
    pageSubtitle: "Wallet transfer · verified automatically",
    accountLabel: "Receiving Name",
    numberLabel: "TeleBirr Number",
    refLabel: "TeleBirr Transaction ID",
    refPrefix: "D",
    refPlaceholder: "e.g. D8XK2M9QW1",
    refHint: 'Starts with "D" — from your TeleBirr receipt',
    refError: 'TeleBirr transaction IDs start with "D". Check your receipt and try again.',
    successToast: "Deposit submitted — verifying your TeleBirr transfer.",
  },
};

function getMethodOrder(type: string): number {
  if (type === "cbe") return 0;
  if (type === "telebirr") return 1;
  return 2;
}

function getMethodMeta(type: string) {
  return METHOD_META[(type as MethodType) in METHOD_META ? (type as MethodType) : "cbe"];
}

/**
 * Amount is optional. Empty input is valid (server verifies the real amount
 * from the payment reference). Returns:
 *  - { ok: true, value: null }   for blank input
 *  - { ok: true, value: number } for a valid positive amount
 *  - { ok: false }               for anything invalid
 */
function parseOptionalAmount(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return { ok: false };
  return { ok: true, value };
}

function DepositPage() {
  const { user } = useAuthStore();
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const fetchWallet = useWalletStore((s) => s.fetchWallet);

  const [step, setStep] = useState<"select" | "form">("select");
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [amount, setAmount] = useState("");
  const [txReference, setTxReference] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodsLoaded, setMethodsLoaded] = useState(false);
  const [deposits, setDeposits] = useState<UserDeposit[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const mountedRef = useRef(true);

  // Two deliberately independent retry systems: one for payment methods,
  // one for deposit history. Do not merge or cross-wire them.
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
          METHODS_TIMEOUT_MS,
          "Payment methods request timed out.",
        );
        if (!mountedRef.current) return;
        setMethods(result);
        setMethodsLoaded(true);
        methodsRetryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Deposit methods load failed:", err);
        if (!mountedRef.current) return;
        scheduleMethodsRetry(() => {
          void loadMethods();
        });
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
      if (!accessToken) {
        setDeposits([]);
        setHistoryLoaded(false);
        return;
      }

      clearHistoryRetryTimer();
      historyLoadingRef.current = true;

      try {
        const result = await withTimeout(
          getUserDepositsFn({ data: { accessToken } }),
          HISTORY_TIMEOUT_MS,
          "Deposit history request timed out.",
        );
        if (!mountedRef.current) return;
        setDeposits(result);
        setHistoryLoaded(true);
        historyRetryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Deposit history load failed:", err);
        if (!mountedRef.current) return;
        scheduleHistoryRetry(() => {
          void loadHistory();
        });
      } finally {
        historyLoadingRef.current = false;
      }
    },
    [accessToken, clearHistoryRetryTimer, scheduleHistoryRetry],
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
    const refresh = () => {
      void loadMethods({ resetRetryCount: true });
      void loadHistory({ resetRetryCount: true });
    };

    const handleVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", refresh);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", refresh);
    };
  }, [loadHistory, loadMethods]);

  const resetForm = useCallback(() => {
    setAmount("");
    setTxReference("");
  }, []);

  const selectMethod = useCallback((method: PaymentMethod) => {
    setSelectedMethod(method);
    setStep("form");
  }, []);

  const backToSelect = useCallback(() => {
    setSelectedMethod(null);
    setStep("select");
    resetForm();
  }, [resetForm]);

  const handleSubmit = useCallback(async () => {
    if (!selectedMethod || submitting) return;

    const meta = getMethodMeta(selectedMethod.type);
    const normalizedRef = txReference.trim().toUpperCase();

    if (!normalizedRef) {
      toast.error("Enter your transaction ID.");
      return;
    }

    if (!normalizedRef.startsWith(meta.refPrefix)) {
      toast.error(meta.refError);
      return;
    }

    const parsedAmount = parseOptionalAmount(amount);
    if (!parsedAmount.ok) {
      toast.error("Enter a valid amount or leave it blank.");
      return;
    }

    if (!user?.id || !accessToken) {
      toast.error("Session expired. Please sign in again.");
      return;
    }

    setSubmitting(true);
    try {
      await submitDepositFn({
        data: {
          accessToken,
          paymentMethodId: selectedMethod.id,
          transactionReference: normalizedRef,
          amount: parsedAmount.value,
        },
      });

      toast.success(meta.successToast);
      resetForm();
      backToSelect();
      void loadHistory({ resetRetryCount: true });
      void fetchWallet(user.id);
    } catch (err) {
      console.error("[QHash] Deposit submit failed:", err);
      toast.error(getSafeErrorMessage(err, "Failed to submit deposit. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }, [
    accessToken,
    amount,
    backToSelect,
    fetchWallet,
    loadHistory,
    resetForm,
    selectedMethod,
    submitting,
    txReference,
    user?.id,
  ]);

  // Group active accounts by method type so multiple receiving accounts of
  // the same type remain individually selectable ("· Account 2" etc.).
  const methodOptions = (() => {
    const grouped: Record<string, PaymentMethod[]> = {};
    for (const method of methods) {
      (grouped[method.type] ??= []).push(method);
    }
    return Object.entries(grouped)
      .sort(([a], [b]) => getMethodOrder(a) - getMethodOrder(b))
      .flatMap(([, accounts]) =>
        accounts.map((method, index) => ({ method, index, total: accounts.length })),
      );
  })();

  return (
    <div className="space-y-5 pb-20 lg:grid lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0 lg:pb-0">
      <div className="space-y-5 lg:col-span-7 xl:col-span-8">
        {step === "select" || !selectedMethod ? (
          <>
            {/* Header */}
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00ff41]">
                Deposit Center
              </p>
              <h1 className="mt-1 text-xl font-bold leading-tight text-gray-100">Deposit</h1>
              <p className="mt-1 text-xs text-gray-500">Add funds via CBE or TeleBirr</p>
            </div>

            {/* Method selection */}
            <div>
              <p className="mb-2 text-sm font-bold text-gray-100">Choose Deposit Method</p>

              {!methodsLoaded ? (
                <div className="space-y-2">
                  <div className="skeleton h-14 rounded-xl" aria-label="Loading payment methods" />
                  <div className="skeleton h-14 rounded-xl" />
                </div>
              ) : methodOptions.length === 0 ? (
                <div className="rounded-xl border border-[#1a1a1a] bg-[#111] px-4 py-8 text-center">
                  <p className="text-xs font-medium text-gray-500">
                    No deposit methods are available right now.
                  </p>
                  <p className="mx-auto mt-1 max-w-xs text-[11px] leading-relaxed text-gray-600">
                    Please check back shortly or contact support.
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111]">
                  {methodOptions.map(({ method, index, total }, rowIndex) => {
                    const meta = getMethodMeta(method.type);
                    const accountSuffix = total > 1 ? ` · Account ${index + 1}` : "";

                    return (
                      <button
                        key={method.id}
                        type="button"
                        onClick={() => selectMethod(method)}
                        className={[
                          "flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left card-press",
                          rowIndex > 0 ? "border-t border-[#1a1a1a]" : "",
                        ].join(" ")}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[rgba(0,255,65,0.08)] text-[#00ff41]">
                            {method.type === "telebirr" ? (
                              <Smartphone size={15} />
                            ) : (
                              <Building2 size={15} />
                            )}
                          </div>

                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-gray-100">
                              {meta.label}
                            </p>
                            <p className="mt-0.5 truncate text-[11px] text-gray-500">
                              {meta.sublabel}
                              {accountSuffix}
                            </p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant="neon">Auto-verify</Badge>
                          <ChevronRight size={14} className="text-gray-600" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-600">
                <Info size={12} className="mt-0.5 shrink-0" />
                Transfer first, then submit your transaction ID.
              </p>
            </div>
          </>
        ) : (
          <MethodDepositForm
            method={selectedMethod}
            amount={amount}
            txReference={txReference}
            submitting={submitting}
            onAmountChange={setAmount}
            onReferenceChange={setTxReference}
            onBack={backToSelect}
            onSubmit={handleSubmit}
          />
        )}
      </div>

      {/* Deposit history */}
      <div className="lg:col-span-5 xl:col-span-4">
        <DepositHistory deposits={deposits} loaded={historyLoaded} />
      </div>
    </div>
  );
}

function MethodDepositForm({
  method,
  amount,
  txReference,
  submitting,
  onAmountChange,
  onReferenceChange,
  onBack,
  onSubmit,
}: {
  method: PaymentMethod;
  amount: string;
  txReference: string;
  submitting: boolean;
  onAmountChange: (value: string) => void;
  onReferenceChange: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const meta = getMethodMeta(method.type);
  const [copied, setCopied] = useState(false);

  const copyAccountNumber = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(method.account_number);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("Unable to copy. Please copy manually.");
    }
  }, [method.account_number]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to deposit methods"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#1f1f1f] bg-[#111] text-gray-400 card-press"
        >
          <ChevronLeft size={15} />
        </button>

        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[rgba(0,255,65,0.08)] text-[#00ff41]">
          {method.type === "telebirr" ? <Smartphone size={15} /> : <Building2 size={15} />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-bold leading-tight text-gray-100">
              {meta.label} Deposit
            </h1>
            <Badge variant="neon">Auto-verify</Badge>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-gray-500">{meta.pageSubtitle}</p>
        </div>
      </div>

      {/* Receiving account */}
      <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">
            {meta.accountLabel}
          </p>
        </div>
        <p className="mt-1 text-sm font-semibold text-gray-100">{method.account_name}</p>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-[#1f1f1f] bg-[#0d0d0d] px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] text-gray-600">
              {meta.numberLabel}
            </p>
            <p className="mt-0.5 break-all font-mono text-sm font-bold text-gray-100">
              {method.account_number}
            </p>
          </div>

          <button
            type="button"
            onClick={copyAccountNumber}
            aria-label={`Copy ${meta.numberLabel.toLowerCase()}`}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.25)] bg-[rgba(0,255,65,0.08)] text-[#00ff41] card-press"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-gray-600">
        <Info size={12} className="mt-0.5 shrink-0" />
        Transfer to this account, then enter your transaction ID below.
      </p>

      {/* Amount (optional) */}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-gray-300">
          Amount (ETB) <span className="font-normal text-gray-600">— optional</span>
        </p>
        <Input
          type="number"
          inputMode="decimal"
          placeholder="0.00"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
        />
        <p className="mt-1 text-[11px] text-gray-600">
          Optional — the amount is verified from your receipt
        </p>
      </div>

      {/* Transaction reference */}
      <div>
        <p className="mb-1.5 text-xs font-semibold text-gray-300">{meta.refLabel}</p>
        <Input
          type="text"
          placeholder={meta.refPlaceholder}
          value={txReference}
          onChange={(e) => onReferenceChange(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />
        <p className="mt-1 text-[11px] text-gray-600">{meta.refHint}</p>
      </div>

      <Button
        className="w-full"
        loading={submitting}
        disabled={submitting || txReference.trim().length === 0}
        onClick={onSubmit}
      >
        <ArrowDownCircle size={15} />
        Submit for Verification
      </Button>
    </div>
  );
}

function DepositHistory({ deposits, loaded }: { deposits: UserDeposit[]; loaded: boolean }) {
  const visible = deposits.slice(0, HISTORY_PREVIEW_LIMIT);

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-100">Deposit History</h2>
          {loaded && deposits.length > 0 && (
            <Badge variant="default">{deposits.length}</Badge>
          )}
        </div>

        {loaded && deposits.length > HISTORY_PREVIEW_LIMIT && (
          <Link
            to="/transactions"
            className="flex shrink-0 items-center gap-0.5 text-[10px] text-gray-500"
          >
            View all <ChevronRight size={12} />
          </Link>
        )}
      </div>

      {!loaded ? (
        <div className="space-y-2">
          <div className="skeleton h-14 rounded-xl" aria-label="Loading deposit history" />
          <div className="skeleton h-14 rounded-xl" />
        </div>
      ) : deposits.length === 0 ? (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] px-4 py-8 text-center">
          <p className="text-xs font-medium text-gray-500">No deposits yet</p>
          <p className="mx-auto mt-1 max-w-xs text-[11px] leading-relaxed text-gray-600">
            Your submitted deposits will appear here.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#1a1a1a] overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111]">
          {visible.map((deposit) => (
            <DepositHistoryItem key={deposit.id} deposit={deposit} />
          ))}
        </div>
      )}
    </div>
  );
}

function DepositHistoryItem({ deposit }: { deposit: UserDeposit }) {
  const meta = getMethodMeta(deposit.method_type);
  const status = (deposit.status ?? "").toLowerCase();
  const isApproved = status === "approved";
  const isRejected = status === "rejected";
  const isPending = status === "pending";
  const hasAmount = isApproved && Number(deposit.amount) > 0;

  const formattedAmount = Number(deposit.amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const refTail = (deposit.transaction_reference ?? "").slice(-6);

  const badge = isApproved
    ? { label: "Done", className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", Icon: CheckCircle }
    : isRejected
      ? { label: "Failed", className: "bg-red-500/10 text-red-400 border-red-500/20", Icon: XCircle }
      : { label: "Pending", className: "bg-amber-500/10 text-amber-400 border-amber-500/20", Icon: Clock };

  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <div
          className={[
            "grid h-8 w-8 shrink-0 place-items-center rounded-full",
            isApproved
              ? "bg-emerald-500/10 text-emerald-400"
              : isRejected
                ? "bg-red-500/10 text-red-400"
                : "bg-amber-500/10 text-amber-400",
          ].join(" ")}
        >
          <badge.Icon size={14} />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-semibold text-gray-100">
              {meta.label} Deposit
            </p>
            <span
              className={[
                "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[9px] font-medium",
                badge.className,
              ].join(" ")}
            >
              {badge.label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[10px] text-gray-600">
            {formatDateTime(deposit.created_at)}
            {refTail ? ` · Ref …${refTail}` : ""}
          </p>
        </div>
      </div>

      <div className="shrink-0 text-right">
        {hasAmount ? (
          <p className="font-mono text-sm font-semibold text-[#00ff41]">
            +{formattedAmount} ETB
          </p>
        ) : isRejected ? (
          <p className="text-xs font-semibold text-red-400">Rejected</p>
        ) : isPending ? (
          <p className="text-xs font-semibold text-amber-400">Pending</p>
        ) : (
          <p className="text-xs font-semibold text-gray-500">Reviewing</p>
        )}
      </div>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { EmptyState } from "@/components/ui/EmptyState.js";
import { ListPanel } from "@/components/ui/ListPanel.js";
import { ListRow } from "@/components/ui/ListRow.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import { getPaymentMethodsFn } from "@/lib/server/payment-methods.js";
import { submitDepositFn, getUserDepositsFn } from "@/lib/server/deposits.js";
import { withTimeout } from "@/lib/async.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { formatDateTime } from "@/lib/format.js";
import type { PaymentMethodType } from "@/lib/database.types.js";

export const Route = createFileRoute("/_app/deposit")({
  component: DepositPage,
});

type PaymentMethod = {
  id: string;
  type: PaymentMethodType;
  account_name: string;
  account_number: string;
  instructions: string | null;
  is_active: boolean;
};

type UserDeposit = Awaited<ReturnType<typeof getUserDepositsFn>>[number];
type DepositStep = "select" | "form";
type MethodType = Extract<PaymentMethodType, "cbe" | "telebirr">;

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
  icon: React.ReactNode;
};

const METHOD_LOAD_TIMEOUT_MS = 10_000;
const HISTORY_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;
const HISTORY_PREVIEW_LIMIT = 6;

const METHOD_META: Record<MethodType, MethodMeta> = {
  cbe: {
    label: "CBE",
    sublabel: "Bank Transfer",
    pageSubtitle: "Bank transfer",
    accountLabel: "Receiver's Name",
    numberLabel: "Account Number",
    refLabel: "CBE Transaction ID",
    refPrefix: "FT",
    refPlaceholder: "e.g. FT24XXXXXXX",
    refHint: 'Starts with "FT" — from your CBE receipt',
    refError: 'CBE transaction IDs start with "FT". Check your receipt and try again.',
    successToast: "CBE deposit submitted successfully.",
    icon: <Building2 size={15} />,
  },
  telebirr: {
    label: "TeleBirr",
    sublabel: "Wallet Transfer",
    pageSubtitle: "Wallet transfer",
    accountLabel: "Receiver's Name",
    numberLabel: "TeleBirr Number",
    refLabel: "TeleBirr Transaction ID",
    refPrefix: "D",
    refPlaceholder: "e.g. DXXXXXXXXX",
    refHint: 'Starts with "D" — from your TeleBirr receipt',
    refError: 'TeleBirr transaction IDs start with "D". Check your receipt and try again.',
    successToast: "TeleBirr deposit submitted successfully.",
    icon: <Smartphone size={15} />,
  },
};

function getMethodOrder(type: string): number {
  if (type === "cbe") return 0;
  if (type === "telebirr") return 1;
  return 99;
}

function getMethodMeta(type: string): MethodMeta {
  if (type === "telebirr") return METHOD_META.telebirr;
  return METHOD_META.cbe;
}

function parseOptionalAmount(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;

  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

function shortReference(value: string | null | undefined): string {
  const ref = value?.trim();
  if (!ref) return "Ref unavailable";
  if (ref.length <= 10) return `Ref ${ref}`;
  return `Ref …${ref.slice(-6)}`;
}

function formatAmount(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function DepositPage() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const fetchWallet = useWalletStore((s) => s.fetchWallet);

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodsLoaded, setMethodsLoaded] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [amount, setAmount] = useState("");
  const [txReference, setTxReference] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deposits, setDeposits] = useState<UserDeposit[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [step, setStep] = useState<DepositStep>("select");

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

      if (options?.resetRetryCount) {
        methodsRetryCountRef.current = 0;
      }

      clearMethodsRetryTimer();
      methodsLoadingRef.current = true;

      try {
        const result = await withTimeout(
          getPaymentMethodsFn({ data: { activeOnly: true } }),
          METHOD_LOAD_TIMEOUT_MS,
          "Payment methods request timed out.",
        );

        if (!mountedRef.current) return;

        setMethods(result as PaymentMethod[]);
        setMethodsLoaded(true);
        methodsRetryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Deposit payment methods background refresh failed:", err);

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

      if (options?.resetRetryCount) {
        historyRetryCountRef.current = 0;
      }

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
      } catch (err) {
        console.error("[QHash] Deposit history background refresh failed:", err);

        if (!mountedRef.current) return;

        scheduleHistoryRetry(() => {
          void loadHistory();
        });
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

  const resetForm = () => {
    setStep("select");
    setSelectedMethod(null);
    setAmount("");
    setTxReference("");
  };

  const handleSubmit = async () => {
    if (!user?.id || !selectedMethod || submitting) return;

    const meta = getMethodMeta(selectedMethod.type);
    const ref = txReference.trim().toUpperCase();

    if (!ref) {
      toast.error("Enter your transaction ID.");
      return;
    }

    if (!ref.startsWith(meta.refPrefix)) {
      toast.error(meta.refError);
      return;
    }

    const amountInput = amount.trim();
    const numAmount = parseOptionalAmount(amountInput);

    if (amountInput && (!Number.isFinite(numAmount) || numAmount <= 0)) {
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
          amount: numAmount,
          paymentMethodId: selectedMethod.id,
          transactionReference: ref,
        },
      });

      toast.success(meta.successToast);
      resetForm();
      void loadHistory({ resetRetryCount: true });
      void fetchWallet(user.id);
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "DEPOSIT").message);
    } finally {
      setSubmitting(false);
    }
  };

  const methodOptions = useMemo(
    () =>
      Object.entries(
        methods.reduce(
          (acc, method) => {
            if (!acc[method.type]) acc[method.type] = [];
            acc[method.type].push(method);
            return acc;
          },
          {} as Record<string, PaymentMethod[]>,
        ),
      )
        .sort(([a], [b]) => getMethodOrder(a) - getMethodOrder(b))
        .flatMap(([, accounts]) =>
          accounts.map((method, index) => ({ method, index, total: accounts.length })),
        ),
    [methods],
  );

  return (
    <div className="space-y-3 pb-20 lg:mx-auto lg:grid lg:max-w-5xl lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0">
      <div className="space-y-3 lg:col-span-7 xl:col-span-8">
        {step === "select" || !selectedMethod ? (
          <DepositMethodSelection
            methodsLoaded={methodsLoaded}
            methodsCount={methods.length}
            methodOptions={methodOptions}
            onSelect={(method) => {
              setSelectedMethod(method);
              setStep("form");
            }}
          />
        ) : (
          <MethodDepositForm
            method={selectedMethod}
            amount={amount}
            txReference={txReference}
            submitting={submitting}
            onAmountChange={setAmount}
            onReferenceChange={setTxReference}
            onBack={resetForm}
            onSubmit={handleSubmit}
          />
        )}
      </div>

      <div className="lg:col-span-5 xl:col-span-4">
        <DepositHistory deposits={deposits} historyLoaded={historyLoaded} />
      </div>
    </div>
  );
}

function DepositMethodSelection({
  methodsLoaded,
  methodsCount,
  methodOptions,
  onSelect,
}: {
  methodsLoaded: boolean;
  methodsCount: number;
  methodOptions: Array<{ method: PaymentMethod; index: number; total: number }>;
  onSelect: (method: PaymentMethod) => void;
}) {
  return (
    <>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
          Deposit Center
        </p>
        <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">Deposit</h1>
        <p className="mt-1 text-xs text-gray-500">Add funds via CBE or TeleBirr</p>
      </div>

      <section className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-gray-100">Choose Deposit Method</h2>
          {methodsCount > 0 && (
            <Badge variant="default" className="shrink-0 text-[9px]">
              {methodsCount} option{methodsCount === 1 ? "" : "s"}
            </Badge>
          )}
        </div>

        {!methodsLoaded && methodsCount === 0 ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="skeleton h-16 rounded-xl" />
            ))}
          </div>
        ) : methodsLoaded && methodsCount === 0 ? (
          <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-6 text-center">
            <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-[#1a1a1a] bg-[#0b0b0b]">
              <ArrowDownCircle size={17} className="text-gray-600" />
            </div>
            <p className="mt-3 text-sm font-semibold text-gray-300">No payment methods</p>
            <p className="mt-1 text-xs text-gray-600">Please try again later.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111] shadow-[0_0_0_1px_rgba(0,255,65,0.02)]">
            {methodOptions.map(({ method, index, total }, rowIndex) => {
              const meta = getMethodMeta(method.type);
              const accountSuffix = total > 1 ? ` · Account ${index + 1}` : "";

              return (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => onSelect(method)}
                  className={[
                    "group w-full px-3.5 py-3 text-left transition-colors hover:bg-[rgba(0,255,65,0.035)] card-press",
                    rowIndex === methodOptions.length - 1 ? "" : "border-b border-[#1a1a1a]",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[rgba(0,255,65,0.18)] bg-[linear-gradient(145deg,rgba(0,255,65,0.12),rgba(0,255,65,0.04))] text-[#00ff41]">
                      {meta.icon}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black leading-tight text-gray-100">
                        {meta.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                        {meta.sublabel}{accountSuffix}
                      </span>
                    </span>

                    <Badge variant="neon" className="shrink-0 text-[9px]">
                      Add funds
                    </Badge>

                    <ChevronRight
                      size={15}
                      className="shrink-0 text-gray-600 transition-colors group-hover:text-[#00ff41]"
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <DepositNoticeLine />
      </section>
    </>
  );
}

function DepositNoticeLine() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.035)] px-3 py-2.5">
      <Info size={13} className="mt-0.5 shrink-0 text-[#00ff41]" />
      <p className="text-[10px] leading-relaxed text-gray-500">
        <span className="font-semibold text-[#00ff41]">Fund wallet</span>
        <span> · Transfer first, then submit your reference.</span>
      </p>
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
    <section className="overflow-hidden rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111]">
      <div className="border-b border-[#1a1a1a] px-3.5 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] text-gray-400 transition-colors hover:border-[rgba(0,255,65,0.35)] hover:text-[#00ff41] card-press"
            aria-label="Back to deposit methods"
          >
            <ChevronLeft size={15} />
          </button>

          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
            {meta.icon}
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-gray-600">
              Deposit details
            </p>
            <h2 className="truncate text-sm font-bold leading-tight text-gray-100">
              {meta.label} Deposit
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-gray-500">{meta.pageSubtitle}</p>
          </div>

          <Badge variant="neon" className="shrink-0 text-[9px]">
            Add funds
          </Badge>
        </div>
      </div>

      <div className="space-y-3.5 p-3.5">
        <PaymentAccountCard
          method={method}
          meta={meta}
          copied={copied}
          onCopy={copyAccountNumber}
        />

        <div className="flex items-start gap-2 rounded-xl border border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.035)] px-3 py-2.5">
          <Info size={13} className="mt-0.5 shrink-0 text-[#00ff41]" />
          <p className="text-[10px] leading-relaxed text-gray-500">
            Transfer to this {method.type === "telebirr" ? "TeleBirr number" : "account"}, then enter your transaction ID below.
          </p>
        </div>

        <Input
          label="Amount (ETB) — optional"
          type="text"
          placeholder="Enter deposit amount"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          inputMode="decimal"
          hint="Optional — enter the amount from your receipt"
        />

        <Input
          label={meta.refLabel}
          placeholder={meta.refPlaceholder}
          value={txReference}
          onChange={(e) => onReferenceChange(e.target.value)}
          hint={meta.refHint}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
        />

        <Button
          fullWidth
          loading={submitting}
          disabled={!txReference.trim() || submitting}
          onClick={onSubmit}
        >
          Submit Deposit
        </Button>
      </div>
    </section>
  );
}

function PaymentAccountCard({
  method,
  meta,
  copied,
  onCopy,
}: {
  method: PaymentMethod;
  meta: MethodMeta;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-2.5 rounded-xl border border-[#1f1f1f] bg-[#0b0b0b] p-3">
      <AccountDetail label={meta.accountLabel} value={method.account_name} />
      <div className="flex items-start justify-between gap-3">
        <span className="shrink-0 text-[11px] text-gray-500">{meta.numberLabel}</span>
        <div className="flex min-w-0 items-start justify-end gap-2">
          <span className="min-w-0 break-all text-right font-mono text-sm font-semibold leading-relaxed text-[#00ff41]">
            {method.account_number}
          </span>
          <button
            type="button"
            onClick={onCopy}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#1f1f1f] bg-[#111] text-gray-500 hover:text-[#00ff41] card-press"
            aria-label={`Copy ${meta.numberLabel.toLowerCase()}`}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      </div>
      {method.instructions && (
        <p className="border-t border-[#1f1f1f] pt-2.5 text-[11px] leading-relaxed text-gray-500">
          {method.instructions}
        </p>
      )}
    </div>
  );
}

function AccountDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[11px] text-gray-500">{label}</span>
      <span className="truncate text-xs font-semibold text-gray-200">{value}</span>
    </div>
  );
}

function DepositHistory({
  deposits,
  historyLoaded,
}: {
  deposits: UserDeposit[];
  historyLoaded: boolean;
}) {
  const visibleDeposits = deposits.slice(0, HISTORY_PREVIEW_LIMIT);

  return (
    <section className="mt-1 space-y-2.5 lg:mt-0">
      <SectionHeader
        title="Deposit History"
        action={
          <div className="flex items-center gap-2">
            {deposits.length > HISTORY_PREVIEW_LIMIT && (
              <Link
                to="/transactions"
                className="inline-flex items-center gap-0.5 text-[10px] font-medium text-gray-500 hover:text-[#00ff41]"
              >
                View all
                <ChevronRight size={12} />
              </Link>
            )}
            {deposits.length > 0 ? (
              <Badge variant="default" className="shrink-0 text-[9px]">
                {deposits.length}
              </Badge>
            ) : null}
          </div>
        }
      />

      {!historyLoaded && deposits.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : historyLoaded && deposits.length === 0 ? (
        <ListPanel divided={false}>
          <EmptyState
            icon={<Clock size={22} />}
            title="No deposits yet"
            description="Submitted deposits will appear here."
            className="py-10"
          />
        </ListPanel>
      ) : (
        <ListPanel>
          {visibleDeposits.map((deposit) => (
            <DepositHistoryItem key={deposit.id} deposit={deposit} />
          ))}
        </ListPanel>
      )}
    </section>
  );
}

function DepositHistoryItem({ deposit }: { deposit: UserDeposit }) {
  const meta = getMethodMeta(deposit.method_type);
  const hasAmount = deposit.amount > 0;
  const isApproved = deposit.status === "approved";
  const isRejected = deposit.status === "rejected";
  const isPending = deposit.status === "pending";
  const amountText = hasAmount
    ? `+${formatAmount(deposit.amount)} ETB`
    : isRejected
      ? "Rejected"
      : isPending
        ? "Pending"
        : "Reviewing";
  const amountClass = isApproved
    ? "text-[#00ff41]"
    : isRejected
      ? "text-red-400"
      : isPending
        ? "text-amber-300"
        : "text-gray-300";
  const iconClass = isApproved
    ? "text-[#00ff41]"
    : isRejected
      ? "text-red-400"
      : "text-amber-300";

  return (
    <ListRow
      icon={<ArrowDownCircle size={15} className={iconClass} />}
      title={
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-bold text-gray-100">
            {meta.label} Deposit
          </p>
          <DepositStatusBadge status={deposit.status} />
        </div>
      }
      description={`${shortReference(deposit.transaction_reference)} · ${formatDateTime(deposit.created_at)}`}
      right={<p className={`font-mono text-xs font-semibold ${amountClass}`}>{amountText}</p>}
    />
  );
}

function DepositStatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { label: string; variant: "success" | "warning" | "danger" | "default"; icon: React.ReactNode }
  > = {
    approved: { label: "Done", variant: "success", icon: <CheckCircle size={10} /> },
    pending: { label: "Pending", variant: "warning", icon: <Clock size={10} /> },
    rejected: { label: "Failed", variant: "danger", icon: <XCircle size={10} /> },
  };
  const { label, variant, icon } = config[status] ?? {
    label: status,
    variant: "default" as const,
    icon: null,
  };

  return (
    <Badge variant={variant} className="shrink-0 text-[9px]">
      <span className="flex items-center gap-1">
        {icon}
        {label}
      </span>
    </Badge>
  );
}

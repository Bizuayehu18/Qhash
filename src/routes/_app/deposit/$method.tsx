import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { EmptyState } from "@/components/ui/EmptyState.js";
import { Input } from "@/components/ui/Input.js";
import { ListPanel } from "@/components/ui/ListPanel.js";
import { ListRow } from "@/components/ui/ListRow.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";
import {
  ArrowDownCircle,
  ArrowLeft,
  Building2,
  CheckCircle,
  ChevronRight,
  Clock,
  Copy,
  Info,
  ReceiptText,
  ShieldCheck,
  Smartphone,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { withTimeout } from "@/lib/async.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { formatDateTime } from "@/lib/format.js";
import type { PaymentMethodType } from "@/lib/database.types.js";
import { getUserDepositsFn, submitDepositFn } from "@/lib/server/deposits.js";
import { getPaymentMethodsFn } from "@/lib/server/payment-methods.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";

export const Route = createFileRoute("/_app/deposit/$method")({
  component: DepositMethodRoute,
});

type DepositMethodType = Extract<PaymentMethodType, "cbe" | "telebirr">;
type PaymentMethod = {
  id: string;
  type: PaymentMethodType;
  account_name: string;
  account_number: string;
  instructions: string | null;
  is_active: boolean;
};
type UserDeposit = Awaited<ReturnType<typeof getUserDepositsFn>>[number];

type MethodMeta = {
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  accountLabel: string;
  numberLabel: string;
  referencePrefix: string;
  referencePlaceholder: string;
  verificationBadge: string;
  verificationTone: "success" | "warning";
  hint: string;
  submitLabel: string;
  icon: React.ReactNode;
};

const METHOD_LOAD_TIMEOUT_MS = 10_000;
const HISTORY_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

const METHOD_META: Record<DepositMethodType, MethodMeta> = {
  cbe: {
    label: "CBE",
    eyebrow: "Bank transfer",
    title: "CBE Deposit",
    description: "Transfer to the QHash CBE account, then submit your FT transaction ID for receipt verification.",
    accountLabel: "Receiving Account",
    numberLabel: "CBE Account Number",
    referencePrefix: "FT",
    referencePlaceholder: "e.g. FTXXXXXXXXXX",
    verificationBadge: "Auto verification",
    verificationTone: "success",
    hint: "The actual amount is verified from your CBE receipt.",
    submitLabel: "Submit CBE Deposit",
    icon: <Building2 size={17} />,
  },
  telebirr: {
    label: "TeleBirr",
    eyebrow: "Wallet transfer",
    title: "TeleBirr Deposit",
    description: "Send funds to the QHash TeleBirr account, then submit your D transaction ID for review.",
    accountLabel: "Receiving Name",
    numberLabel: "TeleBirr Number",
    referencePrefix: "D",
    referencePlaceholder: "e.g. DXXXXXXXXX",
    verificationBadge: "Manual review",
    verificationTone: "warning",
    hint: "TeleBirr deposits are reviewed after submission.",
    submitLabel: "Submit TeleBirr Deposit",
    icon: <Smartphone size={17} />,
  },
};

function normalizeMethod(value: string): DepositMethodType | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "cbe") return "cbe";
  if (normalized === "telebirr") return "telebirr";
  return null;
}

function formatAmount(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

function DepositMethodRoute() {
  const { method } = Route.useParams();
  const methodType = normalizeMethod(method);

  if (!methodType) {
    return <UnsupportedDepositMethod method={method} />;
  }

  return <DepositMethodPage methodType={methodType} />;
}

function DepositMethodPage({ methodType }: { methodType: DepositMethodType }) {
  const meta = METHOD_META[methodType];
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

        setMethods(result as PaymentMethod[]);
        setMethodsLoaded(true);
        methodsRetryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Method deposit account load failed:", err);

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
      } catch (err) {
        console.error("[QHash] Method deposit history load failed:", err);

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

  const methodOptions = useMemo(
    () => methods.filter((method) => method.type === methodType),
    [methodType, methods],
  );

  useEffect(() => {
    if (!methodsLoaded) return;

    const selectedStillAvailable = selectedMethod
      ? methodOptions.some((method) => method.id === selectedMethod.id)
      : false;

    if (!selectedStillAvailable) {
      setSelectedMethod(methodOptions[0] ?? null);
    }
  }, [methodOptions, methodsLoaded, selectedMethod]);

  const methodDeposits = useMemo(
    () => deposits.filter((deposit) => deposit.method_type === methodType),
    [deposits, methodType],
  );

  const confirmAmount = parseOptionalAmount(amount);

  const resetForm = () => {
    setAmount("");
    setTxReference("");
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied!"));
  };

  const handleSubmit = async () => {
    if (!user?.id || !selectedMethod || !txReference.trim()) return;

    const ref = txReference.trim().toUpperCase();
    if (!ref.startsWith(meta.referencePrefix)) {
      toast.error(`Please enter a valid ${meta.label} transaction ID starting with "${meta.referencePrefix}".`);
      return;
    }

    const amountInput = amount.trim();
    const numAmount = parseOptionalAmount(amountInput);

    if (amountInput && (!Number.isFinite(numAmount) || numAmount <= 0)) {
      toast.error("Enter a deposit amount above 0 ETB, or leave it blank.");
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

      toast.success("Deposit submitted. It will be verified shortly.");
      resetForm();
      void loadHistory({ resetRetryCount: true });
      void fetchWallet(user.id);
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "DEPOSIT").message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-3 pb-20 lg:mx-auto lg:grid lg:max-w-5xl lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0">
      <div className="lg:col-span-12">
        <MethodHero meta={meta} />
      </div>

      <div className="space-y-3 lg:col-span-7 xl:col-span-8">
        {methodOptions.length > 1 && (
          <AccountSelector
            meta={meta}
            methods={methodOptions}
            selectedMethod={selectedMethod}
            onSelect={setSelectedMethod}
          />
        )}

        {!methodsLoaded && methodOptions.length === 0 ? (
          <DepositMethodSkeleton />
        ) : methodsLoaded && methodOptions.length === 0 ? (
          <NoMethodAccount meta={meta} />
        ) : selectedMethod ? (
          <DepositMethodForm
            meta={meta}
            selectedMethod={selectedMethod}
            amount={amount}
            txReference={txReference}
            confirmAmount={confirmAmount}
            submitting={submitting}
            onAmountChange={setAmount}
            onTxReferenceChange={setTxReference}
            onCopy={copyToClipboard}
            onSubmit={handleSubmit}
          />
        ) : null}
      </div>

      <div className="space-y-3 lg:col-span-5 xl:col-span-4">
        <MethodGuide meta={meta} />
        <MethodDepositHistory meta={meta} deposits={methodDeposits} historyLoaded={historyLoaded} />
      </div>
    </div>
  );
}

function MethodHero({ meta }: { meta: MethodMeta }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[rgba(0,255,65,0.16)] bg-[#111] p-4 shadow-[0_0_30px_rgba(0,255,65,0.04)]">
      <div className="pointer-events-none absolute -right-12 -top-16 h-36 w-36 rounded-full bg-[rgba(0,255,65,0.08)] blur-3xl" />
      <div className="relative flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[rgba(0,255,65,0.2)] bg-[linear-gradient(145deg,rgba(0,255,65,0.14),rgba(0,255,65,0.045))] text-[#00ff41]">
          {meta.icon}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
              {meta.eyebrow}
            </p>
            <Badge
              variant={meta.verificationTone}
              className="rounded-full px-2.5 py-1 text-[9px]"
            >
              {meta.verificationBadge}
            </Badge>
          </div>
          <h1 className="mt-1 text-xl font-black leading-tight text-gray-100">{meta.title}</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-500">{meta.description}</p>
        </div>
      </div>
    </section>
  );
}

function AccountSelector({
  meta,
  methods,
  selectedMethod,
  onSelect,
}: {
  meta: MethodMeta;
  methods: PaymentMethod[];
  selectedMethod: PaymentMethod | null;
  onSelect: (method: PaymentMethod) => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111]">
      <div className="flex items-center justify-between gap-3 border-b border-[#1a1a1a] px-3.5 py-3">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-gray-600">Receiving account</p>
          <h2 className="text-sm font-bold text-gray-100">Choose {meta.label} account</h2>
        </div>
        <Badge variant="default" className="shrink-0 text-[9px]">
          {methods.length} accounts
        </Badge>
      </div>

      {methods.map((method, index) => {
        const selected = selectedMethod?.id === method.id;
        return (
          <button
            key={method.id}
            type="button"
            onClick={() => onSelect(method)}
            className={[
              "group w-full px-3.5 py-3 text-left transition-colors hover:bg-[rgba(0,255,65,0.035)] card-press",
              index === methods.length - 1 ? "" : "border-b border-[#1a1a1a]",
              selected ? "bg-[rgba(0,255,65,0.045)]" : "",
            ].join(" ")}
          >
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.055)] text-[#00ff41]">
                {meta.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold text-gray-100">{method.account_name}</span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-gray-500">{method.account_number}</span>
              </span>
              {selected ? (
                <Badge variant="neon" className="shrink-0 rounded-full text-[9px]">Selected</Badge>
              ) : (
                <ChevronRight size={15} className="shrink-0 text-gray-600 group-hover:text-[#00ff41]" />
              )}
            </div>
          </button>
        );
      })}
    </section>
  );
}

function DepositMethodForm({
  meta,
  selectedMethod,
  amount,
  txReference,
  confirmAmount,
  submitting,
  onAmountChange,
  onTxReferenceChange,
  onCopy,
  onSubmit,
}: {
  meta: MethodMeta;
  selectedMethod: PaymentMethod;
  amount: string;
  txReference: string;
  confirmAmount: number;
  submitting: boolean;
  onAmountChange: (value: string) => void;
  onTxReferenceChange: (value: string) => void;
  onCopy: (text: string) => void;
  onSubmit: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[rgba(0,255,65,0.16)] bg-[#111] shadow-[0_0_30px_rgba(0,255,65,0.03)]">
      <div className="border-b border-[#1a1a1a] px-3.5 py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
            <ReceiptText size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-gray-600">Secure funding</p>
            <h2 className="truncate text-sm font-bold leading-tight text-gray-100">Transfer & confirm</h2>
          </div>
          <Badge variant="neon" className="shrink-0 text-[9px]">{meta.label}</Badge>
        </div>
      </div>

      <div className="space-y-3.5 p-3.5">
        <ReceivingAccountCard meta={meta} selectedMethod={selectedMethod} onCopy={onCopy} />

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Amount (ETB) — optional"
            type="text"
            placeholder="Enter deposit amount"
            value={amount}
            onChange={(e) => onAmountChange(e.target.value)}
            inputMode="decimal"
            hint={meta.hint}
          />

          <Input
            label="Transaction ID / Reference"
            placeholder={meta.referencePlaceholder}
            value={txReference}
            onChange={(e) => onTxReferenceChange(e.target.value)}
            hint={`Starts with ${meta.referencePrefix}`}
          />
        </div>

        <DepositSummary meta={meta} selectedMethod={selectedMethod} confirmAmount={confirmAmount} />

        <Button
          fullWidth
          loading={submitting}
          disabled={!txReference.trim() || submitting}
          onClick={onSubmit}
        >
          {meta.submitLabel}
        </Button>
      </div>
    </section>
  );
}

function ReceivingAccountCard({
  meta,
  selectedMethod,
  onCopy,
}: {
  meta: MethodMeta;
  selectedMethod: PaymentMethod;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="space-y-2.5 rounded-xl border border-[#1f1f1f] bg-[#0b0b0b] p-3">
      <AccountDetail label={meta.accountLabel} value={selectedMethod.account_name} />
      <div className="flex items-start justify-between gap-3">
        <span className="shrink-0 text-[11px] text-gray-500">{meta.numberLabel}</span>
        <div className="flex min-w-0 items-start justify-end gap-2">
          <span className="min-w-0 break-all text-right font-mono text-sm font-semibold leading-relaxed text-[#00ff41]">
            {selectedMethod.account_number}
          </span>
          <button
            type="button"
            onClick={() => onCopy(selectedMethod.account_number)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#1f1f1f] bg-[#111] text-gray-500 hover:text-[#00ff41] card-press"
            aria-label={`Copy ${meta.label} account number`}
          >
            <Copy size={12} />
          </button>
        </div>
      </div>
      {selectedMethod.instructions && (
        <p className="border-t border-[#1f1f1f] pt-2.5 text-[11px] leading-relaxed text-gray-500">
          {selectedMethod.instructions}
        </p>
      )}
    </div>
  );
}

function DepositSummary({
  meta,
  selectedMethod,
  confirmAmount,
}: {
  meta: MethodMeta;
  selectedMethod: PaymentMethod;
  confirmAmount: number;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-[#1f1f1f] bg-[#0b0b0b] p-3">
      <SummaryRow label="Method" value={meta.label} />
      <SummaryRow label="Receiving account" value={selectedMethod.account_name} />
      {Number.isFinite(confirmAmount) && confirmAmount > 0 && (
        <SummaryRow label="Amount" value={`${formatAmount(confirmAmount)} ETB`} highlight />
      )}
    </div>
  );
}

function MethodGuide({ meta }: { meta: MethodMeta }) {
  return (
    <section className="space-y-2.5 rounded-xl border border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.035)] p-3">
      <div className="flex items-center gap-2">
        <ShieldCheck size={14} className="text-[#00ff41]" />
        <h2 className="text-xs font-bold text-gray-100">How it works</h2>
      </div>
      <ol className="space-y-2 text-[10px] leading-relaxed text-gray-500">
        <li><span className="font-semibold text-[#00ff41]">1.</span> Transfer to the receiving account.</li>
        <li><span className="font-semibold text-[#00ff41]">2.</span> Copy your {meta.label} transaction ID.</li>
        <li><span className="font-semibold text-[#00ff41]">3.</span> Submit the reference and wait for verification.</li>
      </ol>
    </section>
  );
}

function MethodDepositHistory({
  meta,
  deposits,
  historyLoaded,
}: {
  meta: MethodMeta;
  deposits: UserDeposit[];
  historyLoaded: boolean;
}) {
  return (
    <section className="mt-1 space-y-2.5 lg:mt-0">
      <SectionHeader
        title={`${meta.label} History`}
        action={
          deposits.length > 0 ? (
            <Badge variant="default" className="shrink-0 text-[9px]">
              {deposits.length}
            </Badge>
          ) : null
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
            title={`No ${meta.label} deposits yet`}
            description="Submitted deposits will appear here."
            className="py-10"
          />
        </ListPanel>
      ) : (
        <ListPanel>
          {deposits.map((deposit) => (
            <DepositHistoryItem key={deposit.id} deposit={deposit} />
          ))}
        </ListPanel>
      )}
    </section>
  );
}

function DepositHistoryItem({ deposit }: { deposit: UserDeposit }) {
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
          <p className="truncate text-sm font-bold text-gray-100">Deposit</p>
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

function AccountDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[11px] text-gray-500">{label}</span>
      <span className="truncate text-xs font-semibold text-gray-200">{value}</span>
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
      <span className={highlight ? "font-mono font-semibold text-[#00ff41]" : "truncate text-gray-300"}>
        {value}
      </span>
    </div>
  );
}

function DepositMethodSkeleton() {
  return (
    <div className="space-y-3">
      <div className="skeleton h-44 rounded-2xl" />
      <div className="skeleton h-64 rounded-2xl" />
    </div>
  );
}

function NoMethodAccount({ meta }: { meta: MethodMeta }) {
  return (
    <div className="rounded-2xl border border-[#1a1a1a] bg-[#111] p-6 text-center">
      <div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-[#1a1a1a] bg-[#0b0b0b] text-gray-600">
        {meta.icon}
      </div>
      <p className="mt-3 text-sm font-semibold text-gray-300">No active {meta.label} account</p>
      <p className="mt-1 text-xs text-gray-600">Please try another deposit method or check again later.</p>
      <Link
        to="/deposit"
        className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.055)] px-3 py-1.5 text-[11px] font-semibold text-[#00ff41] card-press"
      >
        Back to Deposit Center
        <ChevronRight size={12} />
      </Link>
    </div>
  );
}

function UnsupportedDepositMethod({ method }: { method: string }) {
  return (
    <div className="mx-auto max-w-md pb-20">
      <div className="rounded-2xl border border-[#1a1a1a] bg-[#111] p-6 text-center">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl border border-[#1a1a1a] bg-[#0b0b0b] text-gray-600">
          <Info size={18} />
        </div>
        <p className="mt-3 text-sm font-semibold text-gray-300">Deposit method not found</p>
        <p className="mt-1 text-xs leading-relaxed text-gray-600">
          “{method}” is not available. Choose CBE or TeleBirr from the Deposit Center.
        </p>
        <Link
          to="/deposit"
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.055)] px-3 py-1.5 text-[11px] font-semibold text-[#00ff41] card-press"
        >
          <ArrowLeft size={12} />
          Back to Deposit Center
        </Link>
      </div>
    </div>
  );
}

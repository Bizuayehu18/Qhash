import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import {
  ArrowDownCircle,
  Info,
  CheckCircle,
  Clock,
  XCircle,
  Copy,
  Building2,
  Smartphone,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { formatDateTime } from "@/lib/format.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import { getPaymentMethodsFn } from "@/lib/server/payment-methods.js";
import { submitDepositFn, getUserDepositsFn } from "@/lib/server/deposits.js";
import { withTimeout } from "@/lib/async.js";
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
type DepositStep = "select" | "pay" | "confirm";

const METHOD_LOAD_TIMEOUT_MS = 10_000;
const HISTORY_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

const METHOD_ICONS: Record<string, React.ReactNode> = {
  cbe: <Building2 size={16} />,
  telebirr: <Smartphone size={16} />,
};

const METHOD_LABELS: Record<string, string> = {
  cbe: "CBE",
  telebirr: "TeleBirr",
};

const METHOD_SUBLABELS: Record<string, string> = {
  cbe: "Bank transfer",
  telebirr: "Mobile wallet",
};

const METHOD_ORDER: Record<string, number> = {
  cbe: 0,
  telebirr: 1,
};

function parseOptionalAmount(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;

  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
}

function getMethodLabel(type: string): string {
  return METHOD_LABELS[type] ?? type.toUpperCase();
}

function getMethodSublabel(type: string): string {
  return METHOD_SUBLABELS[type] ?? "Payment method";
}

function getMethodIcon(type: string): React.ReactNode {
  return METHOD_ICONS[type] ?? <ArrowDownCircle size={16} />;
}

function getMethodOrder(type: string): number {
  return METHOD_ORDER[type] ?? 99;
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

  const getTxPrefix = () => selectedMethod?.type === "telebirr" ? "D" : "FT";
  const getTxPlaceholder = () =>
    selectedMethod?.type === "telebirr" ? "e.g. DXXXXXXXXX" : "e.g. FTXXXXXXXXXX";

  const handleSubmit = async () => {
    if (!user?.id || !selectedMethod || !txReference.trim()) return;

    const ref = txReference.trim().toUpperCase();
    const prefix = getTxPrefix();

    if (!ref.startsWith(prefix)) {
      toast.error(
        `Please enter a valid ${METHOD_LABELS[selectedMethod.type]} transaction ID starting with "${prefix}".`
      );
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
      fetchWallet(user.id);
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "DEPOSIT").message);
    } finally {
      setSubmitting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied!"));
  };

  const groupedMethods = useMemo(
    () => methods.reduce(
      (acc, method) => {
        if (!acc[method.type]) acc[method.type] = [];
        acc[method.type].push(method);
        return acc;
      },
      {} as Record<string, PaymentMethod[]>,
    ),
    [methods],
  );

  const confirmAmount = parseOptionalAmount(amount);

  return (
    <div className="space-y-3 pb-20 lg:mx-auto lg:grid lg:max-w-5xl lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0">
      <div className="lg:col-span-12">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
          Deposit Center
        </p>
        <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">Deposit</h1>
        <p className="mt-1 text-xs text-gray-500">Add funds via CBE or TeleBirr</p>
      </div>

      <div className="space-y-3 lg:col-span-7 xl:col-span-8">
        {step === "select" && (
          <MethodSelection
            groupedMethods={groupedMethods}
            methodsLoaded={methodsLoaded}
            methodsCount={methods.length}
            onSelect={(method) => {
              setSelectedMethod(method);
              setStep("pay");
            }}
          />
        )}

        {step === "pay" && selectedMethod && (
          <TransferDetails
            selectedMethod={selectedMethod}
            amount={amount}
            onAmountChange={setAmount}
            onCopy={copyToClipboard}
            onBack={resetForm}
            onContinue={() => setStep("confirm")}
          />
        )}

        {step === "confirm" && selectedMethod && (
          <ConfirmDeposit
            selectedMethod={selectedMethod}
            confirmAmount={confirmAmount}
            txReference={txReference}
            txPlaceholder={getTxPlaceholder()}
            submitting={submitting}
            onTxReferenceChange={setTxReference}
            onBack={() => setStep("pay")}
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

function MethodSelection({
  groupedMethods,
  methodsLoaded,
  methodsCount,
  onSelect,
}: {
  groupedMethods: Record<string, PaymentMethod[]>;
  methodsLoaded: boolean;
  methodsCount: number;
  onSelect: (method: PaymentMethod) => void;
}) {
  const methodOptions = Object.entries(groupedMethods)
    .sort(([a], [b]) => getMethodOrder(a) - getMethodOrder(b))
    .flatMap(([, accounts]) =>
      accounts.map((method, index) => ({ method, index, total: accounts.length })),
    );

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-100">Choose Payment Method</h2>
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
        <div className="overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111]">
          {methodOptions.map(({ method, index, total }, rowIndex) => (
            <PaymentMethodRow
              key={method.id}
              method={method}
              accountIndex={index}
              accountCount={total}
              isLast={rowIndex === methodOptions.length - 1}
              onSelect={() => onSelect(method)}
            />
          ))}
        </div>
      )}

      <DepositNoticeLine />
    </section>
  );
}

function PaymentMethodRow({
  method,
  accountIndex,
  accountCount,
  isLast,
  onSelect,
}: {
  method: PaymentMethod;
  accountIndex: number;
  accountCount: number;
  isLast: boolean;
  onSelect: () => void;
}) {
  const baseSublabel = getMethodSublabel(method.type);
  const sublabel = accountCount > 1 ? `${baseSublabel} · Account ${accountIndex + 1}` : baseSublabel;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "group w-full px-3.5 py-3 text-left transition-colors hover:bg-[rgba(0,255,65,0.035)] card-press",
        isLast ? "" : "border-b border-[#1a1a1a]",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.045)] text-[#00ff41]">
          {getMethodIcon(method.type)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-gray-100">{getMethodLabel(method.type)}</span>
          <span className="mt-0.5 block truncate text-[11px] text-gray-500">{sublabel}</span>
        </span>

        <ChevronRight
          size={15}
          className="shrink-0 text-gray-600 transition-colors group-hover:text-[#00ff41]"
        />
      </div>
    </button>
  );
}

function DepositNoticeLine() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.035)] px-3 py-2.5">
      <Info size={13} className="mt-0.5 shrink-0 text-[#00ff41]" />
      <p className="text-[10px] leading-relaxed text-gray-500">
        <span className="font-semibold text-[#00ff41]">Transfer first</span>
        <span> · Then submit your transaction ID for verification.</span>
      </p>
    </div>
  );
}

function TransferDetails({
  selectedMethod,
  amount,
  onAmountChange,
  onCopy,
  onBack,
  onContinue,
}: {
  selectedMethod: PaymentMethod;
  amount: string;
  onAmountChange: (value: string) => void;
  onCopy: (text: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111]">
      <StepHeader
        title="Transfer Details"
        stepLabel="Step 2 of 3"
        badge={getMethodLabel(selectedMethod.type)}
        icon={getMethodIcon(selectedMethod.type)}
        onBack={onBack}
      />

      <div className="space-y-3.5 p-3.5">
        <PaymentAccountCard selectedMethod={selectedMethod} onCopy={onCopy} />

        <div className="flex items-start gap-2 rounded-xl border border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.035)] px-3 py-2.5">
          <Info size={13} className="mt-0.5 shrink-0 text-[#00ff41]" />
          <p className="text-[10px] leading-relaxed text-gray-500">
            Transfer to the account above, then continue and submit your transaction ID.
          </p>
        </div>

        <Input
          label="Amount (ETB) — optional"
          type="text"
          placeholder="Enter deposit amount"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          inputMode="decimal"
          hint="The actual amount will be verified from the receipt"
        />

        <Button fullWidth onClick={onContinue}>
          I've Made the Payment
        </Button>
      </div>
    </section>
  );
}

function StepHeader({
  title,
  stepLabel,
  badge,
  icon,
  onBack,
}: {
  title: string;
  stepLabel: string;
  badge: string;
  icon: React.ReactNode;
  onBack: () => void;
}) {
  return (
    <div className="border-b border-[#1a1a1a] px-3.5 py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] text-gray-400 transition-colors hover:border-[rgba(0,255,65,0.35)] hover:text-[#00ff41] card-press"
          aria-label="Go back"
        >
          <ChevronLeft size={15} />
        </button>

        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
          {icon}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-gray-600">
            {stepLabel}
          </p>
          <h2 className="truncate text-sm font-bold leading-tight text-gray-100">{title}</h2>
        </div>

        <Badge variant="neon" className="shrink-0 text-[9px]">
          {badge}
        </Badge>
      </div>
    </div>
  );
}

function PaymentAccountCard({
  selectedMethod,
  onCopy,
}: {
  selectedMethod: PaymentMethod;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="space-y-2.5 rounded-xl border border-[#1f1f1f] bg-[#0b0b0b] p-3">
      <AccountDetail label="Account Name" value={selectedMethod.account_name} />
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 text-[11px] text-gray-500">Account Number</span>
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-sm font-semibold text-[#00ff41]">
            {selectedMethod.account_number}
          </span>
          <button
            type="button"
            onClick={() => onCopy(selectedMethod.account_number)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#1f1f1f] bg-[#111] text-gray-500 hover:text-[#00ff41] card-press"
            aria-label="Copy account number"
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

function AccountDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[11px] text-gray-500">{label}</span>
      <span className="truncate text-xs font-semibold text-gray-200">{value}</span>
    </div>
  );
}

function ConfirmDeposit({
  selectedMethod,
  confirmAmount,
  txReference,
  txPlaceholder,
  submitting,
  onTxReferenceChange,
  onBack,
  onSubmit,
}: {
  selectedMethod: PaymentMethod;
  confirmAmount: number;
  txReference: string;
  txPlaceholder: string;
  submitting: boolean;
  onTxReferenceChange: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111]">
      <StepHeader
        title="Confirm Deposit"
        stepLabel="Step 3 of 3"
        badge={getMethodLabel(selectedMethod.type)}
        icon={<CheckCircle size={16} />}
        onBack={onBack}
      />

      <div className="space-y-3.5 p-3.5">
        <div className="space-y-2 rounded-xl border border-[#1f1f1f] bg-[#0b0b0b] p-3">
          <SummaryRow label="Method" value={getMethodLabel(selectedMethod.type)} />
          <SummaryRow label="Account" value={selectedMethod.account_name} />
          {Number.isFinite(confirmAmount) && confirmAmount > 0 && (
            <SummaryRow
              label="Amount"
              value={`${formatAmount(confirmAmount)} ETB`}
              highlight
            />
          )}
        </div>

        <Input
          label="Transaction ID / Reference"
          placeholder={txPlaceholder}
          value={txReference}
          onChange={(e) => onTxReferenceChange(e.target.value)}
          hint={`From your ${getMethodLabel(selectedMethod.type)} payment receipt`}
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

function DepositHistory({
  deposits,
  historyLoaded,
}: {
  deposits: UserDeposit[];
  historyLoaded: boolean;
}) {
  return (
    <section className="mt-1 space-y-2.5 lg:mt-0">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-100">Deposit History</h2>
        {deposits.length > 0 && (
          <Badge variant="default" className="shrink-0 text-[9px]">
            {deposits.length}
          </Badge>
        )}
      </div>

      {!historyLoaded && deposits.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : historyLoaded && deposits.length === 0 ? (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-6 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-[#1a1a1a] bg-[#0b0b0b]">
            <Clock size={17} className="text-gray-600" />
          </div>
          <p className="mt-3 text-sm font-semibold text-gray-300">No deposits yet</p>
          <p className="mt-1 text-xs text-gray-600">Submitted deposits will appear here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111] divide-y divide-[#1a1a1a]">
          {deposits.map((deposit) => (
            <DepositHistoryItem key={deposit.id} deposit={deposit} />
          ))}
        </div>
      )}
    </section>
  );
}

function DepositHistoryItem({ deposit }: { deposit: UserDeposit }) {
  const hasAmount = deposit.amount > 0;
  const isApproved = deposit.status === "approved";
  const isRejected = deposit.status === "rejected";
  const isPending = deposit.status === "pending";
  const amountText = hasAmount ? `+${formatAmount(deposit.amount)} ETB` : "Pending verification";
  const amountClass = isApproved
    ? "text-[#00ff41]"
    : isRejected
      ? "text-red-400"
      : isPending
        ? "text-amber-300"
        : "text-gray-300";

  return (
    <div className="space-y-1.5 px-3.5 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`truncate font-mono text-sm font-semibold ${amountClass}`}>
            {amountText}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-gray-600">
            {getMethodLabel(deposit.method_type)} · {formatDateTime(deposit.created_at)} · {shortReference(deposit.transaction_reference)}
          </p>
        </div>
        <DepositStatusBadge status={deposit.status} />
      </div>
    </div>
  );
}

function DepositStatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { label: string; variant: "success" | "warning" | "danger" | "default"; icon: React.ReactNode }
  > = {
    approved: {
      label: "Approved",
      variant: "success",
      icon: <CheckCircle size={10} />,
    },
    pending: {
      label: "Pending",
      variant: "warning",
      icon: <Clock size={10} />,
    },
    rejected: {
      label: "Rejected",
      variant: "danger",
      icon: <XCircle size={10} />,
    },
  };
  const { label, variant, icon } = config[status] ?? {
    label: status,
    variant: "default" as const,
    icon: null,
  };
  return (
    <Badge variant={variant}>
      <span className="flex items-center gap-1">
        {icon}
        {label}
      </span>
    </Badge>
  );
}

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
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

function parseOptionalAmount(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;

  const value = Number(trimmed);
  return Number.isFinite(value) ? value : Number.NaN;
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
  const [step, setStep] = useState<"select" | "pay" | "confirm">("select");

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

  const groupedMethods = methods.reduce(
    (acc, m) => {
      if (!acc[m.type]) acc[m.type] = [];
      acc[m.type].push(m);
      return acc;
    },
    {} as Record<string, PaymentMethod[]>
  );

  const stepNum = step === "select" ? 1 : step === "pay" ? 2 : 3;
  const confirmAmount = parseOptionalAmount(amount);

  return (
    <div className="space-y-5 lg:grid lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0">
      <div className="lg:col-span-12">
        <h1 className="text-lg font-bold">Deposit</h1>
        <p className="text-xs text-gray-500 mt-1">Add funds via CBE or TeleBirr</p>
      </div>

      {/* Progress steps */}
      <div className="flex items-center gap-2 lg:col-span-12">
        {["Select", "Pay", "Confirm"].map((label, i) => (
          <div key={label} className="flex items-center gap-2 flex-1">
            <div
              className={`h-1.5 rounded-full flex-1 ${
                i + 1 <= stepNum ? "bg-[#00ff41]" : "bg-[#1a1a1a]"
              }`}
            />
          </div>
        ))}
      </div>

      <div className="lg:col-span-8 lg:max-w-xl">
        {/* Step 1: Select */}
        {step === "select" && (
          <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <ArrowDownCircle size={14} className="text-[#00ff41]" />
              <span className="text-xs font-semibold">Select Payment Method</span>
            </div>

            {!methodsLoaded && methods.length === 0 ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="skeleton h-16 rounded-xl" />
                ))}
              </div>
            ) : methodsLoaded && methods.length === 0 ? (
              <div className="text-center py-8 text-xs text-gray-500">
                No payment methods available.
              </div>
            ) : (
              <div className="space-y-4">
                {Object.entries(groupedMethods).map(([type, accounts]) => (
                  <div key={type}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-gray-500">{METHOD_ICONS[type]}</span>
                      <span className="text-xs font-medium text-gray-400">
                        {METHOD_LABELS[type] ?? type.toUpperCase()}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {accounts.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setSelectedMethod(m);
                            setStep("pay");
                          }}
                          className="w-full text-left p-3 rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] hover:border-[rgba(0,255,65,0.3)] transition-all card-press"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-sm font-medium text-gray-200">{m.account_name}</p>
                              <p className="text-[11px] text-gray-500 mt-0.5 font-mono">
                                {m.account_number}
                              </p>
                            </div>
                            <Badge variant="neon">{METHOD_LABELS[m.type] ?? m.type}</Badge>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Transfer Details */}
        {step === "pay" && selectedMethod && (
          <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <button onClick={resetForm} className="text-gray-500">
                  <ChevronLeft size={16} />
                </button>
                <span className="text-xs font-semibold">Transfer Details</span>
              </div>
              <Badge variant="neon">{METHOD_LABELS[selectedMethod.type]}</Badge>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[#0a0a0a] border border-[#1f1f1f] space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">Account Name</span>
                  <span className="text-xs text-gray-200">{selectedMethod.account_name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-gray-500">Account Number</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono text-[#00ff41]">
                      {selectedMethod.account_number}
                    </span>
                    <button
                      onClick={() => copyToClipboard(selectedMethod.account_number)}
                      className="text-gray-600 hover:text-gray-300 card-press"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </div>
                {selectedMethod.instructions && (
                  <p className="text-[11px] text-gray-500 pt-2.5 border-t border-[#1f1f1f]">
                    {selectedMethod.instructions}
                  </p>
                )}
              </div>

              <div className="p-3 rounded-xl bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.1)] flex gap-2 text-[11px] text-gray-400">
                <Info size={13} className="text-[#00ff41] shrink-0 mt-0.5" />
                Transfer the amount to the account above, then tap "I've Made the Payment" to continue.
              </div>

              <Input
                label="Amount (ETB) — optional"
                type="number"
                placeholder="Enter deposit amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0.01"
                step="0.01"
                hint="The actual amount will be verified from the receipt"
              />

              <Button
                fullWidth
                onClick={() => setStep("confirm")}
              >
                I've Made the Payment
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm with Transaction ID */}
        {step === "confirm" && selectedMethod && (
          <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4">
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setStep("pay")} className="text-gray-500">
                <ChevronLeft size={16} />
              </button>
              <CheckCircle size={14} className="text-[#00ff41]" />
              <span className="text-xs font-semibold">Confirm Deposit</span>
            </div>

            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-[#0a0a0a] border border-[#1f1f1f] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Method</span>
                  <span className="text-gray-300">{METHOD_LABELS[selectedMethod.type]}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-500">Account</span>
                  <span className="text-gray-300">{selectedMethod.account_name}</span>
                </div>
                {Number.isFinite(confirmAmount) && confirmAmount > 0 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-gray-500">Amount</span>
                    <span className="text-[#00ff41] font-mono font-medium">
                      {confirmAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB
                    </span>
                  </div>
                )}
              </div>

              <Input
                label="Transaction ID / Reference"
                placeholder={getTxPlaceholder()}
                value={txReference}
                onChange={(e) => setTxReference(e.target.value)}
                hint={`From your ${METHOD_LABELS[selectedMethod.type]} payment receipt`}
              />

              <Button
                fullWidth
                loading={submitting}
                disabled={!txReference.trim() || submitting}
                onClick={handleSubmit}
              >
                Submit Deposit
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Deposit History */}
      <div className="lg:col-span-4">
        <h2 className="text-sm font-semibold mb-3">Deposit History</h2>
        {!historyLoaded && deposits.length === 0 ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="skeleton h-14 rounded-xl" />
            ))}
          </div>
        ) : historyLoaded && deposits.length === 0 ? (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-8 text-center text-xs text-gray-600">
            No deposits yet
          </div>
        ) : (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
            {deposits.map((d) => (
              <div key={d.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <ArrowDownCircle size={14} className="text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-xs font-mono text-[#00ff41]">
                        {d.amount > 0
                          ? `+${d.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB`
                          : "Pending verification"}
                      </p>
                      <p className="text-[10px] text-gray-600">
                        {METHOD_LABELS[d.method_type] ?? d.method_type} &middot;{" "}
                        {formatDateTime(d.created_at)}
                      </p>
                    </div>
                  </div>
                  <DepositStatusBadge status={d.status} />
                </div>
                <div className="flex items-center gap-3 mt-1.5 ml-11">
                  <span className="text-[10px] text-gray-500 font-mono truncate max-w-[140px]">
                    {d.transaction_reference}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
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

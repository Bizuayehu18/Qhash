import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Receipt, Clock, CheckCircle2, XCircle } from "lucide-react";
import { TxIcon, txLabel, isOutgoingTx } from "@/components/ui/TransactionHelpers.js";
import { formatDateTime } from "@/lib/format.js";
import { useAuthStore } from "@/store/authStore.js";
import { getTransactionsFn } from "@/lib/server/transactions.js";
import { withTimeout } from "@/lib/async.js";

export const Route = createFileRoute("/_app/transactions")({
  component: TransactionsPage,
});

const FILTER_TABS = [
  { key: "all", label: "All" },
  { key: "deposit", label: "Deposits" },
  { key: "withdrawal", label: "Withdrawals" },
  { key: "earning", label: "Earnings" },
  { key: "plan_purchase", label: "Investments" },
];

type Transaction = Awaited<ReturnType<typeof getTransactionsFn>>[number];

const TRANSACTIONS_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

function StatusBadge({ status }: { status?: string }) {
  switch (status) {
    case "completed":
    case "approved":
      return (
        <span className="inline-flex items-center gap-1 text-[9px] text-emerald-400 bg-emerald-400/[0.08] border border-emerald-400/[0.15] rounded-full px-1.5 py-0.5">
          <CheckCircle2 size={8} />
          Done
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 text-[9px] text-amber-400 bg-amber-400/[0.08] border border-amber-400/[0.15] rounded-full px-1.5 py-0.5">
          <Clock size={8} />
          Pending
        </span>
      );
    case "failed":
    case "rejected":
      return (
        <span className="inline-flex items-center gap-1 text-[9px] text-red-400 bg-red-400/[0.08] border border-red-400/[0.15] rounded-full px-1.5 py-0.5">
          <XCircle size={8} />
          Failed
        </span>
      );
    default:
      return null;
  }
}

function TransactionsPage() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsLoaded, setTransactionsLoaded] = useState(false);
  const [activeFilter, setActiveFilter] = useState("all");

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
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

  const loadTransactions = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (!user?.id || !accessToken) return;

      clearRetryTimer();

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const filter = activeFilter;

      try {
        const rows = await withTimeout(
          getTransactionsFn({ data: { accessToken, type: filter } }),
          TRANSACTIONS_LOAD_TIMEOUT_MS,
          "Transactions request timed out.",
        );

        if (!mountedRef.current || requestIdRef.current !== requestId) return;

        setTransactions(rows);
        setTransactionsLoaded(true);
        retryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Transactions background refresh failed:", err);

        if (!mountedRef.current || requestIdRef.current !== requestId) return;

        scheduleRetry(() => {
          void loadTransactions();
        });
      }
    },
    [accessToken, activeFilter, clearRetryTimer, scheduleRetry, user?.id],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  useEffect(() => {
    setTransactions([]);
    setTransactionsLoaded(false);
    retryCountRef.current = 0;
    void loadTransactions({ resetRetryCount: true });
  }, [activeFilter, loadTransactions]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void loadTransactions({ resetRetryCount: true });
      }
    };

    const handleOnline = () => {
      void loadTransactions({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadTransactions]);

  return (
    <div className="space-y-4 lg:max-w-3xl lg:mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Transactions</h1>
        {transactionsLoaded && transactions.length > 0 && (
          <span className="text-[10px] text-gray-600 font-mono">
            {transactions.length} records
          </span>
        )}
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1 lg:mx-0 lg:px-0">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveFilter(tab.key)}
            className={`shrink-0 px-3 py-1.5 text-[11px] rounded-full border transition-colors card-press ${
              activeFilter === tab.key
                ? "border-[rgba(0,255,65,0.3)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
                : "border-[#1f1f1f] text-gray-500"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {!transactionsLoaded ? (
        <div className="space-y-3 stagger-children">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton h-[68px] rounded-xl" />
          ))}
        </div>
      ) : transactions.length === 0 ? (
        <div className="text-center py-16">
          <Receipt size={24} className="mx-auto mb-3 text-gray-700" />
          <p className="text-xs text-gray-600">No transactions found</p>
        </div>
      ) : (
        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a] overflow-hidden">
          {transactions.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between px-4 py-3 tx-row"
            >
              <div className="flex items-center gap-3">
                <TxIcon type={tx.type} />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium text-gray-200">{txLabel(tx.type)}</p>
                    <StatusBadge status={(tx as Record<string, unknown>).status as string | undefined} />
                  </div>
                  <p className="text-[10px] text-gray-600 mt-0.5 truncate max-w-[160px]">
                    {tx.description ?? formatDateTime(tx.created_at)}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <span
                  className={`text-xs font-mono font-medium ${isOutgoingTx(tx.type) ? "text-red-400" : "text-[#00ff41]"}`}
                >
                  {isOutgoingTx(tx.type) ? "-" : "+"}
                  {Math.abs(tx.amount).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <p className="text-[10px] text-gray-700 mt-0.5">{formatDateTime(tx.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

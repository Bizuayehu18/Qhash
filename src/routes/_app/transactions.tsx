import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Receipt, Clock, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { TxIcon, txLabel, isOutgoingTx } from "@/components/ui/TransactionHelpers.js";
import { formatDateTime } from "@/lib/format.js";
import { useAuthStore } from "@/store/authStore.js";
import { getTransactionsFn } from "@/lib/server/transactions.js";
import { getSafeErrorMessage } from "@/lib/errors.js";

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
  const { user } = useAuthStore();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState("all");

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    getTransactionsFn({ data: { userId: user.id, type: activeFilter } })
      .then(setTransactions)
      .catch((err) => {
        console.error("Transactions load failed:", err);
        setError(getSafeErrorMessage(err, "SERVER").message);
      })
      .finally(() => setLoading(false));
  }, [user?.id, activeFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Transactions</h1>
        {!loading && transactions.length > 0 && (
          <span className="text-[10px] text-gray-600 font-mono">
            {transactions.length} records
          </span>
        )}
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
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

      {loading ? (
        <div className="space-y-3 stagger-children">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="skeleton h-[68px] rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <AlertCircle size={24} className="mx-auto mb-3 text-red-400/60" />
          <p className="text-xs text-red-400">{error}</p>
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


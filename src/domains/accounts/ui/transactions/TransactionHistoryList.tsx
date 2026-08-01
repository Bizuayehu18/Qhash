import { CheckCircle2, Clock, Receipt, XCircle } from "lucide-react";
import { AmountText } from "@/components/ui/AmountText.js";
import {
  TxIcon,
  isOutgoingTx,
  txSubtitle,
  txTitle,
} from "@/components/ui/TransactionHelpers.js";
import { formatDateTime } from "@/lib/format.js";
import type { TransactionHistoryRow } from "../../application/transaction-history-browser-service.js";

function StatusBadge({ status }: { status?: string }) {
  switch (status) {
    case "completed":
    case "approved":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/[0.15] bg-emerald-400/[0.08] px-1.5 py-0.5 text-[9px] text-emerald-400">
          <CheckCircle2 size={8} />
          Done
        </span>
      );
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/[0.15] bg-amber-400/[0.08] px-1.5 py-0.5 text-[9px] text-amber-400">
          <Clock size={8} />
          Pending
        </span>
      );
    case "failed":
    case "rejected":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-red-400/[0.15] bg-red-400/[0.08] px-1.5 py-0.5 text-[9px] text-red-400">
          <XCircle size={8} />
          Failed
        </span>
      );
    default:
      return null;
  }
}

type TransactionHistoryListProps = {
  loaded: boolean;
  rows: TransactionHistoryRow[];
};

export function TransactionHistoryList({
  loaded,
  rows,
}: TransactionHistoryListProps) {
  if (!loaded) {
    return (
      <div className="space-y-3 stagger-children">
        {[1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="skeleton h-[68px] rounded-xl" />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="py-16 text-center">
        <Receipt size={24} className="mx-auto mb-3 text-gray-700" />
        <p className="text-xs text-gray-600">No transactions found</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111] divide-y divide-[#1a1a1a]">
      {rows.map((transaction) => {
        const signedAmount = isOutgoingTx(transaction.type)
          ? -Math.abs(transaction.amount)
          : Math.abs(transaction.amount);
        const formattedCreatedAt = formatDateTime(transaction.created_at);
        const subtitle = txSubtitle(transaction, formattedCreatedAt);

        return (
          <div
            key={transaction.id}
            className="flex items-center justify-between px-4 py-3 tx-row"
          >
            <div className="flex min-w-0 items-center gap-3">
              <TxIcon type={transaction.type} />

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium text-gray-200">
                    {txTitle(transaction.type)}
                  </p>
                  <StatusBadge
                    status={(transaction as Record<string, unknown>).status as string | undefined}
                  />
                </div>

                <p className="mt-0.5 max-w-[160px] truncate text-[10px] text-gray-600">
                  {subtitle}
                </p>
              </div>
            </div>

            <div className="shrink-0 text-right">
              <AmountText value={signedAmount} showSign size="sm" />
              <p className="mt-0.5 text-[10px] text-gray-700">
                {formattedCreatedAt}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

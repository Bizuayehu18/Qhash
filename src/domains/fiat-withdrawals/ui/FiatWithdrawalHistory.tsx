import { useState, type ReactNode } from "react";
import { ArrowUpCircle, CheckCircle, Clock, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { formatDateTime } from "@/shared/formatting/date-time.js";
import { getFiatWithdrawalMethodLabel } from "./fiat-withdrawal-providers.js";
import type { UserFiatWithdrawal } from "./fiat-withdrawal-types.js";
import { EtbWithdrawalAmount } from "./FiatWithdrawalSummary.js";

const HISTORY_PREVIEW_LIMIT = 6;

export function FiatWithdrawalHistory({
  withdrawals,
  historyLoaded,
}: {
  withdrawals: UserFiatWithdrawal[];
  historyLoaded: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleWithdrawals = expanded
    ? withdrawals
    : withdrawals.slice(0, HISTORY_PREVIEW_LIMIT);
  const hasMore = withdrawals.length > HISTORY_PREVIEW_LIMIT;

  return (
    <section className="mt-1 space-y-2.5 lg:mt-0">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-100">Withdrawal History</h2>
        {withdrawals.length > 0 && (
          <Badge variant="default" className="shrink-0 text-[9px]">
            {withdrawals.length}
          </Badge>
        )}
      </div>

      {!historyLoaded && withdrawals.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((index) => (
            <div key={index} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : historyLoaded && withdrawals.length === 0 ? (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-6 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-[#1a1a1a] bg-[#0b0b0b]">
            <Clock size={17} className="text-gray-600" />
          </div>
          <p className="mt-3 text-sm font-semibold text-gray-300">No withdrawals yet</p>
          <p className="mt-1 text-xs text-gray-600">
            Submitted requests will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111] divide-y divide-[#1a1a1a]">
          {visibleWithdrawals.map((withdrawal) => (
            <FiatWithdrawalHistoryItem
              key={withdrawal.id}
              withdrawal={withdrawal}
            />
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="w-full px-3.5 py-3 text-center text-[11px] font-semibold text-[#00ff41] transition-colors hover:bg-[rgba(0,255,65,0.035)] card-press"
            >
              {expanded
                ? "Show less"
                : `See more (${withdrawals.length - visibleWithdrawals.length})`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function FiatWithdrawalHistoryItem({
  withdrawal,
}: {
  withdrawal: UserFiatWithdrawal;
}) {
  const methodLabel = getFiatWithdrawalMethodLabel(withdrawal.method);
  const accountLine = `${withdrawal.account_name}${
    withdrawal.account_last4 ? ` • ${withdrawal.account_last4}` : ""
  }`;
  const isRejected = withdrawal.status === "rejected";

  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <FiatWithdrawalStatusIcon status={withdrawal.status} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-bold text-gray-100">
            {methodLabel} Withdrawal
          </p>
          <FiatWithdrawalStatusBadge status={withdrawal.status} />
        </div>
        <p className="mt-0.5 truncate text-[10px] text-gray-600">
          {formatDateTime(withdrawal.created_at)} · {accountLine}
        </p>
      </div>
      <p
        className={
          isRejected
            ? "shrink-0 text-right text-[11px] font-semibold text-gray-500"
            : "shrink-0 text-right font-mono text-xs font-semibold text-red-400"
        }
      >
        {isRejected ? (
          "Rejected"
        ) : (
          <EtbWithdrawalAmount value={withdrawal.amount} prefix="-" />
        )}
      </p>
    </div>
  );
}

function FiatWithdrawalStatusIcon({ status }: { status: string }) {
  const className =
    status === "approved"
      ? "border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
      : status === "pending"
        ? "border-amber-400/15 bg-amber-400/10 text-amber-300"
        : status === "rejected"
          ? "border-red-400/15 bg-red-500/10 text-red-400"
          : "border-[#1a1a1a] bg-[#0b0b0b] text-gray-500";

  return (
    <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${className}`}>
      <ArrowUpCircle size={15} />
    </div>
  );
}

function FiatWithdrawalStatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    {
      label: string;
      variant: "success" | "warning" | "danger" | "default";
      icon: ReactNode;
    }
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
  const item = config[status] ?? {
    label: status,
    variant: "default" as const,
    icon: <Clock size={10} />,
  };

  return (
    <Badge variant={item.variant} className="shrink-0 text-[9px]">
      <span className="flex items-center gap-1">
        {item.icon}
        {item.label}
      </span>
    </Badge>
  );
}

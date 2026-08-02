import { History } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { formatDateTime } from "@/shared/formatting/date-time.js";
import {
  formatUsdtDecimal,
  nowpaymentsStatusLabel,
  type NowpaymentsDepositHistoryView,
  type NowpaymentsHistoryStatus,
} from "./nowpayments-deposit-ui.js";

function statusVariant(status: NowpaymentsHistoryStatus) {
  if (status === "finished") return "success" as const;
  if (["failed", "refunded", "expired"].includes(status)) return "danger" as const;
  if (["waiting", "partially_paid", "manual_review"].includes(status)) return "warning" as const;
  return "info" as const;
}

export function UsdtBep20DepositHistory({
  history,
}: {
  history: NowpaymentsDepositHistoryView[];
}) {
  return (
    <section className="space-y-2.5" aria-labelledby="usdt-deposit-history-title">
      <div className="flex items-center justify-between gap-3">
        <h3 id="usdt-deposit-history-title" className="flex items-center gap-2 text-sm font-bold text-gray-100">
          <History size={14} className="text-[#00ff41]" /> USDT Deposit History
        </h3>
        {history.length > 0 && <Badge variant="default" className="text-[9px]">{history.length}</Badge>}
      </div>
      {history.length === 0 ? (
        <div className="rounded-xl border border-[#1f1f1f] bg-[#111] p-6 text-center">
          <p className="text-xs font-semibold text-gray-400">No USDT deposits yet</p>
          <p className="mt-1 text-[11px] text-gray-600">Your address sessions will appear here.</p>
        </div>
      ) : (
        <div className="divide-y divide-[#1f1f1f] overflow-hidden rounded-xl border border-[#1f1f1f] bg-[#111]">
          {history.map((entry, index) => (
            <HistoryRow key={`${entry.created_at}-${entry.pay_address ?? "none"}-${index}`} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryRow({ entry }: { entry: NowpaymentsDepositHistoryView }) {
  return (
    <article className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-gray-100">USDT · BEP20</p>
          <p className="mt-0.5 text-[10px] text-gray-600">Created {formatDateTime(entry.created_at)}</p>
        </div>
        <Badge variant={statusVariant(entry.status)} className="text-[9px]">
          {nowpaymentsStatusLabel(entry.status)}
        </Badge>
      </div>
      {entry.pay_address && (
        <p className="truncate font-mono text-[10px] text-gray-500" title="Historical deposit address">
          {entry.pay_address}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-600">
        <span>
          {entry.valid_until
            ? `Original activation deadline ${formatDateTime(entry.valid_until)}`
            : "Activation deadline unavailable"}
        </span>
        <span className="text-right">
          {entry.credited_amount_usdt && (
            <span className="block text-[#00ff41]">
              {formatUsdtDecimal(entry.credited_amount_usdt)} USDT credited
            </span>
          )}
          {entry.completed_at ? (
            <span className="block">Completed {formatDateTime(entry.completed_at)}</span>
          ) : !entry.credited_amount_usdt ? (
            <span className="block">No credit recorded</span>
          ) : null}
        </span>
      </div>
    </article>
  );
}

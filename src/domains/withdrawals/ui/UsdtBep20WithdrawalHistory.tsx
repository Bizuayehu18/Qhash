import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { formatDateTime } from "@/lib/format.js";
import {
  formatUsdtDisplay,
  maskBep20Address,
  nowpaymentsWithdrawalStatusLabel,
  type NowpaymentsWithdrawalHistoryView,
} from "@/lib/nowpayments-withdrawal-ui.js";

export function UsdtBep20WithdrawalHistory({
  expanded,
  history,
  isExpandable,
  onExpandedChange,
  visibleHistory,
}: {
  expanded: boolean;
  history: NowpaymentsWithdrawalHistoryView[];
  isExpandable: boolean;
  onExpandedChange: (value: boolean) => void;
  visibleHistory: NowpaymentsWithdrawalHistoryView[];
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-gray-100">USDT Withdrawal History</h3>
        {history.length > 0 && (
          <Badge variant="default" className="text-[9px]">{history.length}</Badge>
        )}
      </div>
      {history.length === 0 ? (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-5 text-center">
          <Clock size={17} className="mx-auto text-gray-600" />
          <p className="mt-2 text-xs text-gray-500">No USDT withdrawals yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visibleHistory.map((row, index) => (
            <div key={`${row.requested_at}-${index}`} className="rounded-xl border border-[#1a1a1a] bg-[#111] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-gray-200">
                    {formatUsdtDisplay(row.gross_amount_usdt)} USDT
                  </p>
                  <p className="mt-0.5 text-[10px] text-gray-600">
                    To {maskBep20Address(row.destination)} · {formatDateTime(row.requested_at)}
                  </p>
                </div>
                <span className="text-right text-[10px] font-semibold text-[#00ff41]">
                  {nowpaymentsWithdrawalStatusLabel(row.status)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-[#1a1a1a] pt-2 text-[10px] text-gray-500">
                <span>Fee {formatUsdtDisplay(row.fee_amount_usdt)} USDT</span>
                <span>Net {formatUsdtDisplay(row.net_amount_usdt)} USDT</span>
              </div>
            </div>
          ))}
          {isExpandable && (
            <Button
              fullWidth
              size="sm"
              variant="ghost"
              onClick={() => onExpandedChange(!expanded)}
            >
              {expanded ? "Show less" : "Show all"}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

import { Clock } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { formatDateTime } from "@/shared/formatting/date-time.js";
import type { AdminFiatDeposit } from "../../application/admin-fiat-deposit-operations-browser-service.js";
import {
  ADMIN_FIAT_DEPOSIT_METHOD_LABELS,
  ADMIN_FIAT_DEPOSIT_STATUS,
  requiresManualFiatDepositReview,
} from "./admin-fiat-deposit-operations-presentation.js";
import { AdminFiatDepositAmount } from "./AdminFiatDepositAmount.js";

type AdminFiatDepositListProps = Readonly<{
  deposits: AdminFiatDeposit[];
  depositsLoaded: boolean;
  onSelect: (deposit: AdminFiatDeposit) => void;
}>;

export function AdminFiatDepositList({
  deposits,
  depositsLoaded,
  onSelect,
}: AdminFiatDepositListProps) {
  if (!depositsLoaded) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((index) => (
          <div key={index} className="skeleton h-14 rounded-xl" />
        ))}
      </div>
    );
  }

  if (deposits.length === 0) {
    return (
      <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-8 text-center text-xs text-gray-600">
        No deposits found.
      </div>
    );
  }

  return (
    <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
      {deposits.map((deposit) => {
        const status = ADMIN_FIAT_DEPOSIT_STATUS[deposit.status];
        return (
          <button
            key={deposit.id}
            onClick={() => onSelect(deposit)}
            className="w-full text-left flex items-center justify-between px-4 py-3 card-press"
          >
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-medium text-gray-200">
                  @{deposit.username}
                </p>
                {deposit.status === "pending" && (
                  <Clock size={10} className="text-yellow-400" />
                )}
                {deposit.status === "pending"
                  && requiresManualFiatDepositReview(deposit.admin_note) && (
                  <Badge
                    variant="warning"
                    className="text-[9px] px-1.5 py-0"
                  >
                    Verifier Review
                  </Badge>
                )}
              </div>
              <p className="text-[10px] text-gray-600">
                {ADMIN_FIAT_DEPOSIT_METHOD_LABELS[deposit.method_type]
                  ?? deposit.method_type}
                {" · "}
                {formatDateTime(deposit.created_at)}
              </p>
            </div>
            <div className="text-right flex items-center gap-2">
              <span className="text-xs text-[#00ff41] font-mono">
                {deposit.amount > 0
                  ? <AdminFiatDepositAmount value={deposit.amount} />
                  : "—"}
              </span>
              <Badge variant={status?.variant ?? "default"}>
                {status?.label ?? deposit.status}
              </Badge>
            </div>
          </button>
        );
      })}
    </div>
  );
}

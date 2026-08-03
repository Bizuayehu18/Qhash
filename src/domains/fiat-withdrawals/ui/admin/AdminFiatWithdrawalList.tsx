import { Clock } from "lucide-react";
import type { AdminFiatWithdrawal } from "../../application/admin-fiat-withdrawal-operations-browser-service.js";
import { ADMIN_FIAT_WITHDRAWAL_METHOD_LABELS } from "./admin-fiat-withdrawal-operations-presentation.js";
import { AdminFiatWithdrawalAmount } from "./AdminFiatWithdrawalAmount.js";
import { AdminFiatWithdrawalStatusBadge } from "./AdminFiatWithdrawalStatusBadge.js";

type AdminFiatWithdrawalListProps = Readonly<{
  onSelect: (withdrawal: AdminFiatWithdrawal) => void;
  withdrawals: AdminFiatWithdrawal[];
  withdrawalsLoaded: boolean;
}>;

export function AdminFiatWithdrawalList({
  onSelect,
  withdrawals,
  withdrawalsLoaded,
}: AdminFiatWithdrawalListProps) {
  if (!withdrawalsLoaded) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((index) => (
          <div key={index} className="skeleton h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (withdrawals.length === 0) {
    return (
      <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-8 text-center text-xs text-gray-600">
        No withdrawals found.
      </div>
    );
  }

  return (
    <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
      {withdrawals.map((withdrawal) => (
        <button
          key={withdrawal.id}
          onClick={() => onSelect(withdrawal)}
          className="w-full text-left px-4 py-3 card-press"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-medium text-gray-200 truncate">
                  @{withdrawal.username}
                </p>
                {withdrawal.status === "pending" && (
                  <Clock size={10} className="text-yellow-400" />
                )}
              </div>
              <p className="text-[10px] text-gray-600">
                {withdrawal.phone || "No phone"}
              </p>
              <p className="text-[10px] text-gray-500 mt-1">
                {ADMIN_FIAT_WITHDRAWAL_METHOD_LABELS[withdrawal.method]
                  ?? withdrawal.method}
                {" · "}
                {withdrawal.account_name}
                {" · "}
                {withdrawal.account_last4
                  ? `****${withdrawal.account_last4}`
                  : "No account"}
              </p>
            </div>
            <div className="text-right shrink-0 space-y-1">
              <p className="text-xs text-red-400 font-mono">
                <AdminFiatWithdrawalAmount value={withdrawal.amount} />
              </p>
              <AdminFiatWithdrawalStatusBadge status={withdrawal.status} />
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

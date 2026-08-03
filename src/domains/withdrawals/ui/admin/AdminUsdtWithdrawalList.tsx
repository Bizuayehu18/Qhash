import { Clock } from "lucide-react";
import type { NowpaymentsAdminWithdrawal } from "../../application/admin-usdt-withdrawal-browser-service.js";
import type { AdminUsdtWithdrawalDialogKind } from "./useAdminUsdtWithdrawalOperations.js";
import { AdminUsdtWithdrawalCard } from "./AdminUsdtWithdrawalCard.js";

type AdminUsdtWithdrawalListProps = Readonly<{
  busy: boolean;
  onOpenDialog: (
    kind: AdminUsdtWithdrawalDialogKind,
    withdrawal: NowpaymentsAdminWithdrawal,
  ) => void;
  withdrawals: NowpaymentsAdminWithdrawal[];
}>;

export function AdminUsdtWithdrawalList({
  busy,
  onOpenDialog,
  withdrawals,
}: AdminUsdtWithdrawalListProps) {
  if (withdrawals.length === 0) {
    return (
      <div className="rounded-xl border border-[#1f1f1f] bg-[#111] p-6 text-center">
        <Clock size={18} className="mx-auto text-gray-600" />
        <p className="mt-2 text-xs text-gray-500">
          No matching USDT withdrawals.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {withdrawals.map((withdrawal) => (
        <AdminUsdtWithdrawalCard
          key={withdrawal.id}
          busy={busy}
          onComplete={() => onOpenDialog("complete", withdrawal)}
          onReject={() => onOpenDialog("reject", withdrawal)}
          withdrawal={withdrawal}
        />
      ))}
    </div>
  );
}

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button.js";
import type { NowpaymentsAdminWithdrawalStatus } from "../../application/admin-usdt-withdrawal-browser-service.js";
import {
  ADMIN_USDT_WITHDRAWAL_FILTERS,
  ADMIN_USDT_WITHDRAWAL_STATUS_LABELS,
} from "./admin-usdt-withdrawal-presentation.js";
import { AdminUsdtWithdrawalActionDialog } from "./AdminUsdtWithdrawalActionDialog.js";
import { AdminUsdtWithdrawalList } from "./AdminUsdtWithdrawalList.js";
import { useAdminUsdtWithdrawalOperations } from "./useAdminUsdtWithdrawalOperations.js";

type AdminUsdtBep20WithdrawalOperationsPanelProps = Readonly<{
  accessToken: string | null | undefined;
  userId: string | null | undefined;
}>;

export function AdminUsdtBep20WithdrawalOperationsPanel({
  accessToken,
  userId,
}: AdminUsdtBep20WithdrawalOperationsPanelProps) {
  const controller = useAdminUsdtWithdrawalOperations(accessToken, userId);

  return (
    <section className="space-y-4 rounded-2xl border border-[#1f1f1f] bg-[#0b0b0b] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00ff41]/70">
            USDT BEP20
          </p>
          <h2 className="text-base font-bold text-gray-100">
            Withdrawal requests
          </h2>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={controller.loading || controller.actionBusy}
          onClick={() => void controller.refreshOverview()}
        >
          <RefreshCw size={13} />
          Refresh
        </Button>
      </div>

      {controller.loading && !controller.overview ? (
        <div className="skeleton h-28 rounded-xl" />
      ) : controller.loadError || !controller.overview ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-xs text-red-300">
          Administrator withdrawal data is unavailable.
        </div>
      ) : (
        <>
          {!controller.overview.withdrawals_enabled && (
            <div className="flex items-start gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5">
              <AlertTriangle
                size={14}
                className="mt-0.5 shrink-0 text-yellow-400"
              />
              <p className="text-xs text-yellow-300">
                New USDT withdrawal requests are disabled. Existing pending requests remain actionable.
              </p>
            </div>
          )}

          <AdminUsdtWithdrawalFilters
            activeFilter={controller.filter}
            onSelect={controller.setFilter}
          />
          <AdminUsdtWithdrawalList
            busy={controller.actionBusy}
            onOpenDialog={controller.openDialog}
            withdrawals={controller.visibleWithdrawals}
          />
        </>
      )}

      {controller.selected && controller.dialog && (
        <AdminUsdtWithdrawalActionDialog
          busy={controller.actionBusy}
          kind={controller.dialog}
          onCancel={controller.resetDialog}
          onSubmit={controller.submitDialog}
          onTransactionHashChange={controller.setTransactionHash}
          transactionHash={controller.transactionHash}
          withdrawal={controller.selected}
        />
      )}
    </section>
  );
}

function AdminUsdtWithdrawalFilters({
  activeFilter,
  onSelect,
}: Readonly<{
  activeFilter: "all" | NowpaymentsAdminWithdrawalStatus;
  onSelect: (filter: "all" | NowpaymentsAdminWithdrawalStatus) => void;
}>) {
  return (
    <div className="flex flex-wrap gap-2">
      {(["all", ...ADMIN_USDT_WITHDRAWAL_FILTERS] as const).map((filter) => (
        <button
          key={filter}
          type="button"
          onClick={() => onSelect(filter)}
          className={`rounded-lg border px-2.5 py-1 text-[10px] font-semibold ${
            activeFilter === filter
              ? "border-[#00ff41]/40 bg-[#00ff41]/10 text-[#00ff41]"
              : "border-[#242424] text-gray-500"
          }`}
        >
          {filter === "all"
            ? "All"
            : ADMIN_USDT_WITHDRAWAL_STATUS_LABELS[filter]}
        </button>
      ))}
    </div>
  );
}

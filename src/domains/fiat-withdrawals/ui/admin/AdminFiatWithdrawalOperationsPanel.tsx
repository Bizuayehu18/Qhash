import { toast } from "sonner";
import type { AdminFiatWithdrawalStatusFilter } from "../../application/admin-fiat-withdrawal-operations-auth-lifecycle.js";
import { ADMIN_FIAT_WITHDRAWAL_FILTERS } from "./admin-fiat-withdrawal-operations-presentation.js";
import { AdminFiatWithdrawalDetail } from "./AdminFiatWithdrawalDetail.js";
import { AdminFiatWithdrawalList } from "./AdminFiatWithdrawalList.js";
import { useAdminFiatWithdrawalOperations } from "./useAdminFiatWithdrawalOperations.js";

type AdminFiatWithdrawalOperationsPanelProps = Readonly<{
  accessToken: string | null | undefined;
  userId: string | null | undefined;
}>;

export function AdminFiatWithdrawalOperationsPanel({
  accessToken,
  userId,
}: AdminFiatWithdrawalOperationsPanelProps) {
  const controller = useAdminFiatWithdrawalOperations(userId, accessToken);

  const copyToClipboard = (value: string) => {
    navigator.clipboard.writeText(value).then(() => toast.success("Copied!"));
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {ADMIN_FIAT_WITHDRAWAL_FILTERS.map((filter) => (
          <AdminFiatWithdrawalFilter
            key={filter.key}
            active={controller.statusFilter === filter.key}
            count={filter.key === "pending" ? controller.pendingCount : 0}
            filter={filter.key}
            label={filter.label}
            onSelect={controller.setStatusFilter}
          />
        ))}
      </div>

      {controller.selectedWithdrawal && (
        <AdminFiatWithdrawalDetail
          actionLoading={controller.actionLoading}
          adminNote={controller.adminNote}
          onClose={controller.clearEditor}
          onCopy={copyToClipboard}
          onReview={controller.submitReview}
          setAdminNote={controller.setAdminNote}
          withdrawal={controller.selectedWithdrawal}
        />
      )}

      <AdminFiatWithdrawalList
        onSelect={controller.selectWithdrawal}
        withdrawals={controller.withdrawals}
        withdrawalsLoaded={controller.withdrawalsLoaded}
      />
    </div>
  );
}

function AdminFiatWithdrawalFilter({
  active,
  count,
  filter,
  label,
  onSelect,
}: Readonly<{
  active: boolean;
  count: number;
  filter: AdminFiatWithdrawalStatusFilter;
  label: string;
  onSelect: (filter: AdminFiatWithdrawalStatusFilter) => void;
}>) {
  return (
    <button
      onClick={() => onSelect(filter)}
      className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] border transition-colors card-press ${
        active
          ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]"
          : "text-gray-500 border-[#1f1f1f]"
      }`}
    >
      {label}
      {filter === "pending" && count > 0 && (
        <span className="ml-1 text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </button>
  );
}

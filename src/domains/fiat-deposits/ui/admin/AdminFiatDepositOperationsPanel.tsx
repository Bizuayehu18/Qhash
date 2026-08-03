import { toast } from "sonner";
import type { AdminFiatDepositStatusFilter } from "../../application/admin-fiat-deposit-operations-auth-lifecycle.js";
import { ADMIN_FIAT_DEPOSIT_FILTERS } from "./admin-fiat-deposit-operations-presentation.js";
import { AdminFiatDepositDetail } from "./AdminFiatDepositDetail.js";
import { AdminFiatDepositList } from "./AdminFiatDepositList.js";
import { useAdminFiatDepositOperations } from "./useAdminFiatDepositOperations.js";

type AdminFiatDepositOperationsPanelProps = Readonly<{
  accessToken: string | null | undefined;
  userId: string | null | undefined;
}>;

export function AdminFiatDepositOperationsPanel({
  accessToken,
  userId,
}: AdminFiatDepositOperationsPanelProps) {
  const controller = useAdminFiatDepositOperations(userId, accessToken);

  const copyToClipboard = (value: string) => {
    navigator.clipboard.writeText(value).then(() => toast.success("Copied!"));
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {ADMIN_FIAT_DEPOSIT_FILTERS.map((filter) => (
          <AdminFiatDepositFilter
            key={filter.key}
            active={controller.statusFilter === filter.key}
            count={filter.key === "pending" ? controller.pendingCount : 0}
            filter={filter.key}
            label={filter.label}
            onSelect={controller.setStatusFilter}
          />
        ))}
      </div>

      {controller.selectedDeposit && (
        <AdminFiatDepositDetail
          actionLoading={controller.actionLoading}
          adminNote={controller.adminNote}
          approvalAmount={controller.approvalAmount}
          deposit={controller.selectedDeposit}
          onClose={controller.clearEditor}
          onCopy={copyToClipboard}
          onReview={controller.submitReview}
          setAdminNote={controller.setAdminNote}
          setApprovalAmount={controller.setApprovalAmount}
        />
      )}

      <AdminFiatDepositList
        deposits={controller.deposits}
        depositsLoaded={controller.depositsLoaded}
        onSelect={controller.selectDeposit}
      />
    </div>
  );
}

function AdminFiatDepositFilter({
  active,
  count,
  filter,
  label,
  onSelect,
}: Readonly<{
  active: boolean;
  count: number;
  filter: AdminFiatDepositStatusFilter;
  label: string;
  onSelect: (filter: AdminFiatDepositStatusFilter) => void;
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

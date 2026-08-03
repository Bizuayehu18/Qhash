import type { ReactNode } from "react";
import { CheckCircle, Copy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { formatDateTime } from "@/shared/formatting/date-time.js";
import type {
  AdminFiatWithdrawal,
  AdminFiatWithdrawalReviewAction,
} from "../../application/admin-fiat-withdrawal-operations-browser-service.js";
import { ADMIN_FIAT_WITHDRAWAL_METHOD_LABELS } from "./admin-fiat-withdrawal-operations-presentation.js";
import { AdminFiatWithdrawalAmount } from "./AdminFiatWithdrawalAmount.js";
import { AdminFiatWithdrawalStatusBadge } from "./AdminFiatWithdrawalStatusBadge.js";

type AdminFiatWithdrawalDetailProps = Readonly<{
  actionLoading: boolean;
  adminNote: string;
  onClose: () => void;
  onCopy: (value: string) => void;
  onReview: (action: AdminFiatWithdrawalReviewAction) => Promise<boolean>;
  setAdminNote: (value: string) => void;
  withdrawal: AdminFiatWithdrawal;
}>;

export function AdminFiatWithdrawalDetail({
  actionLoading,
  adminNote,
  onClose,
  onCopy,
  onReview,
  setAdminNote,
  withdrawal,
}: AdminFiatWithdrawalDetailProps) {
  return (
    <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Withdrawal Details</span>
        <button onClick={onClose} className="text-[10px] text-gray-500">
          Close
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <AdminFiatWithdrawalDetailRow
          label="User"
          value={`@${withdrawal.username}`}
        />
        <AdminFiatWithdrawalDetailRow
          label="Phone"
          value={withdrawal.phone || "—"}
        />
        <AdminFiatWithdrawalDetailRow
          label="Amount"
          value={<AdminFiatWithdrawalAmount value={withdrawal.amount} />}
          highlight
        />
        <AdminFiatWithdrawalDetailRow
          label="Net payout"
          value={<AdminFiatWithdrawalAmount value={withdrawal.net_amount ?? 0} />}
          highlight
        />
        <AdminFiatWithdrawalDetailRow
          label="Fee"
          value={<AdminFiatWithdrawalAmount value={withdrawal.fee_amount ?? 0} />}
        />
        <AdminFiatWithdrawalDetailRow
          label="Method"
          value={ADMIN_FIAT_WITHDRAWAL_METHOD_LABELS[withdrawal.method]
            ?? withdrawal.method}
        />
        <AdminFiatWithdrawalDetailRow
          label="Account Name"
          value={withdrawal.account_name}
        />
        <div>
          <span className="text-gray-500 text-[10px] block mb-1">
            Status
          </span>
          <AdminFiatWithdrawalStatusBadge status={withdrawal.status} />
        </div>
        <div className="col-span-2">
          <span className="text-gray-500 text-[10px] block mb-1">
            Account Number
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-200 font-mono break-all">
              {withdrawal.account_number || "—"}
            </span>
            {withdrawal.account_number && (
              <button
                onClick={() => onCopy(withdrawal.account_number)}
                className="p-1 rounded text-gray-600 hover:text-gray-300 transition-colors shrink-0"
              >
                <Copy size={11} />
              </button>
            )}
          </div>
        </div>
        <AdminFiatWithdrawalDetailRow
          label="Requested"
          value={formatDateTime(withdrawal.created_at)}
        />
        <AdminFiatWithdrawalDetailRow
          label="Reviewed"
          value={withdrawal.reviewed_at
            ? formatDateTime(withdrawal.reviewed_at)
            : "—"}
        />
      </div>

      {withdrawal.admin_note && withdrawal.status !== "pending" && (
        <div className="text-[11px] text-gray-500">
          <span className="text-gray-600">Note:</span> {withdrawal.admin_note}
        </div>
      )}

      {withdrawal.status === "pending" && (
        <div className="pt-3 border-t border-[#1f1f1f] space-y-3">
          <Input
            label="Review Note (optional)"
            placeholder="e.g. Paid to customer account"
            value={adminNote}
            onChange={(event) => setAdminNote(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={actionLoading}
              onClick={() => void onReview("approve")}
              className="flex-1"
            >
              <CheckCircle size={13} /> Approve
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={actionLoading}
              onClick={() => void onReview("reject")}
              className="flex-1"
            >
              <XCircle size={13} /> Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminFiatWithdrawalDetailRow({
  highlight,
  label,
  value,
}: Readonly<{
  highlight?: boolean;
  label: string;
  value: ReactNode;
}>) {
  return (
    <div>
      <span className="text-gray-500 text-[10px] block">{label}</span>
      <span className={`text-xs ${
        highlight ? "text-[#00ff41] font-mono" : "text-gray-200"
      }`}>
        {value}
      </span>
    </div>
  );
}

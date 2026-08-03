import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Copy,
  ExternalLink,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import type {
  AdminFiatDeposit,
  AdminFiatDepositReviewAction,
} from "../../application/admin-fiat-deposit-operations-browser-service.js";
import {
  ADMIN_FIAT_DEPOSIT_METHOD_LABELS,
  ADMIN_FIAT_DEPOSIT_STATUS,
  requiresManualFiatDepositReview,
} from "./admin-fiat-deposit-operations-presentation.js";
import { AdminFiatDepositAmount } from "./AdminFiatDepositAmount.js";

type AdminFiatDepositDetailProps = Readonly<{
  actionLoading: boolean;
  adminNote: string;
  approvalAmount: string;
  deposit: AdminFiatDeposit;
  onClose: () => void;
  onCopy: (value: string) => void;
  onReview: (action: AdminFiatDepositReviewAction) => Promise<boolean>;
  setAdminNote: (value: string) => void;
  setApprovalAmount: (value: string) => void;
}>;

export function AdminFiatDepositDetail({
  actionLoading,
  adminNote,
  approvalAmount,
  deposit,
  onClose,
  onCopy,
  onReview,
  setAdminNote,
  setApprovalAmount,
}: AdminFiatDepositDetailProps) {
  const manualReview = requiresManualFiatDepositReview(deposit.admin_note);

  return (
    <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Deposit Details</span>
        <button onClick={onClose} className="text-[10px] text-gray-500">
          Close
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <AdminFiatDepositDetailRow label="User" value={`@${deposit.username}`} />
        <AdminFiatDepositDetailRow label="Phone" value={deposit.phone} />
        <AdminFiatDepositDetailRow
          label="Amount"
          value={deposit.amount > 0
            ? <AdminFiatDepositAmount value={deposit.amount} />
            : "Not specified"}
          highlight={deposit.amount > 0}
        />
        <AdminFiatDepositDetailRow
          label="Method"
          value={ADMIN_FIAT_DEPOSIT_METHOD_LABELS[deposit.method_type]
            ?? deposit.method_type}
        />
        <AdminFiatDepositDetailRow label="Account" value={deposit.method_number} />
        <AdminFiatDepositDetailRow
          label="Status"
          value={ADMIN_FIAT_DEPOSIT_STATUS[deposit.status]?.label
            ?? deposit.status}
        />
        <div className="col-span-2">
          <span className="text-gray-500 text-[10px] block mb-1">
            Transaction ID
          </span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#00ff41] font-mono">
              {deposit.transaction_reference}
            </span>
            <button
              onClick={() => onCopy(deposit.transaction_reference)}
              className="p-1 rounded text-gray-600 hover:text-gray-300 transition-colors"
            >
              <Copy size={11} />
            </button>
          </div>
        </div>
      </div>

      {manualReview && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="text-[11px] text-amber-300 leading-relaxed">
            <span className="font-semibold text-amber-400 block mb-0.5">
              Manual Review Required
            </span>
            {deposit.admin_note}
          </div>
        </div>
      )}

      {deposit.admin_note && !manualReview && (
        <div className="text-[11px] text-gray-500">
          <span className="text-gray-600">Note:</span> {deposit.admin_note}
        </div>
      )}

      {deposit.receipt_url && (
        <a
          href={deposit.receipt_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-[rgba(0,255,65,0.2)] bg-[rgba(0,255,65,0.04)] text-[#00ff41] text-xs font-medium transition-colors hover:bg-[rgba(0,255,65,0.08)] card-press"
        >
          <ExternalLink size={13} />
          Open Receipt
        </a>
      )}

      {deposit.status === "pending" && (
        <div className="pt-3 border-t border-[#1f1f1f] space-y-3">
          <Input
            label="Verified Amount (ETB)"
            type="number"
            placeholder="Enter amount from receipt"
            value={approvalAmount}
            onChange={(event) => setApprovalAmount(event.target.value)}
            min="100"
            step="0.01"
            hint={deposit.amount > 0
              ? <>User entered: <AdminFiatDepositAmount value={deposit.amount} /></>
              : "User did not specify amount — check receipt"}
          />
          <Input
            label="Verification Note (optional)"
            placeholder="e.g. Verified receiver name and amount"
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

function AdminFiatDepositDetailRow({
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

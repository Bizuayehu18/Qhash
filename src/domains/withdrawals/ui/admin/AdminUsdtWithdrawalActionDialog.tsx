import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import type { NowpaymentsAdminWithdrawal } from "../../application/admin-usdt-withdrawal-browser-service.js";
import { formatAdminUsdtSix } from "./admin-usdt-withdrawal-presentation.js";
import type { AdminUsdtWithdrawalDialogKind } from "./useAdminUsdtWithdrawalOperations.js";

type AdminUsdtWithdrawalActionDialogProps = Readonly<{
  busy: boolean;
  kind: AdminUsdtWithdrawalDialogKind;
  onCancel: () => void;
  onSubmit: () => void;
  onTransactionHashChange: (value: string) => void;
  transactionHash: string;
  withdrawal: NowpaymentsAdminWithdrawal;
}>;

export function AdminUsdtWithdrawalActionDialog({
  busy,
  kind,
  onCancel,
  onSubmit,
  onTransactionHashChange,
  transactionHash,
  withdrawal,
}: AdminUsdtWithdrawalActionDialogProps) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={
          kind === "complete"
            ? "Complete USDT withdrawal"
            : "Reject USDT withdrawal"
        }
        className="w-full max-w-md rounded-2xl border border-[#292929] bg-[#111] p-4 shadow-2xl"
      >
        <h3 className="text-base font-bold text-gray-100">
          {kind === "complete" ? "Confirm completion" : "Confirm rejection"}
        </h3>

        {kind === "complete" ? (
          <div className="mt-3 space-y-3">
            <p className="text-xs leading-relaxed text-gray-400">
              Confirm only after exactly {formatAdminUsdtSix(withdrawal.net_amount_usdt)} USDT
              was sent to the stored BEP20 destination.
            </p>
            <Input
              label="Public BSC transaction hash (optional)"
              type="text"
              value={transactionHash}
              onChange={(event) => onTransactionHashChange(event.target.value)}
              placeholder="0x…"
              disabled={busy}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <p className="text-[10px] text-gray-500">
              Completion consumes the full {formatAdminUsdtSix(withdrawal.gross_amount_usdt)} USDT
              reservation and records the fee and net amount atomically.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-gray-400">
            Rejecting returns the full {formatAdminUsdtSix(withdrawal.gross_amount_usdt)} USDT
            reservation to the user.
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={kind === "reject" ? "danger" : "primary"}
            loading={busy}
            disabled={busy}
            onClick={onSubmit}
          >
            {kind === "complete" ? "Confirm Complete" : "Confirm Reject"}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { CheckCircle, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { formatDateTime } from "@/shared/formatting/date-time.js";
import type { NowpaymentsAdminWithdrawal } from "../../application/admin-usdt-withdrawal-browser-service.js";
import {
  ADMIN_USDT_WITHDRAWAL_STATUS_LABELS,
  ADMIN_USDT_WITHDRAWAL_STATUS_VARIANTS,
  formatAdminUsdtSix,
} from "./admin-usdt-withdrawal-presentation.js";

type AdminUsdtWithdrawalCardProps = Readonly<{
  busy: boolean;
  onComplete: () => void;
  onReject: () => void;
  withdrawal: NowpaymentsAdminWithdrawal;
}>;

export function AdminUsdtWithdrawalCard({
  busy,
  onComplete,
  onReject,
  withdrawal,
}: AdminUsdtWithdrawalCardProps) {
  return (
    <article className="rounded-xl border border-[#1f1f1f] bg-[#111] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-gray-100">
            {formatAdminUsdtSix(withdrawal.gross_amount_usdt)} USDT
          </p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            @{withdrawal.username} · {formatDateTime(withdrawal.requested_at)}
          </p>
        </div>
        <Badge variant={ADMIN_USDT_WITHDRAWAL_STATUS_VARIANTS[withdrawal.status]}>
          {ADMIN_USDT_WITHDRAWAL_STATUS_LABELS[withdrawal.status]}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-3">
        <AdminUsdtWithdrawalSummary
          label="Fee"
          value={`${formatAdminUsdtSix(withdrawal.fee_amount_usdt)} USDT`}
        />
        <AdminUsdtWithdrawalSummary
          label="Net to send"
          value={`${formatAdminUsdtSix(withdrawal.net_amount_usdt)} USDT`}
        />
        <AdminUsdtWithdrawalSummary
          label="Destination"
          value={withdrawal.destination_address}
          mono
        />
      </div>

      {withdrawal.transaction_hash && (
        <p className="mt-2 truncate font-mono text-[10px] text-gray-500">
          Audit hash: {withdrawal.transaction_hash}
        </p>
      )}

      {withdrawal.status === "pending" && (
        <div className="mt-3 flex gap-2 border-t border-[#1f1f1f] pt-3">
          <Button size="sm" disabled={busy} onClick={onComplete}>
            <CheckCircle size={13} />
            Complete
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={onReject}>
            <XCircle size={13} />
            Reject
          </Button>
        </div>
      )}
    </article>
  );
}

function AdminUsdtWithdrawalSummary({
  label,
  mono = false,
  value,
}: Readonly<{
  label: string;
  mono?: boolean;
  value: string;
}>) {
  return (
    <div className="min-w-0 rounded-lg border border-[#1c1c1c] bg-[#0b0b0b] p-2.5">
      <p className="text-[9px] uppercase tracking-wide text-gray-600">{label}</p>
      <p
        className={`mt-1 truncate text-gray-300 ${
          mono ? "font-mono text-[10px]" : "font-semibold"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

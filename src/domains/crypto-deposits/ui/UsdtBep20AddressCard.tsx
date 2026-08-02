import { Check, Copy, QrCode } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { formatDateTime } from "@/shared/formatting/date-time.js";
import {
  formatDepositCountdown,
  formatUsdtDecimal,
  nowpaymentsStatusLabel,
  type NowpaymentsDepositOverview,
} from "./nowpayments-deposit-ui.js";
import { copyButtonAccessibleName } from "./usdt-bep20-deposit-state.js";

export function UsdtBep20AddressCard({
  session,
  nowMs,
  addressSendable,
  qrDataUrl,
  copied,
  onCopy,
}: {
  session: NonNullable<NowpaymentsDepositOverview["active_session"]>;
  nowMs: number;
  addressSendable: boolean;
  qrDataUrl: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  const permanentlyActivated = session.address_lifecycle === "permanently_activated";
  return (
    <div className="overflow-hidden rounded-xl border border-[rgba(0,255,65,0.16)] bg-[#111]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f1f1f] px-3.5 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            {permanentlyActivated ? "Permanent deposit address" : "Pending address activation"}
          </p>
          <p className="mt-0.5 text-sm font-bold text-gray-100">USDT · BNB Smart Chain (BEP20)</p>
        </div>
        <Badge variant={permanentlyActivated ? "success" : "warning"} className="text-[9px]">
          {permanentlyActivated ? "Permanently activated" : nowpaymentsStatusLabel(session.status)}
        </Badge>
      </div>

      <div className="space-y-3 p-3.5">
        <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center">
          <div className="mx-auto grid h-[220px] w-[220px] place-items-center overflow-hidden rounded-xl border border-[#262626] bg-white p-2">
            {addressSendable && qrDataUrl ? (
              <img src={qrDataUrl} alt="QR code for the USDT BEP20 deposit address" className="h-full w-full" />
            ) : addressSendable ? (
              <QrCode size={38} className="text-gray-400" aria-label="QR code loading" />
            ) : (
              <div className="text-center text-gray-500" aria-label="QR code disabled for expired address">
                <QrCode size={38} className="mx-auto opacity-40" />
                <p className="mt-2 text-[10px] font-semibold uppercase">QR disabled</p>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Deposit address</p>
              <div className="mt-1.5 flex items-start gap-2 rounded-xl border border-[#252525] bg-[#090909] p-3">
                <code className="min-w-0 flex-1 break-all text-xs leading-relaxed text-[#00ff41]">
                  {session.pay_address}
                </code>
                <button
                  type="button"
                  onClick={onCopy}
                  disabled={!addressSendable}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#252525] text-gray-400 hover:text-[#00ff41] disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={copyButtonAccessibleName({ addressSendable, copied })}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-xs">
              <SessionDetail label="Minimum" value={`${formatUsdtDecimal(session.minimum_deposit_usdt)} USDT`} />
              <SessionDetail label="Created" value={formatDateTime(session.created_at)} />
              {session.valid_until && (
                <>
                  <SessionDetail label="Activation time remaining" value={formatDepositCountdown(session.valid_until, nowMs)} />
                  <SessionDetail label="Activation deadline" value={formatDateTime(session.valid_until)} />
                </>
              )}
            </dl>
          </div>
        </div>

        <div className="rounded-xl border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.035)] p-3" role="status">
          <p className="text-xs font-bold text-gray-200">
            {permanentlyActivated
              ? "This is your permanent USDT BEP20 deposit address."
              : "Complete your first verified deposit before the activation deadline."}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            {permanentlyActivated
              ? "Future deposits to this same address are credited separately after independent verification."
              : "A verified finished first deposit activates this same address permanently. The deadline is never extended."}
          </p>
        </div>
      </div>
    </div>
  );
}

function SessionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#202020] bg-[#0a0a0a] p-2.5">
      <dt className="text-[9px] uppercase tracking-wider text-gray-600">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-gray-300">{value}</dd>
    </div>
  );
}

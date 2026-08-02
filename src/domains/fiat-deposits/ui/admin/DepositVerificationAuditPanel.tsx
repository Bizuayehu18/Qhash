import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { CurrencyUnit } from "@/components/ui/AmountText.js";
import { formatDateTime } from "@/shared/formatting/date-time.js";
import {
  DEPOSIT_VERIFICATION_AUDIT_LIMIT,
  type DepositVerificationAuditPaymentType,
} from "../../application/deposit-verification-audit-browser-service.js";
import {
  DEPOSIT_VERIFICATION_AUDIT_ACTION_VARIANTS,
  DEPOSIT_VERIFICATION_AUDIT_METHOD_LABELS,
  DEPOSIT_VERIFICATION_AUDIT_PAYMENT_TYPES,
  formatDepositVerificationAuditEntityId,
  formatDepositVerificationAuditEtb,
  formatDepositVerificationAuditPaymentType,
} from "./deposit-verification-audit-presentation.js";
import { useDepositVerificationAudit } from "./useDepositVerificationAudit.js";

type DepositVerificationAuditPanelProps = Readonly<{
  accessToken: string | null | undefined;
  userId: string | null | undefined;
}>;

export function DepositVerificationAuditPanel({
  accessToken,
  userId,
}: DepositVerificationAuditPanelProps) {
  const [paymentType, setPaymentType] =
    useState<DepositVerificationAuditPaymentType>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { logs, logsLoaded } = useDepositVerificationAudit(
    userId,
    accessToken,
    paymentType,
  );

  useEffect(() => {
    setExpandedId(null);
  }, [accessToken, paymentType, userId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ScrollText size={13} className="text-gray-500" />
        <p className="text-[11px] text-gray-500">
          Read-only verification audit trail — latest {DEPOSIT_VERIFICATION_AUDIT_LIMIT}
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {DEPOSIT_VERIFICATION_AUDIT_PAYMENT_TYPES.map((filter) => (
          <button
            key={filter}
            onClick={() => setPaymentType(filter)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] border transition-colors card-press ${
              paymentType === filter
                ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]"
                : "text-gray-500 border-[#1f1f1f]"
            }`}
          >
            {filter === "all"
              ? "All"
              : DEPOSIT_VERIFICATION_AUDIT_METHOD_LABELS[filter]}
          </button>
        ))}
      </div>

      {!logsLoaded ? (
        <div className="space-y-2">
          {[1, 2, 3].map((index) => (
            <div key={index} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-8 text-center text-xs text-gray-600">
          No audit logs found.
        </div>
      ) : (
        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
          {logs.map((logRow) => {
            const isOpen = expandedId === logRow.id;
            return (
              <div key={logRow.id}>
                <button
                  onClick={() => setExpandedId(isOpen ? null : logRow.id)}
                  className="w-full text-left flex items-start justify-between gap-3 px-4 py-3 card-press"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-medium text-gray-200">
                        {formatDepositVerificationAuditPaymentType(
                          logRow.payment_type,
                        )}
                      </span>
                      {logRow.action && (
                        <Badge
                          variant={DEPOSIT_VERIFICATION_AUDIT_ACTION_VARIANTS[
                            logRow.action
                          ] ?? "default"}
                          className="text-[9px] px-1.5 py-0"
                        >
                          {logRow.action}
                        </Badge>
                      )}
                      <span className="text-[10px] text-gray-600 font-mono">
                        {logRow.event ?? "—"}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-600 mt-0.5">
                      {formatDateTime(logRow.created_at)}
                      {logRow.reason_code ? (
                        <> &middot; <span className="font-mono">{logRow.reason_code}</span></>
                      ) : null}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs text-[#00ff41] font-mono">
                      {typeof logRow.amount === "number" && logRow.amount > 0 ? (
                        <>
                          {formatDepositVerificationAuditEtb(logRow.amount)}
                          <CurrencyUnit />
                        </>
                      ) : "—"}
                    </span>
                    {logRow.tx_ref_last4 && (
                      <p className="text-[10px] text-gray-600 font-mono mt-0.5">
                        ****{logRow.tx_ref_last4}
                      </p>
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="px-4 pb-3 -mt-1">
                    <div className="grid grid-cols-2 gap-2.5 text-xs bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] p-3">
                      <AuditDetail label="Source" value={logRow.source ?? "—"} />
                      <AuditDetail label="Actor" value={logRow.actor_type ?? "—"} />
                      <AuditDetail
                        label="Receiver Matched"
                        value={logRow.receiver_matched === null
                          ? "—"
                          : logRow.receiver_matched ? "Yes" : "No"}
                      />
                      <AuditDetail
                        label="Freshness"
                        value={logRow.freshness_decision ?? "—"}
                      />
                      <AuditDetail
                        label="Age (min)"
                        value={typeof logRow.age_minutes === "number"
                          ? String(logRow.age_minutes)
                          : "—"}
                      />
                      <AuditDetail
                        label="Reason Code"
                        value={logRow.reason_code ?? "—"}
                      />
                      <AuditDetail
                        label="Deposit"
                        value={formatDepositVerificationAuditEntityId(
                          logRow.deposit_id,
                        )}
                        mono
                      />
                      <AuditDetail
                        label="User"
                        value={formatDepositVerificationAuditEntityId(
                          logRow.user_id,
                        )}
                        mono
                      />
                    </div>

                    {logRow.reason_message_safe && (
                      <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                        {logRow.reason_message_safe}
                      </p>
                    )}

                    {logRow.metadata && Object.keys(logRow.metadata).length > 0 && (
                      <details className="mt-2">
                        <summary className="text-[10px] text-gray-500 cursor-pointer select-none">
                          Metadata
                        </summary>
                        <pre className="text-[10px] text-gray-500 font-mono mt-1 p-2 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] overflow-x-auto whitespace-pre-wrap break-all">
                          {JSON.stringify(logRow.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AuditDetail({
  label,
  mono,
  value,
}: Readonly<{
  label: string;
  mono?: boolean;
  value: string;
}>) {
  return (
    <div>
      <span className="text-gray-500 text-[10px] block">{label}</span>
      <span className={`text-xs text-gray-200 ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

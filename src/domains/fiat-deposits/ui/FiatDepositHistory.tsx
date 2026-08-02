import { useState, type ReactNode } from "react";
import { ArrowDownCircle, CheckCircle, Clock, XCircle } from "lucide-react";
import { CurrencyUnit } from "@/components/ui/AmountText.js";
import { Badge } from "@/components/ui/Badge.js";
import { EmptyState } from "@/components/ui/EmptyState.js";
import { ListPanel } from "@/components/ui/ListPanel.js";
import { ListRow } from "@/components/ui/ListRow.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";
import { formatDateTime } from "@/shared/formatting/date-time.js";
import { getFiatDepositMethodMeta } from "./fiat-deposit-providers.js";
import type { UserFiatDeposit } from "./fiat-deposit-types.js";

const HISTORY_PREVIEW_LIMIT = 6;

function shortReference(value: string | null | undefined): string {
  const reference = value?.trim();
  if (!reference) return "Ref unavailable";
  if (reference.length <= 10) return `Ref ${reference}`;
  return `Ref …${reference.slice(-6)}`;
}

function formatAmount(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function DepositAmountText({ value, prefix = "" }: { value: number; prefix?: string }) {
  return (
    <>
      {prefix}{formatAmount(value)}
      <CurrencyUnit />
    </>
  );
}

export function FiatDepositHistory({
  deposits,
  historyLoaded,
}: {
  deposits: UserFiatDeposit[];
  historyLoaded: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleDeposits = expanded ? deposits : deposits.slice(0, HISTORY_PREVIEW_LIMIT);
  const hasMoreDeposits = deposits.length > HISTORY_PREVIEW_LIMIT;

  return (
    <section className="mt-1 space-y-2.5 lg:mt-0">
      <SectionHeader
        title="Deposit History"
        action={
          deposits.length > 0 ? (
            <Badge variant="default" className="shrink-0 text-[9px]">
              {deposits.length}
            </Badge>
          ) : null
        }
      />

      {!historyLoaded && deposits.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((index) => (
            <div key={index} className="skeleton h-14 rounded-xl" />
          ))}
        </div>
      ) : historyLoaded && deposits.length === 0 ? (
        <ListPanel divided={false}>
          <EmptyState
            icon={<Clock size={22} />}
            title="No deposits yet"
            description="Submitted deposits will appear here."
            className="py-10"
          />
        </ListPanel>
      ) : (
        <ListPanel>
          {visibleDeposits.map((deposit) => (
            <DepositHistoryItem key={deposit.id} deposit={deposit} />
          ))}
          {hasMoreDeposits && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="w-full px-3.5 py-3 text-center text-[11px] font-semibold text-[#00ff41] transition-colors hover:bg-[rgba(0,255,65,0.035)] card-press"
            >
              {expanded ? "Show less" : `See more (${deposits.length - visibleDeposits.length})`}
            </button>
          )}
        </ListPanel>
      )}
    </section>
  );
}

function DepositHistoryItem({ deposit }: { deposit: UserFiatDeposit }) {
  const meta = getFiatDepositMethodMeta(deposit.method_type);
  const hasAmount = deposit.amount > 0;
  const isApproved = deposit.status === "approved";
  const isRejected = deposit.status === "rejected";
  const isPending = deposit.status === "pending";
  const amountText: ReactNode = isRejected
    ? "Rejected"
    : isApproved && hasAmount
      ? <DepositAmountText value={deposit.amount} prefix="+" />
      : isPending
        ? "Pending"
        : hasAmount
          ? <DepositAmountText value={deposit.amount} />
          : "Reviewing";
  const amountClass = isApproved && hasAmount
    ? "text-[#00ff41]"
    : isRejected
      ? "text-red-400"
      : isPending
        ? "text-amber-300"
        : "text-gray-300";
  const iconClass = isApproved
    ? "text-[#00ff41]"
    : isRejected
      ? "text-red-400"
      : "text-amber-300";

  return (
    <ListRow
      className="!gap-2.5 !px-3 !py-2.5"
      icon={<ArrowDownCircle size={14} className={iconClass} />}
      title={
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-[13px] font-bold text-gray-100">
            {meta.label} Deposit
          </p>
          <DepositStatusBadge status={deposit.status} />
        </div>
      }
      description={`${shortReference(deposit.transaction_reference)} · ${formatDateTime(deposit.created_at)}`}
      right={<p className={`font-mono text-xs font-semibold ${amountClass}`}>{amountText}</p>}
    />
  );
}

function DepositStatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { label: string; variant: "success" | "warning" | "danger" | "default"; icon: ReactNode }
  > = {
    approved: { label: "Done", variant: "success", icon: <CheckCircle size={10} /> },
    pending: { label: "Pending", variant: "warning", icon: <Clock size={10} /> },
    rejected: { label: "Failed", variant: "danger", icon: <XCircle size={10} /> },
  };
  const { label, variant, icon } = config[status] ?? {
    label: status,
    variant: "default" as const,
    icon: null,
  };

  return (
    <Badge variant={variant} className="shrink-0 text-[9px]">
      <span className="flex items-center gap-1">
        {icon}
        {label}
      </span>
    </Badge>
  );
}

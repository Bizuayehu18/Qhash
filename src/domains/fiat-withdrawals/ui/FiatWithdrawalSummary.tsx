import type { ReactNode } from "react";
import { CurrencyUnit } from "@/components/ui/AmountText.js";
import { formatEtb } from "./fiat-withdrawal-format.js";
import { ETHIOPIA_WITHDRAWAL_FEE_PERCENT } from "./providers/et/ethiopia-withdrawal-policy.js";

export function EtbWithdrawalAmount({
  value,
  prefix = "",
}: {
  value: number;
  prefix?: string;
}) {
  return (
    <>
      {prefix}
      {formatEtb(value)}
      <CurrencyUnit />
    </>
  );
}

export function FiatWithdrawalSummaryRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={highlight ? "font-semibold text-[#00ff41]" : "text-gray-300"}>
        {value}
      </span>
    </div>
  );
}

export function FiatWithdrawalSummaryCard({
  amount,
  fee,
  net,
}: {
  amount: number;
  fee: number;
  net: number;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-[#1f1f1f] bg-[#0b0b0b] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-gray-200">Summary</span>
        <span className="text-[10px] text-gray-600">
          Fee {ETHIOPIA_WITHDRAWAL_FEE_PERCENT}%
        </span>
      </div>
      <FiatWithdrawalSummaryRow
        label="Amount"
        value={<EtbWithdrawalAmount value={amount} />}
      />
      <FiatWithdrawalSummaryRow
        label="Fee"
        value={<EtbWithdrawalAmount value={fee} />}
      />
      <div className="border-t border-[#1a1a1a] pt-2">
        <FiatWithdrawalSummaryRow
          label="You receive"
          value={<EtbWithdrawalAmount value={net} />}
          highlight
        />
      </div>
    </div>
  );
}

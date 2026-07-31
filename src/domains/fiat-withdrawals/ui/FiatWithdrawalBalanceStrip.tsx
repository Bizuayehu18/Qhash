import { Wallet } from "lucide-react";
import { CurrencyUnit } from "@/components/ui/AmountText.js";
import { formatEtb } from "./fiat-withdrawal-format.js";

export function FiatWithdrawalBalanceStrip({
  walletBalance,
}: {
  walletBalance: number | null;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-[rgba(0,255,65,0.16)] bg-[#111] px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.07)]">
          <Wallet size={15} className="text-[#00ff41]" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#00ff41]/70">
            Available
          </p>
          <p className="text-[10px] text-gray-600">Wallet balance</p>
        </div>
      </div>

      {walletBalance === null ? (
        <span
          className="skeleton inline-block h-5 w-24 rounded"
          aria-label="Loading available balance"
        />
      ) : (
        <div className="shrink-0 text-right">
          <span className="text-base font-black leading-none text-[#00ff41]">
            {formatEtb(walletBalance)}
          </span>
          <CurrencyUnit className="font-semibold" />
        </div>
      )}
    </div>
  );
}

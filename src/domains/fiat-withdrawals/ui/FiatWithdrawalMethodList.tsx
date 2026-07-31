import { ChevronRight } from "lucide-react";
import {
  FIAT_WITHDRAWAL_METHODS,
  getFiatWithdrawalMethodLabel,
} from "./fiat-withdrawal-providers.js";
import type { FiatWithdrawalMethod } from "./fiat-withdrawal-provider.js";

export function FiatWithdrawalMethodList({
  onSelect,
}: {
  onSelect: (method: FiatWithdrawalMethod) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111]">
      {FIAT_WITHDRAWAL_METHODS.map((provider, index) => (
        <button
          key={provider.method}
          type="button"
          onClick={() => onSelect(provider.method)}
          className={[
            "group w-full px-3.5 py-2.5 text-left transition-colors hover:bg-[rgba(255,77,77,0.035)] card-press",
            index === FIAT_WITHDRAWAL_METHODS.length - 1
              ? ""
              : "border-b border-[#1a1a1a]",
          ].join(" ")}
        >
          <span className="flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-red-400/15 bg-red-500/5 text-red-300">
              {provider.meta.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold leading-tight text-gray-100">
                {getFiatWithdrawalMethodLabel(provider.method)}
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                {provider.meta.label}
              </span>
            </span>
            <span className="inline-flex shrink-0 rounded-full border border-red-400/15 bg-red-500/5 px-2.5 py-1 text-[9px] font-semibold text-red-300">
              Payout
            </span>
            <ChevronRight
              size={15}
              className="shrink-0 text-gray-600 transition-colors group-hover:text-red-300"
            />
          </span>
        </button>
      ))}
    </div>
  );
}

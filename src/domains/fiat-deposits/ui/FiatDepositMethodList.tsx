import { ArrowDownCircle, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { getFiatDepositMethodMeta } from "./fiat-deposit-providers.js";
import type { FiatDepositMethodOption, FiatPaymentMethod } from "./fiat-deposit-types.js";

export function FiatDepositMethodList({
  methodsLoaded,
  methodOptions,
  onSelect,
}: {
  methodsLoaded: boolean;
  methodOptions: FiatDepositMethodOption[];
  onSelect: (method: FiatPaymentMethod) => void;
}) {
  if (!methodsLoaded && methodOptions.length === 0) {
    return (
      <div className="space-y-2">
        {[1, 2].map((index) => (
          <div key={index} className="skeleton h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (methodsLoaded && methodOptions.length === 0) {
    return (
      <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-6 text-center">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl border border-[#1a1a1a] bg-[#0b0b0b]">
          <ArrowDownCircle size={17} className="text-gray-600" />
        </div>
        <p className="mt-3 text-sm font-semibold text-gray-300">No payment methods</p>
        <p className="mt-1 text-xs text-gray-600">Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111] shadow-[0_0_0_1px_rgba(0,255,65,0.02)]">
      {methodOptions.map(({ method, index, total }, rowIndex) => {
        const meta = getFiatDepositMethodMeta(method.type);
        const accountSuffix = total > 1 ? ` · Account ${index + 1}` : "";

        return (
          <button
            key={method.id}
            type="button"
            onClick={() => onSelect(method)}
            className={[
              "group w-full px-3.5 py-3 text-left transition-colors hover:bg-[rgba(0,255,65,0.035)] card-press",
              rowIndex === methodOptions.length - 1 ? "" : "border-b border-[#1a1a1a]",
            ].join(" ")}
          >
            <span className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[rgba(0,255,65,0.18)] bg-[linear-gradient(145deg,rgba(0,255,65,0.12),rgba(0,255,65,0.04))] text-[#00ff41]">
                {meta.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-black leading-tight text-gray-100">
                  {meta.label}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-gray-500">
                  {meta.sublabel}{accountSuffix}
                </span>
              </span>
              <Badge variant="neon" className="shrink-0 text-[9px]">Add funds</Badge>
              <ChevronRight
                size={15}
                className="shrink-0 text-gray-600 transition-colors group-hover:text-[#00ff41]"
              />
            </span>
          </button>
        );
      })}
    </div>
  );
}

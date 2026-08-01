import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { CurrencyUnit } from "@/components/ui/AmountText.js";
import type { PlanCatalogItem } from "../domain/plan-catalog.js";
import { getPlanCardSummary } from "../domain/plan-eligibility.js";
import { formatPlanAmount } from "./plan-format.js";
import { PlanIcon } from "./plan-icons.js";

export function PlanCard({ plan, onSelect }: { plan: PlanCatalogItem; onSelect: () => void }) {
  const isAvailable = plan.eligibility.isEligible;
  const totalEarnings = plan.daily_earning * plan.duration_days;

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border bg-[#101010] p-3 transition card-press ${
        plan.is_popular
          ? "border-[rgba(0,255,65,0.38)] shadow-[0_0_0_1px_rgba(0,255,65,0.08)]"
          : "border-[#1b1b1b]"
      }`}
    >
      {plan.is_popular && <div className="absolute inset-x-0 top-0 h-px bg-[#00ff41]/80" />}

      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border ${
              isAvailable
                ? "border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
                : "border-[#242424] bg-[#171717] text-gray-500"
            }`}
          >
            {isAvailable ? <PlanIcon iconKey={plan.icon_key} /> : <Lock size={15} />}
          </div>

          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold leading-tight text-gray-100">{plan.name}</h3>
            <p className="mt-0.5 text-[10px] text-gray-600">{plan.duration_days}-day contract</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            {plan.is_popular && <Badge variant="neon">Popular</Badge>}
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[9px] ${
                isAvailable
                  ? "border-[rgba(0,255,65,0.22)] bg-[rgba(0,255,65,0.05)] text-[#00ff41]"
                  : "border-amber-400/20 bg-amber-400/5 text-amber-300"
              }`}
            >
              {isAvailable ? "Open" : "Locked"}
            </span>
          </div>
          <span className="text-[9px] text-gray-600">
            Limit {plan.eligibility.activePlanCount}/{plan.eligibility.maxActivePerUser}
          </span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-[#181818] bg-[#0a0a0a] px-2.5 py-2">
        <div className="min-w-0">
          <p className="truncate text-[9px] uppercase tracking-[0.14em] text-gray-600">Invest</p>
          <p className="mt-0.5 truncate font-mono text-sm font-black leading-tight text-gray-100">
            {formatPlanAmount(plan.investment_amount)}<CurrencyUnit />
          </p>
        </div>
        <div className="min-w-0 text-center">
          <p className="truncate text-[9px] uppercase tracking-[0.14em] text-gray-600">Daily</p>
          <p className="mt-0.5 truncate font-mono text-sm font-black leading-tight text-[#00ff41]">
            {formatPlanAmount(plan.daily_earning)}<CurrencyUnit />
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="truncate text-[9px] uppercase tracking-[0.14em] text-gray-600">Total</p>
          <p className="mt-0.5 truncate font-mono text-sm font-black leading-tight text-gray-100">
            {formatPlanAmount(totalEarnings)}<CurrencyUnit />
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#1a1a1a] pt-2">
        <p className={`min-w-0 flex-1 truncate text-[10px] ${isAvailable ? "text-gray-500" : "text-amber-200"}`}>
          {getPlanCardSummary(plan)}
        </p>
        <button
          type="button"
          onClick={onSelect}
          className={`shrink-0 rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition active:scale-[0.98] ${
            isAvailable
              ? "border-[rgba(0,255,65,0.28)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
              : "border-[#2a2a2a] bg-[#151515] text-gray-300"
          }`}
        >
          {isAvailable ? "Purchase" : "Details"}
        </button>
      </div>
    </div>
  );
}

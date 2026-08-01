import { Link } from "@tanstack/react-router";
import { Lock, X } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { CurrencyUnit } from "@/components/ui/AmountText.js";
import { Button } from "@/components/ui/Button.js";
import type { PlanCatalogItem } from "../domain/plan-catalog.js";
import {
  getMissingPlanEligibilityRows,
  getMissingPlanRequirementName,
} from "../domain/plan-eligibility.js";
import { PlanEligibilityProgress } from "./PlanEligibilityProgress.js";
import { formatPlanAmount, formatPlanWalletAmount } from "./plan-format.js";
import { PlanIcon } from "./plan-icons.js";

type PlanDetailsDialogProps = {
  onClose: () => void;
  onPurchase: () => void;
  plan: PlanCatalogItem;
  purchasing: boolean;
  walletBalance: number | null;
};

export function PlanDetailsDialog({
  onClose,
  onPurchase,
  plan,
  purchasing,
  walletBalance,
}: PlanDetailsDialogProps) {
  const walletBalanceKnown = walletBalance !== null;
  const missingRows = getMissingPlanEligibilityRows(plan);

  return (
    <div className="fixed inset-x-0 top-0 bottom-14 z-40 flex items-end justify-center bg-black/80 backdrop-blur-sm lg:inset-0 lg:z-[60] lg:items-center">
      <div
        className="relative max-h-[85dvh] w-full max-w-[520px] overflow-y-auto rounded-t-2xl border border-[rgba(0,255,65,0.12)] bg-[#111] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.55)] animate-[slideUp_0.25s_ease-out] lg:rounded-2xl"
        style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="mb-3 flex justify-center"><div className="h-1 w-10 rounded-full bg-gray-700" /></div>
        <button
          type="button"
          aria-label="Close plan details"
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-300"
        >
          <X size={18} />
        </button>

        <div className="mb-3 flex items-start gap-2.5 pr-8">
          <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${
            plan.eligibility.isEligible
              ? "border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
              : "border-[#242424] bg-[#171717] text-gray-500"
          }`}>
            {plan.eligibility.isEligible ? <PlanIcon iconKey={plan.icon_key} /> : <Lock size={16} />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-base font-bold leading-tight">{plan.name}</h3>
              {plan.is_popular && <Badge variant="neon">Popular</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">{plan.duration_days}-Day Mining Contract</p>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl border border-[#1b1b1b] bg-[#0a0a0a] px-3 py-2.5">
          <PlanAmount label="Invest" value={plan.investment_amount} />
          <PlanAmount label="Daily" value={plan.daily_earning} align="center" highlight />
          <PlanAmount label="Total" value={plan.daily_earning * plan.duration_days} align="right" />
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-[#1b1b1b] bg-[#0a0a0a] px-3 py-2">
            <p className="text-[10px] text-gray-600">Duration</p>
            <p className="mt-0.5 font-semibold text-gray-200">{plan.duration_days} days</p>
          </div>
          <div className="rounded-lg border border-[#1b1b1b] bg-[#0a0a0a] px-3 py-2 text-right">
            <p className="text-[10px] text-gray-600">Active Limit</p>
            <p className="mt-0.5 font-semibold text-gray-200">
              {plan.eligibility.activePlanCount} / {plan.eligibility.maxActivePerUser}
            </p>
          </div>
        </div>

        <div className="mb-3 rounded-xl border border-[#1b1b1b] bg-[#0a0a0a] p-3">
          <PlanEligibilityProgress plan={plan} />
          {!plan.eligibility.isEligible && (
            <div className="mt-2 border-t border-[#181818] pt-2">
              <p className="text-[11px] font-semibold text-amber-300">This contract is currently locked.</p>
              {plan.eligibility.limitReached && (
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                  Active limit reached. You can purchase again after one active contract expires.
                </p>
              )}
              {missingRows.length > 0 && (
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                  Missing: {missingRows.map((row) => (
                    `${row.missing} ${getMissingPlanRequirementName(row.label, row.missing)}`
                  )).join(" · ")}.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="mb-4 flex items-center justify-between border-t border-[#1f1f1f] pt-3 text-sm">
          <span className="text-gray-500">Your Wallet</span>
          {!walletBalanceKnown ? (
            <span className="skeleton inline-block h-5 w-24 rounded" aria-label="Loading wallet balance" />
          ) : (
            <span className={[
              "font-mono font-semibold",
              !plan.eligibility.isEligible
                ? "text-gray-200"
                : walletBalance >= plan.investment_amount
                  ? "text-[#00ff41]"
                  : "text-red-400",
            ].join(" ")}>
              {formatPlanWalletAmount(walletBalance)}<CurrencyUnit />
            </span>
          )}
        </div>

        <PlanDialogActions
          onClose={onClose}
          onPurchase={onPurchase}
          plan={plan}
          purchasing={purchasing}
          walletBalance={walletBalance}
        />
      </div>
    </div>
  );
}

function PlanAmount({
  align = "left",
  highlight = false,
  label,
  value,
}: {
  align?: "center" | "left" | "right";
  highlight?: boolean;
  label: string;
  value: number;
}) {
  return (
    <div className={`min-w-0 ${align === "center" ? "text-center" : align === "right" ? "text-right" : ""}`}>
      <p className="truncate text-[10px] uppercase tracking-[0.14em] text-gray-600">{label}</p>
      <p className={`mt-1 truncate font-mono text-sm font-black ${highlight ? "text-[#00ff41]" : "text-gray-100"}`}>
        {formatPlanAmount(value)}<CurrencyUnit />
      </p>
    </div>
  );
}

function PlanDialogActions({
  onClose,
  onPurchase,
  plan,
  purchasing,
  walletBalance,
}: PlanDetailsDialogProps) {
  if (!plan.eligibility.isEligible) {
    return (
      <div className="flex gap-3">
        <Button variant="ghost" size="sm" fullWidth onClick={onClose}>Close</Button>
        <Button variant="outline" size="sm" fullWidth disabled className="border-[#2a2a2a] bg-[#121212] text-gray-500 shadow-none disabled:opacity-100">Locked</Button>
      </div>
    );
  }

  if (walletBalance === null) {
    return (
      <div className="flex gap-3">
        <Button variant="ghost" size="sm" fullWidth onClick={onClose}>Close</Button>
        <Button variant="primary" size="sm" fullWidth disabled>Checking Wallet</Button>
      </div>
    );
  }

  if (walletBalance < plan.investment_amount) {
    return (
      <div className="text-center">
        <p className="mb-3 text-xs text-red-400">Insufficient balance. Deposit funds to continue.</p>
        <div className="flex gap-3">
          <Button variant="ghost" size="sm" fullWidth onClick={onClose}>Close</Button>
          <Link to="/deposit" className="flex-1"><Button variant="primary" size="sm" fullWidth>Deposit</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <Button variant="ghost" size="sm" fullWidth onClick={onClose} disabled={purchasing}>Cancel</Button>
      <Button variant="primary" size="sm" fullWidth loading={purchasing} onClick={onPurchase}>Confirm Purchase</Button>
    </div>
  );
}

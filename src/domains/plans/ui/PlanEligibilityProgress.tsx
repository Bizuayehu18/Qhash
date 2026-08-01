import { CheckCircle2, XCircle } from "lucide-react";
import type { PlanCatalogItem } from "../domain/plan-catalog.js";
import { getPlanEligibilityRows } from "../domain/plan-eligibility.js";

export function PlanEligibilityProgress({ plan }: { plan: PlanCatalogItem }) {
  const rows = getPlanEligibilityRows(plan);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-gray-600">
        <span>Eligibility</span>
        <span>{plan.eligibility.referralRequirementMet ? "Cleared" : "Required"}</span>
      </div>
      {rows.length === 0 ? (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <CheckCircle2 size={13} className="text-[#00ff41]" /> No referral requirement
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => {
            const requirementMet = row.current >= row.required;
            return (
              <div key={row.label} className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-gray-400">
                  {requirementMet ? (
                    <CheckCircle2 size={13} className="text-[#00ff41]" />
                  ) : (
                    <XCircle size={13} className="text-amber-400" />
                  )}
                  {row.label}
                </span>
                <span className={requirementMet ? "text-[#00ff41]" : "text-amber-300"}>
                  {row.current} / {row.required}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

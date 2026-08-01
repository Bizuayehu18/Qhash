import type { PlanCatalogItem } from "./plan-catalog.js";

export type PlanEligibilityRow = {
  current: number;
  label: "Direct referrals" | "Level 2 referrals" | "Level 3 referrals";
  required: number;
};

export type MissingPlanEligibilityRow = PlanEligibilityRow & { missing: number };

export function getPlanEligibilityRows(plan: PlanCatalogItem): PlanEligibilityRow[] {
  const eligibility = plan.eligibility;
  return [
    {
      label: "Direct referrals" as const,
      current: eligibility.activeLevel1Referrals,
      required: eligibility.requiredLevel1Referrals,
    },
    {
      label: "Level 2 referrals" as const,
      current: eligibility.activeLevel2Referrals,
      required: eligibility.requiredLevel2Referrals,
    },
    {
      label: "Level 3 referrals" as const,
      current: eligibility.activeLevel3Referrals,
      required: eligibility.requiredLevel3Referrals,
    },
  ].filter((row) => row.required > 0);
}

export function getMissingPlanEligibilityRows(
  plan: PlanCatalogItem,
): MissingPlanEligibilityRow[] {
  return getPlanEligibilityRows(plan)
    .map((row) => ({ ...row, missing: Math.max(0, row.required - row.current) }))
    .filter((row) => row.missing > 0);
}

export function getMissingPlanRequirementName(
  label: PlanEligibilityRow["label"],
  count: number,
) {
  const name = label === "Direct referrals"
    ? "active direct referral"
    : label === "Level 2 referrals"
      ? "active level 2 referral"
      : "active level 3 referral";

  return `${name}${count === 1 ? "" : "s"}`;
}

export function getPlanLockReason(plan: PlanCatalogItem) {
  if (plan.eligibility.limitReached) {
    return `Active limit reached (${plan.eligibility.activePlanCount}/${plan.eligibility.maxActivePerUser}).`;
  }

  const firstMissing = getMissingPlanEligibilityRows(plan)[0];
  if (firstMissing) {
    return `Requires ${firstMissing.missing} more ${getMissingPlanRequirementName(firstMissing.label, firstMissing.missing)}.`;
  }

  return "Requirements not met.";
}

export function getPlanCardSummary(plan: PlanCatalogItem) {
  if (!plan.eligibility.isEligible) return getPlanLockReason(plan);
  return getPlanEligibilityRows(plan).length === 0
    ? "No referral requirement"
    : "Requirements cleared";
}

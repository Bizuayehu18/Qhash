import {
  getPlansWithEligibilityFn,
} from "@/lib/server/plans.js";
import { purchasePlanFn } from "@/lib/server/investments.js";
import type { PlanCatalogItem } from "../domain/plan-catalog.js";

export function loadPlansWithEligibility(accessToken: string): Promise<PlanCatalogItem[]> {
  return getPlansWithEligibilityFn({ data: { accessToken } });
}

export function purchasePlan(planId: string, accessToken: string) {
  return purchasePlanFn({ data: { planId, accessToken } });
}

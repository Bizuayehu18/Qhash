import { loadDashboardFn } from "@/lib/server/dashboard.js";
import { getPlansFn } from "@/lib/server/plans.js";

export type DashboardData = Awaited<ReturnType<typeof loadDashboardFn>>;

export function loadAuthenticatedDashboard(accessToken: string) {
  return loadDashboardFn({ data: { accessToken } });
}

export function loadDashboardPlans() {
  return getPlansFn();
}

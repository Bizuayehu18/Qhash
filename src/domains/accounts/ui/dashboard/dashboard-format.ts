const DASHBOARD_RECENT_TRANSACTION_LIMIT = 5;
const DASHBOARD_COMPLETED_PLAN_LIMIT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export function formatDashboardAmount(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function getDashboardPlanTiming({
  endDate,
  nowMs,
  startDate,
}: {
  endDate: string;
  nowMs: number;
  startDate: string;
}) {
  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const totalMs = endMs - startMs;
  const elapsedMs = Math.min(nowMs - startMs, totalMs);
  const progress = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;
  const clampedProgress = Math.max(0, Math.min(progress, 100));

  return {
    clampedProgress,
    daysRemaining: Math.max(0, Math.ceil((endMs - nowMs) / DAY_MS)),
    roundedProgress: Math.round(clampedProgress),
  };
}

export function getRecentDashboardTransactions<T>(transactions: readonly T[]) {
  return transactions.slice(0, DASHBOARD_RECENT_TRANSACTION_LIMIT);
}

export function getCompletedDashboardInvestments<T>(investments: readonly T[]) {
  return investments.slice(0, DASHBOARD_COMPLETED_PLAN_LIMIT);
}

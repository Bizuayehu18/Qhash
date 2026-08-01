import { Link } from "@tanstack/react-router";
import { Cpu, Server } from "lucide-react";
import { AmountText, CurrencyUnit } from "@/components/ui/AmountText.js";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { EmptyState } from "@/components/ui/EmptyState.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";
import type { DashboardData } from "../../application/dashboard-browser-service.js";
import {
  formatDashboardAmount,
  getCompletedDashboardInvestments,
  getDashboardPlanTiming,
} from "./dashboard-format.js";

type DashboardPlanNameResolver = (planId: string) => string;

export function ActiveDashboardPlans({
  activeInvestments,
  getPlanName,
  hasDashboardData,
}: {
  activeInvestments: DashboardData["activeInvestments"];
  getPlanName: DashboardPlanNameResolver;
  hasDashboardData: boolean;
}) {
  return (
    <div className="lg:col-span-12">
      <SectionHeader
        title="Active Plans"
        action={
          <Badge variant={activeInvestments.length > 0 ? "neon" : "default"}>
            {hasDashboardData ? (
              `${activeInvestments.length} active`
            ) : (
              <span className="skeleton inline-block h-3 w-12 rounded" aria-label="Loading active plan count" />
            )}
          </Badge>
        }
        className="mb-3"
      />

      {!hasDashboardData ? (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-6">
          <div className="skeleton mx-auto mb-3 h-6 w-6 rounded-md" />
          <div className="skeleton mx-auto h-3 w-32 rounded" />
        </div>
      ) : activeInvestments.length === 0 ? (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111]">
          <EmptyState
            icon={<Server size={24} />}
            title="No active mining plans"
            action={
              <Link to="/plans">
                <Button variant="secondary" size="sm">Browse Plans</Button>
              </Link>
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {activeInvestments.map((investment) => {
            const timing = getDashboardPlanTiming({
              endDate: investment.end_date,
              nowMs: Date.now(),
              startDate: investment.start_date,
            });

            return (
              <div key={investment.id} className="relative overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]">
                      <Cpu size={14} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold leading-tight text-gray-100">
                        {getPlanName(investment.plan_id)}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-gray-600">
                        {formatDashboardAmount(investment.daily_earning)}
                        <CurrencyUnit className="text-gray-600" />/day · {timing.roundedProgress}% complete
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.05)] px-2 py-0.5 text-[10px] text-[#00ff41]">
                    {timing.daysRemaining}d left
                  </span>
                </div>

                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#1a1a1a]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#00ff41] to-[#00cc33] transition-all"
                    style={{ width: `${timing.clampedProgress}%` }}
                  />
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-[#181818] bg-[#0a0a0a] px-2.5 py-2">
                  <PlanMetric label="Invested" value={investment.invested_amount} />
                  <PlanMetric label="Daily" value={investment.daily_earning} align="center" />
                  <PlanMetric label="Earned" value={investment.total_earned} align="right" accent />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CompletedDashboardPlans({
  completedInvestments,
  getPlanName,
}: {
  completedInvestments: DashboardData["completedInvestments"];
  getPlanName: DashboardPlanNameResolver;
}) {
  if (completedInvestments.length === 0) return null;

  return (
    <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-3.5 lg:col-span-4">
      <SectionHeader title="Completed Plans" className="mb-3" />
      <div className="space-y-2">
        {getCompletedDashboardInvestments(completedInvestments).map((investment) => (
          <div key={investment.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
            <span className="min-w-0 truncate text-gray-400">{getPlanName(investment.plan_id)}</span>
            <AmountText value={investment.total_earned} showSign tone="positive" size="sm" className="shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanMetric({
  accent,
  align = "left",
  label,
  value,
}: {
  accent?: boolean;
  align?: "center" | "left" | "right";
  label: string;
  value: number;
}) {
  const alignment = align === "center" ? "text-center" : align === "right" ? "text-right" : "";
  return (
    <div className={`min-w-0 ${alignment}`}>
      <p className="truncate text-[9px] uppercase tracking-[0.14em] text-gray-600">{label}</p>
      <p className={`mt-0.5 truncate font-mono text-sm font-black leading-tight ${accent ? "text-[#00ff41]" : "text-gray-100"}`}>
        {formatDashboardAmount(value)}<CurrencyUnit />
      </p>
    </div>
  );
}

import { useSupportDestination } from "@/domains/support/public.js";
import { useAuthStore } from "@/store/authStore.js";
import { DashboardAccountSummary } from "./DashboardAccountSummary.js";
import {
  ActiveDashboardPlans,
  CompletedDashboardPlans,
} from "./DashboardPlanSections.js";
import { DashboardRecentTransactions } from "./DashboardRecentTransactions.js";
import { useDashboardRemoteState } from "../useDashboardRemoteState.js";

export function DashboardPage() {
  const profile = useAuthStore((state) => state.profile);
  const { balance, data, plans } = useDashboardRemoteState();
  const {
    openSupport,
    supportDescription,
    supportOpening,
    supportUrl,
  } = useSupportDestination();
  const hasDashboardData = data !== null;
  const activeInvestments = data?.activeInvestments ?? [];
  const completedInvestments = data?.completedInvestments ?? [];
  const incomeSummary = data?.incomeSummary ?? null;
  const recentTransactions = data?.recentTransactions ?? [];
  const getPlanName = (planId: string) => (
    plans.find((plan) => plan.id === planId)?.name ?? "Mining Plan"
  );

  return (
    <div className="space-y-4 stagger-children lg:grid lg:grid-cols-12 lg:gap-5 lg:space-y-0">
      <DashboardAccountSummary
        activeInvestmentCount={activeInvestments.length}
        balance={balance}
        hasDashboardData={hasDashboardData}
        incomeSummary={incomeSummary}
        onOpenSupport={openSupport}
        profileUsername={profile?.username}
        supportDescription={supportDescription}
        supportOpening={supportOpening}
        supportUrl={supportUrl}
      />
      <ActiveDashboardPlans
        activeInvestments={activeInvestments}
        getPlanName={getPlanName}
        hasDashboardData={hasDashboardData}
      />
      <DashboardRecentTransactions
        hasCompletedInvestments={completedInvestments.length > 0}
        hasDashboardData={hasDashboardData}
        recentTransactions={recentTransactions}
      />
      <CompletedDashboardPlans
        completedInvestments={completedInvestments}
        getPlanName={getPlanName}
      />
    </div>
  );
}

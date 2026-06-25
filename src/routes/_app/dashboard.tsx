import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  TrendingUp,
  Cpu,
  Layers,
  ChevronRight,
  ArrowDownCircle,
  ArrowUpCircle,
  Server,
  Users,
  MessageCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";
import { StatTile } from "@/components/ui/StatTile.js";
import { ListPanel } from "@/components/ui/ListPanel.js";
import { ListRow } from "@/components/ui/ListRow.js";
import { EmptyState } from "@/components/ui/EmptyState.js";
import { AmountText } from "@/components/ui/AmountText.js";
import { TxIcon, txLabel, isOutgoingTx } from "@/components/ui/TransactionHelpers.js";
import { MiningStatus } from "@/components/ui/MiningStatus.js";
import { ActivityFeed } from "@/components/ui/ActivityFeed.js";
import { OnlineUsers } from "@/components/ui/OnlineUsers.js";
import { MiningAnimation } from "@/components/ui/MiningAnimation.js";
import { formatDateTime } from "@/lib/format.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import { loadDashboardFn } from "@/lib/server/dashboard.js";
import { getPlansFn } from "@/lib/server/plans.js";
import { withTimeout } from "@/lib/async.js";
import type { Plan } from "@/lib/database.types.js";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

type DashboardData = Awaited<ReturnType<typeof loadDashboardFn>>;

const DASHBOARD_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

function DashboardPage() {
  const { user, profile } = useAuthStore();
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const walletBalance = useWalletStore((s) => s.balance);
  const setWalletBalance = useWalletStore((s) => s.setBalance);
  const [data, setData] = useState<DashboardData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const loadingRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback((loadFn: () => void) => {
    clearRetryTimer();

    if (retryCountRef.current >= MAX_AUTO_RETRIES) return;

    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(loadFn, AUTO_RETRY_DELAY_MS);
  }, [clearRetryTimer]);

  const load = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (loadingRef.current) return;

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (!user?.id || !accessToken) {
        setData(null);
        return;
      }

      clearRetryTimer();
      loadingRef.current = true;

      try {
        const [dashboardResult, plansResult] = await Promise.allSettled([
          withTimeout(
            loadDashboardFn({ data: { accessToken } }),
            DASHBOARD_LOAD_TIMEOUT_MS,
            "Dashboard request timed out.",
          ),
          withTimeout(
            getPlansFn(),
            DASHBOARD_LOAD_TIMEOUT_MS,
            "Plans request timed out.",
          ),
        ]);

        if (!mountedRef.current) return;

        if (dashboardResult.status === "fulfilled") {
          setData(dashboardResult.value);
          setWalletBalance(dashboardResult.value.wallet.balance);
          retryCountRef.current = 0;
        } else {
          console.error("[QHash] Dashboard background refresh failed:", dashboardResult.reason);
          scheduleRetry(() => {
            void load();
          });
        }

        if (plansResult.status === "fulfilled") {
          setPlans(plansResult.value);
        } else {
          console.error("[QHash] Dashboard plans background refresh failed:", plansResult.reason);
        }
      } catch (err) {
        console.error("[QHash] Dashboard background refresh failed:", err);

        if (!mountedRef.current) return;

        scheduleRetry(() => {
          void load();
        });
      } finally {
        loadingRef.current = false;
      }
    },
    [accessToken, clearRetryTimer, scheduleRetry, setWalletBalance, user?.id],
  );

  useEffect(() => {
    mountedRef.current = true;
    void load({ resetRetryCount: true });

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer, load]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void load({ resetRetryCount: true });
      }
    };

    const handleOnline = () => {
      void load({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [load]);

  const hasDashboardData = data !== null;
  const wallet = data?.wallet ?? null;
  const activeInvestments = data?.activeInvestments ?? [];
  const completedInvestments = data?.completedInvestments ?? [];
  const dailyEarningRate = hasDashboardData ? data.dailyEarningRate : null;
  const totalEarned = hasDashboardData ? data.totalEarned : null;
  const recentTransactions = data?.recentTransactions ?? [];
  const balance = walletBalance ?? wallet?.balance ?? null;

  const getPlanName = (planId: string) => {
    const plan = plans.find((p) => p.id === planId);
    return plan?.name ?? planId;
  };

  return (
    <div className="space-y-4 stagger-children lg:grid lg:grid-cols-12 lg:gap-5 lg:space-y-0">
      {/* Greeting + Online Users */}
      <div className="flex items-end justify-between lg:col-span-12">
        <div>
          <p className="text-xs text-gray-500">Welcome back</p>
          <h1 className="text-lg font-bold leading-tight">@{profile?.username ?? "User"}</h1>
        </div>
        <OnlineUsers />
      </div>

      {/* Balance Card with Mining Animation */}
      <div className="balance-card mining-active relative overflow-hidden rounded-2xl p-4 lg:col-span-8 lg:p-5">
        {/* Mining animation background */}
        <div className="absolute inset-0 opacity-30">
          <MiningAnimation />
        </div>

        <div className="relative z-10">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs text-gray-500">Total Balance</p>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00ff41] status-pulse" />
              <span className="text-[10px] text-gray-600">Mining Active</span>
            </div>
          </div>
          <p className="flex min-h-[38px] items-baseline text-3xl font-black tracking-tight neon-text">
            {balance === null ? (
              <span className="skeleton inline-block h-8 w-28 rounded-md" aria-label="Loading balance" />
            ) : (
              balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            )}
            <span className="ml-1.5 text-sm font-normal text-gray-500">ETB</span>
          </p>

          <div className="mt-3 flex gap-2.5">
            <Link to="/deposit" className="flex-1">
              <button className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-[#00ff41] py-2.5 text-xs font-bold text-black card-press">
                <ArrowDownCircle size={14} />
                Deposit
              </button>
            </Link>
            <Link to="/plans" className="flex-1">
              <button className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-[rgba(0,255,65,0.22)] bg-[rgba(0,255,65,0.08)] py-2.5 text-xs font-semibold text-[#00ff41] card-press">
                <Layers size={14} />
                Buy Contract
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-2.5 lg:col-span-4 lg:grid-cols-1 lg:gap-3">
        <StatTile
          icon={<Cpu size={14} />}
          label="Daily"
          value={dailyEarningRate === null ? "" : <AmountText value={dailyEarningRate} currency="" size="sm" className="stat-value-glow" />}
          caption="ETB/day"
          accent
          loading={dailyEarningRate === null}
        />
        <StatTile
          icon={<TrendingUp size={14} />}
          label="Earned"
          value={totalEarned === null ? "" : <AmountText value={totalEarned} currency="" size="sm" className="stat-value-glow" />}
          caption="Total"
          accent
          loading={totalEarned === null}
        />
        <StatTile
          icon={<Layers size={14} />}
          label="Plans"
          value={activeInvestments.length}
          caption="Active"
          accent
          loading={!hasDashboardData}
        />
      </div>

      {/* Mining Network Status */}
      <div className="lg:col-span-8">
        <MiningStatus />
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3 overflow-x-auto hide-scrollbar -mx-4 px-4 lg:col-span-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
        <Link to="/withdraw" className="shrink-0 lg:w-full">
          <div className="flex items-center gap-2 rounded-xl border border-[#1a1a1a] bg-[#111] px-4 py-3 card-press lg:w-full">
            <ArrowUpCircle size={14} className="text-[#00ff41]" />
            <span className="whitespace-nowrap text-xs font-medium text-gray-300">Withdraw</span>
          </div>
        </Link>
        <Link to="/referrals" className="shrink-0 lg:w-full">
          <div className="flex items-center gap-2 rounded-xl border border-[#1a1a1a] bg-[#111] px-4 py-3 card-press lg:w-full">
            <Users size={14} className="text-[#00ff41]" />
            <span className="whitespace-nowrap text-xs font-medium text-gray-300">Invite & Earn</span>
          </div>
        </Link>
        <Link to="/support" className="shrink-0 lg:w-full">
          <div className="flex items-center gap-2 rounded-xl border border-[#1a1a1a] bg-[#111] px-4 py-3 card-press lg:w-full">
            <MessageCircle size={14} className="text-[#00ff41]" />
            <span className="whitespace-nowrap text-xs font-medium text-gray-300">Support</span>
          </div>
        </Link>
      </div>

      {/* Active Investments */}
      <div className="lg:col-span-8">
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
          <div className="space-y-3">
            {activeInvestments.map((inv) => {
              const startMs = new Date(inv.start_date).getTime();
              const endMs = new Date(inv.end_date).getTime();
              const nowMs = Date.now();
              const totalMs = endMs - startMs;
              const elapsedMs = Math.min(nowMs - startMs, totalMs);
              const progress = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;
              const daysRemaining = Math.max(0, Math.ceil((endMs - nowMs) / (24 * 60 * 60 * 1000)));

              return (
                <div key={inv.id} className="rounded-xl border border-[#1a1a1a] bg-[#111] p-3.5">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#00ff41] status-pulse" />
                      <span className="truncate text-sm font-semibold">{getPlanName(inv.plan_id)}</span>
                    </div>
                    <span className="shrink-0 text-[10px] text-gray-600">{daysRemaining}d left</span>
                  </div>
                  <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-2">
                      <p className="mb-1 text-[10px] text-gray-600">Invested</p>
                      <AmountText value={inv.invested_amount} tone="neutral" size="sm" className="block truncate" />
                    </div>
                    <div className="rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-2 text-center">
                      <p className="mb-1 text-[10px] text-gray-600">Daily</p>
                      <AmountText value={inv.daily_earning} tone="neutral" size="sm" className="block truncate" />
                    </div>
                    <div className="rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-2 text-right">
                      <p className="mb-1 text-[10px] text-gray-600">Earned</p>
                      <AmountText value={inv.total_earned} tone="positive" size="sm" className="block truncate" />
                    </div>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#1a1a1a]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#00ff41] to-[#00cc33] transition-all"
                      style={{ width: `${Math.min(progress, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Completed Plans */}
      {completedInvestments.length > 0 && (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-3.5 lg:col-span-4 lg:order-last">
          <SectionHeader title="Completed Plans" className="mb-3" />
          <div className="space-y-2">
            {completedInvestments.slice(0, 3).map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <span className="min-w-0 truncate text-gray-400">{getPlanName(inv.plan_id)}</span>
                <AmountText value={inv.total_earned} showSign tone="positive" size="sm" className="shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Activity Feed */}
      <div className="lg:col-span-4">
        <ActivityFeed />
      </div>

      {/* Recent Transactions */}
      <div className="lg:col-span-8">
        <SectionHeader
          title="Recent Transactions"
          action={
            <Link to="/transactions" className="flex items-center gap-0.5 text-[10px] text-gray-500">
              View All <ChevronRight size={12} />
            </Link>
          }
          className="mb-3"
        />

        {!hasDashboardData ? (
          <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-6">
            <div className="skeleton h-3 w-36 rounded" />
          </div>
        ) : recentTransactions.length === 0 ? (
          <div className="rounded-xl border border-[#1a1a1a] bg-[#111]">
            <EmptyState title="No transactions yet" className="py-10" />
          </div>
        ) : (
          <ListPanel>
            {recentTransactions.slice(0, 5).map((tx) => {
              const signedAmount = isOutgoingTx(tx.type) ? -Math.abs(tx.amount) : Math.abs(tx.amount);

              return (
                <ListRow
                  key={tx.id}
                  icon={<TxIcon type={tx.type} />}
                  title={txLabel(tx.type)}
                  meta={formatDateTime(tx.created_at)}
                  right={<AmountText value={signedAmount} showSign currency="" size="sm" />}
                />
              );
            })}
          </ListPanel>
        )}
      </div>
    </div>
  );
}

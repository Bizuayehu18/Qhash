import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  TrendingUp,
  Cpu,
  Layers,
  ChevronRight,
  ArrowDownCircle,
  ArrowUpCircle,
  Zap,
  Server,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
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
    <div className="space-y-5 stagger-children">
      {/* Greeting + Online Users */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-gray-500 text-xs">Welcome back</p>
          <h1 className="text-lg font-bold">@{profile?.username ?? "User"}</h1>
        </div>
        <OnlineUsers />
      </div>

      {/* Balance Card with Mining Animation */}
      <div className="balance-card rounded-2xl p-5 mining-active relative">
        {/* Mining animation background */}
        <div className="absolute inset-0 opacity-30">
          <MiningAnimation />
        </div>

        <div className="relative z-10">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-gray-500">Total Balance</p>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#00ff41] status-pulse" />
              <span className="text-[10px] text-gray-600">Mining Active</span>
            </div>
          </div>
          <p className="text-3xl font-black neon-text tracking-tight min-h-[40px] flex items-baseline">
            {balance === null ? (
              <span className="skeleton inline-block h-8 w-28 rounded-md" aria-label="Loading balance" />
            ) : (
              balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            )}
            <span className="text-sm font-normal text-gray-500 ml-1.5">ETB</span>
          </p>

          <div className="flex gap-3 mt-4">
            <Link to="/deposit" className="flex-1">
              <button className="w-full flex items-center justify-center gap-1.5 bg-[#00ff41] text-black rounded-xl py-2.5 text-xs font-bold card-press">
                <ArrowDownCircle size={14} />
                Deposit
              </button>
            </Link>
            <Link to="/withdraw" className="flex-1">
              <button className="w-full flex items-center justify-center gap-1.5 bg-white/[0.06] border border-white/[0.08] text-gray-300 rounded-xl py-2.5 text-xs font-medium card-press">
                <ArrowUpCircle size={14} />
                Withdraw
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="premium-card rounded-xl p-3">
          <Cpu size={14} className="text-[#00ff41] mb-2" />
          <p className="text-sm font-bold stat-value-glow min-h-[20px]">
            {dailyEarningRate === null ? (
              <span className="skeleton inline-block h-4 w-14 rounded" aria-label="Loading daily earning" />
            ) : (
              dailyEarningRate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            )}
          </p>
          <p className="text-[10px] text-gray-600">ETB/day</p>
        </div>
        <div className="premium-card rounded-xl p-3">
          <TrendingUp size={14} className="text-[#00ff41] mb-2" />
          <p className="text-sm font-bold stat-value-glow min-h-[20px]">
            {totalEarned === null ? (
              <span className="skeleton inline-block h-4 w-14 rounded" aria-label="Loading total earned" />
            ) : (
              totalEarned.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            )}
          </p>
          <p className="text-[10px] text-gray-600">Total Earned</p>
        </div>
        <div className="premium-card rounded-xl p-3">
          <Layers size={14} className="text-[#00ff41] mb-2" />
          <p className="text-sm font-bold stat-value-glow min-h-[20px]">
            {hasDashboardData ? (
              activeInvestments.length
            ) : (
              <span className="skeleton inline-block h-4 w-8 rounded" aria-label="Loading active plans" />
            )}
          </p>
          <p className="text-[10px] text-gray-600">Active Plans</p>
        </div>
      </div>

      {/* Mining Network Status */}
      <MiningStatus />

      {/* Quick Actions */}
      <div className="flex gap-3 overflow-x-auto hide-scrollbar -mx-4 px-4">
        <Link to="/plans" className="shrink-0">
          <div className="flex items-center gap-2 premium-card rounded-xl px-4 py-3 card-press">
            <Zap size={14} className="text-[#00ff41]" />
            <span className="text-xs font-medium text-gray-300 whitespace-nowrap">Buy Plan</span>
          </div>
        </Link>
        <Link to="/referrals" className="shrink-0">
          <div className="flex items-center gap-2 premium-card rounded-xl px-4 py-3 card-press">
            <span className="text-xs">👥</span>
            <span className="text-xs font-medium text-gray-300 whitespace-nowrap">Invite & Earn</span>
          </div>
        </Link>
        <Link to="/support" className="shrink-0">
          <div className="flex items-center gap-2 premium-card rounded-xl px-4 py-3 card-press">
            <span className="text-xs">💬</span>
            <span className="text-xs font-medium text-gray-300 whitespace-nowrap">Support</span>
          </div>
        </Link>
      </div>

      {/* Active Investments */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Active Plans</h2>
          <Badge variant={activeInvestments.length > 0 ? "neon" : "default"}>
            {hasDashboardData ? (
              `${activeInvestments.length} active`
            ) : (
              <span className="skeleton inline-block h-3 w-12 rounded" aria-label="Loading active plan count" />
            )}
          </Badge>
        </div>

        {!hasDashboardData ? (
          <div className="premium-card rounded-xl p-6">
            <div className="skeleton mx-auto mb-3 h-6 w-6 rounded-md" />
            <div className="skeleton mx-auto h-3 w-32 rounded" />
          </div>
        ) : activeInvestments.length === 0 ? (
          <div className="premium-card rounded-xl p-6 text-center">
            <Server size={24} className="mx-auto mb-3 text-gray-700" />
            <p className="text-xs text-gray-600 mb-3">No active mining plans</p>
            <Link to="/plans">
              <Button variant="secondary" size="sm">Browse Plans</Button>
            </Link>
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
                <div key={inv.id} className="premium-card rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-[#00ff41] status-pulse" />
                      <span className="font-semibold text-sm">{getPlanName(inv.plan_id)}</span>
                    </div>
                    <span className="text-[10px] text-gray-600">{daysRemaining}d left</span>
                  </div>
                  <div className="flex justify-between text-xs mb-3">
                    <div>
                      <p className="text-gray-600">Invested</p>
                      <p className="font-medium text-gray-300">{inv.invested_amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB</p>
                    </div>
                    <div className="text-center">
                      <p className="text-gray-600">Daily</p>
                      <p className="font-medium text-gray-300">{inv.daily_earning.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB</p>
                    </div>
                    <div className="text-right">
                      <p className="text-gray-600">Earned</p>
                      <p className="font-medium text-[#00ff41]">{inv.total_earned.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB</p>
                    </div>
                  </div>
                  <div className="h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#00ff41] to-[#00cc33] rounded-full transition-all"
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
        <div className="premium-card rounded-xl p-4">
          <p className="text-xs font-semibold text-gray-400 mb-3">Completed Plans</p>
          <div className="space-y-2">
            {completedInvestments.slice(0, 3).map((inv) => (
              <div key={inv.id} className="flex items-center justify-between text-xs py-1.5">
                <span className="text-gray-400">{getPlanName(inv.plan_id)}</span>
                <span className="text-[#00ff41] font-mono text-[11px]">+{inv.total_earned.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Activity Feed */}
      <ActivityFeed />

      {/* Recent Transactions */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Recent Transactions</h2>
          <Link to="/transactions" className="text-[10px] text-gray-500 flex items-center gap-0.5">
            View All <ChevronRight size={12} />
          </Link>
        </div>

        {!hasDashboardData ? (
          <div className="premium-card rounded-xl p-6">
            <div className="skeleton h-3 w-36 rounded" />
          </div>
        ) : recentTransactions.length === 0 ? (
          <div className="premium-card rounded-xl p-6 text-center text-xs text-gray-600">
            No transactions yet
          </div>
        ) : (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a] overflow-hidden">
            {recentTransactions.slice(0, 5).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-4 py-3 tx-row">
                <div className="flex items-center gap-3">
                  <TxIcon type={tx.type} />
                  <div>
                    <p className="text-xs font-medium text-gray-200">{txLabel(tx.type)}</p>
                    <p className="text-[10px] text-gray-600">{formatDateTime(tx.created_at)}</p>
                  </div>
                </div>
                <span className={`text-xs font-mono font-medium ${isOutgoingTx(tx.type) ? "text-red-400" : "text-[#00ff41]"}`}>
                  {isOutgoingTx(tx.type) ? "-" : "+"}{Math.abs(tx.amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

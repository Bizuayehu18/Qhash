import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
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
import { getSafeErrorMessage } from "@/lib/errors.js";
import type { Plan } from "@/lib/database.types.js";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

type DashboardData = Awaited<ReturnType<typeof loadDashboardFn>>;

function DashboardSkeleton() {
  return (
    <div className="space-y-5 stagger-children">
      <div className="skeleton h-36 rounded-2xl" />
      <div className="grid grid-cols-3 gap-3">
        <div className="skeleton h-20 rounded-xl" />
        <div className="skeleton h-20 rounded-xl" />
        <div className="skeleton h-20 rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="skeleton h-20 rounded-xl" />
        <div className="skeleton h-20 rounded-xl" />
        <div className="skeleton h-20 rounded-xl" />
        <div className="skeleton h-20 rounded-xl" />
      </div>
      <div className="skeleton h-10 rounded-xl" />
      <div className="skeleton h-48 rounded-xl" />
      <div className="skeleton h-32 rounded-xl" />
    </div>
  );
}

function DashboardPage() {
  const { user, profile } = useAuthStore();
  const walletBalance = useWalletStore((s) => s.balance);
  const setWalletBalance = useWalletStore((s) => s.setBalance);
  const [data, setData] = useState<DashboardData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    Promise.all([
      loadDashboardFn({ data: { userId: user.id } }),
      getPlansFn(),
    ])
      .then(([d, p]) => {
        setData(d);
        setPlans(p);
        setWalletBalance(d.wallet.balance);
      })
      .catch((err) => {
        console.error("Dashboard load failed:", err);
        setError(getSafeErrorMessage(err, "SERVER").message);
      })
      .finally(() => setLoading(false));
  }, [user?.id, setWalletBalance]);

  if (loading) return <DashboardSkeleton />;

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-gray-500 text-sm mb-4">{error ?? "Failed to load dashboard."}</p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            if (!user?.id) return;
            setLoading(true);
            setError(null);
            loadDashboardFn({ data: { userId: user.id } })
              .then((d) => {
                setData(d);
                setWalletBalance(d.wallet.balance);
              })
              .catch((err) => setError(getSafeErrorMessage(err, "SERVER").message))
              .finally(() => setLoading(false));
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  const { wallet, activeInvestments, completedInvestments, dailyEarningRate, totalEarned, recentTransactions } = data;
  const balance = walletBalance ?? wallet.balance;

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
          <h1 className="text-lg font-bold">@{profile?.username ?? 'User'}</h1>
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
          <p className="text-3xl font-black neon-text tracking-tight">
            {balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                <span className="text-[8px] font-semibold text-[#00ff41] bg-[rgba(0,255,65,0.1)] rounded-full px-1.5 py-0.5 leading-none">Soon</span>
              </button>
            </Link>
          </div>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="premium-card rounded-xl p-3">
          <Cpu size={14} className="text-[#00ff41] mb-2" />
          <p className="text-sm font-bold stat-value-glow">{dailyEarningRate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className="text-[10px] text-gray-600">ETB/day</p>
        </div>
        <div className="premium-card rounded-xl p-3">
          <TrendingUp size={14} className="text-[#00ff41] mb-2" />
          <p className="text-sm font-bold stat-value-glow">{totalEarned.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          <p className="text-[10px] text-gray-600">Total Earned</p>
        </div>
        <div className="premium-card rounded-xl p-3">
          <Layers size={14} className="text-[#00ff41] mb-2" />
          <p className="text-sm font-bold stat-value-glow">{activeInvestments.length}</p>
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
            <span className="text-[8px] font-semibold text-[#00ff41] bg-[rgba(0,255,65,0.1)] rounded-full px-1.5 py-0.5 leading-none">Soon</span>
          </div>
        </Link>
      </div>

      {/* Active Investments */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Active Plans</h2>
          <Badge variant={activeInvestments.length > 0 ? "neon" : "default"}>
            {activeInvestments.length} active
          </Badge>
        </div>

        {activeInvestments.length === 0 ? (
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

        {recentTransactions.length === 0 ? (
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

import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Cpu,
  Layers,
  ChevronRight,
  ArrowDownCircle,
  ArrowUpCircle,
  Server,
  UserPlus,
  LifeBuoy,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";
import { ListPanel } from "@/components/ui/ListPanel.js";
import { ListRow } from "@/components/ui/ListRow.js";
import { EmptyState } from "@/components/ui/EmptyState.js";
import { AmountText } from "@/components/ui/AmountText.js";
import { TxIcon, txTitle, txSubtitle, isOutgoingTx } from "@/components/ui/TransactionHelpers.js";
import { formatDateTime } from "@/lib/format.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import { loadDashboardFn } from "@/lib/server/dashboard.js";
import { getPlansFn } from "@/lib/server/plans.js";
import { getSupportSettingsFn } from "@/lib/server/support-settings.js";
import { withTimeout } from "@/lib/async.js";
import type { Plan } from "@/lib/database.types.js";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});

type DashboardData = Awaited<ReturnType<typeof loadDashboardFn>>;

const DASHBOARD_LOAD_TIMEOUT_MS = 10_000;
const SUPPORT_SETTINGS_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

function formatDashboardAmount(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDashboardEtb(value: number) {
  return `${formatDashboardAmount(value)} ETB`;
}

function CompactMetric({
  label,
  value,
  caption,
  loading,
  icon,
  accent,
}: {
  label: string;
  value: ReactNode;
  caption?: string;
  loading?: boolean;
  icon?: ReactNode;
  accent?: boolean;
}) {
  return (
    <div
      className={[
        "min-w-0 rounded-xl border px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]",
        accent
          ? "border-[rgba(0,255,65,0.15)] bg-[rgba(0,255,65,0.035)]"
          : "border-[rgba(255,255,255,0.07)] bg-[#121212]",
      ].join(" ")}
    >
      <div className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-1.5">
        <p
          className={[
            "col-start-2 truncate text-[9px] uppercase tracking-[0.14em]",
            accent ? "text-[#00ff41]/65" : "text-gray-500",
          ].join(" ")}
        >
          {label}
        </p>
        <span
          className={[
            "col-start-1 row-start-2 mt-0.5 flex h-4 items-center justify-center",
            accent ? "text-[#00ff41]" : "text-[#00ff41]/65",
          ].join(" ")}
        >
          {!loading && icon}
        </span>
        <div
          className={[
            "col-start-2 row-start-2 mt-0.5 min-w-0 truncate font-mono text-sm font-black leading-tight",
            accent ? "text-[#00ff41]" : "text-gray-100",
          ].join(" ")}
        >
          {loading ? <span className="skeleton inline-block h-4 w-14 rounded" /> : value}
        </div>
        {caption && (
          <p
            className={[
              "col-start-2 row-start-3 mt-0.5 truncate text-[9px]",
              accent ? "text-[#00ff41]/45" : "text-gray-700",
            ].join(" ")}
          >
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}

function DashboardPage() {
  const { user, profile } = useAuthStore();
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const walletBalance = useWalletStore((s) => s.balance);
  const setWalletBalance = useWalletStore((s) => s.setBalance);
  const [data, setData] = useState<DashboardData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [supportUrl, setSupportUrl] = useState<string | null>(null);
  const [supportOpening, setSupportOpening] = useState(false);
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

  const loadSupportUrl = useCallback(async () => {
    try {
      const result = await withTimeout(
        getSupportSettingsFn({ data: {} }),
        SUPPORT_SETTINGS_LOAD_TIMEOUT_MS,
        "Support settings request timed out.",
      );
      const url = result.isConfigured ? result.telegramUrl : null;

      if (mountedRef.current) {
        setSupportUrl(url);
      }

      return url;
    } catch (err) {
      console.error("[QHash] Support settings preload failed:", err);
      return null;
    }
  }, []);

  const handleSupportClick = useCallback(async () => {
    if (supportOpening) return;

    if (supportUrl) {
      window.location.assign(supportUrl);
      return;
    }

    setSupportOpening(true);
    const url = await loadSupportUrl();

    if (url) {
      setSupportOpening(false);
      window.location.assign(url);
      return;
    }

    setSupportOpening(false);
    window.location.assign("/support");
  }, [loadSupportUrl, supportOpening, supportUrl]);

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
    void loadSupportUrl();

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer, load, loadSupportUrl]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void load({ resetRetryCount: true });
        void loadSupportUrl();
      }
    };

    const handleOnline = () => {
      void load({ resetRetryCount: true });
      void loadSupportUrl();
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [load, loadSupportUrl]);

  const hasDashboardData = data !== null;
  const wallet = data?.wallet ?? null;
  const activeInvestments = data?.activeInvestments ?? [];
  const completedInvestments = data?.completedInvestments ?? [];
  const incomeSummary = data?.incomeSummary ?? null;
  const recentTransactions = data?.recentTransactions ?? [];
  const balance = walletBalance ?? wallet?.balance ?? null;

  const getPlanName = (planId: string) => {
    const plan = plans.find((p) => p.id === planId);
    return plan?.name ?? "Mining Plan";
  };

  return (
    <div className="space-y-4 stagger-children lg:grid lg:grid-cols-12 lg:gap-5 lg:space-y-0">
      {/* Header */}
      <div className="flex items-end justify-between gap-3 lg:col-span-12">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00ff41]">
            Account Overview
          </p>
          <h1 className="mt-1 text-xl font-bold leading-tight text-gray-100">Dashboard</h1>
          <p className="mt-1 truncate text-xs text-gray-500">
            Welcome back, @{profile?.username ?? "User"}
          </p>
        </div>

        {hasDashboardData && (
          <span className="shrink-0 rounded-full border border-[#1f1f1f] bg-[#111] px-2.5 py-1 text-[10px] text-gray-500">
            {activeInvestments.length > 0 ? "Mining active" : "Ready"}
          </span>
        )}
      </div>

      {/* Balance Card */}
      <div className="relative overflow-hidden rounded-2xl border border-[rgba(0,255,65,0.14)] bg-[#111] p-4 lg:col-span-12 lg:p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(0,255,65,0.5)] to-transparent" />

        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-500">Total Balance</p>
            <p className="mt-1 flex min-h-[34px] items-baseline text-3xl font-black tracking-tight text-gray-100">
              {balance === null ? (
                <span className="skeleton inline-block h-8 w-28 rounded-md" aria-label="Loading balance" />
              ) : (
                formatDashboardAmount(balance)
              )}
              <span className="ml-1.5 text-sm font-normal text-gray-500">ETB</span>
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#1f1f1f] bg-[#0a0a0a] px-2.5 py-1">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                activeInvestments.length > 0 ? "bg-[#00ff41] status-pulse" : "bg-gray-600"
              }`}
            />
            <span className="text-[10px] text-gray-600">
              {activeInvestments.length > 0 ? "Mining active" : "Wallet ready"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Link to="/deposit" className="min-w-0">
            <button className="flex w-full items-center justify-center gap-1 rounded-xl border border-[rgba(0,255,65,0.28)] bg-[rgba(0,255,65,0.88)] px-2 py-2.5 text-[11px] font-bold text-black card-press">
              <ArrowDownCircle size={13} />
              Deposit
            </button>
          </Link>

          <Link to="/withdraw" className="min-w-0">
            <button className="flex w-full items-center justify-center gap-1 rounded-xl border border-[#1f1f1f] bg-[#0d0d0d] px-2 py-2.5 text-[11px] font-semibold text-gray-200 card-press">
              <ArrowUpCircle size={13} />
              Withdraw
            </button>
          </Link>

          <Link to="/plans" className="min-w-0">
            <button className="flex w-full items-center justify-center gap-1 rounded-xl border border-[rgba(0,255,65,0.22)] bg-[rgba(0,255,65,0.08)] px-2 py-2.5 text-[11px] font-semibold text-[#00ff41] card-press">
              <Layers size={13} />
              Buy Plan
            </button>
          </Link>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-2.5 lg:col-span-12">
        <CompactMetric
          label="Today's"
          value={formatDashboardEtb(incomeSummary?.todayTotalIncome ?? 0)}
          caption="Total Income"
          loading={!hasDashboardData}
          icon={<TrendingUp size={13} />}
          accent
        />
        <CompactMetric
          label="All Time"
          value={formatDashboardEtb(incomeSummary?.totalIncome ?? 0)}
          caption="Total Income"
          loading={!hasDashboardData}
          icon={<TrendingUp size={13} />}
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-2.5 lg:col-span-12">
        <QuickActionCard
          to="/referrals"
          icon={<UserPlus size={15} />}
          title="Refer & Earn"
          description="Grow your team"
        />

        {supportUrl ? (
          <QuickActionCard
            href={supportUrl}
            icon={<LifeBuoy size={15} />}
            title="Support"
            description="Get help fast"
          />
        ) : (
          <QuickActionCard
            onClick={handleSupportClick}
            disabled={supportOpening}
            icon={<LifeBuoy size={15} />}
            title="Support"
            description={supportOpening ? "Opening..." : "Get help fast"}
          />
        )}
      </div>

      {/* Active Investments */}
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
            {activeInvestments.map((inv) => {
              const startMs = new Date(inv.start_date).getTime();
              const endMs = new Date(inv.end_date).getTime();
              const nowMs = Date.now();
              const totalMs = endMs - startMs;
              const elapsedMs = Math.min(nowMs - startMs, totalMs);
              const progress = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;
              const clampedProgress = Math.max(0, Math.min(progress, 100));
              const roundedProgress = Math.round(clampedProgress);
              const daysRemaining = Math.max(0, Math.ceil((endMs - nowMs) / (24 * 60 * 60 * 1000)));

              return (
                <div key={inv.id} className="relative overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]">
                        <Cpu size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold leading-tight text-gray-100">{getPlanName(inv.plan_id)}</p>
                        <p className="mt-0.5 truncate text-[10px] text-gray-600">
                          {formatDashboardAmount(inv.daily_earning)} ETB/day · {roundedProgress}% complete
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.05)] px-2 py-0.5 text-[10px] text-[#00ff41]">
                      {daysRemaining}d left
                    </span>
                  </div>

                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#1a1a1a]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#00ff41] to-[#00cc33] transition-all"
                      style={{ width: `${clampedProgress}%` }}
                    />
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-[#181818] bg-[#0a0a0a] px-2.5 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[9px] uppercase tracking-[0.14em] text-gray-600">Invested</p>
                      <p className="mt-0.5 truncate font-mono text-sm font-black leading-tight text-gray-100">
                        {formatDashboardAmount(inv.invested_amount)} <span className="text-[9px] font-normal text-gray-500">ETB</span>
                      </p>
                    </div>

                    <div className="min-w-0 text-center">
                      <p className="truncate text-[9px] uppercase tracking-[0.14em] text-gray-600">Daily</p>
                      <p className="mt-0.5 truncate font-mono text-sm font-black leading-tight text-gray-100">
                        {formatDashboardAmount(inv.daily_earning)} <span className="text-[9px] font-normal text-gray-500">ETB</span>
                      </p>
                    </div>

                    <div className="min-w-0 text-right">
                      <p className="truncate text-[9px] uppercase tracking-[0.14em] text-gray-600">Earned</p>
                      <p className="mt-0.5 truncate font-mono text-sm font-black leading-tight text-[#00ff41]">
                        {formatDashboardAmount(inv.total_earned)} <span className="text-[9px] font-normal text-gray-500">ETB</span>
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent Transactions */}
      <div className={completedInvestments.length > 0 ? "lg:col-span-8" : "lg:col-span-12"}>
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
              const formattedCreatedAt = formatDateTime(tx.created_at);
              const subtitle = txSubtitle(tx, formattedCreatedAt);

              return (
                <ListRow
                  key={tx.id}
                  icon={<TxIcon type={tx.type} />}
                  title={txTitle(tx.type)}
                  description={subtitle}
                  meta={formattedCreatedAt}
                  right={<AmountText value={signedAmount} showSign currency="" size="sm" />}
                />
              );
            })}
          </ListPanel>
        )}
      </div>

      {/* Completed Plans */}
      {completedInvestments.length > 0 && (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-3.5 lg:col-span-4">
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
    </div>
  );
}

type QuickActionCardProps = {
  icon: ReactNode;
  title: string;
  description: string;
  disabled?: boolean;
} & (
  | { to: "/referrals"; href?: never; onClick?: never }
  | { href: string; to?: never; onClick?: never }
  | { onClick: () => void; to?: never; href?: never }
);

function QuickActionCard({
  to,
  href,
  onClick,
  icon,
  title,
  description,
  disabled,
}: QuickActionCardProps) {
  const content = (
    <div className="flex h-full items-center justify-between gap-3 rounded-xl border border-[#1a1a1a] bg-[#111] p-3 card-press">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[rgba(0,255,65,0.08)] text-[#00ff41]">
          {icon}
        </div>

        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-gray-100">{title}</p>
          <p className="mt-0.5 truncate text-[10px] text-gray-600">{description}</p>
        </div>
      </div>

      <ChevronRight size={13} className="shrink-0 text-gray-600" />
    </div>
  );

  if (href) {
    return (
      <a href={href} className="block min-w-0">
        {content}
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="block w-full min-w-0 border-0 bg-transparent p-0 text-left disabled:cursor-wait disabled:opacity-70"
      >
        {content}
      </button>
    );
  }

  return (
    <Link to={to} className="block min-w-0">
      {content}
    </Link>
  );
}

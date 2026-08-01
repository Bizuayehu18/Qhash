import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronRight,
  Layers,
  LifeBuoy,
  TrendingUp,
  UserPlus,
} from "lucide-react";
import { CurrencyUnit } from "@/components/ui/AmountText.js";
import type { DashboardData } from "../../application/dashboard-browser-service.js";
import { formatDashboardAmount } from "./dashboard-format.js";

type DashboardAccountSummaryProps = {
  activeInvestmentCount: number;
  balance: number | null;
  hasDashboardData: boolean;
  incomeSummary: DashboardData["incomeSummary"] | null;
  onOpenSupport: () => void;
  profileUsername: string | null | undefined;
  supportDescription: string;
  supportOpening: boolean;
  supportUrl: string | null;
};

export function DashboardAccountSummary({
  activeInvestmentCount,
  balance,
  hasDashboardData,
  incomeSummary,
  onOpenSupport,
  profileUsername,
  supportDescription,
  supportOpening,
  supportUrl,
}: DashboardAccountSummaryProps) {
  return (
    <>
      <div className="flex items-end justify-between gap-3 lg:col-span-12">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00ff41]">
            Account Overview
          </p>
          <h1 className="mt-1 text-xl font-bold leading-tight text-gray-100">Dashboard</h1>
          <p className="mt-1 truncate text-xs text-gray-500">
            Welcome back, @{profileUsername ?? "User"}
          </p>
        </div>

        {hasDashboardData && (
          <span className="shrink-0 rounded-full border border-[#1f1f1f] bg-[#111] px-2.5 py-1 text-[10px] text-gray-500">
            {activeInvestmentCount > 0 ? "Mining active" : "Ready"}
          </span>
        )}
      </div>

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
              <CurrencyUnit className="ml-1.5 text-[0.48em]" />
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#1f1f1f] bg-[#0a0a0a] px-2.5 py-1">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                activeInvestmentCount > 0 ? "bg-[#00ff41] status-pulse" : "bg-gray-600"
              }`}
            />
            <span className="text-[10px] text-gray-600">
              {activeInvestmentCount > 0 ? "Mining active" : "Wallet ready"}
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

      <div className="grid grid-cols-2 gap-2.5 lg:col-span-12">
        <CompactMetric
          label="Today's"
          value={<DashboardEtb value={incomeSummary?.todayTotalIncome ?? 0} />}
          caption="Total Income"
          loading={!hasDashboardData}
          icon={<TrendingUp size={13} />}
          accent
        />
        <CompactMetric
          label="All Time"
          value={<DashboardEtb value={incomeSummary?.totalIncome ?? 0} />}
          caption="Total Income"
          loading={!hasDashboardData}
          icon={<TrendingUp size={13} />}
        />
      </div>

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
            onClick={onOpenSupport}
            disabled={supportOpening}
            icon={<LifeBuoy size={15} />}
            title="Support"
            description={supportDescription}
          />
        )}
      </div>
    </>
  );
}

function DashboardEtb({ value }: { value: number }) {
  return (
    <>
      {formatDashboardAmount(value)}
      <CurrencyUnit />
    </>
  );
}

function CompactMetric({
  accent,
  caption,
  icon,
  label,
  loading,
  value,
}: {
  accent?: boolean;
  caption?: string;
  icon?: ReactNode;
  label: string;
  loading?: boolean;
  value: ReactNode;
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
        <p className={`col-start-2 truncate text-[9px] uppercase tracking-[0.14em] ${accent ? "text-[#00ff41]/65" : "text-gray-500"}`}>
          {label}
        </p>
        <span className={`col-start-1 row-start-2 mt-0.5 flex h-4 items-center justify-center ${accent ? "text-[#00ff41]" : "text-[#00ff41]/65"}`}>
          {!loading && icon}
        </span>
        <div className={`col-start-2 row-start-2 mt-0.5 min-w-0 truncate font-mono text-sm font-black leading-tight ${accent ? "text-[#00ff41]" : "text-gray-100"}`}>
          {loading ? <span className="skeleton inline-block h-4 w-14 rounded" /> : value}
        </div>
        {caption && (
          <p className={`col-start-2 row-start-3 mt-0.5 truncate text-[9px] ${accent ? "text-[#00ff41]/45" : "text-gray-700"}`}>
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}

type QuickActionCardProps = {
  description: string;
  disabled?: boolean;
  icon: ReactNode;
  title: string;
} & (
  | { to: "/referrals"; href?: never; onClick?: never }
  | { href: string; to?: never; onClick?: never }
  | { onClick: () => void; to?: never; href?: never }
);

function QuickActionCard({
  description,
  disabled,
  href,
  icon,
  onClick,
  title,
  to,
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
    return <a href={href} className="block min-w-0">{content}</a>;
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
  return <Link to={to!} className="block min-w-0">{content}</Link>;
}

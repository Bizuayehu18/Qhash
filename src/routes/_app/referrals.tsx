import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Users,
  UserCheck,
  Copy,
  Check,
  Link2,
  TrendingUp,
  ChevronRight,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore.js";
import { Card } from "@/components/ui/Card.js";
import { EmptyState } from "@/components/ui/EmptyState.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";
import { loadReferralStatsFn } from "@/lib/server/referrals.js";
import { withTimeout } from "@/lib/async.js";

export const Route = createFileRoute("/_app/referrals")({
  component: ReferralsPage,
});

type ReferralLevel = 1 | 2 | 3;
type ReferralLevelFilter = "all" | ReferralLevel;

interface ReferralMember {
  id: string;
  name: string | null;
  level: number;
  joinedAt: string;
  isActive: boolean;
}

interface ReferralStats {
  total: number;
  active: number;
  earned: number;
  todayRewards: number;
  members: ReferralMember[];
}

interface LevelCounts {
  all: number;
  1: number;
  2: number;
  3: number;
}

const EMPTY_REFERRAL_STATS: ReferralStats = {
  total: 0,
  active: 0,
  earned: 0,
  todayRewards: 0,
  members: [],
};

const TEAM_FILTERS: Array<{ label: string; value: ReferralLevelFilter }> = [
  { label: "All", value: "all" },
  { label: "L1", value: 1 },
  { label: "L2", value: 2 },
  { label: "L3", value: 3 },
];

const REFERRAL_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

function useReferralData() {
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const [stats, setStats] = useState<ReferralStats>(EMPTY_REFERRAL_STATS);
  const [statsLoaded, setStatsLoaded] = useState(false);
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

  const scheduleRetry = useCallback(
    (loadFn: () => void) => {
      clearRetryTimer();

      if (retryCountRef.current >= MAX_AUTO_RETRIES) return;

      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(loadFn, AUTO_RETRY_DELAY_MS);
    },
    [clearRetryTimer],
  );

  const load = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (loadingRef.current) return;

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (!user || !accessToken) {
        setStats(EMPTY_REFERRAL_STATS);
        setStatsLoaded(false);
        return;
      }

      clearRetryTimer();
      loadingRef.current = true;

      try {
        const result = await withTimeout(
          loadReferralStatsFn({ data: { accessToken } }),
          REFERRAL_LOAD_TIMEOUT_MS,
          "Team stats request timed out.",
        );

        if (!mountedRef.current) return;

        setStats({
          total: result.total,
          active: result.active,
          earned: result.earned,
          todayRewards: result.todayRewards ?? 0,
          members: Array.isArray(result.members) ? result.members : [],
        });
        setStatsLoaded(true);
        retryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Referral stats background refresh failed:", err);

        if (!mountedRef.current) return;

        scheduleRetry(() => {
          void load();
        });
      } finally {
        loadingRef.current = false;
      }
    },
    [accessToken, clearRetryTimer, scheduleRetry, user],
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

  return {
    stats,
    statsLoaded,
    username: profile?.username ?? null,
  };
}

function ReferralsPage() {
  const { stats, statsLoaded, username } = useReferralData();
  const [copied, setCopied] = useState(false);
  const [teamLevelFilter, setTeamLevelFilter] = useState<ReferralLevelFilter>("all");

  const referralLink =
    username && typeof window !== "undefined"
      ? `${window.location.origin}/register?ref=${username}`
      : null;

  function handleCopy() {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const hasNoReferrals = statsLoaded && stats.total === 0;
  const levelCounts = getLevelCounts(stats.members);
  const filteredMembers = filterMembersByLevel(stats.members, teamLevelFilter);

  return (
    <div className="space-y-5 lg:mx-auto lg:grid lg:max-w-4xl lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0">
      <div className="lg:col-span-12">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
          Affiliate Program
        </p>
        <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">
          Team
        </h1>
        <p className="mt-1 text-xs text-gray-500">
          Invite friends, grow your mining team, and earn rewards automatically.
        </p>
      </div>

      <Card neon className="lg:col-span-12">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link2 size={16} className="text-[#00ff41]" />
              <span className="text-xs font-semibold uppercase tracking-wider text-[#00ff41]">
                Your Referral Link
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
              Share this link with friends. When they join and invest, eligible rewards are added to your account.
            </p>
          </div>
        </div>

        {username ? (
          <>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex-1 truncate rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2.5 font-mono text-xs text-gray-300">
                {referralLink}
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-[#00ff41] transition-all active:scale-95"
                aria-label="Copy referral link"
              >
                {copied ? (
                  <Check size={16} className="text-black" />
                ) : (
                  <Copy size={16} className="text-black" />
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] text-gray-600">Referral code:</span>
              <span className="rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-2 py-1 font-mono text-xs text-gray-400">
                {username}
              </span>
              {copied && (
                <span className="text-[10px] font-semibold text-[#00ff41]">
                  Copied
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-500">
            Your referral code is being set up. Please try again shortly.
          </p>
        )}
      </Card>

      <div className="space-y-3 lg:col-span-4">
        <TeamOverviewCard stats={stats} loading={!statsLoaded} />

        {hasNoReferrals && (
          <Card padding="none">
            <EmptyState
              icon={<Users size={22} />}
              title="Start building your team"
              description="Copy your referral link and share it with friends to begin earning from eligible activity."
              className="px-4 py-8"
            />
          </Card>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:col-span-8">
        <div className="order-0 lg:order-none">
          <MyTeamCard
            members={filteredMembers}
            totalMembers={stats.members.length}
            levelCounts={levelCounts}
            activeFilter={teamLevelFilter}
            onFilterChange={setTeamLevelFilter}
            loading={!statsLoaded}
          />
        </div>

        <div className="order-1 lg:order-none">
          <HowRewardsCard />
        </div>

        <Card className="order-2 lg:order-none">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-100">Reward History</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                Referral bonuses also appear in your transaction history.
              </p>
            </div>
            <Link
              to="/transactions"
              className="flex shrink-0 items-center gap-0.5 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-2.5 py-1.5 text-[10px] font-semibold text-gray-400 card-press hover:text-white"
            >
              View <ChevronRight size={12} />
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}

function TeamOverviewCard({
  stats,
  loading,
}: {
  stats: ReferralStats;
  loading: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-100">Team Overview</p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-600">
            Your referral rewards and team activity.
          </p>
        </div>

        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[rgba(0,255,65,0.08)] text-[#00ff41]">
          <TrendingUp size={15} />
        </div>
      </div>

      <div className="rounded-xl border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.06)] p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#00ff41]">
              Today&apos;s Rewards
            </p>
            <p className="mt-0.5 text-[10px] text-gray-500">
              From your team today
            </p>
          </div>

          <div className="shrink-0 text-right">
            {loading ? (
              <span className="skeleton inline-block h-6 w-24 rounded" aria-label="Loading today's rewards" />
            ) : (
              <span className="font-mono text-lg font-black leading-none text-[#00ff41]">
                {formatEtb(stats.todayRewards)}
              </span>
            )}
          </div>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-[#0a0a0a]">
          <div className="h-full w-2/3 rounded-full bg-[#00ff41]" />
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#0a0a0a]">
        <OverviewRow
          label="Total Earned"
          value={formatEtb(stats.earned)}
          loading={loading}
          accent
        />

        <div className="grid grid-cols-2 divide-x divide-[#141414] border-t border-[#141414]">
          <OverviewMiniMetric
            icon={<Users size={14} />}
            label="Total Team"
            value={stats.total}
            loading={loading}
          />

          <OverviewMiniMetric
            icon={<UserCheck size={14} />}
            label="Active Team"
            value={stats.active}
            loading={loading}
            accent
          />
        </div>
      </div>
    </Card>
  );
}

function OverviewRow({
  label,
  value,
  loading,
  accent,
}: {
  label: string;
  value: string;
  loading: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="text-[11px] text-gray-500">{label}</span>
      {loading ? (
        <span className="skeleton h-4 w-20 rounded" aria-label={`Loading ${label}`} />
      ) : (
        <span className={`shrink-0 font-mono text-xs font-semibold ${accent ? "text-[#00ff41]" : "text-gray-200"}`}>
          {value}
        </span>
      )}
    </div>
  );
}

function OverviewMiniMetric({
  icon,
  label,
  value,
  loading,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  loading: boolean;
  accent?: boolean;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className={`mb-1 ${accent ? "text-[#00ff41]" : "text-gray-500"}`}>
        {icon}
      </div>
      {loading ? (
        <span className="skeleton inline-block h-4 w-8 rounded" aria-label={`Loading ${label}`} />
      ) : (
        <p className={`font-mono text-base font-bold leading-none ${accent ? "text-[#00ff41]" : "text-gray-100"}`}>
          {value}
        </p>
      )}
      <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-gray-600">
        {label}
      </p>
    </div>
  );
}

function HowRewardsCard() {
  return (
    <Card>
      <SectionHeader
        title="How Team Rewards Work"
        description="Earn from both plan purchases and daily mining rewards in your team."
        className="mb-4"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <RewardSourceCard
          title="Plan Purchase Reward"
          description="Earn when someone in your team buys a mining plan."
        />
        <RewardSourceCard
          title="Daily Mining Reward"
          description="Earn when someone in your team receives daily mining income."
        />
      </div>

      <div className="mt-4 space-y-2.5">
        <TierRow level={1} label="Direct referrals" rate="5%" />
        <TierRow level={2} label="Level 2 team" rate="3%" />
        <TierRow level={3} label="Level 3 team" rate="2%" />
      </div>

      <div className="mt-4 rounded-lg border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.05)] px-3 py-2.5">
        <p className="text-[10px] leading-relaxed text-gray-400">
          Keep an active mining plan to receive eligible team rewards.
        </p>
      </div>
    </Card>
  );
}

function RewardSourceCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] p-3">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
        <TrendingUp size={15} />
      </div>
      <p className="text-xs font-semibold text-gray-100">{title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{description}</p>
    </div>
  );
}

function MyTeamCard({
  members,
  totalMembers,
  levelCounts,
  activeFilter,
  onFilterChange,
  loading,
}: {
  members: ReferralMember[];
  totalMembers: number;
  levelCounts: LevelCounts;
  activeFilter: ReferralLevelFilter;
  onFilterChange: (value: ReferralLevelFilter) => void;
  loading: boolean;
}) {
  return (
    <Card>
      <SectionHeader
        title="My Team"
        description="Filter team members by level."
        className="mb-3"
      />

      <TeamLevelFilters
        counts={levelCounts}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
        disabled={loading}
      />

      <p className="mb-3 text-[10px] leading-relaxed text-gray-600">
        <span className="font-semibold text-gray-400">Active</span> = member has a running mining contract.
      </p>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-2">
                  <div className="skeleton h-4 w-24 rounded" />
                  <div className="skeleton h-3 w-32 rounded" />
                </div>
                <div className="skeleton h-6 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : totalMembers === 0 ? (
        <EmptyState
          icon={<Users size={22} />}
          title="No team members yet"
          description="Share your referral link to start building your team."
          className="px-4 py-8"
        />
      ) : members.length === 0 ? (
        <EmptyState
          icon={<Users size={22} />}
          title="No members in this level"
          description="Choose another level filter to view more team members."
          className="px-4 py-8"
        />
      ) : (
        <div className="space-y-2">
          {members.map((member) => (
            <TeamMemberRow key={member.id} member={member} />
          ))}
        </div>
      )}
    </Card>
  );
}

function TeamLevelFilters({
  counts,
  activeFilter,
  onFilterChange,
  disabled,
}: {
  counts: LevelCounts;
  activeFilter: ReferralLevelFilter;
  onFilterChange: (value: ReferralLevelFilter) => void;
  disabled: boolean;
}) {
  return (
    <div className="mb-2 grid grid-cols-4 gap-1.5 rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] p-1">
      {TEAM_FILTERS.map((filter) => {
        const active = activeFilter === filter.value;
        const count = getFilterCount(counts, filter.value);

        return (
          <button
            key={filter.label}
            type="button"
            disabled={disabled}
            onClick={() => onFilterChange(filter.value)}
            className={[
              "flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? "bg-[#00ff41] text-black"
                : "bg-[#111] text-gray-500 hover:text-gray-200",
            ].join(" ")}
          >
            <span>{filter.label}</span>
            <span className={active ? "text-black/70" : "text-gray-700"}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TeamMemberRow({ member }: { member: ReferralMember }) {
  const displayName = member.name ? `@${member.name}` : "Team member";

  return (
    <div className="rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-100">{displayName}</p>
          <p className="mt-1 text-[10px] text-gray-600">
            Level {member.level} · Joined {formatJoinedDate(member.joinedAt)}
          </p>
        </div>
        <span
          className={[
            "shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold",
            member.isActive
              ? "border-[rgba(0,255,65,0.25)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
              : "border-[#2a2a2a] bg-[#111] text-gray-500",
          ].join(" ")}
        >
          {member.isActive ? "Active" : "Inactive"}
        </span>
      </div>
    </div>
  );
}

function TierRow({
  level,
  label,
  rate,
}: {
  level: number;
  label: string;
  rate: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-[#0a0a0a] px-3 py-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(0,255,65,0.2)] bg-[rgba(0,255,65,0.08)]">
        <span className="text-[10px] font-bold text-[#00ff41]">L{level}</span>
      </div>
      <span className="flex-1 text-xs text-gray-300">{label}</span>
      <div className="flex items-center gap-1">
        <span className="text-sm font-bold text-[#00ff41]">{rate}</span>
        <ChevronRight size={12} className="text-gray-600" />
      </div>
    </div>
  );
}

function getLevelCounts(members: ReferralMember[]): LevelCounts {
  return members.reduce<LevelCounts>(
    (counts, member) => {
      if (member.level === 1 || member.level === 2 || member.level === 3) {
        counts[member.level] += 1;
      }

      return counts;
    },
    {
      all: members.length,
      1: 0,
      2: 0,
      3: 0,
    },
  );
}

function getFilterCount(counts: LevelCounts, filter: ReferralLevelFilter): number {
  return filter === "all" ? counts.all : counts[filter];
}

function filterMembersByLevel(
  members: ReferralMember[],
  filter: ReferralLevelFilter,
): ReferralMember[] {
  if (filter === "all") return members;
  return members.filter((member) => member.level === filter);
}

function formatEtb(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  return `${amount.toFixed(2)} ETB`;
}

function formatJoinedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

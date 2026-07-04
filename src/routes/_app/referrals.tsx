import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Users,
  Copy,
  Check,
  Link2,
  TrendingUp,
  ChevronRight,
  Gift,
  Activity,
  ShieldCheck,
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
const TEAM_PREVIEW_LIMIT = 4;

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

    navigator.clipboard
      .writeText(referralLink)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((err) => {
        console.error("[QHash] Failed to copy referral link:", err);
      });
  }

  const levelCounts = getLevelCounts(stats.members);
  const filteredMembers = filterMembersByLevel(stats.members, teamLevelFilter);

  return (
    <div className="space-y-4 lg:mx-auto lg:grid lg:max-w-5xl lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0">
      <div className="lg:col-span-12">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
          Affiliate Program
        </p>
        <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">
          Team
        </h1>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          Invite friends, grow your mining team, and earn rewards automatically.
        </p>
      </div>

      <RewardsOverviewCard stats={stats} loading={!statsLoaded} />

      <ReferralLinkCard
        username={username}
        referralLink={referralLink}
        copied={copied}
        onCopy={handleCopy}
      />

      <div className="lg:col-span-7">
        <MyTeamCard
          members={filteredMembers}
          totalMembers={stats.members.length}
          activeMembers={stats.active}
          levelCounts={levelCounts}
          activeFilter={teamLevelFilter}
          onFilterChange={setTeamLevelFilter}
          loading={!statsLoaded}
        />
      </div>

      <div className="space-y-4 lg:col-span-5">
        <RewardRatesCard />
        <RewardHistoryCard />
      </div>
    </div>
  );
}

function RewardsOverviewCard({
  stats,
  loading,
}: {
  stats: ReferralStats;
  loading: boolean;
}) {
  return (
    <Card neon padding="sm" className="lg:col-span-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TrendingUp size={15} className="text-[#00ff41]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#00ff41]">
              Team Rewards
            </p>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-600">
            Today&apos;s referral income
          </p>
        </div>

        <div className="shrink-0 text-right">
          {loading ? (
            <span
              className="skeleton inline-block h-6 w-24 rounded"
              aria-label="Loading today's rewards"
            />
          ) : (
            <span className="font-mono text-xl font-black leading-none text-[#00ff41]">
              {formatEtb(stats.todayRewards)}
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <RewardMetricTile
          label="Total"
          value={formatEtb(stats.earned)}
          caption="Earned"
          loading={loading}
          accent
        />
        <RewardMetricTile
          label="Team"
          value={stats.total.toString()}
          caption="Members"
          loading={loading}
        />
        <RewardMetricTile
          label="Active"
          value={stats.active.toString()}
          caption="Mining"
          loading={loading}
        />
      </div>
    </Card>
  );
}

function RewardMetricTile({
  label,
  value,
  caption,
  loading,
  accent,
}: {
  label: string;
  value: string;
  caption: string;
  loading: boolean;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] px-2.5 py-2">
      <p className="truncate text-[9px] uppercase tracking-[0.12em] text-gray-600">
        {label}
      </p>
      {loading ? (
        <span
          className="mt-1 inline-block h-4 w-12 rounded skeleton"
          aria-label={`Loading ${label}`}
        />
      ) : (
        <p
          className={`mt-0.5 truncate font-mono text-xs font-black ${
            accent ? "text-[#00ff41]" : "text-gray-100"
          }`}
        >
          {value}
        </p>
      )}
      <p className="mt-0.5 truncate text-[9px] text-gray-700">{caption}</p>
    </div>
  );
}

function ReferralLinkCard({
  username,
  referralLink,
  copied,
  onCopy,
}: {
  username: string | null;
  referralLink: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <Card padding="sm" className="lg:col-span-7">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link2 size={15} className="text-[#00ff41]" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#00ff41]">
              Referral Link
            </p>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-600">
            Share your invite link and grow your team.
          </p>
        </div>

        {username && (
          <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-2 py-1">
            <span className="text-[9px] text-gray-700">Code</span>
            <span className="font-mono text-[10px] text-gray-300">{username}</span>
          </div>
        )}
      </div>

      {username ? (
        <>
          <div className="mt-3 flex items-center gap-2">
            <div className="min-w-0 flex-1 truncate rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2.5 font-mono text-[11px] text-gray-300">
              {referralLink}
            </div>
            <button
              type="button"
              onClick={onCopy}
              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-[rgba(0,255,65,0.28)] bg-[#00ff41] transition-all active:scale-95"
              aria-label="Copy referral link"
            >
              {copied ? (
                <Check size={16} className="text-black" />
              ) : (
                <Copy size={16} className="text-black" />
              )}
            </button>
          </div>

          <div className="mt-2 flex min-h-4 items-center">
            {copied && (
              <p className="text-[10px] font-semibold text-[#00ff41]">
                Referral link copied
              </p>
            )}
          </div>
        </>
      ) : (
        <p className="mt-3 text-xs text-gray-500">
          Your referral code is being set up. Please try again shortly.
        </p>
      )}
    </Card>
  );
}

function MyTeamCard({
  members,
  totalMembers,
  activeMembers,
  levelCounts,
  activeFilter,
  onFilterChange,
  loading,
}: {
  members: ReferralMember[];
  totalMembers: number;
  activeMembers: number;
  levelCounts: LevelCounts;
  activeFilter: ReferralLevelFilter;
  onFilterChange: (value: ReferralLevelFilter) => void;
  loading: boolean;
}) {
  const [showAllMembers, setShowAllMembers] = useState(false);

  useEffect(() => {
    setShowAllMembers(false);
  }, [activeFilter]);

  const hasMoreMembers = members.length > TEAM_PREVIEW_LIMIT;
  const visibleMembers = showAllMembers ? members : members.slice(0, TEAM_PREVIEW_LIMIT);

  return (
    <Card>
      <SectionHeader
        title="My Team"
        description="Filter team members by level."
        action={
          <span className="rounded-full border border-[#1f1f1f] bg-[#0a0a0a] px-2 py-0.5 text-[10px] text-gray-500">
            {loading ? "Loading" : `${totalMembers} total · ${activeMembers} active`}
          </span>
        }
        className="mb-3"
      />

      <TeamLevelFilters
        counts={levelCounts}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
        disabled={loading}
      />

      <p className="mb-3 text-[10px] leading-relaxed text-gray-600">
        <span className="font-semibold text-gray-400">Active</span> means the
        member has a running mining contract.
      </p>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="skeleton h-7 w-7 rounded-lg" />
                  <div className="space-y-2">
                    <div className="skeleton h-3.5 w-24 rounded" />
                    <div className="skeleton h-3 w-28 rounded" />
                  </div>
                </div>
                <div className="skeleton h-5 w-14 rounded-full" />
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
          {visibleMembers.map((member) => (
            <TeamMemberRow key={member.id} member={member} />
          ))}

          {hasMoreMembers && (
            <button
              type="button"
              onClick={() => setShowAllMembers((current) => !current)}
              className="mt-1 w-full rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 text-[10px] font-semibold text-gray-400 transition hover:text-gray-100 active:scale-[0.99]"
            >
              {showAllMembers ? "Show less" : `See more (${members.length - TEAM_PREVIEW_LIMIT})`}
            </button>
          )}
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
            aria-pressed={active}
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
    <div className="rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.06)]">
            <span className="text-[9px] font-bold text-[#00ff41]">
              L{member.level}
            </span>
          </div>

          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-gray-100">
              {displayName}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-gray-600">
              Joined {formatJoinedDate(member.joinedAt)}
            </p>
          </div>
        </div>

        <span
          className={[
            "shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold",
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

function RewardRatesCard() {
  return (
    <Card padding="sm">
      <SectionHeader
        title="Reward Rates"
        description="Earn from plan purchases and daily mining rewards."
        className="mb-3"
      />

      <div className="grid grid-cols-2 gap-2">
        <RewardTypeCard
          icon={<Gift size={13} />}
          title="Plan Purchase"
          description="When your team buys a plan"
        />
        <RewardTypeCard
          icon={<Activity size={13} />}
          title="Daily Mining"
          description="When your team earns daily"
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <RateTile level={1} label="Direct" rate="5%" />
        <RateTile level={2} label="Level 2" rate="3%" />
        <RateTile level={3} label="Level 3" rate="2%" />
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-xl border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.05)] px-3 py-2">
        <ShieldCheck size={13} className="mt-0.5 shrink-0 text-[#00ff41]" />
        <p className="text-[10px] leading-relaxed text-gray-400">
          Keep an active mining plan to receive eligible team rewards.
        </p>
      </div>
    </Card>
  );
}

function RewardTypeCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2.5">
      <div className="flex items-center gap-2 text-[#00ff41]">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.06)]">
          {icon}
        </span>
        <p className="truncate text-[11px] font-semibold text-gray-100">{title}</p>
      </div>
      <p className="mt-1 text-[9px] leading-relaxed text-gray-600">{description}</p>
    </div>
  );
}

function RateTile({
  level,
  label,
  rate,
}: {
  level: number;
  label: string;
  rate: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[rgba(0,255,65,0.2)] bg-[rgba(0,255,65,0.08)] text-[9px] font-bold text-[#00ff41]">
          L{level}
        </span>
        <span className="font-mono text-sm font-black text-[#00ff41]">{rate}</span>
      </div>
      <p className="mt-1 truncate text-[9px] text-gray-500">{label}</p>
    </div>
  );
}

function RewardHistoryCard() {
  return (
    <Card padding="sm">
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

  return `${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ETB`;
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

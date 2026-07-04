import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Users,
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
const TEAM_PREVIEW_LIMIT = 6;

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

      <Card neon padding="sm" className="lg:col-span-12">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link2 size={15} className="text-[#00ff41]" />
              <span className="text-xs font-semibold uppercase tracking-wider text-[#00ff41]">
                Your Referral Link
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
              Share your link to grow your team.
            </p>
          </div>
        </div>

        {username ? (
          <>
            <div className="mb-2 flex items-center gap-2">
              <div className="flex-1 truncate rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] text-gray-300">
                {referralLink}
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-[#00ff41] transition-all active:scale-95"
                aria-label="Copy referral link"
              >
                {copied ? (
                  <Check size={15} className="text-black" />
                ) : (
                  <Copy size={15} className="text-black" />
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] text-gray-600">Code:</span>
              <span className="rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-2 py-0.5 font-mono text-[11px] text-gray-400">
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

      <ReferralStatsTiles stats={stats} loading={!statsLoaded} />

      <div className="lg:col-span-8">
        <MyTeamCard
          members={filteredMembers}
          totalMembers={stats.members.length}
          levelCounts={levelCounts}
          activeFilter={teamLevelFilter}
          onFilterChange={setTeamLevelFilter}
          loading={!statsLoaded}
        />
      </div>

      <div className="space-y-3 lg:col-span-4">
        <HowRewardsCard />

        <Card>
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

function ReferralStatsTiles({
  stats,
  loading,
}: {
  stats: ReferralStats;
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:col-span-12 lg:grid-cols-4">
      <ReferralStatTile
        label="Today's"
        value={formatEtb(stats.todayRewards)}
        caption="Referral income"
        icon={<TrendingUp size={13} />}
        loading={loading}
        accent
      />
      <ReferralStatTile
        label="Total"
        value={formatEtb(stats.earned)}
        caption="Referral income"
        icon={<TrendingUp size={13} />}
        loading={loading}
      />
      <ReferralStatTile
        label="Team"
        value={stats.total.toString()}
        caption="Members"
        icon={<Users size={13} />}
        loading={loading}
      />
      <ReferralStatTile
        label="Active"
        value={stats.active.toString()}
        caption="Members"
        icon={<Check size={13} />}
        loading={loading}
      />
    </div>
  );
}

function ReferralStatTile({
  label,
  value,
  caption,
  icon,
  loading,
  accent,
}: {
  label: string;
  value: string;
  caption: string;
  icon: ReactNode;
  loading: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={[
        "min-w-0 rounded-xl border bg-[#111] px-3 py-2.5",
        accent ? "border-[rgba(0,255,65,0.18)]" : "border-[#1a1a1a]",
      ].join(" ")}
    >
      <div className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-1.5">
        <p className="col-start-2 truncate text-[9px] uppercase tracking-[0.14em] text-gray-600">
          {label}
        </p>
        <span className="col-start-1 row-start-2 mt-0.5 flex h-4 items-center justify-center text-[#00ff41]">
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
        <p className="col-start-2 row-start-3 mt-0.5 truncate text-[9px] text-gray-700">
          {caption}
        </p>
      </div>
    </div>
  );
}

function HowRewardsCard() {
  return (
    <Card padding="sm">
      <SectionHeader
        title="How Team Rewards Work"
        description="Both reward types use L1 5%, L2 3%, and L3 2%."
        className="mb-3"
      />

      <div className="space-y-2">
        <RewardSourceRow
          title="Plan Purchase Reward"
          description="Earn when someone in your team buys a mining plan."
        />
        <RewardSourceRow
          title="Daily Mining Reward"
          description="Earn when someone in your team receives daily mining income."
        />
      </div>

      <div className="mt-3 space-y-2">
        <TierRow level={1} label="Direct referrals" rate="5%" />
        <TierRow level={2} label="Level 2 team" rate="3%" />
        <TierRow level={3} label="Level 3 team" rate="2%" />
      </div>

      <div className="mt-3 rounded-lg border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.05)] px-3 py-2">
        <p className="text-[10px] leading-relaxed text-gray-400">
          Keep an active mining plan to receive eligible team rewards.
        </p>
      </div>
    </Card>
  );
}

function RewardSourceRow({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
        <TrendingUp size={13} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-100">{title}</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">{description}</p>
      </div>
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
    <div className="flex items-center gap-2.5 rounded-lg bg-[#0a0a0a] px-3 py-2">
      <div className="flex h-6 w-6 items-center justify-center rounded-full border border-[rgba(0,255,65,0.2)] bg-[rgba(0,255,65,0.08)]">
        <span className="text-[10px] font-bold text-[#00ff41]">L{level}</span>
      </div>
      <span className="flex-1 text-xs text-gray-300">{label}</span>
      <span className="text-sm font-bold text-[#00ff41]">{rate}</span>
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

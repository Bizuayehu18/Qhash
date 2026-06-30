import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
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

interface ReferralMember {
  id: string;
  name: string | null;
  level: number;
  joinedAt: string;
  isActive: boolean;
  totalRewards: number;
}

interface ReferralStats {
  total: number;
  active: number;
  earned: number;
  investmentRewards: number;
  miningRewards: number;
  members: ReferralMember[];
}

const EMPTY_REFERRAL_STATS: ReferralStats = {
  total: 0,
  active: 0,
  earned: 0,
  investmentRewards: 0,
  miningRewards: 0,
  members: [],
};

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
          investmentRewards: result.investmentRewards ?? 0,
          miningRewards: result.miningRewards ?? 0,
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

      <HowItWorksCard />

      <div className="space-y-3 lg:col-span-4">
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
          <StatCard
            icon={<Users size={18} />}
            label="Total"
            value={stats.total}
            description="People who joined from your link"
            loading={!statsLoaded}
          />
          <StatCard
            icon={<UserCheck size={18} />}
            label="Active"
            value={stats.active}
            description="Invited users with active mining"
            accent
            loading={!statsLoaded}
          />
          <StatCard
            icon={<TrendingUp size={18} />}
            label="Earned"
            value={formatEtb(stats.earned)}
            description="Total referral rewards"
            accent
            loading={!statsLoaded}
          />
        </div>

        <RewardBreakdownCard stats={stats} loading={!statsLoaded} />

        <Card padding="sm">
          <p className="text-[10px] leading-relaxed text-gray-500">
            <span className="font-semibold text-gray-300">Active</span> means an invited user currently has a running mining contract.
          </p>
        </Card>

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
        <div className="order-1 lg:order-none">
          <HowRewardsCard />
        </div>

        <div className="order-0 lg:order-none">
          <MyTeamCard members={stats.members} loading={!statsLoaded} />
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

function HowItWorksCard() {
  return (
    <Card padding="sm" className="lg:col-span-12">
      <div className="mb-3">
        <p className="text-sm font-semibold text-gray-100">How It Works</p>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
          Invite, build your team, and earn rewards.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <CompactStepRow
          icon={<Copy size={14} />}
          step="1"
          title="Share your link"
          description="Invite friends with your referral link."
        />
        <CompactStepRow
          icon={<UserCheck size={14} />}
          step="2"
          title="Build your team"
          description="New users who register through your link join your team."
        />
        <CompactStepRow
          icon={<TrendingUp size={14} />}
          step="3"
          title="Earn rewards"
          description="Receive rewards from team purchases and daily mining."
        />
      </div>
    </Card>
  );
}

function HowRewardsCard() {
  return (
    <Card>
      <SectionHeader
        title="How Team Rewards Work"
        description="The same level rates apply to plan purchase rewards and daily mining rewards."
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

function RewardBreakdownCard({ stats, loading }: { stats: ReferralStats; loading: boolean }) {
  return (
    <Card padding="sm">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Reward Breakdown
      </p>
      <div className="space-y-2">
        <BreakdownRow
          label="Plan purchase rewards"
          value={formatEtb(stats.investmentRewards)}
          loading={loading}
        />
        <BreakdownRow
          label="Daily mining rewards"
          value={formatEtb(stats.miningRewards)}
          loading={loading}
        />
      </div>
    </Card>
  );
}

function BreakdownRow({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-[#0a0a0a] px-3 py-2">
      <span className="text-[11px] text-gray-500">{label}</span>
      {loading ? (
        <span className="skeleton h-4 w-16 rounded" aria-label={`Loading ${label}`} />
      ) : (
        <span className="shrink-0 text-xs font-semibold text-gray-200">{value}</span>
      )}
    </div>
  );
}

function MyTeamCard({ members, loading }: { members: ReferralMember[]; loading: boolean }) {
  return (
    <Card>
      <SectionHeader
        title="My Team"
        description="See your team members, activity status, and total rewards."
        className="mb-4"
      />

      {loading ? (
        <div className="space-y-2.5">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="space-y-2">
                  <div className="skeleton h-4 w-24 rounded" />
                  <div className="skeleton h-3 w-32 rounded" />
                </div>
                <div className="skeleton h-6 w-16 rounded-full" />
              </div>
              <div className="skeleton h-4 w-40 rounded" />
            </div>
          ))}
        </div>
      ) : members.length === 0 ? (
        <EmptyState
          icon={<Users size={22} />}
          title="No team members yet"
          description="Share your referral link to start building your team."
          className="px-4 py-8"
        />
      ) : (
        <div className="space-y-2.5">
          {members.map((member) => (
            <TeamMemberRow key={member.id} member={member} />
          ))}
        </div>
      )}
    </Card>
  );
}

function TeamMemberRow({ member }: { member: ReferralMember }) {
  const displayName = member.name ? `@${member.name}` : "Team member";

  return (
    <div className="rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] p-3">
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
          {member.isActive ? "Active" : "Not active"}
        </span>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Total rewards:{" "}
        <span className="font-semibold text-[#00ff41]">
          {formatEtb(member.totalRewards)}
        </span>
      </p>
    </div>
  );
}

function CompactStepRow({
  icon,
  step,
  title,
  description,
}: {
  icon: React.ReactNode;
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-gray-600">0{step}</span>
          <p className="text-xs font-semibold text-gray-100">{title}</p>
        </div>
        <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">
          {description}
        </p>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  description,
  accent,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  description?: string;
  accent?: boolean;
  loading?: boolean;
}) {
  return (
    <Card padding="sm">
      <div className="flex flex-col items-center gap-1.5 py-1 text-center">
        <div className={accent ? "text-[#00ff41]" : "text-gray-500"}>
          {icon}
        </div>
        <span className={`text-base font-bold ${accent ? "text-[#00ff41]" : "text-gray-100"}`}>
          {loading ? (
            <span className="skeleton inline-block h-5 w-12 rounded" aria-label={`Loading ${label}`} />
          ) : (
            value
          )}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-gray-600">
          {label}
        </span>
        {description && (
          <span className="hidden text-[10px] leading-relaxed text-gray-600 lg:block">
            {description}
          </span>
        )}
      </div>
    </Card>
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

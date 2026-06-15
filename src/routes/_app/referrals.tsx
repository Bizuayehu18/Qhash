import { createFileRoute } from "@tanstack/react-router";
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
import { loadReferralStatsFn } from "@/lib/server/referrals.js";
import { withTimeout } from "@/lib/async.js";

export const Route = createFileRoute("/_app/referrals")({
  component: ReferralsPage,
});

interface ReferralStats {
  total: number;
  active: number;
  earned: number;
}

const EMPTY_REFERRAL_STATS: ReferralStats = {
  total: 0,
  active: 0,
  earned: 0,
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

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Team</h1>
        <p className="text-xs text-gray-500 mt-1">
          Invite friends, earn commissions
        </p>
      </div>

      <Card neon>
        <div className="flex items-center gap-2 mb-3">
          <Link2 size={16} className="text-[#00ff41]" />
          <span className="text-xs font-semibold text-[#00ff41] uppercase tracking-wider">
            Your Referral Link
          </span>
        </div>

        {username ? (
          <>
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 bg-[#0a0a0a] border border-[#1f1f1f] rounded-lg px-3 py-2.5 text-xs text-gray-300 truncate font-mono">
                {referralLink}
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="shrink-0 h-10 w-10 rounded-lg bg-[#00ff41] flex items-center justify-center transition-all active:scale-95 cursor-pointer"
              >
                {copied ? (
                  <Check size={16} className="text-black" />
                ) : (
                  <Copy size={16} className="text-black" />
                )}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-600">Referral code:</span>
              <span className="text-xs font-mono text-gray-400">{username}</span>
            </div>
          </>
        ) : (
          <p className="text-xs text-gray-500">
            Your referral code is being set up. Please try again shortly.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <StatCard icon={<Users size={18} />} label="Total" value={stats.total} loading={!statsLoaded} />
        <StatCard icon={<UserCheck size={18} />} label="Active" value={stats.active} accent loading={!statsLoaded} />
        <StatCard
          icon={<TrendingUp size={18} />}
          label="Earned"
          value={`$${stats.earned.toFixed(2)}`}
          accent
          loading={!statsLoaded}
        />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-gray-100">
            Commission Tiers
          </span>
        </div>

        <div className="space-y-2.5">
          <TierRow level={1} label="Direct Referral" rate="5%" />
          <TierRow level={2} label="Level 2" rate="3%" />
          <TierRow level={3} label="Level 3" rate="2%" />
        </div>

        <div className="mt-4 pt-3 border-t border-[#1f1f1f]">
          <p className="text-[10px] text-gray-600 leading-relaxed">
            Earn commissions when your referrals invest. Rewards are calculated
            automatically based on each tier.
          </p>
        </div>
      </Card>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
  loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent?: boolean;
  loading?: boolean;
}) {
  return (
    <Card padding="sm">
      <div className="flex flex-col items-center text-center gap-1.5 py-1">
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
        <span className="text-[10px] text-gray-600 uppercase tracking-wider">
          {label}
        </span>
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
    <div className="flex items-center gap-3 bg-[#0a0a0a] rounded-lg px-3 py-2.5">
      <div className="h-7 w-7 rounded-full bg-[rgba(0,255,65,0.08)] border border-[rgba(0,255,65,0.2)] flex items-center justify-center">
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

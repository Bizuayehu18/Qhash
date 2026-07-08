import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge.js";
import { CurrencyUnit } from "@/components/ui/AmountText.js";
import { Button } from "@/components/ui/Button.js";
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Cpu,
  Database,
  Gem,
  Lock,
  Server,
  ShieldCheck,
  Wallet,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import { getPlansWithEligibilityFn, type PlanWithEligibility } from "@/lib/server/plans.js";
import { purchasePlanFn } from "@/lib/server/investments.js";
import { isTimeoutError, withTimeout } from "@/lib/async.js";

export const Route = createFileRoute("/_app/plans")({
  component: PlansPage,
});

const PLAN_LOAD_TIMEOUT_MS = 10_000;
const PURCHASE_TIMEOUT_MS = 15_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

const PLAN_ICONS: Record<string, React.ReactNode> = {
  contract: <ShieldCheck size={17} />,
  hashrate: <Activity size={17} />,
  growth: <BarChart3 size={17} />,
  node: <Cpu size={17} />,
  cluster: <Server size={17} />,
  vault: <Database size={17} />,
  enterprise: <Gem size={17} />,
};

function formatEtb(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatWalletAmount(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function getEligibilityRows(plan: PlanWithEligibility) {
  const e = plan.eligibility;
  return [
    {
      label: "Direct referrals",
      current: e.activeLevel1Referrals,
      required: e.requiredLevel1Referrals,
    },
    {
      label: "Level 2 referrals",
      current: e.activeLevel2Referrals,
      required: e.requiredLevel2Referrals,
    },
    {
      label: "Level 3 referrals",
      current: e.activeLevel3Referrals,
      required: e.requiredLevel3Referrals,
    },
  ].filter((row) => row.required > 0);
}

function getMissingRows(plan: PlanWithEligibility) {
  return getEligibilityRows(plan)
    .map((row) => ({ ...row, missing: Math.max(0, row.required - row.current) }))
    .filter((row) => row.missing > 0);
}

function getMissingRequirementName(label: string, count: number) {
  const name =
    label === "Direct referrals"
      ? "active direct referral"
      : label === "Level 2 referrals"
        ? "active level 2 referral"
        : "active level 3 referral";

  return `${name}${count === 1 ? "" : "s"}`;
}

function getLockReason(plan: PlanWithEligibility) {
  if (plan.eligibility.limitReached) {
    return `Active limit reached (${plan.eligibility.activePlanCount}/${plan.eligibility.maxActivePerUser}).`;
  }

  const missing = getMissingRows(plan);
  if (missing.length > 0) {
    const first = missing[0];
    return `Requires ${first.missing} more ${getMissingRequirementName(first.label, first.missing)}.`;
  }

  return "Requirements not met.";
}

function getPlanCardSummary(plan: PlanWithEligibility) {
  if (!plan.eligibility.isEligible) return getLockReason(plan);

  return getEligibilityRows(plan).length === 0
    ? "No referral requirement"
    : "Requirements cleared";
}

function RequirementProgress({ plan }: { plan: PlanWithEligibility }) {
  const rows = getEligibilityRows(plan);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-gray-600">
        <span>Eligibility</span>
        <span>{plan.eligibility.referralRequirementMet ? "Cleared" : "Required"}</span>
      </div>
      {rows.length === 0 ? (
        <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <CheckCircle2 size={13} className="text-[#00ff41]" /> No referral requirement
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row) => {
            const ok = row.current >= row.required;
            return (
              <div key={row.label} className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-1.5 text-gray-400">
                  {ok ? <CheckCircle2 size={13} className="text-[#00ff41]" /> : <XCircle size={13} className="text-amber-400" />}
                  {row.label}
                </span>
                <span className={ok ? "text-[#00ff41]" : "text-amber-300"}>{row.current} / {row.required}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan, onSelect }: { plan: PlanWithEligibility; onSelect: () => void }) {
  const isAvailable = plan.eligibility.isEligible;
  const iconKey = plan.icon_key ?? "contract";
  const totalEarnings = plan.daily_earning * plan.duration_days;
  const summary = getPlanCardSummary(plan);

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border bg-[#101010] p-3 transition card-press ${
        plan.is_popular
          ? "border-[rgba(0,255,65,0.38)] shadow-[0_0_0_1px_rgba(0,255,65,0.08)]"
          : "border-[#1b1b1b]"
      }`}
    >
      {plan.is_popular && <div className="absolute inset-x-0 top-0 h-px bg-[#00ff41]/80" />}

      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border ${
              isAvailable
                ? "border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
                : "border-[#242424] bg-[#171717] text-gray-500"
            }`}
          >
            {isAvailable ? (PLAN_ICONS[iconKey] ?? <Zap size={16} />) : <Lock size={15} />}
          </div>

          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold leading-tight text-gray-100">{plan.name}</h3>
            <p className="mt-0.5 text-[10px] text-gray-600">{plan.duration_days}-day contract</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            {plan.is_popular && <Badge variant="neon">Popular</Badge>}
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[9px] ${
                isAvailable
                  ? "border-[rgba(0,255,65,0.22)] bg-[rgba(0,255,65,0.05)] text-[#00ff41]"
                  : "border-amber-400/20 bg-amber-400/5 text-amber-300"
              }`}
            >
              {isAvailable ? "Open" : "Locked"}
            </span>
          </div>
          <span className="text-[9px] text-gray-600">
            Limit {plan.eligibility.activePlanCount}/{plan.eligibility.maxActivePerUser}
          </span>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg border border-[#181818] bg-[#0a0a0a] px-2.5 py-2">
        <div className="min-w-0">
          <p className="truncate text-[9px] uppercase tracking-[0.14em] text-gray-600">Invest</p>
          <p className="mt-0.5 truncate font-mono text-sm font-black leading-tight text-gray-100">
            {formatEtb(plan.investment_amount)}<CurrencyUnit />
          </p>
        </div>
        <div className="min-w-0 text-center">
          <p className="truncate text-[9px] uppercase tracking-[0.14em] text-gray-600">Daily</p>
          <p className="mt-0.5 truncate font-mono text-sm font-black leading-tight text-[#00ff41]">
            {formatEtb(plan.daily_earning)}<CurrencyUnit />
          </p>
        </div>
        <div className="min-w-0 text-right">
          <p className="truncate text-[9px] uppercase tracking-[0.14em] text-gray-600">Total</p>
          <p className="mt-0.5 truncate font-mono text-sm font-black leading-tight text-gray-100">
            {formatEtb(totalEarnings)}<CurrencyUnit />
          </p>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-[#1a1a1a] pt-2">
        <p className={`min-w-0 flex-1 truncate text-[10px] ${isAvailable ? "text-gray-500" : "text-amber-200"}`}>
          {summary}
        </p>
        <button
          type="button"
          onClick={onSelect}
          className={`shrink-0 rounded-lg border px-2.5 py-1 text-[10px] font-semibold transition active:scale-[0.98] ${
            isAvailable
              ? "border-[rgba(0,255,65,0.28)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
              : "border-[#2a2a2a] bg-[#151515] text-gray-300"
          }`}
        >
          {isAvailable ? "Purchase" : "Details"}
        </button>
      </div>
    </div>
  );
}

function PlansPage() {
  const { user } = useAuthStore();
  const session = useAuthStore((s) => s.session);
  const [plans, setPlans] = useState<PlanWithEligibility[]>([]);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanWithEligibility | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const walletBalance = useWalletStore((s) => s.balance);
  const loadingBalance = useWalletStore((s) => s.loading);
  const setWalletBalance = useWalletStore((s) => s.setBalance);
  const fetchWallet = useWalletStore((s) => s.fetchWallet);

  const mountedRef = useRef(true);
  const loadingPlansRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const walletBalanceKnown = walletBalance !== null && !loadingBalance;

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

  const loadPlans = useCallback(
    async (options?: { resetRetryCount?: boolean; resetLoaded?: boolean }) => {
      if (loadingPlansRef.current) return;

      if (options?.resetRetryCount) retryCountRef.current = 0;
      if (options?.resetLoaded) {
        setPlans([]);
        setPlansLoaded(false);
      }

      clearRetryTimer();
      loadingPlansRef.current = true;

      try {
        const rows = await withTimeout(
          getPlansWithEligibilityFn({ data: { accessToken: session?.access_token ?? null } }),
          PLAN_LOAD_TIMEOUT_MS,
          "Plans request timed out.",
        );

        if (!mountedRef.current) return;

        setPlans(rows);
        setPlansLoaded(true);
        retryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Plans background refresh failed:", err);
        if (!mountedRef.current) return;
        scheduleRetry(() => { void loadPlans(); });
      } finally {
        loadingPlansRef.current = false;
      }
    },
    [clearRetryTimer, scheduleRetry, session?.access_token],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadPlans({ resetRetryCount: true, resetLoaded: true });

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer, loadPlans]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") void loadPlans({ resetRetryCount: true });
    };
    const handleOnline = () => { void loadPlans({ resetRetryCount: true }); };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadPlans]);

  useEffect(() => {
    if (user?.id && walletBalance === null) fetchWallet(user.id);
  }, [user?.id, walletBalance, fetchWallet]);

  const handlePurchase = async () => {
    if (!session?.access_token || !selectedPlan || purchasing || !selectedPlan.eligibility.isEligible) return;
    setPurchasing(true);
    try {
      const result = await withTimeout(
        purchasePlanFn({
          data: { planId: selectedPlan.id, accessToken: session.access_token },
        }),
        PURCHASE_TIMEOUT_MS,
        "Purchase request timed out.",
      );
      setWalletBalance(result.newBalance);
      toast.success(`${selectedPlan.name} activated. Mining starts now.`);
      setSelectedPlan(null);
      void loadPlans({ resetRetryCount: true });
    } catch (err: unknown) {
      if (isTimeoutError(err)) {
        toast.error("Purchase is taking too long. Please check your connection and try again.");
        return;
      }
      toast.error(getSafeErrorMessage(err, "PURCHASE").message);
      void loadPlans({ resetRetryCount: true });
    } finally {
      setPurchasing(false);
    }
  };

  if (!plansLoaded) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-44 rounded-lg" />
        <div className="skeleton h-4 w-72 rounded-lg" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="skeleton h-28 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#00ff41]/70">Mining Contracts</p>
          <h1 className="text-lg font-bold mt-1">QHash Contract Plans</h1>
          <p className="text-xs text-gray-500 mt-1">Fixed-duration mining contracts with purchase-time eligibility.</p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-[#101010] border border-[#1b1b1b] rounded-xl px-4 py-3">
        <Wallet size={15} className="text-[#00ff41]" />
        <span className="text-xs text-gray-500">Wallet</span>
        {!walletBalanceKnown ? (
          <span className="skeleton inline-block h-5 w-24 rounded" aria-label="Loading wallet balance" />
        ) : (
          <span className="font-mono text-sm font-black tracking-tight text-[#00ff41]">
            {formatWalletAmount(walletBalance)}<CurrencyUnit />
          </span>
        )}
        <Link to="/deposit" className="ml-auto text-[10px] text-gray-400 border border-[#2a2a2a] rounded-lg px-2.5 py-1 card-press hover:text-white">
          + Add Funds
        </Link>
      </div>

      {plans.length === 0 ? (
        <div className="text-center py-16 text-xs text-gray-600">No contracts available at the moment.</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              onSelect={() => setSelectedPlan(plan)}
            />
          ))}
        </div>
      )}

      {selectedPlan && (
        <div className="fixed inset-x-0 top-0 bottom-14 z-40 flex items-end justify-center bg-black/80 backdrop-blur-sm lg:inset-0 lg:z-[60] lg:items-center">
          <div className="relative w-full max-w-[520px] overflow-y-auto rounded-t-2xl border border-[rgba(0,255,65,0.12)] bg-[#111] p-4 animate-[slideUp_0.25s_ease-out] max-h-[85dvh] shadow-[0_24px_80px_rgba(0,0,0,0.55)] lg:rounded-2xl" style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}>
            <div className="mb-3 flex justify-center"><div className="h-1 w-10 rounded-full bg-gray-700" /></div>
            <button type="button" aria-label="Close plan details" onClick={() => setSelectedPlan(null)} className="absolute top-4 right-4 text-gray-500 hover:text-gray-300"><X size={18} /></button>

            <div className="mb-3 flex items-start gap-2.5 pr-8">
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${selectedPlan.eligibility.isEligible ? "border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]" : "border-[#242424] bg-[#171717] text-gray-500"}`}>
                {selectedPlan.eligibility.isEligible ? (PLAN_ICONS[selectedPlan.icon_key ?? "contract"] ?? <Zap size={17} />) : <Lock size={16} />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h3 className="truncate text-base font-bold leading-tight">{selectedPlan.name}</h3>
                  {selectedPlan.is_popular && <Badge variant="neon">Popular</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{selectedPlan.duration_days}-Day Mining Contract</p>
              </div>
            </div>

            <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl border border-[#1b1b1b] bg-[#0a0a0a] px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-[10px] uppercase tracking-[0.14em] text-gray-600">Invest</p>
                <p className="mt-1 truncate font-mono text-sm font-black text-gray-100">{formatEtb(selectedPlan.investment_amount)}<CurrencyUnit /></p>
              </div>
              <div className="min-w-0 text-center">
                <p className="truncate text-[10px] uppercase tracking-[0.14em] text-gray-600">Daily</p>
                <p className="mt-1 truncate font-mono text-sm font-black text-[#00ff41]">{formatEtb(selectedPlan.daily_earning)}<CurrencyUnit /></p>
              </div>
              <div className="min-w-0 text-right">
                <p className="truncate text-[10px] uppercase tracking-[0.14em] text-gray-600">Total</p>
                <p className="mt-1 truncate font-mono text-sm font-black text-gray-100">{formatEtb(selectedPlan.daily_earning * selectedPlan.duration_days)}<CurrencyUnit /></p>
              </div>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg border border-[#1b1b1b] bg-[#0a0a0a] px-3 py-2">
                <p className="text-[10px] text-gray-600">Duration</p>
                <p className="mt-0.5 font-semibold text-gray-200">{selectedPlan.duration_days} days</p>
              </div>
              <div className="rounded-lg border border-[#1b1b1b] bg-[#0a0a0a] px-3 py-2 text-right">
                <p className="text-[10px] text-gray-600">Active Limit</p>
                <p className="mt-0.5 font-semibold text-gray-200">{selectedPlan.eligibility.activePlanCount} / {selectedPlan.eligibility.maxActivePerUser}</p>
              </div>
            </div>

            <div className="mb-3 rounded-xl border border-[#1b1b1b] bg-[#0a0a0a] p-3">
              <RequirementProgress plan={selectedPlan} />
              {!selectedPlan.eligibility.isEligible && (
                <div className="mt-2 border-t border-[#181818] pt-2">
                  <p className="text-[11px] font-semibold text-amber-300">This contract is currently locked.</p>
                  {selectedPlan.eligibility.limitReached && (
                    <p className="mt-1 text-[11px] leading-relaxed text-gray-500">Active limit reached. You can purchase again after one active contract expires.</p>
                  )}
                  {getMissingRows(selectedPlan).length > 0 && (
                    <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                      Missing: {getMissingRows(selectedPlan).map((row) => `${row.missing} ${getMissingRequirementName(row.label, row.missing)}`).join(" · ")}.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="mb-4 flex items-center justify-between border-t border-[#1f1f1f] pt-3 text-sm">
              <span className="text-gray-500">Your Wallet</span>
              {!walletBalanceKnown ? (
                <span className="skeleton inline-block h-5 w-24 rounded" aria-label="Loading wallet balance" />
              ) : (
                <span className={[
                  "font-mono font-semibold",
                  !selectedPlan.eligibility.isEligible
                    ? "text-gray-200"
                    : walletBalance >= selectedPlan.investment_amount
                      ? "text-[#00ff41]"
                      : "text-red-400",
                ].join(" ")}>
                  {formatWalletAmount(walletBalance)}<CurrencyUnit />
                </span>
              )}
            </div>

            {!selectedPlan.eligibility.isEligible ? (
              <div className="flex gap-3">
                <Button variant="ghost" size="sm" fullWidth onClick={() => setSelectedPlan(null)}>Close</Button>
                <Button variant="outline" size="sm" fullWidth disabled className="border-[#2a2a2a] bg-[#121212] text-gray-500 shadow-none disabled:opacity-100">Locked</Button>
              </div>
            ) : !walletBalanceKnown ? (
              <div className="flex gap-3">
                <Button variant="ghost" size="sm" fullWidth onClick={() => setSelectedPlan(null)}>Close</Button>
                <Button variant="primary" size="sm" fullWidth disabled>Checking Wallet</Button>
              </div>
            ) : walletBalance < selectedPlan.investment_amount ? (
              <div className="text-center">
                <p className="text-xs text-red-400 mb-3">Insufficient balance. Deposit funds to continue.</p>
                <div className="flex gap-3">
                  <Button variant="ghost" size="sm" fullWidth onClick={() => setSelectedPlan(null)}>Close</Button>
                  <Link to="/deposit" className="flex-1"><Button variant="primary" size="sm" fullWidth>Deposit</Button></Link>
                </div>
              </div>
            ) : (
              <div className="flex gap-3">
                <Button variant="ghost" size="sm" fullWidth onClick={() => setSelectedPlan(null)} disabled={purchasing}>Cancel</Button>
                <Button variant="primary" size="sm" fullWidth loading={purchasing} onClick={handlePurchase}>Confirm Purchase</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

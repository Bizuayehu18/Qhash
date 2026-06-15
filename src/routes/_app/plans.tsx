import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Zap, TrendingUp, Crown, X, Layers, Star, Award } from "lucide-react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import { getPlansFn } from "@/lib/server/plans.js";
import { purchasePlanFn } from "@/lib/server/investments.js";
import { isTimeoutError, withTimeout } from "@/lib/async.js";
import type { Plan } from "@/lib/database.types.js";

export const Route = createFileRoute("/_app/plans")({
  component: PlansPage,
});

const PLAN_LOAD_TIMEOUT_MS = 10_000;
const PURCHASE_TIMEOUT_MS = 15_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

const PLAN_ICONS: Record<string, React.ReactNode> = {
  starter: <Zap size={18} />,
  basic: <Layers size={18} />,
  standard: <TrendingUp size={18} />,
  advanced: <Star size={18} />,
  professional: <Award size={18} />,
  elite: <Crown size={18} />,
};

function PlansPage() {
  const { user } = useAuthStore();
  const session = useAuthStore((s) => s.session);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoaded, setPlansLoaded] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
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

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (options?.resetLoaded) {
        setPlans([]);
        setPlansLoaded(false);
      }

      clearRetryTimer();
      loadingPlansRef.current = true;

      try {
        const rows = await withTimeout(
          getPlansFn(),
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

        scheduleRetry(() => {
          void loadPlans();
        });
      } finally {
        loadingPlansRef.current = false;
      }
    },
    [clearRetryTimer, scheduleRetry],
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
      if (document.visibilityState === "visible") {
        void loadPlans({ resetRetryCount: true });
      }
    };

    const handleOnline = () => {
      void loadPlans({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadPlans]);

  useEffect(() => {
    if (user?.id && walletBalance === null) {
      fetchWallet(user.id);
    }
  }, [user?.id, walletBalance, fetchWallet]);

  const handlePurchase = async () => {
    if (!session?.access_token || !selectedPlan || purchasing) return;
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
      toast.success(`${selectedPlan.name} activated! Mining starts now.`);
      setSelectedPlan(null);
    } catch (err: unknown) {
      if (isTimeoutError(err)) {
        toast.error("Purchase is taking too long. Please check your connection and try again.");
        return;
      }

      toast.error(getSafeErrorMessage(err, "PURCHASE").message);
    } finally {
      setPurchasing(false);
    }
  };

  if (!plansLoaded) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-40 rounded-lg" />
        <div className="skeleton h-4 w-64 rounded-lg" />
        <div className="space-y-4 mt-4">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-56 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Mining Plans</h1>
        <p className="text-xs text-gray-500 mt-1">Choose your investment</p>
      </div>

      {/* Balance pill */}
      <div className="flex items-center gap-2 bg-[#111] border border-[#1a1a1a] rounded-xl px-4 py-3">
        <span className="text-xs text-gray-500">Wallet:</span>
        {!walletBalanceKnown ? (
          <span className="skeleton inline-block h-5 w-24 rounded" aria-label="Loading wallet balance" />
        ) : (
          <span className="text-sm font-bold text-[#00ff41]">
            {walletBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB
          </span>
        )}
        <Link to="/deposit" className="ml-auto text-[10px] text-gray-500 border border-[#2a2a2a] rounded-lg px-2.5 py-1 card-press">
          + Add Funds
        </Link>
      </div>

      {plans.length === 0 ? (
        <div className="text-center py-16 text-xs text-gray-600">
          No plans available at the moment.
        </div>
      ) : (
        <div className="space-y-4">
          {plans.map((plan) => {
            const planKey = plan.name.toLowerCase();
            const isPopular = planKey === "standard";
            return (
              <div
                key={plan.id}
                className={`bg-[#111] rounded-xl border p-4 card-press ${
                  isPopular
                    ? "border-[rgba(0,255,65,0.25)] mining-active"
                    : "border-[#1a1a1a]"
                }`}
                onClick={() => setSelectedPlan(plan)}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-xl bg-[rgba(0,255,65,0.08)] flex items-center justify-center text-[#00ff41]">
                      {PLAN_ICONS[planKey] ?? <Zap size={18} />}
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">{plan.name}</h3>
                      <p className="text-[10px] text-gray-600">{plan.duration_days}-day contract</p>
                    </div>
                  </div>
                  {isPopular && <Badge variant="neon">Popular</Badge>}
                </div>

                <div className="flex items-center justify-between bg-[#0a0a0a] rounded-lg p-3 mb-3">
                  <div>
                    <p className="text-xs text-gray-600">Investment</p>
                    <p className="text-lg font-black">{plan.investment_amount.toLocaleString()} <span className="text-xs font-normal text-gray-500">ETB</span></p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-600">Daily Earning</p>
                    <p className="text-lg font-black text-[#00ff41]">{plan.daily_earning.toLocaleString()} <span className="text-xs font-normal text-gray-500">ETB</span></p>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs px-1">
                  <span className="text-gray-500">Total Return</span>
                  <span className="font-bold text-[#00ff41]">{(plan.daily_earning * plan.duration_days).toLocaleString()} ETB</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Purchase Modal */}
      {selectedPlan && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111] border-t border-[rgba(0,255,65,0.1)] rounded-t-2xl w-full max-w-[480px] p-5 animate-[slideUp_0.25s_ease-out] max-h-[85dvh] overflow-y-auto" style={{ paddingBottom: 'calc(70px + env(safe-area-inset-bottom, 0px))' }}>
            <div className="flex justify-center mb-4">
              <div className="h-1 w-10 rounded-full bg-gray-700" />
            </div>

            <button
              onClick={() => setSelectedPlan(null)}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-300"
            >
              <X size={18} />
            </button>

            <h3 className="font-bold text-base mb-4">Confirm Purchase</h3>

            <div className="space-y-3 mb-5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Plan</span>
                <span className="font-medium">{selectedPlan.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Investment</span>
                <span className="font-medium">{selectedPlan.investment_amount.toLocaleString()} ETB</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Daily Earning</span>
                <span className="text-[#00ff41]">{selectedPlan.daily_earning.toLocaleString()} ETB/day</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Duration</span>
                <span>{selectedPlan.duration_days} days</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Total Return</span>
                <span className="text-[#00ff41] font-bold">{(selectedPlan.daily_earning * selectedPlan.duration_days).toLocaleString()} ETB</span>
              </div>
              <div className="border-t border-[#1f1f1f] pt-3 flex justify-between text-sm">
                <span className="text-gray-500">Your Wallet</span>
                {!walletBalanceKnown ? (
                  <span className="skeleton inline-block h-5 w-24 rounded" aria-label="Loading wallet balance" />
                ) : (
                  <span className={walletBalance >= selectedPlan.investment_amount ? "text-[#00ff41]" : "text-red-400"}>
                    {walletBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB
                  </span>
                )}
              </div>
            </div>

            {!walletBalanceKnown ? (
              <div className="flex gap-3">
                <Button variant="ghost" size="sm" fullWidth onClick={() => setSelectedPlan(null)}>Close</Button>
                <Button variant="primary" size="sm" fullWidth disabled>Checking Wallet</Button>
              </div>
            ) : walletBalance < selectedPlan.investment_amount ? (
              <div className="text-center">
                <p className="text-xs text-red-400 mb-3">Insufficient balance. Deposit funds to continue.</p>
                <div className="flex gap-3">
                  <Button variant="ghost" size="sm" fullWidth onClick={() => setSelectedPlan(null)}>Close</Button>
                  <Link to="/deposit" className="flex-1">
                    <Button variant="primary" size="sm" fullWidth>Deposit</Button>
                  </Link>
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

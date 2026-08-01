import { Link } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { CurrencyUnit } from "@/components/ui/AmountText.js";
import { PlanCard } from "./PlanCard.js";
import { PlanDetailsDialog } from "./PlanDetailsDialog.js";
import { formatPlanWalletAmount } from "./plan-format.js";
import { usePlansCatalog } from "./usePlansCatalog.js";

export function PlansPage() {
  const {
    closePlan,
    handlePurchase,
    loaded,
    plans,
    purchasing,
    selectPlan,
    selectedPlan,
    walletBalance,
  } = usePlansCatalog();

  if (!loaded) return <PlansPageSkeleton />;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.22em] text-[#00ff41]/70">Mining Contracts</p>
          <h1 className="mt-1 text-lg font-bold">QHash Contract Plans</h1>
          <p className="mt-1 text-xs text-gray-500">
            Fixed-duration mining contracts with purchase-time eligibility.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-[#1b1b1b] bg-[#101010] px-4 py-3">
        <Wallet size={15} className="text-[#00ff41]" />
        <span className="text-xs text-gray-500">Wallet</span>
        {walletBalance === null ? (
          <span className="skeleton inline-block h-5 w-24 rounded" aria-label="Loading wallet balance" />
        ) : (
          <span className="font-mono text-sm font-black tracking-tight text-[#00ff41]">
            {formatPlanWalletAmount(walletBalance)}<CurrencyUnit />
          </span>
        )}
        <Link
          to="/deposit"
          className="ml-auto rounded-lg border border-[#2a2a2a] px-2.5 py-1 text-[10px] text-gray-400 card-press hover:text-white"
        >
          + Add Funds
        </Link>
      </div>

      {plans.length === 0 ? (
        <div className="py-16 text-center text-xs text-gray-600">
          No contracts available at the moment.
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} onSelect={() => selectPlan(plan)} />
          ))}
        </div>
      )}

      {selectedPlan && (
        <PlanDetailsDialog
          onClose={closePlan}
          onPurchase={() => { void handlePurchase(); }}
          plan={selectedPlan}
          purchasing={purchasing}
          walletBalance={walletBalance}
        />
      )}
    </div>
  );
}

function PlansPageSkeleton() {
  return (
    <div className="space-y-4">
      <div className="skeleton h-8 w-44 rounded-lg" />
      <div className="skeleton h-4 w-72 rounded-lg" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((index) => (
          <div key={index} className="skeleton h-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

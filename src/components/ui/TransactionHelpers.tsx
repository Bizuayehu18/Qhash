import { ArrowDownCircle, ArrowUpCircle, Layers, TrendingUp, Users } from "lucide-react";

export function TxIcon({ type }: { type: string }) {
  const icons: Record<string, { bg: string; color: string; icon: React.ReactNode }> = {
    deposit: { bg: "bg-emerald-500/10", color: "text-emerald-400", icon: <ArrowDownCircle size={14} /> },
    withdrawal: { bg: "bg-amber-500/10", color: "text-amber-400", icon: <ArrowUpCircle size={14} /> },
    plan_purchase: { bg: "bg-blue-500/10", color: "text-blue-400", icon: <Layers size={14} /> },
    earning: { bg: "bg-[rgba(0,255,65,0.08)]", color: "text-[#00ff41]", icon: <TrendingUp size={14} /> },
    referral_investment_bonus: { bg: "bg-purple-500/10", color: "text-purple-400", icon: <Users size={14} /> },
  };
  const cfg = icons[type] ?? { bg: "bg-white/5", color: "text-gray-400", icon: <TrendingUp size={14} /> };
  return (
    <div className={`h-8 w-8 rounded-full ${cfg.bg} flex items-center justify-center ${cfg.color}`}>
      {cfg.icon}
    </div>
  );
}

const OUTGOING_TYPES = new Set(["withdrawal", "plan_purchase"]);

export function isOutgoingTx(type: string): boolean {
  return OUTGOING_TYPES.has(type);
}

export function txLabel(type: string): string {
  const labels: Record<string, string> = {
    deposit: "Deposit",
    withdrawal: "Withdrawal",
    plan_purchase: "Plan Purchase",
    earning: "Mining Earning",
    admin_adjustment: "Adjustment",
    referral_investment_bonus: "Referral Bonus",
  };
  return labels[type] ?? type;
}

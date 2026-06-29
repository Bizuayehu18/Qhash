import type { ReactNode } from "react";
import { ArrowDownCircle, ArrowUpCircle, Layers, TrendingUp, Users } from "lucide-react";

interface TransactionLike {
  type: string;
  description?: string | null;
}

export function TxIcon({ type }: { type: string }) {
  const icons: Record<string, { bg: string; color: string; icon: ReactNode }> = {
    deposit: {
      bg: "bg-emerald-500/10",
      color: "text-emerald-400",
      icon: <ArrowDownCircle size={14} />,
    },
    withdrawal: {
      bg: "bg-amber-500/10",
      color: "text-amber-400",
      icon: <ArrowUpCircle size={14} />,
    },
    investment: {
      bg: "bg-blue-500/10",
      color: "text-blue-400",
      icon: <Layers size={14} />,
    },
    plan_purchase: {
      bg: "bg-blue-500/10",
      color: "text-blue-400",
      icon: <Layers size={14} />,
    },
    earning: {
      bg: "bg-[rgba(0,255,65,0.08)]",
      color: "text-[#00ff41]",
      icon: <TrendingUp size={14} />,
    },
    referral_daily_bonus: {
      bg: "bg-purple-500/10",
      color: "text-purple-400",
      icon: <Users size={14} />,
    },
    referral_investment_bonus: {
      bg: "bg-purple-500/10",
      color: "text-purple-400",
      icon: <Users size={14} />,
    },
    referral_reward: {
      bg: "bg-purple-500/10",
      color: "text-purple-400",
      icon: <Users size={14} />,
    },
  };

  const cfg = icons[type] ?? {
    bg: "bg-white/5",
    color: "text-gray-400",
    icon: <TrendingUp size={14} />,
  };

  return (
    <div className={`h-8 w-8 rounded-full ${cfg.bg} flex items-center justify-center ${cfg.color}`}>
      {cfg.icon}
    </div>
  );
}

const OUTGOING_TYPES = new Set(["withdrawal", "investment", "plan_purchase"]);

export function isOutgoingTx(type: string): boolean {
  return OUTGOING_TYPES.has(type);
}

export function txLabel(type: string): string {
  return txTitle(type);
}

export function txTitle(type: string): string {
  const labels: Record<string, string> = {
    deposit: "Deposit",
    withdrawal: "Withdrawal",
    investment: "Investment",
    plan_purchase: "Investment",
    earning: "Mining Earning",
    admin_adjustment: "Adjustment",
    referral_daily_bonus: "Referral Bonus",
    referral_investment_bonus: "Referral Bonus",
    referral_reward: "Referral Bonus",
  };

  return labels[type] ?? type;
}

export function txFallbackSubtitle(type: string): string {
  switch (type) {
    case "deposit":
      return "Wallet deposit";
    case "withdrawal":
      return "Withdrawal request";
    case "earning":
      return "Daily mining earnings";
    case "investment":
    case "plan_purchase":
      return "Investment purchase";
    case "referral_daily_bonus":
      return "Daily referral bonus";
    case "referral_investment_bonus":
      return "Investment referral bonus";
    case "referral_reward":
      return "Referral reward";
    case "admin_adjustment":
      return "Account adjustment";
    default:
      return "Account activity";
  }
}

export function txSubtitle(tx: TransactionLike, formattedCreatedAt: string): string {
  if (
    tx.type === "referral_daily_bonus" ||
    tx.type === "referral_investment_bonus" ||
    tx.type === "referral_reward"
  ) {
    return txFallbackSubtitle(tx.type);
  }

  const description = typeof tx.description === "string" ? tx.description.trim() : "";

  if (description && description !== formattedCreatedAt) {
    return description;
  }

  return txFallbackSubtitle(tx.type);
}

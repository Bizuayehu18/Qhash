import { Link } from "@tanstack/react-router";
import { ChevronRight, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/Card.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";

export function ReferralRewardsColumn() {
  return (
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

function RewardSourceRow({ title, description }: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
        <TrendingUp size={13} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-gray-100">{title}</p>
        <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">
          {description}
        </p>
      </div>
    </div>
  );
}

function TierRow({ level, label, rate }: {
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

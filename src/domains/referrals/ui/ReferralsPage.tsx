import { useState } from "react";
import {
  filterReferralMembersByLevel,
  getReferralLevelCounts,
  type ReferralLevelFilter,
} from "../domain/referral-team.js";
import { ReferralLinkCard } from "./ReferralLinkCard.js";
import { ReferralRewardsColumn } from "./ReferralRewardsCard.js";
import { ReferralStatsTiles } from "./ReferralStatsTiles.js";
import { ReferralTeamCard } from "./ReferralTeamCard.js";
import { useReferralData } from "./useReferralData.js";

export function ReferralsPage() {
  const { stats, statsLoaded, username } = useReferralData();
  const [teamLevelFilter, setTeamLevelFilter] = useState<ReferralLevelFilter>("all");
  const levelCounts = getReferralLevelCounts(stats.members);
  const filteredMembers = filterReferralMembersByLevel(
    stats.members,
    teamLevelFilter,
  );

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

      <ReferralLinkCard username={username} />
      <ReferralStatsTiles stats={stats} loading={!statsLoaded} />
      <div className="lg:col-span-8">
        <ReferralTeamCard
          members={filteredMembers}
          totalMembers={stats.members.length}
          levelCounts={levelCounts}
          activeFilter={teamLevelFilter}
          onFilterChange={setTeamLevelFilter}
          loading={!statsLoaded}
        />
      </div>
      <ReferralRewardsColumn />
    </div>
  );
}

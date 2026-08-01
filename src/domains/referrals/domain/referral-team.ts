export type ReferralLevel = 1 | 2 | 3;
export type ReferralLevelFilter = "all" | ReferralLevel;

export interface ReferralMember {
  id: string;
  name: string | null;
  level: number;
  joinedAt: string;
  isActive: boolean;
}

export interface ReferralStats {
  total: number;
  active: number;
  earned: number;
  todayRewards: number;
  members: ReferralMember[];
}

export interface ReferralLevelCounts {
  all: number;
  1: number;
  2: number;
  3: number;
}

export const EMPTY_REFERRAL_STATS: ReferralStats = {
  total: 0,
  active: 0,
  earned: 0,
  todayRewards: 0,
  members: [],
};

export const REFERRAL_TEAM_FILTERS: ReadonlyArray<{
  label: string;
  value: ReferralLevelFilter;
}> = [
  { label: "All", value: "all" },
  { label: "L1", value: 1 },
  { label: "L2", value: 2 },
  { label: "L3", value: 3 },
];

export const REFERRAL_TEAM_PREVIEW_LIMIT = 6;

export function normalizeReferralStats(stats: ReferralStats): ReferralStats {
  return {
    total: stats.total,
    active: stats.active,
    earned: stats.earned,
    todayRewards: stats.todayRewards ?? 0,
    members: Array.isArray(stats.members) ? stats.members : [],
  };
}

export function getReferralLevelCounts(
  members: ReferralMember[],
): ReferralLevelCounts {
  return members.reduce<ReferralLevelCounts>(
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

export function getReferralFilterCount(
  counts: ReferralLevelCounts,
  filter: ReferralLevelFilter,
): number {
  return filter === "all" ? counts.all : counts[filter];
}

export function filterReferralMembersByLevel(
  members: ReferralMember[],
  filter: ReferralLevelFilter,
): ReferralMember[] {
  if (filter === "all") return members;
  return members.filter((member) => member.level === filter);
}

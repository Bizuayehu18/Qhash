import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/Card.js";
import { EmptyState } from "@/components/ui/EmptyState.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";
import {
  REFERRAL_TEAM_FILTERS,
  REFERRAL_TEAM_PREVIEW_LIMIT,
  getReferralFilterCount,
  type ReferralLevelCounts,
  type ReferralLevelFilter,
  type ReferralMember,
} from "../domain/referral-team.js";

export function ReferralTeamCard({
  members,
  totalMembers,
  levelCounts,
  activeFilter,
  onFilterChange,
  loading,
}: {
  members: ReferralMember[];
  totalMembers: number;
  levelCounts: ReferralLevelCounts;
  activeFilter: ReferralLevelFilter;
  onFilterChange: (value: ReferralLevelFilter) => void;
  loading: boolean;
}) {
  const [showAllMembers, setShowAllMembers] = useState(false);

  useEffect(() => {
    setShowAllMembers(false);
  }, [activeFilter]);

  const hasMoreMembers = members.length > REFERRAL_TEAM_PREVIEW_LIMIT;
  const visibleMembers = showAllMembers
    ? members
    : members.slice(0, REFERRAL_TEAM_PREVIEW_LIMIT);

  return (
    <Card>
      <SectionHeader
        title="My Team"
        description="Filter team members by level."
        className="mb-3"
      />
      <TeamLevelFilters
        counts={levelCounts}
        activeFilter={activeFilter}
        onFilterChange={onFilterChange}
        disabled={loading}
      />
      <p className="mb-3 text-[10px] leading-relaxed text-gray-600">
        <span className="font-semibold text-gray-400">Active</span>
        {" = member has a running mining contract."}
      </p>

      {loading ? (
        <TeamLoadingRows />
      ) : totalMembers === 0 ? (
        <EmptyState
          icon={<Users size={22} />}
          title="No team members yet"
          description="Share your referral link to start building your team."
          className="px-4 py-8"
        />
      ) : members.length === 0 ? (
        <EmptyState
          icon={<Users size={22} />}
          title="No members in this level"
          description="Choose another level filter to view more team members."
          className="px-4 py-8"
        />
      ) : (
        <div className="space-y-2">
          {visibleMembers.map((member) => (
            <TeamMemberRow key={member.id} member={member} />
          ))}
          {hasMoreMembers && (
            <button
              type="button"
              onClick={() => setShowAllMembers((current) => !current)}
              className="mt-1 w-full rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 text-[10px] font-semibold text-gray-400 transition hover:text-gray-100 active:scale-[0.99]"
            >
              {showAllMembers
                ? "Show less"
                : `See more (${members.length - REFERRAL_TEAM_PREVIEW_LIMIT})`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function TeamLevelFilters({ counts, activeFilter, onFilterChange, disabled }: {
  counts: ReferralLevelCounts;
  activeFilter: ReferralLevelFilter;
  onFilterChange: (value: ReferralLevelFilter) => void;
  disabled: boolean;
}) {
  return (
    <div className="mb-2 grid grid-cols-4 gap-1.5 rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] p-1">
      {REFERRAL_TEAM_FILTERS.map((filter) => {
        const active = activeFilter === filter.value;
        return (
          <button
            key={filter.label}
            type="button"
            disabled={disabled}
            onClick={() => onFilterChange(filter.value)}
            className={[
              "flex items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
              active
                ? "bg-[#00ff41] text-black"
                : "bg-[#111] text-gray-500 hover:text-gray-200",
            ].join(" ")}
          >
            <span>{filter.label}</span>
            <span className={active ? "text-black/70" : "text-gray-700"}>
              {getReferralFilterCount(counts, filter.value)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function TeamLoadingRows() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className="rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-2">
              <div className="skeleton h-4 w-24 rounded" />
              <div className="skeleton h-3 w-32 rounded" />
            </div>
            <div className="skeleton h-6 w-16 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TeamMemberRow({ member }: { member: ReferralMember }) {
  const displayName = member.name ? `@${member.name}` : "Team member";
  return (
    <div className="rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-100">
            {displayName}
          </p>
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
          {member.isActive ? "Active" : "Inactive"}
        </span>
      </div>
    </div>
  );
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

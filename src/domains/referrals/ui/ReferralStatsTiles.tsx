import type { ReactNode } from "react";
import { Check, TrendingUp, Users } from "lucide-react";
import { CurrencyUnit } from "@/components/ui/AmountText.js";
import type { ReferralStats } from "../domain/referral-team.js";

export function ReferralStatsTiles({
  stats,
  loading,
}: {
  stats: ReferralStats;
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:col-span-12 lg:grid-cols-4">
      <ReferralStatTile
        label="Today's"
        value={<EtbValue value={stats.todayRewards} />}
        caption="Referral income"
        icon={<TrendingUp size={13} />}
        loading={loading}
        accent
      />
      <ReferralStatTile
        label="Total"
        value={<EtbValue value={stats.earned} />}
        caption="Referral income"
        icon={<TrendingUp size={13} />}
        loading={loading}
      />
      <ReferralStatTile
        label="Team"
        value={stats.total.toString()}
        caption="Members"
        icon={<Users size={13} />}
        loading={loading}
      />
      <ReferralStatTile
        label="Active"
        value={stats.active.toString()}
        caption="Members"
        icon={<Check size={13} />}
        loading={loading}
      />
    </div>
  );
}

function ReferralStatTile({
  label,
  value,
  caption,
  icon,
  loading,
  accent,
}: {
  label: string;
  value: ReactNode;
  caption: string;
  icon: ReactNode;
  loading: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={[
        "min-w-0 rounded-xl border bg-[#111] px-3 py-2.5",
        accent ? "border-[rgba(0,255,65,0.18)]" : "border-[#1a1a1a]",
      ].join(" ")}
    >
      <div className="grid grid-cols-[14px_minmax(0,1fr)] gap-x-1.5">
        <p className="col-start-2 truncate text-[9px] uppercase tracking-[0.14em] text-gray-600">
          {label}
        </p>
        <span className="col-start-1 row-start-2 mt-0.5 flex h-4 items-center justify-center text-[#00ff41]">
          {!loading && icon}
        </span>
        <div
          className={[
            "col-start-2 row-start-2 mt-0.5 min-w-0 truncate font-mono text-sm font-black leading-tight",
            accent ? "text-[#00ff41]" : "text-gray-100",
          ].join(" ")}
        >
          {loading ? (
            <span className="skeleton inline-block h-4 w-14 rounded" />
          ) : value}
        </div>
        <p className="col-start-2 row-start-3 mt-0.5 truncate text-[9px] text-gray-700">
          {caption}
        </p>
      </div>
    </div>
  );
}

function EtbValue({ value }: { value: number }) {
  const amount = Number.isFinite(value) ? value : 0;
  return (
    <>
      {amount.toFixed(2)}
      <CurrencyUnit />
    </>
  );
}

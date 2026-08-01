import { ChevronRight, Info } from "lucide-react";
import type { FiatWithdrawalSecurityStatus } from "./fiat-withdrawal-types.js";

export function FiatWithdrawalSecurityStatusLine({
  securityStatus,
  loading,
  onSetNow,
}: {
  securityStatus: FiatWithdrawalSecurityStatus | null;
  loading: boolean;
  onSetNow: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-[#1a1a1a] bg-[#111] px-3 py-2.5">
        <Info size={13} className="mt-0.5 shrink-0 text-gray-500" />
        <p className="text-[10px] leading-relaxed text-gray-500">
          Checking fund password status…
        </p>
      </div>
    );
  }

  if (!securityStatus) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5">
        <Info size={13} className="mt-0.5 shrink-0 text-yellow-400" />
        <p className="text-[10px] leading-relaxed text-yellow-300">
          Unable to verify withdrawal security. Please try again.
        </p>
      </div>
    );
  }

  if (securityStatus.isFundPasswordLocked) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5">
        <Info size={13} className="mt-0.5 shrink-0 text-yellow-400" />
        <p className="text-[10px] leading-relaxed text-yellow-300">
          Fund password is temporarily locked. Please try again later.
        </p>
      </div>
    );
  }

  if (!securityStatus.hasFundPassword) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5">
        <div className="flex min-w-0 items-start gap-2">
          <Info size={13} className="mt-0.5 shrink-0 text-yellow-400" />
          <p className="text-[10px] leading-relaxed text-yellow-300">
            Fund password required before withdrawing.
          </p>
        </div>
        <button
          type="button"
          onClick={onSetNow}
          className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-[#00ff41] card-press"
        >
          Set now
          <ChevronRight size={12} />
        </button>
      </div>
    );
  }

  return null;
}

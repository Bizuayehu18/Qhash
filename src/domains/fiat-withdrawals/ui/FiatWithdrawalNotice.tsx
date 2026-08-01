import { Info } from "lucide-react";
import { CROSS_RAIL_WITHDRAWAL_POLICY_MESSAGE } from "@/lib/withdrawal-policy.js";
import {
  ETHIOPIA_MIN_WITHDRAWAL_AMOUNT_ETB,
  ETHIOPIA_WITHDRAWAL_FEE_PERCENT,
} from "./providers/et/ethiopia-withdrawal-policy.js";

export function FiatWithdrawalNotice() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.035)] px-3 py-2.5">
      <Info size={13} className="mt-0.5 shrink-0 text-[#00ff41]" />
      <div className="min-w-0 text-[10px] leading-relaxed text-gray-500">
        <p>
          <span className="font-semibold text-[#00ff41]">24h processing</span>
          <span>
            {" · Min "}
            {ETHIOPIA_MIN_WITHDRAWAL_AMOUNT_ETB} ETB · {ETHIOPIA_WITHDRAWAL_FEE_PERCENT}% fee
          </span>
        </p>
        <p className="mt-1.5 border-t border-[rgba(0,255,65,0.1)] pt-1.5">
          {CROSS_RAIL_WITHDRAWAL_POLICY_MESSAGE}.
        </p>
      </div>
    </div>
  );
}

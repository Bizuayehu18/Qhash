import { loadReferralStatsFn } from "@/lib/server/referrals.js";
import type { ReferralStats } from "../domain/referral-team.js";

export function loadReferralStats(accessToken: string): Promise<ReferralStats> {
  return loadReferralStatsFn({ data: { accessToken } });
}

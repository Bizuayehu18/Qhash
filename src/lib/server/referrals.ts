import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

const REFERRAL_REWARD_TRANSACTION_TYPES = [
  "referral_investment_bonus",
  "referral_daily_bonus",
];

const REFERRAL_DAY_RESET_UTC_HOUR = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

function validateAccessToken(data: unknown): { accessToken: string } {
  if (!data || typeof data !== "object")
    throwSafe("REFERRAL", "Failed to load team stats.", "Invalid request data");
  const { accessToken } = data as Record<string, unknown>;
  if (typeof accessToken !== "string" || accessToken.length === 0)
    throwSafe("REFERRAL", "Failed to load team stats.", "Missing access token");
  return { accessToken };
}

function getReferralDayWindow(now = new Date()): { start: Date; end: Date } {
  let start = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      REFERRAL_DAY_RESET_UTC_HOUR,
      0,
      0,
      0,
    ),
  );

  if (now.getTime() < start.getTime()) {
    start = new Date(start.getTime() - DAY_MS);
  }

  return {
    start,
    end: new Date(start.getTime() + DAY_MS),
  };
}

export const loadReferralStatsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateAccessToken(data))
  .handler(async ({ data }) => {
    const { accessToken } = data;
    const admin = getAdminClient();

    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(accessToken);

    if (authError || !authUser)
      throwSafe("REFERRAL", "Failed to load team stats.", "Invalid or expired access token");
    const userId = authUser.id;

    try {
      const { data: referralRows, error: refError } = await admin
        .from("referrals")
        .select("id, referred_user_id, level, total_investment_rewards, total_mining_rewards, created_at")
        .eq("referrer_id", userId)
        .order("level", { ascending: true })
        .order("created_at", { ascending: false });

      if (refError) {
        throwSafe("REFERRAL", "Failed to load team stats.", "Referrals query: " + refError.message);
      }

      const rows = referralRows ?? [];
      const referredIds = [...new Set(rows.map((r) => r.referred_user_id))];
      const total = referredIds.length;

      let activeMembers = new Set<string>();
      if (referredIds.length > 0) {
        const { data: activeInvestments, error: invError } = await admin
          .from("investments")
          .select("user_id")
          .in("user_id", referredIds)
          .eq("status", "active");

        if (invError) {
          throwSafe("REFERRAL", "Failed to load team stats.", "Investments query: " + invError.message);
        }

        activeMembers = new Set((activeInvestments ?? []).map((i) => i.user_id));
      }

      let nameByUserId = new Map<string, string>();
      if (referredIds.length > 0) {
        const { data: profileRows, error: profileError } = await admin
          .from("profiles")
          .select("id, username")
          .in("id", referredIds);

        if (profileError) {
          throwSafe("REFERRAL", "Failed to load team stats.", "Profiles query: " + profileError.message);
        }

        nameByUserId = new Map((profileRows ?? []).map((profile) => [profile.id, profile.username]));
      }

      const { start, end } = getReferralDayWindow();

      const { data: todayRewardRows, error: todayRewardsError } = await admin
        .from("transactions")
        .select("amount")
        .eq("user_id", userId)
        .in("type", REFERRAL_REWARD_TRANSACTION_TYPES)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString());

      if (todayRewardsError) {
        throwSafe(
          "REFERRAL",
          "Failed to load team stats.",
          "Today rewards query: " + todayRewardsError.message,
        );
      }

      const investmentRewards = rows.reduce((sum, r) => sum + Number(r.total_investment_rewards ?? 0), 0);
      const miningRewards = rows.reduce((sum, r) => sum + Number(r.total_mining_rewards ?? 0), 0);
      const earned = investmentRewards + miningRewards;
      const todayRewards = (todayRewardRows ?? []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

      const members = rows.map((row) => ({
        id: row.id,
        name: nameByUserId.get(row.referred_user_id) ?? null,
        level: row.level,
        joinedAt: row.created_at,
        isActive: activeMembers.has(row.referred_user_id),
      }));

      return {
        total,
        active: activeMembers.size,
        earned,
        todayRewards,
        investmentRewards,
        miningRewards,
        members,
      };
    } catch (err) {
      if (err && typeof err === "object" && "domain" in err) throw err;
      console.error("[QHash] Referral stats error:", err);
      throwSafe(
        "REFERRAL",
        "Failed to load team stats. Please try again.",
        `Referral stats error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

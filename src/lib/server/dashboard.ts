import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

const INCOME_DAY_RESET_UTC_HOUR = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

const TEAM_REWARD_TRANSACTION_TYPES = [
  "referral_daily_bonus",
  "referral_investment_bonus",
];

const TODAY_INCOME_TRANSACTION_TYPES = [
  "earning",
  ...TEAM_REWARD_TRANSACTION_TYPES,
];

function validateAccessToken(data: unknown): { accessToken: string } {
  if (!data || typeof data !== "object") throwSafe("SERVER", "Failed to load dashboard.", "Invalid request data");
  const { accessToken } = data as Record<string, unknown>;
  if (typeof accessToken !== "string" || accessToken.length === 0)
    throwSafe("SERVER", "Failed to load dashboard.", "Missing access token");
  return { accessToken };
}

function getIncomeDayWindow(now = new Date()): { start: Date; end: Date } {
  let start = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      INCOME_DAY_RESET_UTC_HOUR,
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

async function getOrCreateWallet(userId: string) {
  const admin = getAdminClient();

  const { data: existing } = await admin
    .from("wallets")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (existing) return existing;

  const { data: created, error } = await admin
    .from("wallets")
    .insert({ user_id: userId, balance: 0 })
    .select()
    .single();

  if (error) throwSafe("WALLET", "Unable to load wallet.", "Wallet creation failed: " + error.message);
  return created!;
}

export const loadDashboardFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateAccessToken(data))
  .handler(async ({ data }) => {
    const { accessToken } = data;
    const admin = getAdminClient();

    // Derive the caller identity from the session access token. The client
    // never supplies the user id used for the wallet/investment/transaction
    // queries below.
    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(accessToken);
    if (authError || !authUser)
      throwSafe("SERVER", "Failed to load dashboard.", "Invalid or expired access token");
    const userId = authUser.id;

    try {
      const wallet = await getOrCreateWallet(userId);

      const { data: allInvestments } = await admin
        .from("investments")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      const invs = allInvestments ?? [];
      const active = invs.filter((i) => i.status === "active");
      const completed = invs.filter((i) => i.status === "completed");
      const dailyEarningRate = active.reduce(
        (sum, inv) => sum + inv.daily_earning,
        0,
      );
      const totalEarned = invs.reduce(
        (sum, inv) => sum + inv.total_earned,
        0,
      );

      const { data: teamRewardRows, error: teamRewardError } = await admin
        .from("referrals")
        .select("total_investment_rewards, total_mining_rewards")
        .eq("referrer_id", userId);

      if (teamRewardError) {
        throwSafe(
          "SERVER",
          "Failed to load dashboard.",
          "Team rewards query: " + teamRewardError.message,
        );
      }

      const totalTeamRewards = (teamRewardRows ?? []).reduce(
        (sum, row) =>
          sum + Number(row.total_investment_rewards ?? 0) + Number(row.total_mining_rewards ?? 0),
        0,
      );

      const { start, end } = getIncomeDayWindow();

      const { data: todayIncomeRows, error: todayIncomeError } = await admin
        .from("transactions")
        .select("amount, type")
        .eq("user_id", userId)
        .in("type", TODAY_INCOME_TRANSACTION_TYPES)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString());

      if (todayIncomeError) {
        throwSafe(
          "SERVER",
          "Failed to load dashboard.",
          "Today income query: " + todayIncomeError.message,
        );
      }

      const todayRows = todayIncomeRows ?? [];

      const todayPlanIncome = todayRows.reduce(
        (sum, row) => row.type === "earning" ? sum + Number(row.amount ?? 0) : sum,
        0,
      );

      const todayTeamRewards = todayRows.reduce(
        (sum, row) => TEAM_REWARD_TRANSACTION_TYPES.includes(row.type)
          ? sum + Number(row.amount ?? 0)
          : sum,
        0,
      );

      const { data: recentTxns } = await admin
        .from("transactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(10);

      return {
        wallet,
        activeInvestments: active,
        completedInvestments: completed,
        dailyEarningRate,
        totalEarned,
        incomeSummary: {
          todayPlanIncome,
          todayTeamRewards,
          todayTotalIncome: todayPlanIncome + todayTeamRewards,
          totalPlanIncome: totalEarned,
          totalTeamRewards,
          totalIncome: totalEarned + totalTeamRewards,
          resetHourUtc: INCOME_DAY_RESET_UTC_HOUR,
        },
        recentTransactions: recentTxns ?? [],
      };
    } catch (err) {
      // Re-throw domain errors (from throwSafe calls above) so the specific
      // error message reaches the client rather than being replaced by the
      // generic fallback below.
      if (err && typeof err === "object" && "domain" in err) throw err;
      console.error("[QHash] Dashboard load error:", err);
      throwSafe("SERVER", "Failed to load dashboard. Please try again.", `Dashboard error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

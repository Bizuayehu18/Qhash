import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types.js";

type Admin = SupabaseClient<Database>;

interface RewardResult {
  level: number;
  referrerId: string;
  amount: number;
  skipped: boolean;
  reason?: string;
}

interface InvestmentRewardRpcResult {
  processed?: boolean;
  skipped?: boolean;
  reason?: string | null;
  level?: number;
  referrer_user_id?: string;
  reward_amount?: number;
  transaction_id?: string;
  balance_before?: number;
  balance_after?: number;
  investment_id?: string;
  [key: string]: unknown;
}

type InvestmentRewardRpcClient = {
  rpc(
    fn: "credit_investment_referral_reward",
    args: {
      p_referral_id: string;
      p_purchaser_user_id: string;
      p_referrer_user_id: string;
      p_investment_id: string;
      p_level: number;
      p_percent: number;
      p_investment_amount: number;
    },
  ): Promise<{
    data: InvestmentRewardRpcResult | null;
    error: { message?: string; code?: string; details?: string; hint?: unknown } | null;
  }>;
};

export async function processInvestmentReferralRewards(
  admin: Admin,
  purchaserId: string,
  investmentId: string,
  investmentAmount: number,
): Promise<RewardResult[]> {
  const tag = `[referral-reward inv=${investmentId}]`;
  const results: RewardResult[] = [];

  console.log(`${tag} START purchaser=${purchaserId} amount=${investmentAmount}`);

  // Load reward percentages from app_settings
  const { data: settings, error: settingsErr } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "investment_referral_level_1_percent",
      "investment_referral_level_2_percent",
      "investment_referral_level_3_percent",
    ]);

  if (settingsErr || !settings || settings.length === 0) {
    console.error(`${tag} ABORT failed to load reward percentages:`, settingsErr?.message);
    return results;
  }

  const percentByLevel: Record<number, number> = {};
  for (const s of settings) {
    const lvl = s.key === "investment_referral_level_1_percent" ? 1
      : s.key === "investment_referral_level_2_percent" ? 2
      : s.key === "investment_referral_level_3_percent" ? 3
      : 0;
    if (lvl > 0) percentByLevel[lvl] = parseFloat(s.value);
  }
  console.log(`${tag} percentages loaded:`, JSON.stringify(percentByLevel));

  // Query referrals table for upline referrers of the purchaser
  const { data: referralRows, error: refErr } = await admin
    .from("referrals")
    .select("id, referrer_id, level")
    .eq("referred_user_id", purchaserId)
    .gte("level", 1)
    .lte("level", 3)
    .order("level", { ascending: true });

  if (refErr) {
    console.error(`${tag} ABORT failed to load referral rows:`, refErr.message);
    return results;
  }

  if (!referralRows || referralRows.length === 0) {
    console.log(`${tag} no referral rows found for purchaser, skipping rewards`);
    return results;
  }

  console.log(`${tag} found ${referralRows.length} referral row(s)`);

  for (const row of referralRows) {
    const level = row.level;
    const referrerId = row.referrer_id;
    const percent = percentByLevel[level];

    if (!percent || percent <= 0) {
      console.log(`${tag} level=${level} referrer=${referrerId} SKIP no percentage configured`);
      results.push({ level, referrerId, amount: 0, skipped: true, reason: "no_percentage" });
      continue;
    }

    // Anti-abuse: prevent self-reward before calling the RPC. The RPC also
    // enforces this so direct callers cannot bypass the rule.
    if (referrerId === purchaserId) {
      console.log(`${tag} level=${level} referrer=${referrerId} SKIP self-reward blocked`);
      results.push({ level, referrerId, amount: 0, skipped: true, reason: "self_reward" });
      continue;
    }

    try {
      const { data, error } = await (admin as unknown as InvestmentRewardRpcClient).rpc(
        "credit_investment_referral_reward",
        {
          p_referral_id: row.id,
          p_purchaser_user_id: purchaserId,
          p_referrer_user_id: referrerId,
          p_investment_id: investmentId,
          p_level: level,
          p_percent: percent,
          p_investment_amount: investmentAmount,
        },
      );

      if (error) {
        const message = [
          error.message,
          error.code && `code=${error.code}`,
          error.details && `details=${error.details}`,
        ]
          .filter(Boolean)
          .join(" | ");

        console.error(`${tag} level=${level} referrer=${referrerId} RPC failed:`, message);
        results.push({ level, referrerId, amount: 0, skipped: true, reason: "rpc_failed" });
        continue;
      }

      const rewardAmount = Number(data?.reward_amount ?? 0);
      const skipped = Boolean(data?.skipped) || !data?.processed;
      const reason = typeof data?.reason === "string" ? data.reason : skipped ? "skipped" : undefined;

      if (skipped) {
        console.log(`${tag} level=${level} referrer=${referrerId} SKIP ${reason ?? "skipped"}`);
        results.push({ level, referrerId, amount: rewardAmount, skipped: true, reason });
        continue;
      }

      console.log(`${tag} level=${level} referrer=${referrerId} reward=${rewardAmount} (${percent}% of ${investmentAmount})`);
      console.log(`${tag} level=${level} referrer=${referrerId} transaction=${data?.transaction_id ?? "(unknown)"}`);

      // Notification is intentionally best-effort. The wallet credit, reward log,
      // referral total update, and transaction audit were already committed by
      // the RPC; a notification failure should not undo them.
      console.log(`${tag} level=${level} referrer=${referrerId} notification_insert_started`);
      const { error: notifErr } = await admin
        .from("notifications")
        .insert({
          user_id: referrerId,
          title: "Referral Bonus Received",
          message: `You received a level ${level} investment referral bonus of ${rewardAmount} ETB.`,
          is_read: false,
          metadata: {
            type: "referral_investment_bonus",
            level,
            amount: rewardAmount,
            investment_id: investmentId,
            transaction_id: data?.transaction_id ?? null,
          },
        });

      if (notifErr) {
        console.error(`${tag} level=${level} referrer=${referrerId} notification_insert_failed:`, notifErr.message, notifErr.code, notifErr.details);
      } else {
        console.log(`${tag} level=${level} referrer=${referrerId} notification_insert_success`);
      }

      results.push({ level, referrerId, amount: rewardAmount, skipped: false });
    } catch (err) {
      console.error(`${tag} level=${level} referrer=${referrerId} ERROR:`, err instanceof Error ? err.message : String(err));
      results.push({ level, referrerId, amount: 0, skipped: true, reason: "unexpected_error" });
    }
  }

  const rewarded = results.filter(r => !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  console.log(`${tag} COMPLETE rewarded=${rewarded} skipped=${skipped}`);

  return results;
}

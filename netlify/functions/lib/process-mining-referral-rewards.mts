import type { SupabaseClient } from "@supabase/supabase-js";

interface MiningRewardResult {
  level: number;
  referrerId: string;
  amount: number;
  skipped: boolean;
  reason?: string;
}

interface ReferralRow {
  id: string;
  referrer_id: string;
  level: number;
}

interface MiningRewardRpcResult {
  processed?: boolean;
  skipped?: boolean;
  reason?: string | null;
  level?: number;
  referrer_user_id?: string;
  reward_amount?: number;
  transaction_id?: string;
  balance_before?: number;
  balance_after?: number;
  [key: string]: unknown;
}

type MiningRewardRpcClient = {
  rpc(
    fn: "credit_mining_referral_reward",
    args: {
      p_referral_id: string;
      p_earner_user_id: string;
      p_referrer_user_id: string;
      p_earning_transaction_id: string;
      p_investment_id: string;
      p_level: number;
      p_percent: number;
      p_earning_amount: number;
    },
  ): Promise<{
    data: MiningRewardRpcResult | null;
    error: {
      message?: string;
      code?: string;
      details?: string;
      hint?: unknown;
    } | null;
  }>;
};

function log(step: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      fn: "mining-referral-rewards",
      step,
      ts: new Date().toISOString(),
      ...data,
    })
  );
}

function logError(step: string, data: Record<string, unknown>) {
  console.error(
    JSON.stringify({
      fn: "mining-referral-rewards",
      step,
      ts: new Date().toISOString(),
      ...data,
    })
  );
}

export async function loadMiningReferralPercentages(
  admin: SupabaseClient
): Promise<Record<number, number>> {
  const { data: settings, error } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", [
      "mining_referral_level_1_percent",
      "mining_referral_level_2_percent",
      "mining_referral_level_3_percent",
    ]);

  if (error || !settings || settings.length === 0) {
    logError("settings_load_failed", { error: error?.message });
    return {};
  }

  const percentByLevel: Record<number, number> = {};
  for (const s of settings) {
    const lvl =
      s.key === "mining_referral_level_1_percent"
        ? 1
        : s.key === "mining_referral_level_2_percent"
          ? 2
          : s.key === "mining_referral_level_3_percent"
            ? 3
            : 0;
    if (lvl > 0) percentByLevel[lvl] = parseFloat(s.value);
  }
  return percentByLevel;
}

export async function processMiningReferralRewards(
  admin: SupabaseClient,
  earnerUserId: string,
  earningTransactionId: string,
  investmentId: string,
  earningAmount: number,
  percentByLevel: Record<number, number>
): Promise<MiningRewardResult[]> {
  const results: MiningRewardResult[] = [];

  log("mining_referral_started", {
    earner_user_id: earnerUserId,
    earning_transaction_id: earningTransactionId,
    investment_id: investmentId,
    earning_amount: earningAmount,
  });

  if (Object.keys(percentByLevel).length === 0) {
    log("mining_referral_completed", { reason: "no_percentages_configured" });
    return results;
  }

  const { data: referralRows, error: refErr } = await admin
    .from("referrals")
    .select("id, referrer_id, level")
    .eq("referred_user_id", earnerUserId)
    .in("level", [1, 2, 3])
    .order("level", { ascending: true });

  if (refErr) {
    logError("referral_query_failed", { error: refErr.message });
    return results;
  }

  log("referral_rows_found", { count: referralRows?.length ?? 0 });

  if (!referralRows || referralRows.length === 0) {
    log("mining_referral_completed", { reason: "no_referrals" });
    return results;
  }

  for (const row of referralRows as ReferralRow[]) {
    const level = Number(row.level);
    const referrerId = String(row.referrer_id);
    const percent = percentByLevel[level];

    if (!percent || percent <= 0) {
      results.push({
        level,
        referrerId,
        amount: 0,
        skipped: true,
        reason: "no_percentage",
      });
      continue;
    }

    try {
      const { data, error } = await (admin as unknown as MiningRewardRpcClient).rpc(
        "credit_mining_referral_reward",
        {
          p_referral_id: row.id,
          p_earner_user_id: earnerUserId,
          p_referrer_user_id: referrerId,
          p_earning_transaction_id: earningTransactionId,
          p_investment_id: investmentId,
          p_level: level,
          p_percent: percent,
          p_earning_amount: earningAmount,
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

        logError("atomic_reward_failed", {
          level,
          referrer_id: referrerId,
          earning_transaction_id: earningTransactionId,
          error: message,
        });
        results.push({
          level,
          referrerId,
          amount: 0,
          skipped: true,
          reason: "atomic_reward_failed",
        });
        continue;
      }

      const rewardAmount = Number(data?.reward_amount ?? 0);
      const reason = typeof data?.reason === "string" ? data.reason : undefined;

      if (!data?.processed) {
        log("reward_skipped", {
          level,
          referrer_id: referrerId,
          reason: reason ?? "unknown",
          earning_transaction_id: earningTransactionId,
        });
        results.push({
          level,
          referrerId,
          amount: rewardAmount,
          skipped: true,
          reason: reason ?? "skipped",
        });
        continue;
      }

      log("reward_processed", {
        level,
        referrer_id: referrerId,
        reward: rewardAmount,
        percent,
        earning_amount: earningAmount,
        transaction_id: data.transaction_id,
        balance_before: data.balance_before,
        balance_after: data.balance_after,
      });

      results.push({ level, referrerId, amount: rewardAmount, skipped: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError("atomic_reward_exception", {
        level,
        referrer_id: referrerId,
        earning_transaction_id: earningTransactionId,
        error: message,
      });
      results.push({
        level,
        referrerId,
        amount: 0,
        skipped: true,
        reason: "atomic_reward_exception",
      });
    }
  }

  const rewarded = results.filter((r) => !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  log("mining_referral_completed", {
    rewarded,
    skipped,
    earning_transaction_id: earningTransactionId,
  });

  return results;
}

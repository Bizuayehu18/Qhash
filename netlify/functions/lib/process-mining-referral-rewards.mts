import type { SupabaseClient } from "@supabase/supabase-js";

interface MiningRewardResult {
  level: number;
  referrerId: string;
  amount: number;
  skipped: boolean;
  reason?: string;
}

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

  for (const row of referralRows) {
    const level = row.level;
    const referrerId = row.referrer_id;
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

    // Eligibility: referrer must have at least one active investment
    const { count: activeCount, error: activeErr } = await admin
      .from("investments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", referrerId)
      .eq("status", "active");

    if (activeErr) {
      logError("eligibility_check_error", {
        level,
        referrer_id: referrerId,
        error: activeErr.message,
      });
      results.push({
        level,
        referrerId,
        amount: 0,
        skipped: true,
        reason: "eligibility_check_error",
      });
      continue;
    }

    if (!activeCount || activeCount === 0) {
      log("inactive_level_skipped", { level, referrer_id: referrerId });
      results.push({
        level,
        referrerId,
        amount: 0,
        skipped: true,
        reason: "inactive",
      });
      continue;
    }

    // Duplicate check (application-level)
    const { data: existingLog } = await admin
      .from("referral_reward_logs")
      .select("id")
      .eq("earning_reference_id", earningTransactionId)
      .eq("referrer_user_id", referrerId)
      .eq("level", level)
      .eq("reward_type", "mining")
      .maybeSingle();

    if (existingLog) {
      log("duplicate_prevented", {
        level,
        referrer_id: referrerId,
        earning_transaction_id: earningTransactionId,
      });
      results.push({
        level,
        referrerId,
        amount: 0,
        skipped: true,
        reason: "duplicate",
      });
      continue;
    }

    const rewardAmount =
      Math.round(((earningAmount * percent) / 100) * 100) / 100;
    log("reward_calculated", {
      level,
      referrer_id: referrerId,
      reward: rewardAmount,
      percent,
      earning_amount: earningAmount,
    });

    // 1. Insert referral_reward_logs FIRST — application-level check above is the
    //    authoritative duplicate guard for mining rewards.  investment_id is set to
    //    null so the (investment_id, referrer, level, type) unique constraint does
    //    not falsely block subsequent daily earnings from the same investment.
    const { error: logErr } = await admin
      .from("referral_reward_logs")
      .insert({
        investment_id: null,
        earning_reference_id: earningTransactionId,
        purchaser_user_id: null,
        earner_user_id: earnerUserId,
        referrer_user_id: referrerId,
        referred_user_id: earnerUserId,
        level,
        reward_type: "mining",
        reward_amount: rewardAmount,
      });

    if (logErr) {
      if (logErr.code === "23505") {
        log("duplicate_prevented", {
          level,
          referrer_id: referrerId,
          earning_transaction_id: earningTransactionId,
          source: "unique_constraint",
        });
        results.push({
          level,
          referrerId,
          amount: 0,
          skipped: true,
          reason: "duplicate",
        });
        continue;
      } else {
        logError("reward_log_create_failed", {
          level,
          referrer_id: referrerId,
          error: logErr.message,
          code: logErr.code,
        });
        results.push({
          level,
          referrerId,
          amount: rewardAmount,
          skipped: true,
          reason: "reward_log_failed",
        });
        continue;
      }
    }
    log("reward_log_created", { level, referrer_id: referrerId });

    // 2. Get current wallet balance
    const { data: wallet, error: walletErr } = await admin
      .from("wallets")
      .select("balance")
      .eq("user_id", referrerId)
      .single();

    if (walletErr || !wallet) {
      logError("wallet_not_found", {
        level,
        referrer_id: referrerId,
        error: walletErr?.message,
      });
      results.push({
        level,
        referrerId,
        amount: rewardAmount,
        skipped: true,
        reason: "no_wallet",
      });
      continue;
    }

    const balanceBefore = Number(wallet.balance);
    const balanceAfter = balanceBefore + rewardAmount;

    // 3. Update wallet balance
    const { error: updateErr } = await admin
      .from("wallets")
      .update({ balance: balanceAfter, updated_at: new Date().toISOString() })
      .eq("user_id", referrerId);

    if (updateErr) {
      logError("wallet_update_failed", {
        level,
        referrer_id: referrerId,
        error: updateErr.message,
      });
      results.push({
        level,
        referrerId,
        amount: rewardAmount,
        skipped: true,
        reason: "wallet_update_failed",
      });
      continue;
    }
    log("wallet_updated", {
      level,
      referrer_id: referrerId,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
    });

    // 4. Create transaction
    const { error: txErr } = await admin.from("transactions").insert({
      user_id: referrerId,
      type: "referral_daily_bonus" as const,
      amount: rewardAmount,
      status: "completed" as const,
      balance_before: balanceBefore,
      balance_after: balanceAfter,
      description: `Level ${level} daily mining referral bonus (${percent}%)`,
      reference_id: earningTransactionId,
      metadata: {
        reward_type: "mining",
        level,
        percentage: percent,
        earning_amount: earningAmount,
        earner_user_id: earnerUserId,
        investment_id: investmentId,
      },
    });

    if (txErr) {
      logError("transaction_create_failed", {
        level,
        referrer_id: referrerId,
        error: txErr.message,
      });
    } else {
      log("transaction_created", { level, referrer_id: referrerId });
    }

    // 5. Update referrals.total_mining_rewards
    const { data: currentRef } = await admin
      .from("referrals")
      .select("total_mining_rewards")
      .eq("id", row.id)
      .single();

    if (currentRef) {
      const newTotal = Number(currentRef.total_mining_rewards) + rewardAmount;
      const { error: refUpdErr } = await admin
        .from("referrals")
        .update({ total_mining_rewards: newTotal })
        .eq("id", row.id);

      if (refUpdErr) {
        logError("referral_total_update_failed", {
          level,
          referrer_id: referrerId,
          error: refUpdErr.message,
        });
      }
    }

    results.push({ level, referrerId, amount: rewardAmount, skipped: false });
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

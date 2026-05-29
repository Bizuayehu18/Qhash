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

    // Anti-abuse: prevent self-reward
    if (referrerId === purchaserId) {
      console.log(`${tag} level=${level} referrer=${referrerId} SKIP self-reward blocked`);
      results.push({ level, referrerId, amount: 0, skipped: true, reason: "self_reward" });
      continue;
    }

    // Check for duplicate reward
    const { data: existingLog } = await admin
      .from("referral_reward_logs")
      .select("id")
      .eq("investment_id", investmentId)
      .eq("referrer_user_id", referrerId)
      .eq("level", level)
      .eq("reward_type", "investment")
      .maybeSingle();

    if (existingLog) {
      console.log(`${tag} level=${level} referrer=${referrerId} SKIP duplicate reward prevented`);
      results.push({ level, referrerId, amount: 0, skipped: true, reason: "duplicate" });
      continue;
    }

    // Eligibility: referrer must have at least one active investment
    const { count: activeCount, error: activeErr } = await admin
      .from("investments")
      .select("id", { count: "exact", head: true })
      .eq("user_id", referrerId)
      .eq("status", "active");

    if (activeErr) {
      console.error(`${tag} level=${level} referrer=${referrerId} SKIP error checking active investments:`, activeErr.message);
      results.push({ level, referrerId, amount: 0, skipped: true, reason: "eligibility_check_error" });
      continue;
    }

    if (!activeCount || activeCount === 0) {
      console.log(`${tag} level=${level} referrer=${referrerId} SKIP no active investment (inactive)`);
      results.push({ level, referrerId, amount: 0, skipped: true, reason: "inactive" });
      continue;
    }

    // Calculate reward
    const rewardAmount = Math.round((investmentAmount * percent / 100) * 100) / 100;
    console.log(`${tag} level=${level} referrer=${referrerId} reward=${rewardAmount} (${percent}% of ${investmentAmount})`);

    // Get current wallet balance
    const { data: wallet, error: walletErr } = await admin
      .from("wallets")
      .select("balance")
      .eq("user_id", referrerId)
      .single();

    if (walletErr || !wallet) {
      console.error(`${tag} level=${level} referrer=${referrerId} SKIP wallet not found:`, walletErr?.message);
      results.push({ level, referrerId, amount: rewardAmount, skipped: true, reason: "no_wallet" });
      continue;
    }

    const balanceBefore = Number(wallet.balance);
    const balanceAfter = balanceBefore + rewardAmount;

    // Update wallet balance
    const { error: updateErr } = await admin
      .from("wallets")
      .update({ balance: balanceAfter })
      .eq("user_id", referrerId);

    if (updateErr) {
      console.error(`${tag} level=${level} referrer=${referrerId} FAIL wallet update:`, updateErr.message);
      results.push({ level, referrerId, amount: rewardAmount, skipped: true, reason: "wallet_update_failed" });
      continue;
    }
    console.log(`${tag} level=${level} referrer=${referrerId} wallet updated ${balanceBefore} -> ${balanceAfter}`);

    // Create transaction
    const { error: txErr } = await admin
      .from("transactions")
      .insert({
        user_id: referrerId,
        type: "referral_investment_bonus" as const,
        amount: rewardAmount,
        status: "completed" as const,
        balance_before: balanceBefore,
        balance_after: balanceAfter,
        description: `Level ${level} investment referral bonus (${percent}%)`,
        reference_id: investmentId,
        metadata: {
          reward_type: "investment",
          level,
          percentage: percent,
          investment_amount: investmentAmount,
          purchaser_id: purchaserId,
        },
      });

    if (txErr) {
      console.error(`${tag} level=${level} referrer=${referrerId} WARN transaction insert failed:`, txErr.message);
    } else {
      console.log(`${tag} level=${level} referrer=${referrerId} transaction inserted`);
    }

    // Create notification
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
        },
      });

    if (notifErr) {
      console.error(`${tag} level=${level} referrer=${referrerId} notification_insert_failed:`, notifErr.message, notifErr.code, notifErr.details);
    } else {
      console.log(`${tag} level=${level} referrer=${referrerId} notification_insert_success`);
    }

    // Update referrals.total_investment_rewards
    const { data: currentRef } = await admin
      .from("referrals")
      .select("total_investment_rewards")
      .eq("id", row.id)
      .single();

    if (currentRef) {
      const newTotal = Number(currentRef.total_investment_rewards) + rewardAmount;
      const { error: refUpdErr } = await admin
        .from("referrals")
        .update({ total_investment_rewards: newTotal })
        .eq("id", row.id);

      if (refUpdErr) {
        console.error(`${tag} level=${level} referrer=${referrerId} WARN referral total update failed:`, refUpdErr.message);
      } else {
        console.log(`${tag} level=${level} referrer=${referrerId} referral total updated to ${newTotal}`);
      }
    }

    // Insert referral_reward_logs row
    console.log(`${tag} level=${level} referrer=${referrerId} reward_log_insert_started`);
    const { error: logErr } = await admin
      .from("referral_reward_logs")
      .insert({
        investment_id: investmentId,
        earning_reference_id: null,
        purchaser_user_id: purchaserId,
        earner_user_id: null,
        referrer_user_id: referrerId,
        referred_user_id: purchaserId,
        level,
        reward_type: "investment",
        reward_amount: rewardAmount,
      });

    if (logErr) {
      console.error(`${tag} level=${level} referrer=${referrerId} reward_log_insert_failed:`, logErr.message, logErr.code, logErr.details);
    } else {
      console.log(`${tag} level=${level} referrer=${referrerId} reward_log_insert_success`);
    }

    results.push({ level, referrerId, amount: rewardAmount, skipped: false });
  }

  const rewarded = results.filter(r => !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  console.log(`${tag} COMPLETE rewarded=${rewarded} skipped=${skipped}`);

  return results;
}

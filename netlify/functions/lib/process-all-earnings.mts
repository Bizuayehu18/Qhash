import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadMiningReferralPercentages,
  processMiningReferralRewards,
} from "./process-mining-referral-rewards.mts";

interface ActiveInvestment {
  id: string;
  user_id: string;
  daily_earning: number;
  total_earned: number;
  start_date: string;
  end_date: string;
  last_earning_at: string | null;
}

export interface EarningTransaction {
  user_id: string;
  investment_id: string;
  amount: number;
  earning_date: string;
  earning_day_index: number;
  transaction_id?: string;
}

export interface EarningRunStats {
  run_id: string;
  trigger_type: "scheduled" | "manual";
  started_at: string;
  completed_at: string | null;
  status: "running" | "completed" | "failed";
  total_active_investments: number;
  total_users_processed: number;
  total_investments_processed: number;
  total_earnings_credited: number;
  total_skipped: number;
  total_completed_investments: number;
  total_errors: number;
  total_transactions_created: number;
  earning_transactions: EarningTransaction[];
  error_details: Array<{
    user_id: string;
    investment_id?: string;
    error: string;
  }>;
}

function log(step: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      fn: "daily-earnings",
      step,
      ts: new Date().toISOString(),
      ...data,
    })
  );
}

function logError(step: string, data: Record<string, unknown>) {
  console.error(
    JSON.stringify({
      fn: "daily-earnings",
      step,
      ts: new Date().toISOString(),
      ...data,
    })
  );
}

export async function processAllEarnings(
  admin: SupabaseClient,
  triggerType: "scheduled" | "manual"
): Promise<EarningRunStats> {
  const runId = `earn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const stats: EarningRunStats = {
    run_id: runId,
    trigger_type: triggerType,
    started_at: new Date().toISOString(),
    completed_at: null,
    status: "running",
    total_active_investments: 0,
    total_users_processed: 0,
    total_investments_processed: 0,
    total_earnings_credited: 0,
    total_skipped: 0,
    total_completed_investments: 0,
    total_errors: 0,
    total_transactions_created: 0,
    earning_transactions: [],
    error_details: [],
  };

  log("run_started", { run_id: runId, trigger_type: triggerType });

  try {
    const { data: investments, error: fetchError } = await admin
      .from("investments")
      .select(
        "id, user_id, daily_earning, total_earned, start_date, end_date, last_earning_at"
      )
      .eq("status", "active")
      .order("user_id");

    if (fetchError) {
      throw new Error(`Failed to fetch investments: ${fetchError.message}`);
    }

    if (!investments || investments.length === 0) {
      log("no_investments", { message: "No active investments found" });
      stats.status = "completed";
      stats.completed_at = new Date().toISOString();
      await saveRunLog(admin, stats);
      return stats;
    }

    stats.total_active_investments = investments.length;
    log("investments_found", { count: investments.length });

    const userInvestments = new Map<string, ActiveInvestment[]>();
    for (const inv of investments) {
      const list = userInvestments.get(inv.user_id) ?? [];
      list.push(inv as ActiveInvestment);
      userInvestments.set(inv.user_id, list);
    }

    log("users_found", { count: userInvestments.size });

    const miningPercentages = await loadMiningReferralPercentages(admin);
    log("mining_referral_percentages_loaded", { levels: Object.keys(miningPercentages).length });

    const now = new Date();

    for (const [userId, invs] of userInvestments) {
      try {
        const { data: wallet } = await admin
          .from("wallets")
          .select("balance")
          .eq("user_id", userId)
          .single();

        let currentBalance = wallet?.balance ?? 0;
        let userEarnings = 0;
        let userProcessed = 0;
        let userSkipped = 0;
        let userCompleted = 0;
        const userEarningTxns: Array<{
          transactionId: string;
          investmentId: string;
          amount: number;
        }> = [];

        for (const inv of invs) {
          try {
            const lastEarning = new Date(inv.last_earning_at ?? inv.start_date);
            const endDate = new Date(inv.end_date);
            const effectiveNow = now > endDate ? endDate : now;

            const msElapsed = effectiveNow.getTime() - lastEarning.getTime();
            const daysElapsed = Math.floor(msElapsed / (24 * 60 * 60 * 1000));

            if (daysElapsed <= 0) {
              if (now >= endDate) {
                await admin
                  .from("investments")
                  .update({ status: "completed" as const })
                  .eq("id", inv.id);
                userCompleted++;
              }
              userSkipped++;
              continue;
            }

            const totalEarnings = daysElapsed * inv.daily_earning;
            const DAY_MS = 24 * 60 * 60 * 1000;
            const newLastEarningAt = new Date(
              lastEarning.getTime() + daysElapsed * DAY_MS
            ).toISOString();

            for (let dayIdx = 1; dayIdx <= daysElapsed; dayIdx++) {
              const earningDate = new Date(
                lastEarning.getTime() + dayIdx * DAY_MS
              )
                .toISOString()
                .slice(0, 10);
              const balanceBefore = currentBalance;
              const balanceAfter = currentBalance + inv.daily_earning;

              const { data: txRow } = await admin.from("transactions").insert({
                user_id: userId,
                type: "earning",
                amount: inv.daily_earning,
                status: "completed",
                description: "Daily mining earnings",
                reference_id: inv.id,
                balance_before: balanceBefore,
                balance_after: balanceAfter,
                metadata: {
                  source: triggerType,
                  run_id: runId,
                  investment_id: inv.id,
                  earning_date: earningDate,
                  earning_day_index: dayIdx,
                },
              }).select("id").single();

              currentBalance = balanceAfter;
              const earningTxId = txRow?.id ?? undefined;
              if (earningTxId) {
                userEarningTxns.push({
                  transactionId: earningTxId,
                  investmentId: inv.id,
                  amount: inv.daily_earning,
                });
              }
              stats.earning_transactions.push({
                user_id: userId,
                investment_id: inv.id,
                amount: inv.daily_earning,
                earning_date: earningDate,
                earning_day_index: dayIdx,
                transaction_id: earningTxId,
              });
            }

            await admin
              .from("investments")
              .update({
                last_earning_at: newLastEarningAt,
                total_earned: inv.total_earned + totalEarnings,
                ...(now >= endDate
                  ? { status: "completed" as const }
                  : {}),
              })
              .eq("id", inv.id);

            userEarnings += totalEarnings;
            userProcessed++;
            stats.total_transactions_created += daysElapsed;

            if (now >= endDate) {
              userCompleted++;
            }
          } catch (invErr) {
            const msg =
              invErr instanceof Error ? invErr.message : String(invErr);
            logError("investment_error", {
              user_id: userId,
              investment_id: inv.id,
              error: msg,
            });
            stats.error_details.push({
              user_id: userId,
              investment_id: inv.id,
              error: msg,
            });
            stats.total_errors++;
          }
        }

        if (userEarnings > 0) {
          if (wallet) {
            await admin
              .from("wallets")
              .update({
                balance: currentBalance,
                updated_at: new Date().toISOString(),
              })
              .eq("user_id", userId);
          } else {
            await admin.from("wallets").insert({
              user_id: userId,
              balance: userEarnings,
            });
          }
        }

        // Process mining referral rewards (failures never rollback earnings)
        if (
          userEarningTxns.length > 0 &&
          Object.keys(miningPercentages).length > 0
        ) {
          for (const etx of userEarningTxns) {
            try {
              await processMiningReferralRewards(
                admin,
                userId,
                etx.transactionId,
                etx.investmentId,
                etx.amount,
                miningPercentages
              );
            } catch (refErr) {
              const msg =
                refErr instanceof Error ? refErr.message : String(refErr);
              logError("mining_referral_error", {
                user_id: userId,
                earning_transaction_id: etx.transactionId,
                error: msg,
              });
            }
          }
        }

        stats.total_investments_processed += userProcessed;
        stats.total_skipped += userSkipped;
        stats.total_completed_investments += userCompleted;
        stats.total_earnings_credited += userEarnings;
        stats.total_users_processed++;

        log("user_processed", {
          user_id: userId,
          investments_processed: userProcessed,
          skipped: userSkipped,
          completed: userCompleted,
          earnings: userEarnings,
        });
      } catch (userErr) {
        const msg =
          userErr instanceof Error ? userErr.message : String(userErr);
        logError("user_error", { user_id: userId, error: msg });
        stats.error_details.push({ user_id: userId, error: msg });
        stats.total_errors++;
      }
    }

    stats.status = "completed";
    stats.completed_at = new Date().toISOString();

    log("run_completed", {
      run_id: runId,
      users_processed: stats.total_users_processed,
      investments_processed: stats.total_investments_processed,
      transactions_created: stats.total_transactions_created,
      earnings_credited: stats.total_earnings_credited,
      skipped: stats.total_skipped,
      completed_investments: stats.total_completed_investments,
      errors: stats.total_errors,
    });

    await saveRunLog(admin, stats);
    return stats;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("run_failed", { run_id: runId, error: msg });
    stats.status = "failed";
    stats.completed_at = new Date().toISOString();
    stats.error_details.push({ user_id: "system", error: msg });
    stats.total_errors++;

    await saveRunLog(admin, stats);
    return stats;
  }
}

async function saveRunLog(
  admin: SupabaseClient,
  stats: EarningRunStats
): Promise<void> {
  log("earning_run_log_insert_started", { run_id: stats.run_id, status: stats.status });
  try {
    const { error } = await admin.from("earning_run_logs").insert({
      run_id: stats.run_id,
      trigger_type: stats.trigger_type,
      started_at: stats.started_at,
      completed_at: stats.completed_at,
      status: stats.status,
      total_active_investments: stats.total_active_investments,
      total_users_processed: stats.total_users_processed,
      total_investments_processed: stats.total_investments_processed,
      total_earnings_credited: stats.total_earnings_credited,
      total_skipped: stats.total_skipped,
      total_completed_investments: stats.total_completed_investments,
      total_errors: stats.total_errors,
      total_transactions_created: stats.total_transactions_created,
      error_details: stats.error_details,
    });
    if (error) {
      logError("earning_run_log_insert_failed", {
        run_id: stats.run_id,
        message: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
    } else {
      log("earning_run_log_insert_success", { run_id: stats.run_id });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("earning_run_log_insert_failed", {
      run_id: stats.run_id,
      message: msg,
      code: "EXCEPTION",
      details: null,
      hint: null,
    });
  }
}

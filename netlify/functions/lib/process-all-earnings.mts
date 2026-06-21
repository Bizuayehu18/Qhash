import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadMiningReferralPercentages,
  processMiningReferralRewards,
} from "./process-mining-referral-rewards.mts";

interface DueInvestment {
  id: string;
  user_id: string;
  next_earning_at: string | null;
  ends_at: string | null;
  status: string;
}

interface DueEarningRpcResult {
  processed?: boolean;
  reason?: string;
  investment_id?: string;
  user_id?: string;
  amount?: number;
  transaction_id?: string;
  earning_due_at?: string;
  earning_date?: string;
  earning_day_index?: number;
  balance_before?: number;
  balance_after?: number;
  next_earning_at?: string;
  status?: string;
  total_earned_after?: number;
  [key: string]: unknown;
}

type DueEarningRpcClient = {
  rpc(
    fn: "process_due_investment_earning",
    args: {
      p_investment_id: string;
      p_run_id: string;
      p_trigger_type: "scheduled" | "manual";
    },
  ): Promise<{
    data: DueEarningRpcResult | null;
    error: {
      message?: string;
      code?: string;
      details?: string;
      hint?: unknown;
    } | null;
  }>;
};

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

const MAX_DUE_INVESTMENTS_PER_RUN = 500;
const MAX_EARNING_CYCLES_PER_INVESTMENT_PER_RUN = 30;

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

function safeErrorMessage(error: unknown): string {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message;

  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Unknown error");
  }

  return String(error);
}

function isDue(nextEarningAt: string | null | undefined, checkedAt: Date): boolean {
  if (!nextEarningAt) return false;
  const nextTime = new Date(nextEarningAt).getTime();
  return Number.isFinite(nextTime) && nextTime <= checkedAt.getTime();
}

export async function processAllEarnings(
  admin: SupabaseClient,
  triggerType: "scheduled" | "manual"
): Promise<EarningRunStats> {
  const runId = `earn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const checkedAt = new Date();

  const stats: EarningRunStats = {
    run_id: runId,
    trigger_type: triggerType,
    started_at: checkedAt.toISOString(),
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

  const processedUserIds = new Set<string>();
  const processedInvestmentIds = new Set<string>();
  const completedInvestmentIds = new Set<string>();

  log("run_started", {
    run_id: runId,
    trigger_type: triggerType,
    checked_at: checkedAt.toISOString(),
  });

  try {
    const { count: activeCount, error: countError } = await admin
      .from("investments")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");

    if (countError) {
      throw new Error(`Failed to count active investments: ${countError.message}`);
    }

    stats.total_active_investments = activeCount ?? 0;

    const { data: investments, error: fetchError } = await admin
      .from("investments")
      .select("id, user_id, next_earning_at, ends_at, status")
      .eq("status", "active")
      .not("next_earning_at", "is", null)
      .lte("next_earning_at", checkedAt.toISOString())
      .order("next_earning_at", { ascending: true })
      .limit(MAX_DUE_INVESTMENTS_PER_RUN);

    if (fetchError) {
      throw new Error(`Failed to fetch due investments: ${fetchError.message}`);
    }

    const dueInvestments = (investments ?? []) as DueInvestment[];

    if (dueInvestments.length === 0) {
      log("no_due_investments", {
        active_investments: stats.total_active_investments,
        checked_at: checkedAt.toISOString(),
      });
      stats.status = "completed";
      stats.completed_at = new Date().toISOString();
      await saveRunLog(admin, stats);
      return stats;
    }

    log("due_investments_found", {
      count: dueInvestments.length,
      active_investments: stats.total_active_investments,
      limit: MAX_DUE_INVESTMENTS_PER_RUN,
    });

    const miningPercentages = await loadMiningReferralPercentages(admin);
    log("mining_referral_percentages_loaded", {
      levels: Object.keys(miningPercentages).length,
    });

    for (const initialInvestment of dueInvestments) {
      let cyclesProcessedForInvestment = 0;
      let continueProcessing = true;
      let nextEarningAt: string | null | undefined = initialInvestment.next_earning_at;

      while (
        continueProcessing &&
        cyclesProcessedForInvestment < MAX_EARNING_CYCLES_PER_INVESTMENT_PER_RUN &&
        isDue(nextEarningAt, checkedAt)
      ) {
        try {
          const { data: result, error } = await (admin as unknown as DueEarningRpcClient).rpc(
            "process_due_investment_earning",
            {
              p_investment_id: initialInvestment.id,
              p_run_id: runId,
              p_trigger_type: triggerType,
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

            throw new Error(message || "process_due_investment_earning failed");
          }

          if (!result?.processed) {
            stats.total_skipped++;
            log("investment_skipped", {
              run_id: runId,
              investment_id: initialInvestment.id,
              user_id: initialInvestment.user_id,
              reason: result?.reason ?? "unknown",
              next_earning_at: result?.next_earning_at,
            });

            if (result?.status === "completed" || result?.reason === "investment_completed") {
              completedInvestmentIds.add(initialInvestment.id);
            }

            break;
          }

          const investmentId = String(result.investment_id ?? initialInvestment.id);
          const userId = String(result.user_id ?? initialInvestment.user_id);
          const amount = Number(result.amount ?? 0);
          const transactionId =
            typeof result.transaction_id === "string" ? result.transaction_id : undefined;
          const earningDate =
            typeof result.earning_date === "string"
              ? result.earning_date
              : new Date(String(result.earning_due_at ?? checkedAt.toISOString()))
                  .toISOString()
                  .slice(0, 10);
          const earningDayIndex =
            typeof result.earning_day_index === "number"
              ? result.earning_day_index
              : cyclesProcessedForInvestment + 1;

          processedUserIds.add(userId);
          processedInvestmentIds.add(investmentId);
          cyclesProcessedForInvestment++;
          stats.total_transactions_created++;

          if (Number.isFinite(amount) && amount > 0) {
            stats.total_earnings_credited += amount;
          }

          if (result.status === "completed") {
            completedInvestmentIds.add(investmentId);
          }

          stats.earning_transactions.push({
            user_id: userId,
            investment_id: investmentId,
            amount,
            earning_date: earningDate,
            earning_day_index: earningDayIndex,
            transaction_id: transactionId,
          });

          log("earning_processed", {
            run_id: runId,
            user_id: userId,
            investment_id: investmentId,
            transaction_id: transactionId,
            amount,
            earning_due_at: result.earning_due_at,
            next_earning_at: result.next_earning_at,
            status: result.status,
          });

          if (
            transactionId &&
            amount > 0 &&
            Object.keys(miningPercentages).length > 0
          ) {
            try {
              await processMiningReferralRewards(
                admin,
                userId,
                transactionId,
                investmentId,
                amount,
                miningPercentages
              );
            } catch (refErr) {
              logError("mining_referral_error", {
                user_id: userId,
                earning_transaction_id: transactionId,
                investment_id: investmentId,
                error: safeErrorMessage(refErr),
              });
            }
          }

          nextEarningAt =
            typeof result.next_earning_at === "string" ? result.next_earning_at : null;

          if (result.status === "completed" || !isDue(nextEarningAt, checkedAt)) {
            continueProcessing = false;
          }
        } catch (invErr) {
          const msg = safeErrorMessage(invErr);
          logError("investment_error", {
            user_id: initialInvestment.user_id,
            investment_id: initialInvestment.id,
            error: msg,
          });
          stats.error_details.push({
            user_id: initialInvestment.user_id,
            investment_id: initialInvestment.id,
            error: msg,
          });
          stats.total_errors++;
          break;
        }
      }

      if (cyclesProcessedForInvestment >= MAX_EARNING_CYCLES_PER_INVESTMENT_PER_RUN) {
        stats.total_skipped++;
        logError("investment_cycle_limit_reached", {
          run_id: runId,
          investment_id: initialInvestment.id,
          user_id: initialInvestment.user_id,
          limit: MAX_EARNING_CYCLES_PER_INVESTMENT_PER_RUN,
        });
      }
    }

    stats.total_users_processed = processedUserIds.size;
    stats.total_investments_processed = processedInvestmentIds.size;
    stats.total_completed_investments = completedInvestmentIds.size;

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
    const msg = safeErrorMessage(err);
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
    const msg = safeErrorMessage(err);
    logError("earning_run_log_insert_failed", {
      run_id: stats.run_id,
      message: msg,
      code: "EXCEPTION",
      details: null,
      hint: null,
    });
  }
}

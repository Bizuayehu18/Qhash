import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";
import { processInvestmentReferralRewards } from "./referral-rewards.js";

function validatePurchaseInput(data: unknown): {
  planId: string;
  accessToken: string;
} {
  if (!data || typeof data !== "object")
    throwSafe("PURCHASE", "Failed to process purchase. Please try again.", "Invalid request data");
  const { planId, accessToken } = data as Record<string, unknown>;
  if (typeof planId !== "string" || planId.length === 0)
    throwSafe("PURCHASE", "Failed to process purchase. Please try again.", "Missing plan ID");
  if (typeof accessToken !== "string" || accessToken.length === 0)
    throwSafe("PURCHASE", "Please sign in to continue.", "Missing access token");
  return { planId, accessToken };
}

function validateAccessToken(data: unknown): { accessToken: string } {
  if (!data || typeof data !== "object")
    throwSafe("PURCHASE", "Failed to load investments. Please try again.", "Invalid request data");
  const { accessToken } = data as Record<string, unknown>;
  if (typeof accessToken !== "string" || accessToken.length === 0)
    throwSafe("PURCHASE", "Failed to load investments. Please try again.", "Missing access token");
  return { accessToken };
}

interface PurchasePlanRpcInvestment {
  id: string;
  plan_id?: string;
  plan_name: string;
  invested_amount: number;
  daily_earning: number;
  duration_days: number;
  start_date: string;
  end_date: string;
  ends_at: string;
  next_earning_at: string;
  last_earning_at?: string;
}

interface PurchasePlanRpcResult {
  success?: boolean;
  code?: string;
  balance?: number;
  required?: number;
  balance_before?: number;
  balance_after?: number;
  new_balance?: number;
  transaction_id?: string;
  investment?: PurchasePlanRpcInvestment;
}

type PurchasePlanRpcClient = {
  rpc(
    fn: "purchase_plan_tx",
    args: { p_user_id: string; p_plan_id: string },
  ): Promise<{
    data: PurchasePlanRpcResult | null;
    error: { message?: string; code?: string; details?: string; hint?: unknown } | null;
  }>;
};

function throwPurchaseRpcFailure(result: PurchasePlanRpcResult | null): never {
  const code = result?.code ?? "unknown";

  switch (code) {
    case "account_frozen":
      throwSafe("PURCHASE", "Your account is frozen. Please contact support.", code);
      break;
    case "profile_not_found":
      throwSafe("PURCHASE", "Unable to verify your account. Please contact support.", code);
      break;
    case "plan_not_found_or_inactive":
    case "missing_plan_id":
      throwSafe("PURCHASE", "Plan not found or no longer available.", code);
      break;
    case "wallet_not_found":
      throwSafe("PURCHASE", "Unable to verify your wallet. Please contact support.", code);
      break;
    case "insufficient_balance":
      throwSafe("PURCHASE", "Insufficient balance. Please deposit funds first.", code);
      break;
    default:
      throwSafe("PURCHASE", "Failed to process purchase. Please try again.", `RPC returned ${code}`);
  }
}

export const purchasePlanFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validatePurchaseInput(data))
  .handler(async ({ data }) => {
    const { planId, accessToken } = data;
    const admin = getAdminClient();

    console.log("[purchase] step=1_auth");
    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(accessToken);

    if (authError || !authUser) {
      console.error("[purchase] step=1_auth FAILED:", authError?.message);
      throwSafe("PURCHASE", "Authentication failed. Please sign in again.", `Auth error: ${authError?.message}`);
    }

    const userId = authUser.id;
    console.log("[purchase] step=1_auth OK userId=" + userId);
    console.log("[purchase] step=2_atomic_purchase planId=" + planId);

    const { data: result, error } = await (admin as unknown as PurchasePlanRpcClient).rpc(
      "purchase_plan_tx",
      {
        p_user_id: userId,
        p_plan_id: planId,
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

      console.error("[purchase] step=2_atomic_purchase FAILED:", message);
      throwSafe("PURCHASE", "Failed to process purchase. Please try again.", message);
    }

    if (!result?.success || !result.investment) {
      console.error("[purchase] step=2_atomic_purchase REJECTED:", JSON.stringify(result));
      throwPurchaseRpcFailure(result);
    }

    const investment = result.investment;
    const newBalance = Number(result.new_balance ?? result.balance_after);

    if (!Number.isFinite(newBalance)) {
      console.error("[purchase] step=2_atomic_purchase FAILED: missing new balance", JSON.stringify(result));
      throwSafe("PURCHASE", "Failed to process purchase. Please try again.", "RPC did not return a valid balance");
    }

    console.log("[purchase] step=2_atomic_purchase OK investment=" + investment.id + " newBalance=" + newBalance);

    // Referral rewards are intentionally best-effort after the purchaser's atomic
    // purchase commits. A referrer credit failure must not roll back the buyer's
    // completed investment.
    console.log("[purchase] step=3_referral_rewards");
    try {
      const rewardResults = await processInvestmentReferralRewards(
        admin,
        userId,
        investment.id,
        Number(investment.invested_amount),
      );
      const rewarded = rewardResults.filter(r => !r.skipped).length;
      console.log("[purchase] step=3_referral_rewards OK rewarded=" + rewarded + " total=" + rewardResults.length);
    } catch (refErr) {
      console.error("[purchase] step=3_referral_rewards ERROR (non-fatal):", refErr instanceof Error ? refErr.message : String(refErr));
    }

    console.log("[purchase] COMPLETED successfully");

    return {
      investment: {
        id: investment.id,
        plan_name: investment.plan_name,
        invested_amount: Number(investment.invested_amount),
        daily_earning: Number(investment.daily_earning),
        duration_days: Number(investment.duration_days),
        start_date: investment.start_date,
        end_date: investment.end_date,
        ends_at: investment.ends_at,
        next_earning_at: investment.next_earning_at,
      },
      newBalance,
    };
  });

export const getInvestmentsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateAccessToken(data))
  .handler(async ({ data }) => {
    const { accessToken } = data;
    const admin = getAdminClient();

    // Derive the caller identity from the session access token. The client
    // never supplies the user id used for the investments query below.
    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(accessToken);
    if (authError || !authUser)
      throwSafe("PURCHASE", "Failed to load investments. Please try again.", "Invalid or expired access token");

    try {
      const { data: all, error } = await admin
        .from("investments")
        .select("*")
        .eq("user_id", authUser.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const investments = all ?? [];
      return {
        active: investments.filter((i) => i.status === "active"),
        completed: investments.filter((i) => i.status === "completed"),
      };
    } catch (err) {
      console.error("[QHash] Investments load error:", err);
      throwSafe("PURCHASE", "Failed to load investments. Please try again.", `DB error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

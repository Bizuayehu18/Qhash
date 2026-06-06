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

export const purchasePlanFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validatePurchaseInput(data))
  .handler(async ({ data }) => {
    const { planId, accessToken } = data;
    const admin = getAdminClient();

    // Step 1: Authenticate user
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

    // Step 2: Verify user profile exists and is not frozen
    console.log("[purchase] step=2_profile");
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, is_frozen")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      console.error(
        "[purchase] step=2_profile FAILED:",
        profileError?.message,
        profileError?.code,
      );
      throwSafe("PURCHASE", "Unable to verify your account. Please contact support.", `Profile error: ${profileError?.message} code=${profileError?.code}`);
    }
    if (profile.is_frozen) {
      console.error("[purchase] step=2_profile FAILED: account frozen");
      throwSafe("PURCHASE", "Your account is frozen. Please contact support.", "Account frozen");
    }
    console.log("[purchase] step=2_profile OK");

    // Step 3: Fetch and validate plan
    console.log("[purchase] step=3_plan planId=" + planId);
    const { data: plan, error: planError } = await admin
      .from("plans")
      .select("id, name, investment_amount, daily_earning, duration_days")
      .eq("id", planId)
      .eq("is_active", true)
      .single();

    if (planError || !plan) {
      console.error(
        "[purchase] step=3_plan FAILED:",
        planError?.message,
        planError?.code,
      );
      throwSafe("PURCHASE", "Plan not found or no longer available.", `Plan error: ${planError?.message} code=${planError?.code}`);
    }
    console.log(
      "[purchase] step=3_plan OK name=" +
        plan.name +
        " amount=" +
        plan.investment_amount,
    );

    // Step 4: Check wallet balance
    console.log("[purchase] step=4_wallet");
    const { data: wallet, error: walletError } = await admin
      .from("wallets")
      .select("balance")
      .eq("user_id", userId)
      .single();

    if (walletError || !wallet) {
      console.error(
        "[purchase] step=4_wallet FAILED:",
        walletError?.message,
        walletError?.code,
      );
      throwSafe("PURCHASE", "Unable to verify your wallet. Please contact support.", `Wallet error: ${walletError?.message} code=${walletError?.code}`);
    }

    const balanceBefore = Number(wallet.balance);
    console.log(
      "[purchase] step=4_wallet OK balance=" +
        balanceBefore +
        " required=" +
        plan.investment_amount,
    );

    if (balanceBefore < plan.investment_amount) {
      throwSafe("PURCHASE", "Insufficient balance. Please deposit funds first.", `Balance ${balanceBefore} < required ${plan.investment_amount}`);
    }

    // Step 5: Deduct wallet balance (conditional update prevents race conditions)
    const balanceAfter = balanceBefore - plan.investment_amount;
    console.log("[purchase] step=5_deduct amount=" + plan.investment_amount);

    const { data: deducted, error: deductError } = await admin
      .from("wallets")
      .update({ balance: balanceAfter })
      .eq("user_id", userId)
      .gte("balance", plan.investment_amount)
      .select("balance");

    if (deductError) {
      console.error(
        "[purchase] step=5_deduct FAILED:",
        deductError.message,
        deductError.code,
      );
      throwSafe("PURCHASE", "Failed to process purchase. Please try again.", `Wallet deduct error: ${deductError.message} code=${deductError.code}`);
    }
    if (!deducted || deducted.length === 0) {
      console.error("[purchase] step=5_deduct FAILED: 0 rows matched (balance changed)");
      throwSafe("PURCHASE", "Insufficient balance. Your balance may have changed.", "Race condition: 0 rows matched on wallet deduct");
    }
    const actualNewBalance = Number(deducted[0].balance);
    console.log("[purchase] step=5_deduct OK newBalance=" + actualNewBalance);

    // Step 6: Create investment record
    const now = new Date();
    const endDate = new Date(now.getTime() + plan.duration_days * 86400000);
    const startStr = now.toISOString().split("T")[0];
    const endStr = endDate.toISOString().split("T")[0];

    console.log("[purchase] step=6_investment");
    const { data: investment, error: investError } = await admin
      .from("investments")
      .insert({
        user_id: userId,
        plan_id: planId,
        invested_amount: plan.investment_amount,
        daily_earning: plan.daily_earning,
        start_date: startStr,
        end_date: endStr,
        status: "active" as const,
        last_earning_at: now.toISOString(),
      })
      .select("id")
      .single();

    if (investError || !investment) {
      console.error(
        "[purchase] step=6_investment FAILED:",
        investError?.message,
        investError?.code,
        investError?.details,
      );
      // Roll back wallet deduction
      console.log("[purchase] step=6_rollback restoring balance=" + balanceBefore);
      await admin
        .from("wallets")
        .update({ balance: balanceBefore })
        .eq("user_id", userId);
      throwSafe(
        "PURCHASE",
        "Failed to process purchase. Your balance has been restored. Please try again.",
        `Investment insert error: ${investError?.message} code=${investError?.code} details=${investError?.details}`,
      );
    }
    console.log("[purchase] step=6_investment OK id=" + investment.id);

    // Step 7: Create transaction audit record
    const txPayload = {
      user_id: userId,
      type: "plan_purchase" as const,
      amount: plan.investment_amount,
      status: "completed" as const,
      balance_before: balanceBefore,
      balance_after: actualNewBalance,
      description: "Purchased " + plan.name,
      reference_id: investment.id,
      metadata: { plan_id: planId, plan_name: plan.name },
    };
    console.log(
      "[purchase] step=7_transaction payload=" + JSON.stringify(txPayload),
    );
    console.log(
      "[purchase] step=7_transaction field_types:" +
        " user_id=" + typeof userId +
        " type=" + typeof txPayload.type +
        " amount=" + typeof txPayload.amount + "(" + txPayload.amount + ")" +
        " reference_id=" + typeof txPayload.reference_id + "(" + txPayload.reference_id + ")",
    );

    const { data: txData, error: txError } = await admin
      .from("transactions")
      .insert(txPayload)
      .select("id")
      .single();

    if (txError) {
      console.error(
        "[purchase] step=7_transaction FAILED:",
        JSON.stringify({
          message: txError.message,
          code: txError.code,
          details: txError.details,
          hint: txError.hint ?? null,
          status: null,
          payload: txPayload,
        }),
      );
      throwSafe(
        "PURCHASE",
        "Purchase completed but transaction record failed. Please contact support.",
        `Transaction insert error: ${txError.message} code=${txError.code} details=${txError.details}`,
      );
    }
    console.log("[purchase] step=7_transaction OK id=" + txData.id);

    // Step 8: Process referral rewards (non-blocking — purchase is already complete)
    console.log("[purchase] step=8_referral_rewards");
    try {
      const rewardResults = await processInvestmentReferralRewards(
        admin,
        userId,
        investment.id,
        plan.investment_amount,
      );
      const rewarded = rewardResults.filter(r => !r.skipped).length;
      console.log("[purchase] step=8_referral_rewards OK rewarded=" + rewarded + " total=" + rewardResults.length);
    } catch (refErr) {
      console.error("[purchase] step=8_referral_rewards ERROR (non-fatal):", refErr instanceof Error ? refErr.message : String(refErr));
    }

    console.log("[purchase] COMPLETED successfully");

    return {
      investment: {
        id: investment.id,
        plan_name: plan.name,
        invested_amount: plan.investment_amount,
        daily_earning: plan.daily_earning,
        duration_days: plan.duration_days,
        start_date: startStr,
        end_date: endStr,
      },
      newBalance: actualNewBalance,
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

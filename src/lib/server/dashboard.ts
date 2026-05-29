import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

function validateUserId(data: unknown): { userId: string } {
  if (!data || typeof data !== "object") throwSafe("SERVER", "Failed to load dashboard.", "Invalid request data");
  const { userId } = data as Record<string, unknown>;
  if (typeof userId !== "string" || userId.length === 0)
    throwSafe("SERVER", "Failed to load dashboard.", "Missing user ID");
  return { userId };
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
  .inputValidator((data: unknown) => validateUserId(data))
  .handler(async ({ data }) => {
    const { userId } = data;
    const admin = getAdminClient();

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
        recentTransactions: recentTxns ?? [],
      };
    } catch (err) {
      console.error("[QHash] Dashboard load error:", err);
      throwSafe("SERVER", "Failed to load dashboard. Please try again.", `Dashboard error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

function validateUserId(data: unknown): { userId: string } {
  if (!data || typeof data !== "object") throwSafe("WALLET", "Unable to load wallet.", "Invalid request data");
  const { userId } = data as Record<string, unknown>;
  if (typeof userId !== "string" || userId.length === 0)
    throwSafe("WALLET", "Unable to load wallet.", "Missing user ID");
  return { userId };
}

export const getWalletBalanceFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateUserId(data))
  .handler(async ({ data }) => {
    const { userId } = data;
    const admin = getAdminClient();

    const { data: wallet } = await admin
      .from("wallets")
      .select("balance, updated_at")
      .eq("user_id", userId)
      .single();

    return {
      balance: wallet?.balance ?? 0,
      updatedAt: wallet?.updated_at ?? null,
    };
  });

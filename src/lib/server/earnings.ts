import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";
import { processEarnings, creditWallet } from "./earning-engine.js";

function validateUserId(data: unknown): { userId: string } {
  if (!data || typeof data !== "object") throwSafe("SERVER", "Failed to process earnings.", "Invalid request data");
  const { userId } = data as Record<string, unknown>;
  if (typeof userId !== "string" || userId.length === 0)
    throwSafe("SERVER", "Failed to process earnings.", "Missing user ID");
  return { userId };
}

export const processEarningsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateUserId(data))
  .handler(async ({ data }) => {
    const { userId } = data;
    const admin = getAdminClient();

    try {
      const { data: activeInvs } = await admin
        .from("investments")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active");

      const { totalNewEarnings } = await processEarnings(
        userId,
        activeInvs ?? [],
      );

      await creditWallet(userId, totalNewEarnings);

      return { totalNewEarnings };
    } catch (err) {
      console.error("[QHash] Earnings processing error:", err);
      throwSafe("SERVER", "Failed to process earnings.", `Earnings error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

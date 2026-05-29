import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import type { TransactionType } from "../database.types.js";
import { throwSafe } from "../errors.js";

const VALID_TYPES = new Set<string>([
  "all",
  "deposit",
  "withdrawal",
  "plan_purchase",
  "earning",
  "admin_adjustment",
  "referral_investment_bonus",
]);

function validateInput(data: unknown): { userId: string; type?: string } {
  if (!data || typeof data !== "object") throwSafe("SERVER", "Failed to load transactions.", "Invalid request data");
  const { userId, type } = data as Record<string, unknown>;
  if (typeof userId !== "string" || userId.length === 0)
    throwSafe("SERVER", "Failed to load transactions.", "Missing user ID");
  if (
    type !== undefined &&
    type !== null &&
    typeof type === "string" &&
    !VALID_TYPES.has(type)
  ) {
    throwSafe("SERVER", "Failed to load transactions.", "Invalid type filter: " + type);
  }
  return { userId, type: typeof type === "string" ? type : undefined };
}

export const getTransactionsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateInput(data))
  .handler(async ({ data }) => {
    const { userId, type } = data;
    const admin = getAdminClient();

    try {
      let query = admin
        .from("transactions")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(50);

      if (type && type !== "all") {
        query = query.eq("type", type as TransactionType);
      }

      const { data: rows, error } = await query;

      if (error) throw error;
      return rows ?? [];
    } catch (err) {
      console.error("[QHash] Transactions load error:", err);
      throwSafe("SERVER", "Failed to load transactions.", `DB error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

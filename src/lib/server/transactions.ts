import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import type { TransactionType } from "../database.types.js";
import { throwSafe } from "../errors.js";

const REFERRAL_TRANSACTION_TYPES = [
  "referral_daily_bonus",
  "referral_investment_bonus",
] as TransactionType[];

const VALID_TYPES = new Set<string>([
  "all",
  "deposit",
  "withdrawal",
  "plan_purchase",
  "earning",
  "admin_adjustment",
  "referral_bonus",
  "referral_daily_bonus",
  "referral_investment_bonus",
]);

function validateInput(data: unknown): { accessToken: string; type?: string } {
  if (!data || typeof data !== "object") throwSafe("SERVER", "Failed to load transactions.", "Invalid request data");
  const { accessToken, type } = data as Record<string, unknown>;
  if (typeof accessToken !== "string" || accessToken.length === 0)
    throwSafe("SERVER", "Failed to load transactions.", "Missing access token");
  if (
    type !== undefined &&
    type !== null &&
    typeof type === "string" &&
    !VALID_TYPES.has(type)
  ) {
    throwSafe("SERVER", "Failed to load transactions.", "Invalid type filter: " + type);
  }
  return { accessToken, type: typeof type === "string" ? type : undefined };
}

export const getTransactionsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateInput(data))
  .handler(async ({ data }) => {
    const { accessToken, type } = data;
    const admin = getAdminClient();

    // Derive the caller identity from the session access token. The client
    // never supplies the user id used for the transactions query below.
    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(accessToken);
    if (authError || !authUser)
      throwSafe("SERVER", "Failed to load transactions.", "Invalid or expired access token");

    try {
      let query = admin
        .from("transactions")
        .select("*")
        .eq("user_id", authUser.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (type === "referral_bonus") {
        query = query.in("type", REFERRAL_TRANSACTION_TYPES);
      } else if (type && type !== "all") {
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

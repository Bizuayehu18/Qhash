import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";
import { processEarnings, creditWallet } from "./earning-engine.js";

function validateAccessToken(data: unknown): { accessToken: string } {
  if (!data || typeof data !== "object") throwSafe("SERVER", "Failed to process earnings.", "Invalid request data");
  const { accessToken } = data as Record<string, unknown>;
  if (typeof accessToken !== "string" || accessToken.length === 0)
    throwSafe("SERVER", "Failed to process earnings.", "Missing access token");
  return { accessToken };
}

export const processEarningsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateAccessToken(data))
  .handler(async ({ data }) => {
    const { accessToken } = data;
    const admin = getAdminClient();

    // Derive the caller identity from the session access token. The client
    // never supplies the user id used for the investment query, earnings
    // processing, or wallet credit below.
    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(accessToken);
    if (authError || !authUser)
      throwSafe("SERVER", "Failed to process earnings.", "Invalid or expired access token");
    const userId = authUser.id;

    // Reject frozen or unavailable accounts before crediting any earnings.
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("is_frozen")
      .eq("id", userId)
      .single();
    if (profileError || !profile || profile.is_frozen === true)
      throwSafe("SERVER", "Failed to process earnings.", "Account is frozen or unavailable");

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

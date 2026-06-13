import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

function validateAccessToken(data: unknown): { accessToken: string } {
  if (!data || typeof data !== "object")
    throwSafe("REFERRAL", "Failed to load team stats.", "Invalid request data");
  const { accessToken } = data as Record<string, unknown>;
  if (typeof accessToken !== "string" || accessToken.length === 0)
    throwSafe("REFERRAL", "Failed to load team stats.", "Missing access token");
  return { accessToken };
}

export const loadReferralStatsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateAccessToken(data))
  .handler(async ({ data }) => {
    const { accessToken } = data;
    const admin = getAdminClient();

    // Derive the caller identity from the session access token (mirrors
    // getAdminStatsFn / assertAdminToken). The client never supplies the
    // referrer id used for the referral queries below.
    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(accessToken);
    if (authError || !authUser)
      throwSafe("REFERRAL", "Failed to load team stats.", "Invalid or expired access token");
    const userId = authUser.id;

    try {
      const { data: referralRows, error: refError } = await admin
        .from("referrals")
        .select("referred_user_id, total_investment_rewards, total_mining_rewards")
        .eq("referrer_id", userId);

      if (refError) {
        throwSafe("REFERRAL", "Failed to load team stats.", "Referrals query: " + refError.message);
      }

      const rows = referralRows ?? [];
      const total = new Set(rows.map((r) => r.referred_user_id)).size;

      let active = 0;
      if (total > 0) {
        const referredIds = [...new Set(rows.map((r) => r.referred_user_id))];
        const { data: activeInvestments, error: invError } = await admin
          .from("investments")
          .select("user_id")
          .in("user_id", referredIds)
          .eq("status", "active");

        if (invError) {
          throwSafe("REFERRAL", "Failed to load team stats.", "Investments query: " + invError.message);
        }

        active = new Set((activeInvestments ?? []).map((i) => i.user_id)).size;
      }

      const earned = rows.reduce(
        (sum, r) => sum + (r.total_investment_rewards ?? 0) + (r.total_mining_rewards ?? 0),
        0,
      );

      return { total, active, earned };
    } catch (err) {
      if (err && typeof err === "object" && "domain" in err) throw err;
      console.error("[QHash] Referral stats error:", err);
      throwSafe(
        "REFERRAL",
        "Failed to load team stats. Please try again.",
        `Referral stats error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

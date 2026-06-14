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

function nowMs(): number {
  return Date.now();
}

function logReferralTiming(
  requestId: string,
  event: string,
  startedAt: number,
  extra?: Record<string, number | string | boolean>,
) {
  const elapsedMs = Date.now() - startedAt;
  console.info(
    "[QHash Timing] referrals",
    JSON.stringify({
      requestId,
      event,
      elapsedMs,
      ...extra,
    }),
  );
}

function makeRequestId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export const loadReferralStatsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateAccessToken(data))
  .handler(async ({ data }) => {
    const { accessToken } = data;
    const admin = getAdminClient();
    const requestId = makeRequestId();
    const startedAt = nowMs();

    logReferralTiming(requestId, "start", startedAt);

    // Derive the caller identity from the session access token (mirrors
    // getAdminStatsFn / assertAdminToken). The client never supplies the
    // referrer id used for the referral queries below.
    const authStartedAt = nowMs();
    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(accessToken);

    logReferralTiming(requestId, "auth_complete", startedAt, {
      stepMs: nowMs() - authStartedAt,
      hasUser: Boolean(authUser),
    });

    if (authError || !authUser)
      throwSafe("REFERRAL", "Failed to load team stats.", "Invalid or expired access token");
    const userId = authUser.id;

    try {
      const referralQueryStartedAt = nowMs();
      const { data: referralRows, error: refError } = await admin
        .from("referrals")
        .select("referred_user_id, total_investment_rewards, total_mining_rewards")
        .eq("referrer_id", userId);

      logReferralTiming(requestId, "referrals_query_complete", startedAt, {
        stepMs: nowMs() - referralQueryStartedAt,
        rowCount: referralRows?.length ?? 0,
      });

      if (refError) {
        throwSafe("REFERRAL", "Failed to load team stats.", "Referrals query: " + refError.message);
      }

      const rows = referralRows ?? [];
      const total = new Set(rows.map((r) => r.referred_user_id)).size;

      let active = 0;
      if (total > 0) {
        const referredIds = [...new Set(rows.map((r) => r.referred_user_id))];
        const investmentsQueryStartedAt = nowMs();
        const { data: activeInvestments, error: invError } = await admin
          .from("investments")
          .select("user_id")
          .in("user_id", referredIds)
          .eq("status", "active");

        logReferralTiming(requestId, "investments_query_complete", startedAt, {
          stepMs: nowMs() - investmentsQueryStartedAt,
          referredCount: referredIds.length,
          rowCount: activeInvestments?.length ?? 0,
        });

        if (invError) {
          throwSafe("REFERRAL", "Failed to load team stats.", "Investments query: " + invError.message);
        }

        active = new Set((activeInvestments ?? []).map((i) => i.user_id)).size;
      } else {
        logReferralTiming(requestId, "investments_query_skipped", startedAt, {
          referredCount: 0,
        });
      }

      const earned = rows.reduce(
        (sum, r) => sum + (r.total_investment_rewards ?? 0) + (r.total_mining_rewards ?? 0),
        0,
      );

      logReferralTiming(requestId, "success", startedAt, {
        totalMs: nowMs() - startedAt,
        total,
        active,
      });

      return { total, active, earned };
    } catch (err) {
      logReferralTiming(requestId, "error", startedAt, {
        totalMs: nowMs() - startedAt,
      });

      if (err && typeof err === "object" && "domain" in err) throw err;
      console.error("[QHash] Referral stats error:", err);
      throwSafe(
        "REFERRAL",
        "Failed to load team stats. Please try again.",
        `Referral stats error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

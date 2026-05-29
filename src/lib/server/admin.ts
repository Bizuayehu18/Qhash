import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { db } from "../../../db/index.js";
import { supportTickets } from "../../../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { throwSafe } from "../errors.js";

function validateUserId(data: unknown): { userId: string } {
  if (!data || typeof data !== "object") throwSafe("ADMIN", "Failed to process request.", "Invalid request data");
  const { userId } = data as Record<string, unknown>;
  if (typeof userId !== "string" || userId.length === 0)
    throwSafe("ADMIN", "Failed to process request.", "Missing user ID");
  return { userId };
}

export const getAdminStatsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateUserId(data))
  .handler(async ({ data }) => {
    const { userId } = data;
    const admin = getAdminClient();

    try {
      const { data: profile } = await admin
        .from("profiles")
        .select("is_admin")
        .eq("id", userId)
        .single();

      if (!profile?.is_admin) {
        throwSafe("ADMIN", "Unauthorized.", "Non-admin user attempted admin stats access");
      }

      const { count: totalUsers } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true });

      const { count: activeInvCount } = await admin
        .from("investments")
        .select("id", { count: "exact", head: true })
        .eq("status", "active");

      const activeInvestments = activeInvCount ?? 0;

      const { count: pendingWdCount } = await admin
        .from("withdrawals")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");

      const pendingWithdrawalsCount = pendingWdCount ?? 0;

      const { count: pendingDepositCount } = await admin
        .from("deposits")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");

      const pendingDeposits = pendingDepositCount ?? 0;

      const { data: investmentTxns } = await admin
        .from("transactions")
        .select("amount")
        .eq("type", "plan_purchase");

      const totalRevenue = (investmentTxns ?? []).reduce(
        (sum, tx) => sum + Math.abs(tx.amount),
        0,
      );

      const { data: recentUsers } = await admin
        .from("profiles")
        .select("id, username, phone, is_admin, is_frozen, created_at")
        .order("created_at", { ascending: false })
        .limit(20);

      const { data: pendingWithdrawals } = await admin
        .from("withdrawals")
        .select("*")
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(20);

      const withdrawalUserIds = [
        ...new Set((pendingWithdrawals ?? []).map((w) => w.user_id)),
      ];
      let withdrawalProfiles: Array<{
        id: string;
        username: string;
        phone: string;
      }> = [];
      if (withdrawalUserIds.length > 0) {
        const { data: profiles } = await admin
          .from("profiles")
          .select("id, username, phone")
          .in("id", withdrawalUserIds);
        withdrawalProfiles = profiles ?? [];
      }

      const pendingWithdrawalRecords = (pendingWithdrawals ?? []).map((w) => {
        const prof = withdrawalProfiles.find((p) => p.id === w.user_id);
        return {
          id: w.id,
          userId: w.user_id,
          username: prof?.username ?? "Unknown",
          amount: w.amount,
          description: `${w.method.toUpperCase()} - ${w.account_number}`,
          createdAt: w.created_at,
        };
      });

      const openTickets = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.status, "open"))
        .orderBy(desc(supportTickets.createdAt))
        .limit(10);

      let ticketUserProfiles: Array<{ id: string; username: string }> = [];
      const ticketUserIds = [...new Set(openTickets.map((t) => t.userId))];
      if (ticketUserIds.length > 0) {
        const { data: profiles } = await admin
          .from("profiles")
          .select("id, username")
          .in("id", ticketUserIds);
        ticketUserProfiles = profiles ?? [];
      }

      const openTicketRecords = openTickets.map((t) => {
        const prof = ticketUserProfiles.find((p) => p.id === t.userId);
        return {
          id: t.id,
          userId: t.userId,
          username: prof?.username ?? "Unknown",
          subject: t.subject,
          createdAt: t.createdAt,
        };
      });

      return {
        totalUsers: totalUsers ?? 0,
        activeInvestments,
        pendingWithdrawals: pendingWithdrawalsCount,
        pendingDeposits,
        totalRevenue,
        recentUsers: recentUsers ?? [],
        pendingWithdrawalRecords,
        openTicketRecords,
      };
    } catch (err) {
      if (err instanceof Error && err.message.includes("Unauthorized")) {
        throw err;
      }
      console.error("[QHash] Admin stats error:", err);
      throwSafe("ADMIN", "Failed to load admin stats.", `DB error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

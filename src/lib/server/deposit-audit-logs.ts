import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

// Read-only admin reader for the public.deposit_verification_logs audit trail.
//
// This module is intentionally separate from the deposit submission / CBE /
// TeleBirr verification code: it never writes, updates, or deletes, and never
// touches the money path. It only SELECTs a whitelist of safe, already-masked
// columns for display in the admin audit panel.
//
// Safety contract:
//   * Admin-only: the handler re-checks profiles.is_admin via the service-role
//     client before returning any rows (mirrors getAdminDepositsFn).
//   * Selects only safe columns. It never reads full receipt text, full receipt
//     URLs, full transaction references, secrets, or raw receiver / account
//     names — those are not columns on this table, and tx_ref_last4 is already
//     masked to 4 characters at write time.
//   * No join to profiles or deposits; only the shortened ids stored on the
//     audit row itself are returned.

// The whitelist of columns that are safe to expose to the admin UI. Note the
// deliberate absence of anything that could carry PII or a fetch credential.
const SAFE_COLUMNS =
  "id, created_at, payment_type, event, action, reason_code, reason_message_safe, amount, tx_ref_last4, receiver_matched, freshness_decision, age_minutes, source, actor_type, deposit_id, user_id, metadata";

// JSON-serializable metadata. The audit writer only ever persists safe, simple
// values (booleans, finite numbers, short strings, small arrays, shallow
// objects), so a plain JSON shape models it accurately and stays serializable
// across the server-function boundary.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface DepositVerificationLogRow {
  id: string;
  created_at: string;
  payment_type: string | null;
  event: string | null;
  action: string | null;
  reason_code: string | null;
  reason_message_safe: string | null;
  amount: number | null;
  tx_ref_last4: string | null;
  receiver_matched: boolean | null;
  freshness_decision: string | null;
  age_minutes: number | null;
  source: string | null;
  actor_type: string | null;
  deposit_id: string | null;
  user_id: string | null;
  metadata: Record<string, JsonValue> | null;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export const getDepositVerificationLogsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object")
      throwSafe("ADMIN", "Failed to load audit logs.", "Invalid request data");
    const { userId, paymentType, limit } = data as Record<string, unknown>;
    if (typeof userId !== "string" || !userId)
      throwSafe("ADMIN", "Failed to load audit logs.", "Missing user ID");

    // Only the two known payment types (or undefined = all) are accepted.
    const normalisedPaymentType =
      paymentType === "cbe" || paymentType === "telebirr"
        ? paymentType
        : undefined;

    const parsedLimit =
      typeof limit === "number" && Number.isFinite(limit)
        ? Math.min(Math.max(Math.trunc(limit), 1), MAX_LIMIT)
        : DEFAULT_LIMIT;

    return {
      userId,
      paymentType: normalisedPaymentType,
      limit: parsedLimit,
    };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();

    // Admin gate — identical pattern to getAdminDepositsFn.
    const { data: profile } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", data.userId)
      .single();
    if (!profile?.is_admin)
      throwSafe(
        "ADMIN",
        "Unauthorized.",
        "Non-admin user attempted audit log access"
      );

    // The generated Database types do not include this table, so the table name
    // is cast at this boundary only (mirrors the audit writer).
    const client = getAdminClient() as unknown as SupabaseClient;
    let query = client
      .from("deposit_verification_logs")
      .select(SAFE_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.paymentType) {
      query = query.eq("payment_type", data.paymentType);
    }

    const { data: rows, error } = await query;
    if (error)
      throwSafe("ADMIN", "Failed to load audit logs.", `DB error: ${error.message}`);

    return (rows ?? []) as DepositVerificationLogRow[];
  });

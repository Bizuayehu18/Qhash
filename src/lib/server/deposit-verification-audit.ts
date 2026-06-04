import type { SupabaseClient } from "@supabase/supabase-js";
import { getAdminClient } from "./supabase-admin.js";
import type { PaymentMethodType } from "../database.types.js";

// Safe, server-side writer for the public.deposit_verification_logs audit
// table. This helper is intentionally standalone: it is NOT yet wired into CBE
// verification, the TeleBirr verifier, or admin manual approval/rejection.
//
// Safety contract:
//   * Service-role only (writes bypass RLS via getAdminClient()).
//   * Never throws to the caller — auditing must never block the money path.
//   * Stores only masked / sanitised / boolean / enum / numeric fields.
//   * Never accepts or stores full receipt text, full receipt URLs, API
//     keys/secrets, or raw receiver / account names. Those fields are simply
//     absent from the accepted input shape, and metadata is sanitised.

export type DepositVerificationAction =
  | "approve"
  | "reject"
  | "manual_review"
  | "skipped"
  | "error";

export type DepositVerificationActorType = "system" | "admin" | "verifier";

export type DepositVerificationSource =
  | "server"
  | "cbe_auto"
  | "telebirr_verifier"
  | "admin_manual";

export type DepositVerificationFreshness =
  | "fresh"
  | "too_old"
  | "future"
  | "missing"
  | "unparseable";

/**
 * Whitelisted, safe-only input for a single audit row. Every field is optional;
 * the database applies defaults for actor_type, source, and metadata.
 *
 * Deliberately omitted (never accepted, never stored): full receipt text, full
 * receipt URL, API keys/secrets, raw receiver/account names, and the full
 * transaction reference. Only tx_ref_last4 (masked) is accepted.
 */
export interface RecordDepositVerificationLogInput {
  deposit_id?: string | null;
  user_id?: string | null;
  payment_type?: PaymentMethodType | null;
  event?: string | null;
  action?: DepositVerificationAction | null;
  reason_code?: string | null;
  reason_message_safe?: string | null;
  amount?: number | null;
  /** Full or partial reference; only the last 4 characters are persisted. */
  tx_ref_last4?: string | null;
  receiver_matched?: boolean | null;
  freshness_decision?: DepositVerificationFreshness | null;
  age_minutes?: number | null;
  actor_type?: DepositVerificationActorType;
  actor_id?: string | null;
  source?: DepositVerificationSource;
  metadata?: Record<string, unknown>;
}

export type RecordDepositVerificationLogResult =
  | { ok: true }
  | { ok: false; error: string };

// Keys whose names suggest sensitive data are dropped from metadata as
// defense-in-depth, so a careless caller cannot leak secrets via free-form keys.
const UNSAFE_METADATA_KEY = /receipt|secret|password|token|api[_-]?key|url|raw/i;

// Guard against dumping large blobs (e.g. full receipt text) through metadata.
const MAX_METADATA_STRING_LENGTH = 512;

/** Keep only the last 4 characters of a transaction reference. */
function sanitizeTxRefLast4(value: string | null | undefined): string | null {
  if (value == null) return null;
  const str = String(value);
  return str.length <= 4 ? str : str.slice(-4);
}

/** Returns true only for plain objects (not null, arrays, or class instances). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Ensure metadata is a plain object and free of obviously-sensitive keys or
 * oversized string values. Anything unexpected collapses to {}.
 */
function sanitizeMetadata(value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) return {};
  const safe: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (UNSAFE_METADATA_KEY.test(key)) continue;
    if (typeof val === "string" && val.length > MAX_METADATA_STRING_LENGTH) {
      continue;
    }
    safe[key] = val;
  }
  return safe;
}

/**
 * Insert one row into public.deposit_verification_logs.
 *
 * Never throws: any failure (misconfiguration, DB error, unexpected input) is
 * caught and returned as { ok: false, error }. Callers can safely ignore the
 * result without risking the surrounding flow.
 */
export async function recordDepositVerificationLog(
  input: RecordDepositVerificationLogInput
): Promise<RecordDepositVerificationLogResult> {
  try {
    const row = {
      deposit_id: input.deposit_id ?? null,
      user_id: input.user_id ?? null,
      payment_type: input.payment_type ?? null,
      event: input.event ?? null,
      action: input.action ?? null,
      reason_code: input.reason_code ?? null,
      reason_message_safe: input.reason_message_safe ?? null,
      amount: input.amount ?? null,
      tx_ref_last4: sanitizeTxRefLast4(input.tx_ref_last4),
      receiver_matched: input.receiver_matched ?? null,
      freshness_decision: input.freshness_decision ?? null,
      age_minutes: input.age_minutes ?? null,
      actor_type: input.actor_type ?? "system",
      actor_id: input.actor_id ?? null,
      source: input.source ?? "server",
      metadata: sanitizeMetadata(input.metadata),
    };

    // The generated Database types do not yet include this table, so the table
    // name and payload are cast at this boundary only. `row` itself stays fully
    // typed above.
    const admin = getAdminClient() as unknown as SupabaseClient;
    const { error } = await admin
      .from("deposit_verification_logs")
      .insert(row);

    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: message };
  }
}

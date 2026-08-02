import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types.ts";
import { isNonNullNonArrayObject } from "../../src/shared/validation/non-null-non-array-object.ts";
import { isParseableTimestampString } from "../../src/shared/validation/parseable-timestamp.ts";
import { isPublishedProductionDeployContext } from "./lib/nowpayments-deploy-context.mts";

const MAX_BODY_BYTES = 4_096;
const OVERVIEW_LIMIT = 200;
const RELATED_LIMIT = 2_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/;
const INTERNAL_STATUSES = new Set([
  "reserved",
  "reviewing",
  "send_locked",
  "broadcasted",
  "completed",
  "rejected",
]);

type AdminClient = ReturnType<typeof createClient<Database>>;
type PublicStatus = "pending" | "completed" | "rejected";
type WithdrawalRow = {
  id: string;
  user_id: string;
  destination_address: string;
  gross_amount_usdt: string;
  fee_percent: string;
  fee_amount_usdt: string;
  net_amount_usdt: string;
  status: string;
  requested_at: string;
  current_broadcast_id: string | null;
};
type ProfileRow = {
  id: string;
  username: string;
};
type BroadcastRow = {
  id: string;
  withdrawal_id: string;
  transaction_hash: string;
};
type AdminActionBody =
  | {
      action: "complete";
      withdrawal_id: string;
      action_id: string;
      transaction_hash: string | null;
    }
  | {
      action: "reject";
      withdrawal_id: string;
      action_id: string;
    };

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorResponse(error: string, message: string, status: number): Response {
  return json({ error, message }, status);
}

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

function canonicalDecimal(value: string): string {
  const [integer, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
}

function decimalMicros(value: string): bigint {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
}

function publicStatus(status: string): PublicStatus {
  if (status === "completed") return "completed";
  if (status === "rejected") return "rejected";
  return "pending";
}

function validateWithdrawal(value: unknown): WithdrawalRow {
  if (!isNonNullNonArrayObject(value)) throw new Error("invalid_withdrawal_read");
  if (
    typeof value.id !== "string"
    || !UUID_PATTERN.test(value.id)
    || typeof value.user_id !== "string"
    || !UUID_PATTERN.test(value.user_id)
    || typeof value.destination_address !== "string"
    || !ADDRESS_PATTERN.test(value.destination_address)
    || !isDecimal(value.gross_amount_usdt)
    || !isDecimal(value.fee_percent)
    || canonicalDecimal(value.fee_percent) !== "5"
    || !isDecimal(value.fee_amount_usdt)
    || !isDecimal(value.net_amount_usdt)
    || typeof value.status !== "string"
    || !INTERNAL_STATUSES.has(value.status)
    || !isParseableTimestampString(value.requested_at)
    || (
      value.current_broadcast_id !== null
      && (
        typeof value.current_broadcast_id !== "string"
        || !UUID_PATTERN.test(value.current_broadcast_id)
      )
    )
  ) {
    throw new Error("invalid_withdrawal_read");
  }
  const gross = decimalMicros(value.gross_amount_usdt);
  const fee = decimalMicros(value.fee_amount_usdt);
  const net = decimalMicros(value.net_amount_usdt);
  if (fee !== (gross * 5n + 50n) / 100n || net !== gross - fee) {
    throw new Error("invalid_withdrawal_amounts");
  }
  return value as unknown as WithdrawalRow;
}

function validateProfile(value: unknown): ProfileRow {
  if (
    !isNonNullNonArrayObject(value)
    || typeof value.id !== "string"
    || !UUID_PATTERN.test(value.id)
    || typeof value.username !== "string"
    || value.username.trim() === ""
    || value.username.length > 80
  ) {
    throw new Error("invalid_profile_read");
  }
  return value as unknown as ProfileRow;
}

function validateBroadcast(value: unknown): BroadcastRow {
  if (
    !isNonNullNonArrayObject(value)
    || typeof value.id !== "string"
    || !UUID_PATTERN.test(value.id)
    || typeof value.withdrawal_id !== "string"
    || !UUID_PATTERN.test(value.withdrawal_id)
    || typeof value.transaction_hash !== "string"
    || !HASH_PATTERN.test(value.transaction_hash)
  ) {
    throw new Error("invalid_broadcast_read");
  }
  return value as unknown as BroadcastRow;
}

async function handleOverview(admin: AdminClient): Promise<Response> {
  const [{ data: config, error: configError }, { data, error }] = await Promise.all([
    admin
      .from("nowpayments_usdt_config")
      .select("id,asset,network,provider_currency,withdrawals_enabled")
      .eq("id", "USDT-BEP20")
      .maybeSingle(),
    admin
      .from("nowpayments_usdt_withdrawals")
      .select(
        "id,user_id,destination_address,gross_amount_usdt::text,fee_percent::text,fee_amount_usdt::text,net_amount_usdt::text,status,requested_at,current_broadcast_id",
      )
      .order("requested_at", { ascending: false })
      .limit(OVERVIEW_LIMIT),
  ]);
  const configRow = config as unknown as Record<string, unknown> | null;
  if (
    configError
    || !configRow
    || configRow.id !== "USDT-BEP20"
    || configRow.asset !== "USDT"
    || configRow.network !== "BEP20"
    || configRow.provider_currency !== "usdtbsc"
    || typeof configRow.withdrawals_enabled !== "boolean"
    || error
  ) {
    return errorResponse(
      "withdrawal_admin_unavailable",
      "USDT withdrawals are unavailable.",
      503,
    );
  }

  try {
    const withdrawals = ((data ?? []) as unknown[]).map(validateWithdrawal);
    if (new Set(withdrawals.map((row) => row.id)).size !== withdrawals.length) {
      throw new Error("duplicate_withdrawal_read");
    }
    const userIds = [...new Set(withdrawals.map((row) => row.user_id))];
    const expectedBroadcasts = withdrawals.flatMap((row) => (
      row.current_broadcast_id
        ? [{ withdrawalId: row.id, broadcastId: row.current_broadcast_id }]
        : []
    ));
    if (new Set(expectedBroadcasts.map((row) => row.broadcastId)).size
      !== expectedBroadcasts.length) {
      throw new Error("duplicate_broadcast_relationship");
    }

    let profiles: ProfileRow[] = [];
    if (userIds.length > 0) {
      const profileResult = await admin
        .from("profiles")
        .select("id,username")
        .in("id", userIds)
        .limit(RELATED_LIMIT);
      if (profileResult.error) throw new Error("profile_read_failed");
      profiles = ((profileResult.data ?? []) as unknown[]).map(validateProfile);
      if (
        profiles.length !== userIds.length
        || new Set(profiles.map((row) => row.id)).size !== userIds.length
      ) {
        throw new Error("profile_relationship_incomplete");
      }
    }

    let broadcasts: BroadcastRow[] = [];
    if (expectedBroadcasts.length > 0) {
      const broadcastResult = await admin
        .from("nowpayments_usdt_withdrawal_broadcasts")
        .select("id,withdrawal_id,transaction_hash")
        .in("id", expectedBroadcasts.map((row) => row.broadcastId))
        .in("withdrawal_id", expectedBroadcasts.map((row) => row.withdrawalId))
        .limit(RELATED_LIMIT);
      if (broadcastResult.error) throw new Error("broadcast_read_failed");
      broadcasts = ((broadcastResult.data ?? []) as unknown[]).map(validateBroadcast);
      const expected = new Map(
        expectedBroadcasts.map((row) => [row.broadcastId, row.withdrawalId] as const),
      );
      const seenIds = new Set<string>();
      const seenWithdrawals = new Set<string>();
      for (const broadcast of broadcasts) {
        if (
          seenIds.has(broadcast.id)
          || seenWithdrawals.has(broadcast.withdrawal_id)
          || expected.get(broadcast.id) !== broadcast.withdrawal_id
        ) {
          throw new Error("invalid_broadcast_relationship");
        }
        seenIds.add(broadcast.id);
        seenWithdrawals.add(broadcast.withdrawal_id);
      }
      if (broadcasts.length !== expectedBroadcasts.length) {
        throw new Error("broadcast_relationship_incomplete");
      }
    }

    const usernames = new Map(profiles.map((row) => [row.id, row.username] as const));
    const hashes = new Map(broadcasts.map((row) => [row.id, row.transaction_hash] as const));
    return json(
      {
        withdrawals_enabled: configRow.withdrawals_enabled,
        asset: "USDT",
        network: "BEP20",
        withdrawals: withdrawals.map((row) => ({
          id: row.id,
          username: usernames.get(row.user_id),
          status: publicStatus(row.status),
          destination_address: row.destination_address,
          gross_amount_usdt: row.gross_amount_usdt,
          fee_amount_usdt: row.fee_amount_usdt,
          net_amount_usdt: row.net_amount_usdt,
          requested_at: row.requested_at,
          transaction_hash: row.current_broadcast_id
            ? hashes.get(row.current_broadcast_id) ?? null
            : null,
        })),
      },
      200,
    );
  } catch {
    return errorResponse(
      "withdrawal_admin_unavailable",
      "USDT withdrawals are unavailable.",
      503,
    );
  }
}

function parseContentLength(req: Request): number | null {
  const value = req.headers.get("content-length");
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function exactFields(value: Record<string, unknown>, fields: string[]): boolean {
  const keys = Object.keys(value).sort();
  const expected = [...fields].sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index]);
}

async function parseBody(req: Request): Promise<AdminActionBody | null> {
  const contentType = (req.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") return null;
  const contentLength = parseContentLength(req);
  if (contentLength !== null && contentLength > MAX_BODY_BYTES) {
    throw new RangeError("request_body_too_large");
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new RangeError("request_body_too_large");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isNonNullNonArrayObject(value)) return null;
  if (
    typeof value.withdrawal_id !== "string"
    || !UUID_PATTERN.test(value.withdrawal_id)
    || typeof value.action_id !== "string"
    || !UUID_V4_PATTERN.test(value.action_id)
  ) {
    return null;
  }
  const withdrawalId = value.withdrawal_id.toLowerCase();
  const actionId = value.action_id.toLowerCase();
  if (
    value.action === "reject"
    && exactFields(value, ["action", "withdrawal_id", "action_id"])
  ) {
    return { action: "reject", withdrawal_id: withdrawalId, action_id: actionId };
  }
  if (
    value.action === "complete"
    && exactFields(value, ["action", "withdrawal_id", "action_id", "transaction_hash"])
    && (
      value.transaction_hash === null
      || (
        typeof value.transaction_hash === "string"
        && value.transaction_hash === value.transaction_hash.trim()
        && HASH_PATTERN.test(value.transaction_hash.toLowerCase())
      )
    )
  ) {
    return {
      action: "complete",
      withdrawal_id: withdrawalId,
      action_id: actionId,
      transaction_hash: typeof value.transaction_hash === "string"
        ? value.transaction_hash.toLowerCase()
        : null,
    };
  }
  return null;
}

function rpcErrorResponse(error: { message?: string } | null): Response {
  const code = error?.message ?? "";
  if (code.includes("nowpayments_usdt_action_id_conflict")) {
    return errorResponse(
      "idempotency_conflict",
      "This action key was already used for different details.",
      409,
    );
  }
  if (
    code.includes("invalid_nowpayments_usdt_withdrawal_owner_or_state")
    || code.includes("withdrawal_cannot_be_rejected_after_send_lock")
  ) {
    return errorResponse(
      "withdrawal_state_conflict",
      "The withdrawal state changed. Refresh and review it.",
      409,
    );
  }
  if (code.includes("nowpayments_usdt_admin_ineligible")) {
    return errorResponse("account_unavailable", "Account is unavailable.", 403);
  }
  if (
    code.includes("invalid_nowpayments_usdt_manual_completion")
    || code.includes("invalid_nowpayments_usdt_manual_rejection")
    || code.includes("invalid_nowpayments_usdt_withdrawal_destination")
    || code.includes("qhash_controlled_withdrawal_destination")
  ) {
    return errorResponse("invalid_action", "Check the action details.", 400);
  }
  if (code.includes("nowpayments_usdt_withdrawal_not_found")) {
    return errorResponse("withdrawal_not_found", "Withdrawal not found.", 404);
  }
  return errorResponse(
    "withdrawal_action_failed",
    "The withdrawal action could not be completed.",
    500,
  );
}

function sanitizeActionResult(value: unknown, body: AdminActionBody): Record<string, unknown> | null {
  if (!isNonNullNonArrayObject(value)) return null;
  if (
    value.status !== (body.action === "complete" ? "completed" : "rejected")
    || typeof value.withdrawal_id !== "string"
    || value.withdrawal_id !== body.withdrawal_id
    || !isDecimal(value.available_balance_usdt)
    || !isDecimal(value.reserved_balance_usdt)
  ) {
    return null;
  }
  if (
    body.action === "complete"
    && (
      !isDecimal(value.gross_amount_usdt)
      || !isDecimal(value.fee_amount_usdt)
      || !isDecimal(value.net_amount_usdt)
      || (
        body.transaction_hash !== null
        && value.transaction_hash !== body.transaction_hash
      )
      || (
        body.transaction_hash === null
        && value.transaction_hash !== undefined
      )
    )
  ) {
    return null;
  }
  return {
    status: value.status,
    available_balance_usdt: value.available_balance_usdt,
    reserved_balance_usdt: value.reserved_balance_usdt,
    ...(body.action === "complete"
      ? {
          gross_amount_usdt: value.gross_amount_usdt,
          fee_amount_usdt: value.fee_amount_usdt,
          net_amount_usdt: value.net_amount_usdt,
          transaction_hash: body.transaction_hash,
        }
      : {}),
  };
}

async function handleAction(
  req: Request,
  admin: AdminClient,
  adminId: string,
): Promise<Response> {
  let body: AdminActionBody | null;
  try {
    body = await parseBody(req);
  } catch (error) {
    if (error instanceof RangeError) {
      return errorResponse("request_too_large", "Request body is too large.", 413);
    }
    return errorResponse("invalid_request", "Invalid request body.", 400);
  }
  if (!body) {
    const contentType = (req.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    return contentType === "application/json"
      ? errorResponse("invalid_request", "Invalid request body.", 400)
      : errorResponse("unsupported_media_type", "Use application/json.", 415);
  }

  const result = body.action === "complete"
    ? await admin.rpc("complete_nowpayments_usdt_withdrawal_manual", {
        p_withdrawal_id: body.withdrawal_id,
        p_admin_id: adminId,
        p_action_id: body.action_id,
        p_transaction_hash: body.transaction_hash,
      })
    : await admin.rpc("reject_nowpayments_usdt_withdrawal_manual", {
        p_withdrawal_id: body.withdrawal_id,
        p_admin_id: adminId,
        p_action_id: body.action_id,
      });
  if (result.error) return rpcErrorResponse(result.error);
  const response = sanitizeActionResult(result.data, body);
  if (!response) {
    return errorResponse(
      "withdrawal_action_unavailable",
      "The withdrawal action could not be confirmed.",
      503,
    );
  }
  return json(response, 200);
}

export default async (req: Request, context?: Context): Promise<Response> => {
  if (!isPublishedProductionDeployContext(context)) {
    return errorResponse(
      "crypto_runtime_unavailable",
      "USDT withdrawals are unavailable.",
      503,
    );
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return errorResponse("method_not_allowed", "GET or POST only.", 405);
  }

  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL")
    ?? Netlify.env.get("SUPABASE_URL")
    ?? "";
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse("server_config", "Server is not configured.", 500);
  }

  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || token === authorization) {
    return errorResponse("authentication_required", "Authentication required.", 401);
  }

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    return errorResponse("invalid_session", "Invalid or expired session.", 401);
  }
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,is_admin,is_frozen")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (
    profileError
    || !profile
    || profile.id !== authData.user.id
    || !profile.is_admin
    || profile.is_frozen
  ) {
    return errorResponse("account_unavailable", "Account is unavailable.", 403);
  }

  return req.method === "GET"
    ? handleOverview(admin)
    : handleAction(req, admin, authData.user.id);
};

export const config: Config = {
  path: "/api/admin/crypto/nowpayments/withdrawals",
};

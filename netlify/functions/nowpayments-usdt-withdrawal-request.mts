import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types.ts";
import { isPublishedProductionDeployContext } from "./lib/nowpayments-deploy-context.mts";

const MAX_BODY_BYTES = 4_096;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,6})?$/;
const RESPONSE_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const BODY_FIELDS = ["destination_address", "gross_amount_usdt", "idempotency_key"] as const;

type RequestBody = {
  gross_amount_usdt: string;
  destination_address: string;
  idempotency_key: string;
};

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function requestError(
  error: string,
  message: string,
  status: number,
): Response {
  return json({ error, message }, status);
}

function parseContentLength(req: Request): number | null {
  const value = req.headers.get("content-length");
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

async function parseBody(req: Request): Promise<RequestBody | null> {
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
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const fields = Object.keys(body).sort();
  if (
    fields.length !== BODY_FIELDS.length
    || fields.some((field, index) => field !== BODY_FIELDS[index])
    || typeof body.gross_amount_usdt !== "string"
    || !DECIMAL_PATTERN.test(body.gross_amount_usdt)
    || typeof body.destination_address !== "string"
    || body.destination_address !== body.destination_address.trim()
    || !ADDRESS_PATTERN.test(body.destination_address)
    || typeof body.idempotency_key !== "string"
    || !UUID_V4_PATTERN.test(body.idempotency_key)
  ) {
    return null;
  }
  return {
    gross_amount_usdt: body.gross_amount_usdt,
    destination_address: body.destination_address.toLowerCase(),
    idempotency_key: body.idempotency_key.toLowerCase(),
  };
}

function safeRpcError(error: { message?: string } | null): Response {
  const code = error?.message ?? "";
  if (code.includes("nowpayments_usdt_action_id_conflict")) {
    return requestError(
      "idempotency_conflict",
      "This request key was already used for different withdrawal details.",
      409,
    );
  }
  if (code.includes("open_nowpayments_usdt_withdrawal_exists")) {
    return requestError(
      "withdrawal_already_open",
      "You already have a USDT withdrawal in progress.",
      409,
    );
  }
  if (code.includes("insufficient_nowpayments_usdt_available_balance")) {
    return requestError("insufficient_balance", "Insufficient available USDT balance.", 409);
  }
  if (code.includes("nowpayments_usdt_withdrawals_disabled")) {
    return requestError(
      "crypto_withdrawals_disabled",
      "USDT withdrawals are temporarily unavailable.",
      503,
    );
  }
  if (code.includes("nowpayments_usdt_withdrawal_user_ineligible")) {
    return requestError("account_unavailable", "Account is unavailable.", 403);
  }
  if (
    code.includes("invalid_nowpayments_usdt_withdrawal_destination")
    || code.includes("qhash_controlled_withdrawal_destination")
  ) {
    return requestError(
      "invalid_destination",
      "Enter a valid external USDT BEP20 destination address.",
      400,
    );
  }
  if (code.includes("invalid_nowpayments_usdt_withdrawal_request")) {
    return requestError("invalid_withdrawal_request", "Check the withdrawal details.", 400);
  }
  if (
    code.includes("nowpayments_usdt_wallet_not_found")
    || code.includes("nowpayments_usdt_configuration_missing")
  ) {
    return requestError(
      "withdrawal_request_unavailable",
      "USDT withdrawals are unavailable.",
      503,
    );
  }
  return requestError(
    "withdrawal_request_failed",
    "The withdrawal request could not be submitted.",
    500,
  );
}

function canonicalDecimal(value: string): string {
  const [integer, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
}

function amountMicros(value: string): bigint {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function sanitizeResult(
  value: unknown,
  expected: RequestBody,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.withdrawal_id !== "string"
    || !UUID_V4_PATTERN.test(row.withdrawal_id)
    || row.status !== "reserved"
    || typeof row.destination_address !== "string"
    || !/^0x[0-9a-f]{40}$/.test(row.destination_address)
    || row.destination_address !== expected.destination_address
    || typeof row.gross_amount_usdt !== "string"
    || !DECIMAL_PATTERN.test(row.gross_amount_usdt)
    || canonicalDecimal(row.gross_amount_usdt) !== canonicalDecimal(expected.gross_amount_usdt)
    || typeof row.fee_amount_usdt !== "string"
    || !DECIMAL_PATTERN.test(row.fee_amount_usdt)
    || typeof row.net_amount_usdt !== "string"
    || !DECIMAL_PATTERN.test(row.net_amount_usdt)
    || typeof row.available_balance_usdt !== "string"
    || !RESPONSE_DECIMAL_PATTERN.test(row.available_balance_usdt)
    || typeof row.reserved_balance_usdt !== "string"
    || !RESPONSE_DECIMAL_PATTERN.test(row.reserved_balance_usdt)
  ) {
    return null;
  }
  const grossMicros = amountMicros(row.gross_amount_usdt);
  const feeMicros = amountMicros(row.fee_amount_usdt);
  const netMicros = amountMicros(row.net_amount_usdt);
  if (feeMicros !== (grossMicros * 5n + 50n) / 100n || netMicros !== grossMicros - feeMicros) {
    return null;
  }
  return {
    status: "reserved",
    gross_amount_usdt: row.gross_amount_usdt,
    fee_amount_usdt: row.fee_amount_usdt,
    net_amount_usdt: row.net_amount_usdt,
    available_balance_usdt: row.available_balance_usdt,
    reserved_balance_usdt: row.reserved_balance_usdt,
  };
}

export default async (req: Request, context?: Context): Promise<Response> => {
  if (!isPublishedProductionDeployContext(context)) {
    return requestError(
      "crypto_runtime_unavailable",
      "USDT withdrawals are unavailable.",
      503,
    );
  }
  if (req.method !== "POST") {
    return requestError("method_not_allowed", "POST only.", 405);
  }

  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL")
    ?? Netlify.env.get("SUPABASE_URL")
    ?? "";
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return requestError("server_config", "Server is not configured.", 500);
  }

  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || token === authorization) {
    return requestError("authentication_required", "Authentication required.", 401);
  }

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    return requestError("invalid_session", "Invalid or expired session.", 401);
  }
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("is_frozen,is_admin")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile || profile.is_frozen || profile.is_admin) {
    return requestError("account_unavailable", "Account is unavailable.", 403);
  }

  let body: RequestBody | null;
  try {
    body = await parseBody(req);
  } catch (error) {
    if (error instanceof RangeError) {
      return requestError("request_too_large", "Request body is too large.", 413);
    }
    return requestError("invalid_request", "Invalid request body.", 400);
  }
  if (!body) {
    const contentType = (req.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    return contentType === "application/json"
      ? requestError("invalid_request", "Invalid request body.", 400)
      : requestError("unsupported_media_type", "Use application/json.", 415);
  }

  const { data, error } = await admin.rpc("request_nowpayments_usdt_withdrawal", {
    p_user_id: authData.user.id,
    p_request_id: body.idempotency_key,
    p_gross_amount_usdt: body.gross_amount_usdt,
    p_destination_address: body.destination_address,
  });
  if (error) return safeRpcError(error);
  const result = sanitizeResult(data, body);
  if (!result) {
    return requestError(
      "withdrawal_request_unavailable",
      "USDT withdrawals are unavailable.",
      503,
    );
  }
  return json(result, 200);
};

export const config: Config = {
  path: "/api/crypto/nowpayments/withdrawal-request",
};

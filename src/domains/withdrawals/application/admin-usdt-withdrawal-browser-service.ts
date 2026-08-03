import { isNonNullNonArrayObject } from "../../../shared/validation/non-null-non-array-object.ts";
import { isParseableTimestampString } from "../../../shared/validation/parseable-timestamp.ts";

export const NOWPAYMENTS_ADMIN_WITHDRAWAL_STATUSES = [
  "pending",
  "completed",
  "rejected",
] as const;

export type NowpaymentsAdminWithdrawalStatus =
  (typeof NOWPAYMENTS_ADMIN_WITHDRAWAL_STATUSES)[number];

export type NowpaymentsAdminWithdrawal = {
  id: string;
  username: string;
  status: NowpaymentsAdminWithdrawalStatus;
  destination_address: string;
  gross_amount_usdt: string;
  fee_amount_usdt: string;
  net_amount_usdt: string;
  requested_at: string;
  transaction_hash: string | null;
};

export type NowpaymentsAdminWithdrawalOverview = {
  withdrawals_enabled: boolean;
  asset: "USDT";
  network: "BEP20";
  withdrawals: NowpaymentsAdminWithdrawal[];
};

export type NowpaymentsAdminActionInput =
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

export type NowpaymentsAdminActionResult = {
  status: "completed" | "rejected";
  available_balance_usdt: string;
  reserved_balance_usdt: string;
  gross_amount_usdt?: string;
  fee_amount_usdt?: string;
  net_amount_usdt?: string;
  transaction_hash?: string | null;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/;
const STATUS_SET = new Set<string>(NOWPAYMENTS_ADMIN_WITHDRAWAL_STATUSES);

export class NowpaymentsAdminWithdrawalError extends Error {
  readonly kind:
    | "authentication"
    | "authorization"
    | "conflict"
    | "validation"
    | "unavailable";

  constructor(kind: NowpaymentsAdminWithdrawalError["kind"]) {
    super(kind);
    this.name = "NowpaymentsAdminWithdrawalError";
    this.kind = kind;
  }
}

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

function decimalMicros(value: string): bigint {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
}

function parseWithdrawal(value: unknown): NowpaymentsAdminWithdrawal {
  if (
    !isNonNullNonArrayObject(value)
    || typeof value.id !== "string"
    || !UUID_PATTERN.test(value.id)
    || typeof value.username !== "string"
    || value.username.trim() === ""
    || typeof value.status !== "string"
    || !STATUS_SET.has(value.status)
    || typeof value.destination_address !== "string"
    || !ADDRESS_PATTERN.test(value.destination_address)
    || !isDecimal(value.gross_amount_usdt)
    || !isDecimal(value.fee_amount_usdt)
    || !isDecimal(value.net_amount_usdt)
    || !isParseableTimestampString(value.requested_at)
    || (
      value.transaction_hash !== null
      && (
        typeof value.transaction_hash !== "string"
        || !HASH_PATTERN.test(value.transaction_hash)
      )
    )
  ) {
    throw new NowpaymentsAdminWithdrawalError("unavailable");
  }

  const gross = decimalMicros(value.gross_amount_usdt);
  const fee = decimalMicros(value.fee_amount_usdt);
  const net = decimalMicros(value.net_amount_usdt);
  if (fee !== (gross * 5n + 50n) / 100n || net !== gross - fee) {
    throw new NowpaymentsAdminWithdrawalError("unavailable");
  }

  return {
    id: value.id,
    username: value.username,
    status: value.status as NowpaymentsAdminWithdrawalStatus,
    destination_address: value.destination_address,
    gross_amount_usdt: value.gross_amount_usdt,
    fee_amount_usdt: value.fee_amount_usdt,
    net_amount_usdt: value.net_amount_usdt,
    requested_at: value.requested_at,
    transaction_hash: value.transaction_hash,
  };
}

export function parseNowpaymentsAdminWithdrawalOverview(
  value: unknown,
): NowpaymentsAdminWithdrawalOverview {
  if (
    !isNonNullNonArrayObject(value)
    || typeof value.withdrawals_enabled !== "boolean"
    || value.asset !== "USDT"
    || value.network !== "BEP20"
    || !Array.isArray(value.withdrawals)
  ) {
    throw new NowpaymentsAdminWithdrawalError("unavailable");
  }

  const withdrawals = value.withdrawals.map(parseWithdrawal);
  if (new Set(withdrawals.map((row) => row.id)).size !== withdrawals.length) {
    throw new NowpaymentsAdminWithdrawalError("unavailable");
  }

  return {
    withdrawals_enabled: value.withdrawals_enabled,
    asset: "USDT",
    network: "BEP20",
    withdrawals,
  };
}

function parseActionResult(value: unknown): NowpaymentsAdminActionResult {
  if (
    !isNonNullNonArrayObject(value)
    || (value.status !== "completed" && value.status !== "rejected")
    || !isDecimal(value.available_balance_usdt)
    || !isDecimal(value.reserved_balance_usdt)
  ) {
    throw new NowpaymentsAdminWithdrawalError("unavailable");
  }

  if (value.status === "completed") {
    if (
      !isDecimal(value.gross_amount_usdt)
      || !isDecimal(value.fee_amount_usdt)
      || !isDecimal(value.net_amount_usdt)
      || (
        value.transaction_hash !== null
        && (
          typeof value.transaction_hash !== "string"
          || !HASH_PATTERN.test(value.transaction_hash)
        )
      )
    ) {
      throw new NowpaymentsAdminWithdrawalError("unavailable");
    }

    return {
      status: "completed",
      available_balance_usdt: value.available_balance_usdt,
      reserved_balance_usdt: value.reserved_balance_usdt,
      gross_amount_usdt: value.gross_amount_usdt,
      fee_amount_usdt: value.fee_amount_usdt,
      net_amount_usdt: value.net_amount_usdt,
      transaction_hash: value.transaction_hash,
    };
  }

  return {
    status: "rejected",
    available_balance_usdt: value.available_balance_usdt,
    reserved_balance_usdt: value.reserved_balance_usdt,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new NowpaymentsAdminWithdrawalError("unavailable");
  }
}

function throwForResponse(response: Response, value: unknown): never {
  if (response.status === 401) {
    throw new NowpaymentsAdminWithdrawalError("authentication");
  }
  if (response.status === 403) {
    throw new NowpaymentsAdminWithdrawalError("authorization");
  }

  const error = isNonNullNonArrayObject(value) && typeof value.error === "string"
    ? value.error
    : "";
  if (error === "idempotency_conflict" || error === "withdrawal_state_conflict") {
    throw new NowpaymentsAdminWithdrawalError("conflict");
  }
  if (
    response.status === 400
    || response.status === 413
    || response.status === 415
  ) {
    throw new NowpaymentsAdminWithdrawalError("validation");
  }
  throw new NowpaymentsAdminWithdrawalError("unavailable");
}

export async function fetchNowpaymentsAdminWithdrawalOverview(
  accessToken: string,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<NowpaymentsAdminWithdrawalOverview> {
  const response = await request("/api/admin/crypto/nowpayments/withdrawals", {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
    signal,
  });
  const value = await readJson(response);
  if (!response.ok) throwForResponse(response, value);
  return parseNowpaymentsAdminWithdrawalOverview(value);
}

export async function submitNowpaymentsAdminWithdrawalAction(
  accessToken: string,
  input: NowpaymentsAdminActionInput,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<NowpaymentsAdminActionResult> {
  const response = await request("/api/admin/crypto/nowpayments/withdrawals", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
    signal,
  });
  const value = await readJson(response);
  if (!response.ok) throwForResponse(response, value);
  return parseActionResult(value);
}

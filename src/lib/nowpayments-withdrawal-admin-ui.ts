import {
  createLatestWithdrawalOverviewRequestGuard,
  runSingleFlight,
} from "./nowpayments-withdrawal-ui.js";

export const NOWPAYMENTS_ADMIN_WITHDRAWAL_STATUSES = [
  "reserved",
  "reviewing",
  "send_locked",
  "broadcasted",
  "completed",
  "rejected",
] as const;

export type NowpaymentsAdminWithdrawalStatus =
  (typeof NOWPAYMENTS_ADMIN_WITHDRAWAL_STATUSES)[number];

export type NowpaymentsAdminWithdrawalEvent = {
  action:
    | "request"
    | "claim_review"
    | "send_lock"
    | "record_broadcast"
    | "complete"
    | "reject"
    | "admin_takeover";
  from_status: NowpaymentsAdminWithdrawalStatus | null;
  to_status: NowpaymentsAdminWithdrawalStatus;
  created_at: string;
};

export type NowpaymentsAdminWithdrawalBroadcast = {
  transaction_hash: string;
  recorded_at: string;
  is_current: boolean;
  correction_reason: string | null;
};

export type NowpaymentsAdminWithdrawalVerification = {
  chain_id: 56;
  token_contract: "0x55d398326f99059ff775485246999027b3197955";
  transaction_success: true;
  exactly_one_matching_transfer: true;
  destination_address: string;
  net_amount_usdt: string;
  block_number: number;
  transfer_log_index: number;
  confirmations: number;
  verified_at: string;
};

export type NowpaymentsAdminWithdrawal = {
  id: string;
  username: string;
  destination_address: string;
  gross_amount_usdt: string;
  fee_amount_usdt: string;
  net_amount_usdt: string;
  status: NowpaymentsAdminWithdrawalStatus;
  requested_at: string;
  claimed_at: string | null;
  send_locked_at: string | null;
  broadcasted_at: string | null;
  completed_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  assigned_to_current_admin: boolean;
  events: NowpaymentsAdminWithdrawalEvent[];
  broadcasts: NowpaymentsAdminWithdrawalBroadcast[];
  verification: NowpaymentsAdminWithdrawalVerification | null;
};

export type NowpaymentsAdminWithdrawalOverview = {
  withdrawals_enabled: boolean;
  asset: "USDT";
  network: "BEP20";
  minimum_withdrawal_usdt: string;
  withdrawal_fee_percent: string;
  required_confirmations: 120;
  withdrawals: NowpaymentsAdminWithdrawal[];
};

export type NowpaymentsAdminActionInput =
  | {
      action: "begin_review";
      withdrawal_id: string;
      action_id: string;
    }
  | {
      action: "reject";
      withdrawal_id: string;
      action_id: string;
      reason: string;
    }
  | {
      action: "send_lock";
      withdrawal_id: string;
      action_id: string;
      external_liquidity_confirmed: true;
      destination_manually_verified: true;
      irreversible_send_confirmed: true;
    }
  | {
      action: "record_broadcast";
      withdrawal_id: string;
      action_id: string;
      transaction_hash: string;
      correction_reason: string | null;
    }
  | {
      action: "complete";
      withdrawal_id: string;
      action_id: string;
      transaction_hash: string;
      chain_id: 56;
      token_contract: "0x55d398326f99059ff775485246999027b3197955";
      transaction_success: true;
      exactly_one_matching_transfer: true;
      destination_address: string;
      net_amount_usdt: string;
      block_number: number;
      transfer_log_index: number;
      confirmations: number;
      verified_at: string;
    };

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,6})?$/;
const STATUS_SET = new Set<string>(NOWPAYMENTS_ADMIN_WITHDRAWAL_STATUSES);
const ACTION_SET = new Set([
  "request",
  "claim_review",
  "send_lock",
  "record_broadcast",
  "complete",
  "reject",
  "admin_takeover",
]);

export class NowpaymentsAdminWithdrawalError extends Error {
  readonly kind:
    | "authentication"
    | "authorization"
    | "disabled"
    | "conflict"
    | "validation"
    | "unavailable";

  constructor(kind: NowpaymentsAdminWithdrawalError["kind"]) {
    super(kind);
    this.name = "NowpaymentsAdminWithdrawalError";
    this.kind = kind;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
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
  return BigInt(integer) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function parseEvent(value: unknown): NowpaymentsAdminWithdrawalEvent {
  if (
    !isObject(value)
    || typeof value.action !== "string"
    || !ACTION_SET.has(value.action)
    || (value.from_status !== null
      && (typeof value.from_status !== "string" || !STATUS_SET.has(value.from_status)))
    || typeof value.to_status !== "string"
    || !STATUS_SET.has(value.to_status)
    || !isTimestamp(value.created_at)
  ) {
    throw new NowpaymentsAdminWithdrawalError("unavailable");
  }
  return value as unknown as NowpaymentsAdminWithdrawalEvent;
}

function parseBroadcast(value: unknown): NowpaymentsAdminWithdrawalBroadcast {
  if (
    !isObject(value)
    || typeof value.transaction_hash !== "string"
    || !HASH_PATTERN.test(value.transaction_hash)
    || !isTimestamp(value.recorded_at)
    || typeof value.is_current !== "boolean"
    || (value.correction_reason !== null
      && (
        typeof value.correction_reason !== "string"
        || value.correction_reason.length === 0
        || value.correction_reason.length > 500
      ))
  ) {
    throw new NowpaymentsAdminWithdrawalError("unavailable");
  }
  return value as unknown as NowpaymentsAdminWithdrawalBroadcast;
}

function parseVerification(value: unknown): NowpaymentsAdminWithdrawalVerification | null {
  if (value === null) return null;
  if (
    !isObject(value)
    || value.chain_id !== 56
    || value.token_contract !== "0x55d398326f99059ff775485246999027b3197955"
    || value.transaction_success !== true
    || value.exactly_one_matching_transfer !== true
    || typeof value.destination_address !== "string"
    || !ADDRESS_PATTERN.test(value.destination_address)
    || !isDecimal(value.net_amount_usdt)
    || typeof value.block_number !== "number"
    || !Number.isSafeInteger(value.block_number)
    || value.block_number <= 0
    || typeof value.transfer_log_index !== "number"
    || !Number.isSafeInteger(value.transfer_log_index)
    || value.transfer_log_index < 0
    || typeof value.confirmations !== "number"
    || !Number.isSafeInteger(value.confirmations)
    || value.confirmations < 120
    || !isTimestamp(value.verified_at)
  ) {
    throw new NowpaymentsAdminWithdrawalError("unavailable");
  }
  return value as unknown as NowpaymentsAdminWithdrawalVerification;
}

function parseWithdrawal(value: unknown): NowpaymentsAdminWithdrawal {
  if (
    !isObject(value)
    || typeof value.id !== "string"
    || !UUID_V4_PATTERN.test(value.id)
    || typeof value.username !== "string"
    || value.username.length === 0
    || value.username.length > 100
    || typeof value.destination_address !== "string"
    || !ADDRESS_PATTERN.test(value.destination_address)
    || !isDecimal(value.gross_amount_usdt)
    || !isDecimal(value.fee_amount_usdt)
    || !isDecimal(value.net_amount_usdt)
    || typeof value.status !== "string"
    || !STATUS_SET.has(value.status)
    || !isTimestamp(value.requested_at)
    || !isNullableTimestamp(value.claimed_at)
    || !isNullableTimestamp(value.send_locked_at)
    || !isNullableTimestamp(value.broadcasted_at)
    || !isNullableTimestamp(value.completed_at)
    || !isNullableTimestamp(value.rejected_at)
    || (value.rejection_reason !== null
      && (
        typeof value.rejection_reason !== "string"
        || value.rejection_reason.length === 0
        || value.rejection_reason.length > 500
      ))
    || typeof value.assigned_to_current_admin !== "boolean"
    || !Array.isArray(value.events)
    || !Array.isArray(value.broadcasts)
  ) {
    throw new NowpaymentsAdminWithdrawalError("unavailable");
  }
  const events = value.events.map(parseEvent);
  const broadcasts = value.broadcasts.map(parseBroadcast);
  const verification = parseVerification(value.verification);
  const gross = decimalMicros(value.gross_amount_usdt);
  const fee = decimalMicros(value.fee_amount_usdt);
  const net = decimalMicros(value.net_amount_usdt);
  if (
    fee !== (gross * 5n + 50n) / 100n
    || net !== gross - fee
    || (value.status === "completed" && verification === null)
    || (value.status !== "completed" && verification !== null)
    || (
      ["broadcasted", "completed"].includes(value.status)
        ? broadcasts.filter((row) => row.is_current).length !== 1
        : broadcasts.length !== 0
    )
    || (value.status === "rejected"
      ? value.rejection_reason === null || value.rejected_at === null
      : value.rejection_reason !== null)
    || events.length === 0
    || events.at(-1)?.to_status !== value.status
  ) {
    throw new NowpaymentsAdminWithdrawalError("unavailable");
  }
  return {
    id: value.id,
    username: value.username,
    destination_address: value.destination_address,
    gross_amount_usdt: value.gross_amount_usdt,
    fee_amount_usdt: value.fee_amount_usdt,
    net_amount_usdt: value.net_amount_usdt,
    status: value.status as NowpaymentsAdminWithdrawalStatus,
    requested_at: value.requested_at,
    claimed_at: value.claimed_at,
    send_locked_at: value.send_locked_at,
    broadcasted_at: value.broadcasted_at,
    completed_at: value.completed_at,
    rejected_at: value.rejected_at,
    rejection_reason: value.rejection_reason,
    assigned_to_current_admin: value.assigned_to_current_admin,
    events,
    broadcasts,
    verification,
  };
}

export function parseNowpaymentsAdminWithdrawalOverview(
  value: unknown,
): NowpaymentsAdminWithdrawalOverview {
  if (
    !isObject(value)
    || typeof value.withdrawals_enabled !== "boolean"
    || value.asset !== "USDT"
    || value.network !== "BEP20"
    || !isDecimal(value.minimum_withdrawal_usdt)
    || canonicalDecimal(value.minimum_withdrawal_usdt) !== "2"
    || !isDecimal(value.withdrawal_fee_percent)
    || canonicalDecimal(value.withdrawal_fee_percent) !== "5"
    || value.required_confirmations !== 120
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
    minimum_withdrawal_usdt: value.minimum_withdrawal_usdt,
    withdrawal_fee_percent: value.withdrawal_fee_percent,
    required_confirmations: 120,
    withdrawals,
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
  if (response.status === 401) throw new NowpaymentsAdminWithdrawalError("authentication");
  if (response.status === 403) throw new NowpaymentsAdminWithdrawalError("authorization");
  const error = isObject(value) && typeof value.error === "string" ? value.error : "";
  if (error === "crypto_withdrawals_disabled") {
    throw new NowpaymentsAdminWithdrawalError("disabled");
  }
  if (response.status === 409) throw new NowpaymentsAdminWithdrawalError("conflict");
  if ([400, 413, 415].includes(response.status)) {
    throw new NowpaymentsAdminWithdrawalError("validation");
  }
  throw new NowpaymentsAdminWithdrawalError("unavailable");
}

export async function fetchNowpaymentsAdminWithdrawalOverview(
  accessToken: string,
  request: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<NowpaymentsAdminWithdrawalOverview> {
  const response = await request("/api/admin/crypto/nowpayments/usdt-withdrawals", {
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
): Promise<{ status: NowpaymentsAdminWithdrawalStatus; transaction_hash?: string }> {
  const response = await request("/api/admin/crypto/nowpayments/usdt-withdrawals", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const value = await readJson(response);
  if (!response.ok) throwForResponse(response, value);
  if (
    !isObject(value)
    || typeof value.status !== "string"
    || !STATUS_SET.has(value.status)
    || (value.transaction_hash !== undefined
      && (typeof value.transaction_hash !== "string" || !HASH_PATTERN.test(value.transaction_hash)))
  ) {
    throw new NowpaymentsAdminWithdrawalError("unavailable");
  }
  return value as {
    status: NowpaymentsAdminWithdrawalStatus;
    transaction_hash?: string;
  };
}

export function createLatestAdminWithdrawalRequestGuard() {
  return createLatestWithdrawalOverviewRequestGuard();
}

export function createAdminWithdrawalActionKeyManager(
  createKey: () => string = () => globalThis.crypto.randomUUID(),
) {
  let fingerprint: string | null = null;
  let key: string | null = null;
  return {
    keyFor(nextFingerprint: string): string {
      if (fingerprint !== nextFingerprint || key === null) {
        const nextKey = createKey();
        if (!UUID_V4_PATTERN.test(nextKey)) {
          throw new Error("invalid_admin_action_key_factory");
        }
        fingerprint = nextFingerprint;
        key = nextKey.toLowerCase();
      }
      return key;
    },
    clear() {
      fingerprint = null;
      key = null;
    },
  };
}

export function formatAdminUsdtSix(value: string): string {
  if (!DECIMAL_PATTERN.test(value)) return "0.000000";
  const [integer, fraction = ""] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${fraction.padEnd(6, "0")}`;
}

export function currentBroadcast(
  withdrawal: NowpaymentsAdminWithdrawal,
): NowpaymentsAdminWithdrawalBroadcast | null {
  return withdrawal.broadcasts.find((broadcast) => broadcast.is_current) ?? null;
}

export function runAdminWithdrawalSingleFlight<T>(
  holder: { current: Promise<T> | null },
  operation: () => Promise<T>,
): Promise<T> {
  return runSingleFlight(holder, operation);
}

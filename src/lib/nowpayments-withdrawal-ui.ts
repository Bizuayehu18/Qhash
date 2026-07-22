export const NOWPAYMENTS_WITHDRAWAL_STATUSES = [
  "reserved",
  "reviewing",
  "send_locked",
  "broadcasted",
  "completed",
  "rejected",
] as const;

export type NowpaymentsWithdrawalStatus = (typeof NOWPAYMENTS_WITHDRAWAL_STATUSES)[number];

export type NowpaymentsWithdrawalHistoryView = {
  status: NowpaymentsWithdrawalStatus;
  destination: string;
  gross_amount_usdt: string;
  fee_amount_usdt: string;
  net_amount_usdt: string;
  requested_at: string;
  updated_at: string;
  transaction_hash: string | null;
  completed_at: string | null;
  rejected_at: string | null;
  rejection_message: "Funds returned." | null;
};

export type NowpaymentsWithdrawalOverview = {
  withdrawals_enabled: boolean;
  asset: "USDT";
  network: "BEP20";
  available_balance_usdt: string;
  reserved_balance_usdt: string;
  minimum_withdrawal_usdt: string;
  withdrawal_fee_percent: string;
  history: NowpaymentsWithdrawalHistoryView[];
};

export type NowpaymentsWithdrawalRequestResult = {
  status: "reserved";
  gross_amount_usdt: string;
  fee_amount_usdt: string;
  net_amount_usdt: string;
  available_balance_usdt: string;
  reserved_balance_usdt: string;
};

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;
const INPUT_DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,6})?$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_SET = new Set<string>(NOWPAYMENTS_WITHDRAWAL_STATUSES);
const MICROS_PER_USDT = 1_000_000n;
const MINIMUM_MICROS = 2n * MICROS_PER_USDT;

export class NowpaymentsWithdrawalUiError extends Error {
  readonly kind:
    | "authentication"
    | "disabled"
    | "conflict"
    | "insufficient_balance"
    | "invalid_destination"
    | "validation"
    | "unavailable";

  constructor(kind: NowpaymentsWithdrawalUiError["kind"]) {
    super(kind);
    this.name = "NowpaymentsWithdrawalUiError";
    this.kind = kind;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

function canonicalDecimal(value: string): string {
  const [integer, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isNullableTransactionHash(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && TRANSACTION_HASH_PATTERN.test(value));
}

function parseHistory(value: unknown): NowpaymentsWithdrawalHistoryView {
  if (!isObject(value)) throw new NowpaymentsWithdrawalUiError("unavailable");
  if (
    typeof value.status !== "string"
    || !STATUS_SET.has(value.status)
    || typeof value.destination !== "string"
    || !/^0x[0-9a-f]{40}$/.test(value.destination)
    || !isDecimal(value.gross_amount_usdt)
    || !isDecimal(value.fee_amount_usdt)
    || !isDecimal(value.net_amount_usdt)
    || !isTimestamp(value.requested_at)
    || !isTimestamp(value.updated_at)
    || !isNullableTransactionHash(value.transaction_hash)
    || !isNullableTimestamp(value.completed_at)
    || !isNullableTimestamp(value.rejected_at)
    || (value.rejection_message !== null && value.rejection_message !== "Funds returned.")
    || (value.status === "completed" && value.completed_at === null)
    || (value.status === "rejected"
      && (value.rejected_at === null || value.rejection_message !== "Funds returned."))
    || (value.status !== "rejected" && value.rejection_message !== null)
  ) {
    throw new NowpaymentsWithdrawalUiError("unavailable");
  }
  return {
    status: value.status as NowpaymentsWithdrawalStatus,
    destination: value.destination,
    gross_amount_usdt: value.gross_amount_usdt,
    fee_amount_usdt: value.fee_amount_usdt,
    net_amount_usdt: value.net_amount_usdt,
    requested_at: value.requested_at,
    updated_at: value.updated_at,
    transaction_hash: value.transaction_hash,
    completed_at: value.completed_at,
    rejected_at: value.rejected_at,
    rejection_message: value.rejection_message as "Funds returned." | null,
  };
}

export function parseNowpaymentsWithdrawalOverview(
  value: unknown,
): NowpaymentsWithdrawalOverview {
  if (!isObject(value) || !Array.isArray(value.history)) {
    throw new NowpaymentsWithdrawalUiError("unavailable");
  }
  if (
    typeof value.withdrawals_enabled !== "boolean"
    || value.asset !== "USDT"
    || value.network !== "BEP20"
    || !isDecimal(value.available_balance_usdt)
    || !isDecimal(value.reserved_balance_usdt)
    || !isDecimal(value.minimum_withdrawal_usdt)
    || canonicalDecimal(value.minimum_withdrawal_usdt) !== "2"
    || !isDecimal(value.withdrawal_fee_percent)
    || canonicalDecimal(value.withdrawal_fee_percent) !== "5"
  ) {
    throw new NowpaymentsWithdrawalUiError("unavailable");
  }
  return {
    withdrawals_enabled: value.withdrawals_enabled,
    asset: "USDT",
    network: "BEP20",
    available_balance_usdt: value.available_balance_usdt,
    reserved_balance_usdt: value.reserved_balance_usdt,
    minimum_withdrawal_usdt: value.minimum_withdrawal_usdt,
    withdrawal_fee_percent: value.withdrawal_fee_percent,
    history: value.history.map(parseHistory),
  };
}

function parseRequestResult(value: unknown): NowpaymentsWithdrawalRequestResult {
  if (
    !isObject(value)
    || value.status !== "reserved"
    || !isDecimal(value.gross_amount_usdt)
    || !isDecimal(value.fee_amount_usdt)
    || !isDecimal(value.net_amount_usdt)
    || !isDecimal(value.available_balance_usdt)
    || !isDecimal(value.reserved_balance_usdt)
  ) {
    throw new NowpaymentsWithdrawalUiError("unavailable");
  }
  return {
    status: "reserved",
    gross_amount_usdt: value.gross_amount_usdt,
    fee_amount_usdt: value.fee_amount_usdt,
    net_amount_usdt: value.net_amount_usdt,
    available_balance_usdt: value.available_balance_usdt,
    reserved_balance_usdt: value.reserved_balance_usdt,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new NowpaymentsWithdrawalUiError("unavailable");
  }
}

function throwForResponse(response: Response, value: unknown): never {
  if (response.status === 401) throw new NowpaymentsWithdrawalUiError("authentication");
  const error = isObject(value) && typeof value.error === "string" ? value.error : "";
  if (error === "crypto_withdrawals_disabled" || error === "crypto_runtime_unavailable") {
    throw new NowpaymentsWithdrawalUiError("disabled");
  }
  if (error === "insufficient_balance") {
    throw new NowpaymentsWithdrawalUiError("insufficient_balance");
  }
  if (error === "invalid_destination") {
    throw new NowpaymentsWithdrawalUiError("invalid_destination");
  }
  if (error === "idempotency_conflict" || error === "withdrawal_already_open") {
    throw new NowpaymentsWithdrawalUiError("conflict");
  }
  if (response.status === 400 || response.status === 413 || response.status === 415) {
    throw new NowpaymentsWithdrawalUiError("validation");
  }
  throw new NowpaymentsWithdrawalUiError("unavailable");
}

export async function fetchNowpaymentsWithdrawalOverview(
  accessToken: string,
  request: typeof fetch = fetch,
): Promise<NowpaymentsWithdrawalOverview> {
  const response = await request("/api/crypto/nowpayments/withdrawal-overview", {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  const value = await readJson(response);
  if (!response.ok) throwForResponse(response, value);
  return parseNowpaymentsWithdrawalOverview(value);
}

export async function submitNowpaymentsWithdrawalRequest(
  accessToken: string,
  input: {
    gross_amount_usdt: string;
    destination_address: string;
    idempotency_key: string;
  },
  request: typeof fetch = fetch,
): Promise<NowpaymentsWithdrawalRequestResult> {
  const response = await request("/api/crypto/nowpayments/withdrawal-request", {
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
  return parseRequestResult(value);
}

export function parseUsdtMicros(value: string): bigint | null {
  if (!INPUT_DECIMAL_PATTERN.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * MICROS_PER_USDT
    + BigInt(fraction.padEnd(6, "0"));
}

export function formatUsdtMicros(value: bigint): string {
  if (value < 0n) throw new Error("negative_usdt_value");
  const integer = value / MICROS_PER_USDT;
  const fraction = (value % MICROS_PER_USDT).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer.toString();
}

export function floorUsdtToSix(value: string): string | null {
  if (!DECIMAL_PATTERN.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  const micros = BigInt(integer) * MICROS_PER_USDT
    + BigInt(fraction.slice(0, 6).padEnd(6, "0"));
  return formatUsdtMicros(micros);
}

export function calculateWithdrawalPreview(grossAmount: string): {
  grossMicros: bigint;
  feeMicros: bigint;
  netMicros: bigint;
} | null {
  const grossMicros = parseUsdtMicros(grossAmount);
  if (grossMicros === null) return null;
  const feeMicros = (grossMicros * 5n + 50n) / 100n;
  return {
    grossMicros,
    feeMicros,
    netMicros: grossMicros - feeMicros,
  };
}

export function isMinimumWithdrawal(grossAmount: string): boolean {
  const micros = parseUsdtMicros(grossAmount);
  return micros !== null && micros >= MINIMUM_MICROS;
}

export function isValidBep20Address(value: string): boolean {
  return ADDRESS_PATTERN.test(value);
}

export function formatUsdtDisplay(value: string): string {
  const floored = floorUsdtToSix(value);
  if (floored === null) return "0";
  const [integer, fraction] = floored.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export function nowpaymentsWithdrawalStatusLabel(status: NowpaymentsWithdrawalStatus): string {
  const labels: Record<NowpaymentsWithdrawalStatus, string> = {
    reserved: "Submitted",
    reviewing: "Under review",
    send_locked: "Approved for sending",
    broadcasted: "Sent — confirming",
    completed: "Completed",
    rejected: "Rejected — funds returned",
  };
  return labels[status];
}

export function maskBep20Address(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function createWithdrawalAttemptKeyManager(
  createKey: () => string = () => globalThis.crypto.randomUUID(),
): {
  keyFor: (grossAmount: string, destination: string) => string;
  clear: () => void;
} {
  let fingerprint: string | null = null;
  let key: string | null = null;
  return {
    keyFor(grossAmount, destination) {
      const nextFingerprint = `${grossAmount}|${destination.toLowerCase()}`;
      if (nextFingerprint !== fingerprint || key === null) {
        const nextKey = createKey();
        if (!UUID_V4_PATTERN.test(nextKey)) throw new Error("invalid_idempotency_key_factory");
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

export function runSingleFlight<T>(
  holder: { current: Promise<T> | null },
  operation: () => Promise<T>,
): Promise<T> {
  if (holder.current) return holder.current;
  const current = operation();
  holder.current = current;
  void current.finally(() => {
    if (holder.current === current) holder.current = null;
  }).catch(() => {
    // The caller observes the original rejection; this only handles cleanup.
  });
  return current;
}

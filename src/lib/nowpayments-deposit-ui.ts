export const NOWPAYMENTS_ACTIVE_STATUSES = [
  "waiting",
  "partially_paid",
  "confirming",
  "confirmed",
  "sending",
] as const;

export const NOWPAYMENTS_HISTORY_STATUSES = [
  ...NOWPAYMENTS_ACTIVE_STATUSES,
  "finished",
  "failed",
  "refunded",
  "expired",
  "manual_review",
] as const;

export type NowpaymentsActiveStatus = (typeof NOWPAYMENTS_ACTIVE_STATUSES)[number];
export type NowpaymentsHistoryStatus = (typeof NOWPAYMENTS_HISTORY_STATUSES)[number];

export type NowpaymentsDepositSessionView = {
  asset: "USDT";
  network: "BEP20";
  status: NowpaymentsActiveStatus;
  pay_address: string;
  minimum_deposit_usdt: string;
  provider_minimum_usdt: string;
  created_at: string;
  valid_until: string;
};

export type NowpaymentsDepositHistoryView = {
  asset: "USDT";
  network: "BEP20";
  status: NowpaymentsHistoryStatus;
  pay_address: string | null;
  credited_amount_usdt: string | null;
  created_at: string;
  valid_until: string | null;
  completed_at: string | null;
};

export type NowpaymentsDepositOverview = {
  feature_enabled: boolean;
  asset: "USDT";
  network: "BEP20";
  minimum_deposit_usdt: string;
  wallet: {
    available_balance_usdt: string;
    reserved_balance_usdt: string;
  };
  session_state: "none" | "active" | "provisioning" | "manual_review";
  active_session: NowpaymentsDepositSessionView | null;
  history: NowpaymentsDepositHistoryView[];
};

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ACTIVE_STATUS_SET = new Set<string>(NOWPAYMENTS_ACTIVE_STATUSES);
const HISTORY_STATUS_SET = new Set<string>(NOWPAYMENTS_HISTORY_STATUSES);

export class NowpaymentsDepositUiError extends Error {
  readonly kind: "authentication" | "disabled" | "unavailable";

  constructor(kind: "authentication" | "disabled" | "unavailable") {
    super(kind);
    this.name = "NowpaymentsDepositUiError";
    this.kind = kind;
  }
}

export function createSingleFlight<T>(operation: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const request = operation();
    inFlight = request;
    void request.finally(() => {
      if (inFlight === request) inFlight = null;
    }).catch(() => {
      // The caller receives the original rejection; this only handles the cleanup chain.
    });
    return request;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isNullableDecimal(value: unknown): value is string | null {
  return value === null || isDecimal(value);
}

function parseSession(value: unknown): NowpaymentsDepositSessionView | null {
  if (value === null) return null;
  if (!isObject(value)) throw new NowpaymentsDepositUiError("unavailable");
  if (
    value.asset !== "USDT"
    || value.network !== "BEP20"
    || typeof value.status !== "string"
    || !ACTIVE_STATUS_SET.has(value.status)
    || typeof value.pay_address !== "string"
    || !ADDRESS_PATTERN.test(value.pay_address)
    || !isDecimal(value.minimum_deposit_usdt)
    || !isDecimal(value.provider_minimum_usdt)
    || !isTimestamp(value.created_at)
    || !isTimestamp(value.valid_until)
  ) {
    throw new NowpaymentsDepositUiError("unavailable");
  }
  return value as NowpaymentsDepositSessionView;
}

function parseHistory(value: unknown): NowpaymentsDepositHistoryView {
  if (!isObject(value)) throw new NowpaymentsDepositUiError("unavailable");
  if (
    value.asset !== "USDT"
    || value.network !== "BEP20"
    || typeof value.status !== "string"
    || !HISTORY_STATUS_SET.has(value.status)
    || (value.pay_address !== null
      && (typeof value.pay_address !== "string" || !ADDRESS_PATTERN.test(value.pay_address)))
    || !isNullableDecimal(value.credited_amount_usdt)
    || !isTimestamp(value.created_at)
    || !isNullableTimestamp(value.valid_until)
    || !isNullableTimestamp(value.completed_at)
  ) {
    throw new NowpaymentsDepositUiError("unavailable");
  }
  return value as NowpaymentsDepositHistoryView;
}

export function parseNowpaymentsDepositOverview(value: unknown): NowpaymentsDepositOverview {
  if (!isObject(value) || !isObject(value.wallet) || !Array.isArray(value.history)) {
    throw new NowpaymentsDepositUiError("unavailable");
  }
  const activeSession = parseSession(value.active_session);
  if (
    typeof value.feature_enabled !== "boolean"
    || value.asset !== "USDT"
    || value.network !== "BEP20"
    || !isDecimal(value.minimum_deposit_usdt)
    || !isDecimal(value.wallet.available_balance_usdt)
    || !isDecimal(value.wallet.reserved_balance_usdt)
    || !["none", "active", "provisioning", "manual_review"].includes(
      String(value.session_state),
    )
    || (value.session_state === "active") !== Boolean(activeSession)
  ) {
    throw new NowpaymentsDepositUiError("unavailable");
  }

  return {
    feature_enabled: value.feature_enabled,
    asset: "USDT",
    network: "BEP20",
    minimum_deposit_usdt: value.minimum_deposit_usdt,
    wallet: {
      available_balance_usdt: value.wallet.available_balance_usdt,
      reserved_balance_usdt: value.wallet.reserved_balance_usdt,
    },
    session_state: value.session_state as NowpaymentsDepositOverview["session_state"],
    active_session: activeSession,
    history: value.history.map(parseHistory),
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new NowpaymentsDepositUiError("unavailable");
  }
}

function throwForResponse(response: Response, body: unknown): never {
  if (response.status === 401) throw new NowpaymentsDepositUiError("authentication");
  if (
    response.status === 503
    && isObject(body)
    && (body.error === "crypto_deposits_disabled" || body.error === "crypto_runtime_unavailable")
  ) {
    throw new NowpaymentsDepositUiError("disabled");
  }
  throw new NowpaymentsDepositUiError("unavailable");
}

export async function fetchNowpaymentsDepositOverview(
  accessToken: string,
  request: typeof fetch = fetch,
): Promise<NowpaymentsDepositOverview> {
  const response = await request("/api/crypto/nowpayments/deposit-overview", {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  const body = await readJson(response);
  if (!response.ok) throwForResponse(response, body);
  return parseNowpaymentsDepositOverview(body);
}

export async function requestNowpaymentsDepositSession(
  accessToken: string,
  request: typeof fetch = fetch,
): Promise<void> {
  const response = await request("/api/crypto/nowpayments/deposit-session", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  const body = await readJson(response);
  if (!response.ok) throwForResponse(response, body);
  if (
    !isObject(body)
    || body.asset !== "USDT"
    || body.network !== "BEP20"
    || typeof body.pay_address !== "string"
    || !ADDRESS_PATTERN.test(body.pay_address)
    || !isDecimal(body.minimum_deposit_usdt)
    || !isTimestamp(body.valid_until)
  ) {
    throw new NowpaymentsDepositUiError("unavailable");
  }
}

export function formatUsdtDecimal(value: string): string {
  if (!isDecimal(value)) return "0";
  const [integer, fraction] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmedFraction = fraction?.replace(/0+$/, "") ?? "";
  return trimmedFraction ? `${grouped}.${trimmedFraction}` : grouped;
}

export function isDepositAddressSendable(
  session: NowpaymentsDepositSessionView,
  nowMs: number,
): boolean {
  return new Date(session.valid_until).getTime() > nowMs;
}

export function formatDepositCountdown(validUntil: string, nowMs: number): string {
  const remainingSeconds = Math.max(
    0,
    Math.floor((new Date(validUntil).getTime() - nowMs) / 1_000),
  );
  if (remainingSeconds === 0) return "Expired";
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  return days > 0
    ? `${days}d ${hours}h ${minutes}m`
    : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function nowpaymentsStatusLabel(status: NowpaymentsHistoryStatus): string {
  const labels: Record<NowpaymentsHistoryStatus, string> = {
    waiting: "Waiting for payment",
    partially_paid: "Partially paid",
    confirming: "Confirming",
    confirmed: "Confirmed",
    sending: "Processing credit",
    finished: "Finished",
    failed: "Failed",
    refunded: "Refunded",
    expired: "Expired",
    manual_review: "Under review",
  };
  return labels[status];
}

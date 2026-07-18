const NOWPAYMENTS_API_BASE = "https://api.nowpayments.io/v1";
const PROVIDER_CURRENCY = "usdtbsc";
const ACTIVE_PAYMENT_STATUSES = new Set([
  "waiting",
  "partially_paid",
  "confirming",
  "confirmed",
  "sending",
]);
const TERMINAL_PAYMENT_STATUSES = new Set([
  "finished",
  "failed",
  "refunded",
  "expired",
]);

type FetchLike = typeof fetch;

export type NowpaymentsPaymentStatus =
  | "waiting"
  | "partially_paid"
  | "confirming"
  | "confirmed"
  | "sending"
  | "finished"
  | "failed"
  | "refunded"
  | "expired";

export type NowpaymentsCreatePaymentResult = {
  providerPaymentId: string;
  qhashOrderId: string;
  payAddress: string;
  payCurrency: "usdtbsc";
  providerPaymentStatus: Extract<
    NowpaymentsPaymentStatus,
    "waiting" | "partially_paid" | "confirming" | "confirmed" | "sending"
  >;
  providerCreatedAt: string;
  providerValidUntil: string;
};

export type NowpaymentsPaymentStatusResult = {
  providerPaymentId: string;
  providerPaymentStatus: NowpaymentsPaymentStatus;
};

export class NowpaymentsClientError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "NowpaymentsClientError";
    this.code = code;
  }
}

export class NowpaymentsUncertainCreateError extends NowpaymentsClientError {
  readonly recoveryReason:
    | "create_payment_timeout"
    | "create_payment_network_error"
    | "create_payment_http_error"
    | "create_payment_invalid_response";

  constructor(recoveryReason: NowpaymentsUncertainCreateError["recoveryReason"]) {
    super(recoveryReason);
    this.name = "NowpaymentsUncertainCreateError";
    this.recoveryReason = recoveryReason;
  }
}

function expandExponent(rawValue: string): string {
  const match = rawValue.match(/^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (!match) return rawValue;

  const integer = match[1];
  const fraction = match[2] ?? "";
  const exponent = Number(match[3]);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 100) return rawValue;

  const digits = integer + fraction;
  const decimalPosition = integer.length + exponent;
  if (decimalPosition <= 0) return `0.${"0".repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length) {
    return `${digits}${"0".repeat(decimalPosition - digits.length)}`;
  }
  return `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

export function normalizePositiveDecimal(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new NowpaymentsClientError("invalid_decimal");
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new NowpaymentsClientError("invalid_decimal");
  }

  const expanded = expandExponent(String(value).trim());
  const match = expanded.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new NowpaymentsClientError("invalid_decimal");

  const integer = match[1].replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (integer.length > 18 || fraction.length > 18) {
    throw new NowpaymentsClientError("decimal_out_of_range");
  }

  const normalized = fraction ? `${integer}.${fraction}` : integer;
  if (BigInt(integer + fraction.padEnd(18, "0")) <= 0n) {
    throw new NowpaymentsClientError("invalid_decimal");
  }
  return normalized;
}

function compareDecimals(left: string, right: string): number {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(leftInteger + leftFraction.padEnd(scale, "0"));
  const rightValue = BigInt(rightInteger + rightFraction.padEnd(scale, "0"));
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}

export function technicalReferenceAmount(providerMinimum: unknown): {
  providerMinimumUsdt: string;
  technicalReferenceAmountUsdt: string;
} {
  const normalizedMinimum = normalizePositiveDecimal(providerMinimum);
  return {
    providerMinimumUsdt: normalizedMinimum,
    technicalReferenceAmountUsdt:
      compareDecimals(normalizedMinimum, "1") > 0 ? normalizedMinimum : "1",
  };
}

function parseJson(text: string, code: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not_object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new NowpaymentsClientError(code);
  }
}

function lexicalNumber(
  text: string,
  body: Record<string, unknown>,
  field: string,
  code: string,
): unknown {
  const value = body[field];
  if (typeof value !== "number") return value;

  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(
    new RegExp(
      `"${escapedField}"\\s*:\\s*(-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`,
    ),
  );
  if (!match) throw new NowpaymentsClientError(code);
  return match[1];
}

function normalizeIdentifier(value: unknown, code: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new NowpaymentsClientError(code);
  }
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 200) throw new NowpaymentsClientError(code);
  return normalized;
}

function normalizeProviderPaymentId(value: unknown, code: string): string {
  const normalized = normalizeIdentifier(value, code);
  if (!/^\d{1,200}$/.test(normalized)) throw new NowpaymentsClientError(code);
  return normalized;
}

function normalizeStatus(value: unknown): NowpaymentsPaymentStatus {
  if (typeof value !== "string") {
    throw new NowpaymentsClientError("invalid_payment_status");
  }
  const normalized = value.trim().toLowerCase();
  if (!ACTIVE_PAYMENT_STATUSES.has(normalized) && !TERMINAL_PAYMENT_STATUSES.has(normalized)) {
    throw new NowpaymentsClientError("invalid_payment_status");
  }
  return normalized as NowpaymentsPaymentStatus;
}

function normalizeTimestamp(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new NowpaymentsClientError(code);
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) throw new NowpaymentsClientError(code);
  return timestamp.toISOString();
}

async function fetchTextWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

function createPaymentBody(technicalAmount: string, qhashOrderId: string): string {
  const staticFields = {
    price_currency: "usd",
    pay_currency: PROVIDER_CURRENCY,
    order_id: qhashOrderId,
    order_description: "QHash USDTBSC deposit address session",
    is_fixed_rate: false,
    is_fee_paid_by_user: false,
  };
  const encoded = JSON.stringify(staticFields);
  return `{"price_amount":${technicalAmount},"pay_amount":${technicalAmount},${encoded.slice(1)}`;
}

export function createNowpaymentsClient({
  apiKey,
  fetchImpl = fetch,
  timeoutMs = 15_000,
}: {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}) {
  if (!apiKey) throw new NowpaymentsClientError("missing_api_key");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new NowpaymentsClientError("invalid_timeout");
  }

  const headers = { "x-api-key": apiKey };

  return {
    async getMinimum(): Promise<string> {
      const query = new URLSearchParams({
        currency_from: PROVIDER_CURRENCY,
        currency_to: PROVIDER_CURRENCY,
        is_fixed_rate: "false",
        is_fee_paid_by_user: "false",
      });
      let result: { response: Response; text: string };
      try {
        result = await fetchTextWithTimeout(
          fetchImpl,
          `${NOWPAYMENTS_API_BASE}/min-amount?${query}`,
          { method: "GET", headers },
          timeoutMs,
        );
      } catch {
        throw new NowpaymentsClientError("minimum_request_failed");
      }
      if (!result.response.ok) throw new NowpaymentsClientError("minimum_request_failed");

      const body = parseJson(result.text, "minimum_invalid_response");
      for (const field of ["currency_from", "currency_to"] as const) {
        if (body[field] !== undefined && String(body[field]).toLowerCase() !== PROVIDER_CURRENCY) {
          throw new NowpaymentsClientError("minimum_currency_mismatch");
        }
      }
      return normalizePositiveDecimal(
        lexicalNumber(result.text, body, "min_amount", "minimum_invalid_response"),
      );
    },

    async createPayment({
      technicalReferenceAmountUsdt,
      qhashOrderId,
    }: {
      technicalReferenceAmountUsdt: string;
      qhashOrderId: string;
    }): Promise<NowpaymentsCreatePaymentResult> {
      const amount = normalizePositiveDecimal(technicalReferenceAmountUsdt);
      let result: { response: Response; text: string };
      try {
        result = await fetchTextWithTimeout(
          fetchImpl,
          `${NOWPAYMENTS_API_BASE}/payment`,
          {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: createPaymentBody(amount, qhashOrderId),
          },
          timeoutMs,
        );
      } catch (error) {
        const reason = error instanceof Error && error.name === "AbortError"
          ? "create_payment_timeout"
          : "create_payment_network_error";
        throw new NowpaymentsUncertainCreateError(reason);
      }

      if (!result.response.ok) {
        throw new NowpaymentsUncertainCreateError("create_payment_http_error");
      }

      let body: Record<string, unknown>;
      try {
        body = parseJson(result.text, "create_payment_invalid_response");
        const providerPaymentId = normalizeProviderPaymentId(
          lexicalNumber(
            result.text,
            body,
            "payment_id",
            "create_payment_invalid_response",
          ),
          "create_payment_invalid_response",
        );
        const returnedOrderId = normalizeIdentifier(
          body.order_id,
          "create_payment_invalid_response",
        );
        const payAddress = normalizeIdentifier(
          body.pay_address,
          "create_payment_invalid_response",
        );
        const providerPaymentStatus = normalizeStatus(body.payment_status);
        const payCurrency = String(body.pay_currency ?? "").trim().toLowerCase();
        const returnedPayAmount = normalizePositiveDecimal(
          lexicalNumber(
            result.text,
            body,
            "pay_amount",
            "create_payment_invalid_response",
          ),
        );
        const providerCreatedAt = normalizeTimestamp(
          body.created_at,
          "create_payment_invalid_response",
        );
        const providerValidUntil = normalizeTimestamp(
          body.valid_until,
          "create_payment_invalid_response",
        );

        if (
          returnedOrderId !== qhashOrderId
          || !/^0x[0-9A-Fa-f]{40}$/.test(payAddress)
          || payCurrency !== PROVIDER_CURRENCY
          || compareDecimals(returnedPayAmount, amount) !== 0
          || !ACTIVE_PAYMENT_STATUSES.has(providerPaymentStatus)
          || new Date(providerValidUntil).getTime() <= new Date(providerCreatedAt).getTime()
          || new Date(providerValidUntil).getTime() <= Date.now()
        ) {
          throw new NowpaymentsClientError("create_payment_invalid_response");
        }

        return {
          providerPaymentId,
          qhashOrderId: returnedOrderId,
          payAddress,
          payCurrency: PROVIDER_CURRENCY,
          providerPaymentStatus: providerPaymentStatus as NowpaymentsCreatePaymentResult["providerPaymentStatus"],
          providerCreatedAt,
          providerValidUntil,
        };
      } catch {
        throw new NowpaymentsUncertainCreateError("create_payment_invalid_response");
      }
    },

    async getPaymentStatus(providerPaymentId: string): Promise<NowpaymentsPaymentStatusResult> {
      const expectedPaymentId = normalizeIdentifier(
        providerPaymentId,
        "invalid_provider_payment_id",
      );
      let result: { response: Response; text: string };
      try {
        result = await fetchTextWithTimeout(
          fetchImpl,
          `${NOWPAYMENTS_API_BASE}/payment/${encodeURIComponent(expectedPaymentId)}`,
          { method: "GET", headers },
          timeoutMs,
        );
      } catch {
        throw new NowpaymentsClientError("payment_status_request_failed");
      }
      if (!result.response.ok) {
        throw new NowpaymentsClientError("payment_status_request_failed");
      }

      try {
        const body = parseJson(result.text, "payment_status_invalid_response");
        const returnedPaymentId = normalizeProviderPaymentId(
          lexicalNumber(
            result.text,
            body,
            "payment_id",
            "payment_status_invalid_response",
          ),
          "payment_status_invalid_response",
        );
        if (returnedPaymentId !== expectedPaymentId) {
          throw new NowpaymentsClientError("payment_status_invalid_response");
        }
        return {
          providerPaymentId: returnedPaymentId,
          providerPaymentStatus: normalizeStatus(body.payment_status),
        };
      } catch {
        throw new NowpaymentsClientError("payment_status_invalid_response");
      }
    },
  };
}

export function isActiveNowpaymentsStatus(status: string): boolean {
  return ACTIVE_PAYMENT_STATUSES.has(status);
}

export function isTerminalNowpaymentsStatus(status: string): boolean {
  return TERMINAL_PAYMENT_STATUSES.has(status);
}

import { createHmac, timingSafeEqual } from "node:crypto";

export const NOWPAYMENTS_IPN_MAX_BODY_BYTES = 65_536;

export class NowpaymentsIpnError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "NowpaymentsIpnError";
    this.code = code;
  }
}

function sortLikeNowpayments(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;

  const input = value as Record<string, unknown>;
  return Object.keys(input).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = sortLikeNowpayments(input[key]);
    return result;
  }, {});
}

export function canonicalizeNowpaymentsIpn(payload: Record<string, unknown>): string {
  return JSON.stringify(sortLikeNowpayments(payload));
}

function parseObject(rawBody: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not_object");
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new NowpaymentsIpnError("invalid_payload");
  }
}

function extractProviderPaymentId(
  rawBody: string,
  payload: Record<string, unknown>,
): string {
  const value = payload.payment_id;
  if (typeof value === "string") {
    const normalized = value.trim();
    if (/^[0-9]{1,200}$/.test(normalized)) return normalized;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const lexicalMatch = rawBody.match(
      /"payment_id"\s*:\s*(0|[1-9][0-9]{0,199})(?=\s*[,}])/,
    );
    if (lexicalMatch) return lexicalMatch[1];
  }
  throw new NowpaymentsIpnError("invalid_payment_id");
}

export function verifyNowpaymentsIpn({
  rawBody,
  signature,
  secret,
}: {
  rawBody: string;
  signature: string;
  secret: string;
}): { payload: Record<string, unknown>; providerPaymentId: string } {
  if (!secret) throw new NowpaymentsIpnError("missing_secret");
  if (!/^[0-9a-fA-F]{128}$/.test(signature)) {
    throw new NowpaymentsIpnError("invalid_signature");
  }

  const payload = parseObject(rawBody);
  const expected = createHmac("sha512", secret)
    .update(canonicalizeNowpaymentsIpn(payload), "utf8")
    .digest();
  const received = Buffer.from(signature, "hex");

  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new NowpaymentsIpnError("invalid_signature");
  }

  return {
    payload,
    providerPaymentId: extractProviderPaymentId(rawBody, payload),
  };
}

export function isNowpaymentsJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(value.trim());
}

export async function readBoundedNowpaymentsIpnBody(
  request: Request,
  maxBytes = NOWPAYMENTS_IPN_MAX_BODY_BYTES,
): Promise<string> {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new NowpaymentsIpnError("invalid_body_limit");
  }
  if (!request.body) throw new NowpaymentsIpnError("invalid_payload");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new NowpaymentsIpnError("payload_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) throw new NowpaymentsIpnError("invalid_payload");
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new NowpaymentsIpnError("invalid_payload");
  }
}

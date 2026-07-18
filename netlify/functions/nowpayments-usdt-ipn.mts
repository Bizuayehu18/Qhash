import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types.ts";
import {
  createNowpaymentsClient,
  NowpaymentsClientError,
  type NowpaymentsVerifiedPayment,
} from "./lib/nowpayments-client.mts";
import {
  isNowpaymentsJsonContentType,
  NOWPAYMENTS_IPN_MAX_BODY_BYTES,
  NowpaymentsIpnError,
  readBoundedNowpaymentsIpnBody,
  verifyNowpaymentsIpn,
} from "./lib/nowpayments-ipn.mts";

type SettlementResult = {
  status:
    | "credited"
    | "already_credited"
    | "preserved_credited"
    | "recorded_no_credit"
    | "preserved_newer_status";
};

type SettlementStore = {
  settle(payment: NowpaymentsVerifiedPayment): Promise<SettlementResult>;
};

type Provider = {
  getPaymentDetails(providerPaymentId: string): Promise<NowpaymentsVerifiedPayment>;
};

type HandlerDependencies = {
  getEnvironment?: (name: string) => string | undefined;
  createProvider?: (apiKey: string) => Provider;
  createStore?: (supabaseUrl: string, serviceRoleKey: string) => SettlementStore;
};

class SettlementStoreError extends Error {
  readonly safeToIgnore: boolean;

  constructor(message: string, safeToIgnore: boolean) {
    super(message);
    this.name = "SettlementStoreError";
    this.safeToIgnore = safeToIgnore;
  }
}

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function isProductionDeployContext(getEnvironment: (name: string) => string | undefined): boolean {
  try {
    return getEnvironment("CONTEXT") === "production";
  } catch {
    return false;
  }
}

function isSafeSettlementRejection(message: string): boolean {
  return [
    "invalid_nowpayments_settlement_input",
    "invalid_nowpayments_settlement_outcome",
    "unexpected_nowpayments_settlement_outcome",
    "nowpayments_settlement_ownership_mismatch",
    "nowpayments_settlement_record_mismatch",
  ].some((code) => message.includes(code));
}

function defaultStore(supabaseUrl: string, serviceRoleKey: string): SettlementStore {
  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async settle(payment) {
      const { data, error } = await admin.rpc(
        "settle_verified_nowpayments_usdt_payment",
        {
          p_provider_payment_id: payment.providerPaymentId,
          p_parent_provider_payment_id: payment.parentProviderPaymentId,
          p_qhash_order_id: payment.qhashOrderId,
          p_pay_address: payment.payAddress,
          p_pay_currency: payment.payCurrency,
          p_provider_payment_status: payment.providerPaymentStatus,
          p_outcome_amount: payment.outcomeAmountUsdt,
          p_outcome_currency: payment.outcomeCurrency,
        },
      );
      if (error) {
        throw new SettlementStoreError(
          "settlement_rpc_failed",
          isSafeSettlementRejection(error.message),
        );
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new SettlementStoreError("settlement_rpc_invalid_response", false);
      }
      const status = (data as Record<string, unknown>).status;
      if (
        status !== "credited"
        && status !== "already_credited"
        && status !== "preserved_credited"
        && status !== "recorded_no_credit"
        && status !== "preserved_newer_status"
      ) {
        throw new SettlementStoreError("settlement_rpc_invalid_response", false);
      }
      return { status };
    },
  };
}

export function createNowpaymentsUsdtIpnHandler(
  dependencies: HandlerDependencies = {},
): (request: Request) => Promise<Response> {
  const getEnvironment = dependencies.getEnvironment
    ?? ((name: string) => Netlify.env.get(name));

  return async (request: Request): Promise<Response> => {
    // This must remain the first runtime gate. Non-production deploys may not
    // read credentials, access Supabase, or contact NOWPayments.
    if (!isProductionDeployContext(getEnvironment)) {
      return json({ error: "crypto_runtime_unavailable", message: "Not available." }, 503);
    }

    if (request.method !== "POST") {
      return json({ error: "method_not_allowed", message: "POST only." }, 405);
    }
    if (!isNowpaymentsJsonContentType(request.headers.get("content-type"))) {
      return json({ error: "unsupported_media_type", message: "JSON required." }, 415);
    }

    const contentLength = request.headers.get("content-length");
    if (contentLength !== null) {
      const parsedLength = Number(contentLength);
      if (
        !Number.isSafeInteger(parsedLength)
        || parsedLength < 1
        || parsedLength > NOWPAYMENTS_IPN_MAX_BODY_BYTES
      ) {
        return json({ error: "invalid_payload_size", message: "Invalid payload." }, 413);
      }
    }

    const signature = request.headers.get("x-nowpayments-sig") ?? "";
    if (!/^[0-9a-fA-F]{128}$/.test(signature)) {
      return json({ error: "invalid_signature", message: "Invalid signature." }, 401);
    }

    let rawBody: string;
    try {
      rawBody = await readBoundedNowpaymentsIpnBody(request);
    } catch (error) {
      const status = error instanceof NowpaymentsIpnError && error.code === "payload_too_large"
        ? 413
        : 400;
      return json({ error: "invalid_payload", message: "Invalid payload." }, status);
    }

    const ipnSecret = getEnvironment("NOWPAYMENTS_IPN_SECRET") ?? "";
    if (!ipnSecret) {
      return json({ error: "server_config", message: "Server is not configured." }, 503);
    }

    let providerPaymentId: string;
    try {
      providerPaymentId = verifyNowpaymentsIpn({ rawBody, signature, secret: ipnSecret })
        .providerPaymentId;
    } catch (error) {
      const status = error instanceof NowpaymentsIpnError && error.code === "invalid_signature"
        ? 401
        : 400;
      return json(
        {
          error: status === 401 ? "invalid_signature" : "invalid_payload",
          message: status === 401 ? "Invalid signature." : "Invalid payload.",
        },
        status,
      );
    }

    // All remaining credentials are read only after the signature succeeds.
    const apiKey = getEnvironment("NOWPAYMENTS_API_KEY") ?? "";
    const supabaseUrl = getEnvironment("VITE_SUPABASE_URL")
      ?? getEnvironment("SUPABASE_URL")
      ?? "";
    const serviceRoleKey = getEnvironment("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!apiKey || !supabaseUrl || !serviceRoleKey) {
      return json({ error: "server_config", message: "Server is not configured." }, 503);
    }

    let verifiedPayment: NowpaymentsVerifiedPayment;
    try {
      const provider = dependencies.createProvider?.(apiKey)
        ?? createNowpaymentsClient({ apiKey, timeoutMs: 15_000 });
      verifiedPayment = await provider.getPaymentDetails(providerPaymentId);
      if (verifiedPayment.providerPaymentId !== providerPaymentId) {
        throw new NowpaymentsClientError("payment_status_invalid_response");
      }
    } catch (error) {
      const isProviderError = error instanceof NowpaymentsClientError;
      return json(
        { error: "provider_unavailable", message: "Settlement is temporarily unavailable." },
        isProviderError ? 503 : 500,
      );
    }

    try {
      const store = dependencies.createStore?.(supabaseUrl, serviceRoleKey)
        ?? defaultStore(supabaseUrl, serviceRoleKey);
      const result = await store.settle(verifiedPayment);
      return json(
        {
          status: result.status === "credited" || result.status === "already_credited"
            ? "processed"
            : "accepted",
        },
        200,
      );
    } catch (error) {
      if (error instanceof SettlementStoreError && error.safeToIgnore) {
        return json({ status: "ignored" }, 202);
      }
      return json(
        { error: "settlement_unavailable", message: "Settlement is temporarily unavailable." },
        503,
      );
    }
  };
}

export default createNowpaymentsUsdtIpnHandler();

export const config: Config = {
  path: "/api/crypto/nowpayments/ipn",
};

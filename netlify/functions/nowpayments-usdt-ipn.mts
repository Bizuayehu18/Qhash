import type { Config, Context } from "@netlify/functions";
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
import {
  createNowpaymentsSettlementStore,
  NowpaymentsSettlementStoreError,
  type NowpaymentsSettlementStore,
} from "./lib/nowpayments-settlement.mts";
import { isPublishedProductionDeployContext } from "./lib/nowpayments-deploy-context.mts";

type Provider = {
  getPaymentDetails(providerPaymentId: string): Promise<NowpaymentsVerifiedPayment>;
};

type HandlerDependencies = {
  getEnvironment?: (name: string) => string | undefined;
  createProvider?: (apiKey: string) => Provider;
  createStore?: (
    supabaseUrl: string,
    serviceRoleKey: string,
  ) => NowpaymentsSettlementStore;
};

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function createNowpaymentsUsdtIpnHandler(
  dependencies: HandlerDependencies = {},
): (request: Request, context?: Context) => Promise<Response> {
  const getEnvironment = dependencies.getEnvironment
    ?? ((name: string) => Netlify.env.get(name));

  return async (request: Request, context?: Context): Promise<Response> => {
    // This must remain the first runtime gate. Non-production deploys may not
    // read credentials, access Supabase, or contact NOWPayments.
    if (!isPublishedProductionDeployContext(context)) {
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
        ?? createNowpaymentsSettlementStore(supabaseUrl, serviceRoleKey);
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
      if (error instanceof NowpaymentsSettlementStoreError && error.safeToIgnore) {
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

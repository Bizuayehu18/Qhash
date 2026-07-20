import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types.ts";
import {
  createNowpaymentsClient,
  normalizePositiveDecimal,
  NowpaymentsClientError,
  type NowpaymentsVerifiedPayment,
} from "./lib/nowpayments-client.mts";
import {
  isNowpaymentsJsonContentType,
  NowpaymentsIpnError,
  readBoundedNowpaymentsIpnBody,
} from "./lib/nowpayments-ipn.mts";
import {
  createNowpaymentsSettlementStore,
  type NowpaymentsSettlementStore,
} from "./lib/nowpayments-settlement.mts";
import { isPublishedProductionDeployContext } from "./lib/nowpayments-deploy-context.mts";

const RECOVERY_MAX_BODY_BYTES = 4_096;
const PROVIDER_PAYMENT_ID_PATTERN = /^[0-9]{1,200}$/;
const QHASH_ORDER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAY_ADDRESS_PATTERN = /^0x[0-9A-Fa-f]{40}$/;

type AdminAuthorization = "authorized" | "unauthorized" | "forbidden";

type Provider = {
  getPaymentDetails(providerPaymentId: string): Promise<NowpaymentsVerifiedPayment>;
};

type HandlerDependencies = {
  getEnvironment?: (name: string) => string | undefined;
  authorizeAdmin?: (
    supabaseUrl: string,
    serviceRoleKey: string,
    accessToken: string,
  ) => Promise<AdminAuthorization>;
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

function reconciliationCompleted(): Response {
  return json(
    {
      success: true,
      code: "reconciliation_completed",
      message: "The payment was reconciled successfully.",
    },
    200,
  );
}

function reconciliationNotCompleted(): Response {
  return json(
    {
      success: false,
      code: "reconciliation_not_completed",
      message: "The payment could not be reconciled. Verify the payment ID or try again later.",
    },
    503,
  );
}

function bearerToken(request: Request): string | null {
  const match = request.headers.get("authorization")?.match(/^Bearer ([^\s]{1,8192})$/i);
  return match?.[1] ?? null;
}

function parseProviderPaymentId(rawBody: string): string {
  let body: unknown;
  try {
    body = JSON.parse(rawBody) as unknown;
  } catch {
    throw new Error("invalid_recovery_payload");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("invalid_recovery_payload");
  }

  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.payment_id !== "string") {
    throw new Error("invalid_recovery_payload");
  }
  const providerPaymentId = record.payment_id;
  if (!PROVIDER_PAYMENT_ID_PATTERN.test(providerPaymentId)) {
    throw new Error("invalid_recovery_payload");
  }
  return providerPaymentId;
}

async function defaultAuthorizeAdmin(
  supabaseUrl: string,
  serviceRoleKey: string,
  accessToken: string,
): Promise<AdminAuthorization> {
  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) return "unauthorized";

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("is_admin, is_frozen")
    .eq("id", userData.user.id)
    .maybeSingle();
  if (profileError) throw new Error("admin_profile_unavailable");
  if (!profile || profile.is_admin !== true || profile.is_frozen === true) {
    return "forbidden";
  }
  return "authorized";
}

function requireFinishedUsdtbscPayment(
  payment: NowpaymentsVerifiedPayment,
  expectedProviderPaymentId: string,
): NowpaymentsVerifiedPayment {
  if (
    payment.providerPaymentId !== expectedProviderPaymentId
    || !PROVIDER_PAYMENT_ID_PATTERN.test(payment.providerPaymentId)
    || (
      payment.parentProviderPaymentId !== null
      && (
        !PROVIDER_PAYMENT_ID_PATTERN.test(payment.parentProviderPaymentId)
        || payment.parentProviderPaymentId === payment.providerPaymentId
      )
    )
    || (
      payment.qhashOrderId !== null
      && !QHASH_ORDER_ID_PATTERN.test(payment.qhashOrderId)
    )
    || !PAY_ADDRESS_PATTERN.test(payment.payAddress)
    || payment.payCurrency !== "usdtbsc"
  ) {
    throw new NowpaymentsClientError("payment_status_invalid_response");
  }
  if (payment.providerPaymentStatus !== "finished") {
    throw new NowpaymentsClientError("payment_not_finished");
  }
  if (payment.outcomeCurrency !== "usdtbsc") {
    throw new NowpaymentsClientError("payment_status_invalid_response");
  }

  const outcomeAmountUsdt = normalizePositiveDecimal(payment.outcomeAmountUsdt);
  return { ...payment, outcomeAmountUsdt };
}

export function createNowpaymentsUsdtReconcilePaymentHandler(
  dependencies: HandlerDependencies = {},
): (request: Request, context?: Context) => Promise<Response> {
  const getEnvironment = dependencies.getEnvironment
    ?? ((name: string) => Netlify.env.get(name));

  return async (request: Request, context?: Context): Promise<Response> => {
    // Keep this as the first runtime gate. Preview, branch, dev, missing, and
    // unknown contexts must not read credentials or contact external systems.
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
        || parsedLength > RECOVERY_MAX_BODY_BYTES
      ) {
        return json({ error: "invalid_payload_size", message: "Invalid payload." }, 413);
      }
    }

    const accessToken = bearerToken(request);
    if (!accessToken) {
      return json({ error: "unauthorized", message: "Authentication required." }, 401);
    }

    let providerPaymentId: string;
    try {
      const rawBody = await readBoundedNowpaymentsIpnBody(
        request,
        RECOVERY_MAX_BODY_BYTES,
      );
      providerPaymentId = parseProviderPaymentId(rawBody);
    } catch (error) {
      const status = error instanceof NowpaymentsIpnError
        && error.code === "payload_too_large"
        ? 413
        : 400;
      return json({ error: "invalid_payload", message: "Invalid payload." }, status);
    }

    const supabaseUrl = getEnvironment("VITE_SUPABASE_URL")
      ?? getEnvironment("SUPABASE_URL")
      ?? "";
    const serviceRoleKey = getEnvironment("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "server_config", message: "Server is not configured." }, 503);
    }

    let authorization: AdminAuthorization;
    try {
      authorization = await (
        dependencies.authorizeAdmin?.(supabaseUrl, serviceRoleKey, accessToken)
        ?? defaultAuthorizeAdmin(supabaseUrl, serviceRoleKey, accessToken)
      );
    } catch {
      return json(
        { error: "authorization_unavailable", message: "Authorization is unavailable." },
        503,
      );
    }
    if (authorization === "unauthorized") {
      return json({ error: "unauthorized", message: "Invalid or expired session." }, 401);
    }
    if (authorization !== "authorized") {
      return json({ error: "forbidden", message: "Admin access required." }, 403);
    }

    // Provider credentials are read only after the caller is authenticated as
    // an active QHash administrator.
    const apiKey = getEnvironment("NOWPAYMENTS_API_KEY") ?? "";
    if (!apiKey) {
      return json({ error: "server_config", message: "Server is not configured." }, 503);
    }

    let verifiedPayment: NowpaymentsVerifiedPayment;
    try {
      const provider = dependencies.createProvider?.(apiKey)
        ?? createNowpaymentsClient({ apiKey, timeoutMs: 15_000 });
      verifiedPayment = requireFinishedUsdtbscPayment(
        await provider.getPaymentDetails(providerPaymentId),
        providerPaymentId,
      );
    } catch {
      return reconciliationNotCompleted();
    }

    try {
      const store = dependencies.createStore?.(supabaseUrl, serviceRoleKey)
        ?? createNowpaymentsSettlementStore(supabaseUrl, serviceRoleKey);
      const result = await store.settle(verifiedPayment);
      if (result.status === "credited") {
        return reconciliationCompleted();
      }
      if (result.status === "already_credited" || result.status === "preserved_credited") {
        return reconciliationCompleted();
      }
      return reconciliationNotCompleted();
    } catch {
      return reconciliationNotCompleted();
    }
  };
}

export default createNowpaymentsUsdtReconcilePaymentHandler();

export const config: Config = {
  path: "/api/admin/crypto/nowpayments/reconcile-payment",
};

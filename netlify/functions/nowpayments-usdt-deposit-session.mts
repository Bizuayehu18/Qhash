import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types.ts";
import { isPublishedProductionDeployContext } from "./lib/nowpayments-deploy-context.mts";
import {
  createNowpaymentsClient,
  normalizePositiveDecimal,
} from "./lib/nowpayments-client.mts";
import {
  getOrCreateNowpaymentsDepositSession,
  NowpaymentsDepositSessionError,
  type ManualRecoveryReason,
  type NowpaymentsCreatedPayment,
  type NowpaymentsDepositSession,
  type NowpaymentsProviderStatus,
  type NowpaymentsSessionStore,
} from "./lib/nowpayments-deposit-session.mts";

type RpcError = { code?: string; message?: string };
type SessionRpcClient = {
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): Promise<{ data: unknown; error: RpcError | null }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_STATUSES = new Set([
  "provisioning",
  "ready",
  "manual_recovery",
  "terminal",
]);
const PROVIDER_STATUSES = new Set<NowpaymentsProviderStatus>([
  "waiting",
  "partially_paid",
  "confirming",
  "confirmed",
  "sending",
  "finished",
  "failed",
  "refunded",
  "expired",
]);

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NowpaymentsDepositSessionError("database_invalid_response");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, pattern?: RegExp): string {
  if (typeof value !== "string" || !value || (pattern && !pattern.test(value))) {
    throw new NowpaymentsDepositSessionError("database_invalid_response");
  }
  return value;
}

function asNullableString(value: unknown, pattern?: RegExp): string | null {
  if (value === null) return null;
  return asString(value, pattern);
}

function asTimestamp(value: unknown): string {
  const raw = asString(value);
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new NowpaymentsDepositSessionError("database_invalid_response");
  }
  return parsed.toISOString();
}

function asNullableTimestamp(value: unknown): string | null {
  return value === null ? null : asTimestamp(value);
}

function decodeSession(
  value: unknown,
  expectedUserId: string,
): NowpaymentsDepositSession {
  const row = asObject(value);
  const userId = asString(row.user_id, UUID_PATTERN);
  const sessionStatus = asString(row.session_status);
  const providerStatus = asNullableString(row.provider_payment_status);
  if (
    userId !== expectedUserId
    || !SESSION_STATUSES.has(sessionStatus)
    || (providerStatus !== null && !PROVIDER_STATUSES.has(providerStatus as NowpaymentsProviderStatus))
  ) {
    throw new NowpaymentsDepositSessionError("database_invalid_response");
  }

  return {
    id: asString(row.id, UUID_PATTERN),
    user_id: userId,
    qhash_order_id: asString(row.qhash_order_id, UUID_PATTERN),
    session_status: sessionStatus as NowpaymentsDepositSession["session_status"],
    provider_payment_id: asNullableString(row.provider_payment_id, /^\d{1,200}$/),
    provider_payment_status: providerStatus as NowpaymentsProviderStatus | null,
    pay_address: asNullableString(row.pay_address, /^0x[0-9A-Fa-f]{40}$/),
    technical_reference_amount_usdt: normalizePositiveDecimal(
      row.technical_reference_amount_usdt,
    ),
    provider_minimum_usdt: normalizePositiveDecimal(row.provider_minimum_usdt),
    provider_created_at: asNullableTimestamp(row.provider_created_at),
    provider_valid_until: asNullableTimestamp(row.provider_valid_until),
    address_activated_at: asNullableTimestamp(row.address_activated_at),
    provisioning_started_at: asTimestamp(row.provisioning_started_at),
    created_at: asTimestamp(row.created_at),
  };
}

function createSessionStore(
  client: SessionRpcClient,
  expectedUserId: string,
): NowpaymentsSessionStore {
  async function call(
    functionName: string,
    parameters: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const { data, error } = await client.rpc(functionName, parameters);
    if (error) throw new NowpaymentsDepositSessionError("database_operation_failed");
    return asObject(data);
  }

  return {
    async getCurrent(userId) {
      const result = await call("get_current_nowpayments_usdt_deposit_session", {
        p_user_id: userId,
      });
      if (result.disposition === "none") return { disposition: "none" };
      if (
        result.disposition !== "activated"
        && result.disposition !== "pending"
        && result.disposition !== "existing"
      ) {
        throw new NowpaymentsDepositSessionError("database_invalid_response");
      }
      return {
        ...decodeSession(result, expectedUserId),
        disposition: result.disposition,
      };
    },

    async claim(userId, providerMinimumUsdt, technicalReferenceAmountUsdt) {
      const result = await call("claim_nowpayments_usdt_deposit_session", {
        p_user_id: userId,
        p_provider_minimum_usdt: providerMinimumUsdt,
        p_technical_reference_amount_usdt: technicalReferenceAmountUsdt,
      });
      if (
        result.disposition !== "claimed"
        && result.disposition !== "activated"
        && result.disposition !== "pending"
        && result.disposition !== "existing"
      ) {
        throw new NowpaymentsDepositSessionError("database_invalid_response");
      }
      return {
        ...decodeSession(result, expectedUserId),
        disposition: result.disposition,
      };
    },

    async complete(session, result) {
      const response = await call("complete_nowpayments_usdt_deposit_session", {
        p_session_id: session.id,
        p_qhash_order_id: session.qhash_order_id,
        p_provider_payment_id: result.providerPaymentId,
        p_pay_address: result.payAddress,
        p_provider_payment_status: result.providerPaymentStatus,
        p_provider_created_at: result.providerCreatedAt,
        p_provider_valid_until: result.providerValidUntil,
      });
      if (response.disposition !== "completed") {
        throw new NowpaymentsDepositSessionError("database_invalid_response");
      }
      return decodeSession(response, expectedUserId);
    },

    async markManualRecovery(
      session: NowpaymentsDepositSession,
      reason: ManualRecoveryReason,
      evidence?: NowpaymentsCreatedPayment,
    ) {
      const response = await call(
        "mark_nowpayments_usdt_deposit_session_manual_recovery",
        {
          p_session_id: session.id,
          p_qhash_order_id: session.qhash_order_id,
          p_reason: reason,
          p_provider_payment_id: evidence?.providerPaymentId ?? null,
          p_pay_address: evidence?.payAddress ?? null,
          p_provider_payment_status: evidence?.providerPaymentStatus ?? null,
          p_provider_created_at: evidence?.providerCreatedAt ?? null,
          p_provider_valid_until: evidence?.providerValidUntil ?? null,
        },
      );
      if (response.disposition !== "manual_recovery") {
        throw new NowpaymentsDepositSessionError("database_invalid_response");
      }
      return decodeSession(response, expectedUserId);
    },
  };
}

function safeSessionError(error: unknown): Response {
  const code = error instanceof NowpaymentsDepositSessionError
    ? error.code
    : "unexpected_error";
  if (code === "session_provisioning" || code === "session_state_changed") {
    return json(
      { error: "deposit_session_busy", message: "Deposit address setup is already in progress." },
      409,
    );
  }
  if (code === "session_manual_recovery" || code === "payment_creation_uncertain") {
    return json(
      { error: "deposit_session_review", message: "Deposit address setup requires review." },
      503,
    );
  }
  if (code === "minimum_unavailable" || code === "payment_status_unavailable") {
    return json(
      { error: "provider_unavailable", message: "Deposit address setup is temporarily unavailable." },
      503,
    );
  }
  if (code === "provider_config") {
    return json({ error: "provider_config", message: "Crypto deposits are unavailable." }, 503);
  }
  return json(
    { error: "deposit_session_failed", message: "Deposit address setup is unavailable." },
    500,
  );
}

export default async (req: Request, context?: Context): Promise<Response> => {
  if (!isPublishedProductionDeployContext(context)) {
    return json(
      { error: "crypto_runtime_unavailable", message: "Crypto deposits are unavailable." },
      503,
    );
  }

  if (req.method !== "POST") {
    return json({ error: "method_not_allowed", message: "POST only." }, 405);
  }

  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL")
    ?? Netlify.env.get("SUPABASE_URL")
    ?? "";
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "server_config", message: "Server is not configured." }, 500);
  }

  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || token === authorization) {
    return json({ error: "authentication_required", message: "Authentication required." }, 401);
  }

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    return json({ error: "invalid_session", message: "Invalid or expired session." }, 401);
  }

  const [{ data: profile, error: profileError }, { data: config, error: configError }] =
    await Promise.all([
      admin.from("profiles").select("is_frozen").eq("id", authData.user.id).maybeSingle(),
      admin
        .from("nowpayments_usdt_config")
        .select(
          "id, enabled, asset, network, provider_currency, deposit_minimum_usdt, withdrawal_minimum_usdt, withdrawal_fee_percent",
        )
        .eq("id", "USDT-BEP20")
        .maybeSingle(),
    ]);

  if (profileError || !profile || profile.is_frozen) {
    return json({ error: "account_unavailable", message: "Account is unavailable." }, 403);
  }
  if (
    configError
    || !config
    || config.id !== "USDT-BEP20"
    || config.asset !== "USDT"
    || config.network !== "BEP20"
    || config.provider_currency !== "usdtbsc"
    || Number(config.deposit_minimum_usdt) !== 1
    || Number(config.withdrawal_minimum_usdt) !== 2
    || Number(config.withdrawal_fee_percent) !== 5
  ) {
    return json({ error: "crypto_config_unavailable", message: "Crypto deposits are unavailable." }, 503);
  }
  if (!config.enabled) {
    return json({ error: "crypto_deposits_disabled", message: "Crypto deposits are disabled." }, 503);
  }

  try {
    // Provider configuration is resolved lazily. Reusing a permanent or
    // unexpired pending address performs no provider secret read or request.
    let provider: ReturnType<typeof createNowpaymentsClient> | null = null;
    const getProvider = () => {
      if (provider) return provider;
      const apiKey = Netlify.env.get("NOWPAYMENTS_API_KEY") ?? "";
      const productionSiteUrl = Netlify.env.get("URL") ?? "";
      let ipnCallbackUrl = "";
      try {
        const parsedSiteUrl = new URL(productionSiteUrl);
        if (parsedSiteUrl.protocol !== "https:") throw new Error("invalid_site_url");
        ipnCallbackUrl = new URL("/api/crypto/nowpayments/ipn", parsedSiteUrl).toString();
      } catch {
        throw new NowpaymentsDepositSessionError("provider_config");
      }
      if (!apiKey) throw new NowpaymentsDepositSessionError("provider_config");
      provider = createNowpaymentsClient({ apiKey, ipnCallbackUrl });
      return provider;
    };
    const session = await getOrCreateNowpaymentsDepositSession({
      userId: authData.user.id,
      store: createSessionStore(admin as unknown as SessionRpcClient, authData.user.id),
      provider: {
        getMinimum: () => getProvider().getMinimum(),
        createPayment: (input) => getProvider().createPayment(input),
      },
    });

    const addressLifecycle = session.address_activated_at
      ? "permanently_activated"
      : "pending_activation";

    return json(
      {
        asset: "USDT",
        network: "BEP20",
        provider_currency: "usdtbsc",
        status: session.provider_payment_status,
        pay_address: session.pay_address,
        minimum_deposit_usdt: session.technical_reference_amount_usdt,
        provider_minimum_usdt: session.provider_minimum_usdt,
        address_lifecycle: addressLifecycle,
        valid_until: addressLifecycle === "pending_activation"
          ? session.provider_valid_until
          : null,
      },
      200,
    );
  } catch (error) {
    return safeSessionError(error);
  }
};

export const config: Config = {
  path: "/api/crypto/nowpayments/deposit-session",
};

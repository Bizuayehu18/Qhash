import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID } from "node:crypto";
import type { Database } from "../../src/lib/database.types.ts";
import { isUuidV1ToV5, isUuidV4 } from "../../src/shared/identifiers/uuid.ts";
import { isPublishedProductionDeployContext } from "./lib/nowpayments-deploy-context.mts";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const PROVIDER_ID_PATTERN = /^\d{1,200}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;
const ACTIVE_STATUSES = new Set([
  "waiting",
  "partially_paid",
  "confirming",
  "confirmed",
  "sending",
]);
const TERMINAL_STATUSES = new Set(["finished", "failed", "refunded", "expired"]);
const PROVIDER_STATUSES = new Set([...ACTIVE_STATUSES, ...TERMINAL_STATUSES]);
const HISTORY_LIMIT = 250;
const OVERVIEW_LOG_EVENT = "nowpayments_usdt_deposit_overview";

type OverviewStage =
  | "runtime_gate"
  | "method_gate"
  | "server_config"
  | "authentication"
  | "profile_config_query"
  | "overview_queries"
  | "wallet_validation"
  | "response_validation"
  | "complete";

type OverviewDiagnosticCode =
  | "crypto_runtime_unavailable"
  | "method_not_allowed"
  | "server_config"
  | "authentication_required"
  | "invalid_session"
  | "account_unavailable"
  | "deposit_overview_unavailable"
  | "overview_success"
  | "unexpected_exception";

type OverviewTerminalLog = {
  event: typeof OVERVIEW_LOG_EVENT;
  request_id: string;
  stage: OverviewStage;
  http_status: number;
  diagnostic_code: OverviewDiagnosticCode;
  outcome: "success" | "failure";
};

type OverviewInvocation = {
  requestId: string;
  currentStage: OverviewStage;
  terminalLog: OverviewTerminalLog | null;
};

type RequestIdFactory = () => string;

type SessionRow = {
  id: string;
  user_id: string;
  provider_payment_id: string | null;
  provider_payment_status: string | null;
  session_status: "provisioning" | "ready" | "manual_recovery" | "terminal";
  pay_address: string | null;
  technical_reference_amount_usdt: string | null;
  provider_minimum_usdt: string | null;
  provider_created_at: string | null;
  provider_valid_until: string | null;
  address_activated_at: string | null;
  terminal_at: string | null;
  credited_amount_usdt: string | null;
  credited_at: string | null;
  created_at: string;
};

type ProviderPaymentRow = {
  session_id: string;
  user_id: string;
  provider_payment_id: string;
  payment_kind: "original" | "repeated";
  provider_payment_status: string;
  credited_amount_usdt: string | null;
  credited_at: string | null;
  created_at: string;
};

type HistoryView = {
  asset: "USDT";
  network: "BEP20";
  status: string;
  pay_address: string | null;
  credited_amount_usdt: string | null;
  created_at: string;
  valid_until: string | null;
  completed_at: string | null;
};

function json(body: Record<string, unknown>, status: number, requestId: string): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-QHash-Request-ID": requestId,
    },
  });
}

function terminalResponse(
  invocation: OverviewInvocation,
  body: Record<string, unknown>,
  status: number,
  stage: OverviewStage,
  diagnosticCode: OverviewDiagnosticCode,
  outcome: "success" | "failure" = "failure",
): Response {
  const response = json(body, status, invocation.requestId);
  invocation.currentStage = stage;
  invocation.terminalLog = {
    event: OVERVIEW_LOG_EVENT,
    request_id: invocation.requestId,
    stage,
    http_status: status,
    diagnostic_code: diagnosticCode,
    outcome,
  };
  return response;
}

function writeTerminalLog(terminalLog: OverviewTerminalLog): void {
  try {
    console.info(JSON.stringify(terminalLog));
  } catch {
    // Observability must never change the existing response behavior.
  }
}

function randomBytesRequestId(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function createRequestId(requestIdFactory: RequestIdFactory): string {
  try {
    const requestId = requestIdFactory();
    if (isUuidV4(requestId)) return requestId;
  } catch {
    // A request ID remains available without exposing generator failures.
  }
  return randomBytesRequestId();
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

function canonicalDecimal(value: string): string {
  const [integer, fraction = ""] = value.split(".");
  const canonicalInteger = integer.replace(/^0+(?=\d)/, "");
  const canonicalFraction = fraction.replace(/0+$/, "");
  return canonicalFraction ? `${canonicalInteger}.${canonicalFraction}` : canonicalInteger;
}

function isNullableDecimal(value: unknown): value is string | null {
  return value === null || isDecimal(value);
}

function validateSession(value: unknown, userId: string): SessionRow {
  const row = value as Partial<SessionRow> | null;
  if (
    !row
    || typeof row !== "object"
    || !isUuidV1ToV5(row.id)
    || row.user_id !== userId
    || !["provisioning", "ready", "manual_recovery", "terminal"].includes(
      String(row.session_status),
    )
    || (row.provider_payment_id !== null
      && (typeof row.provider_payment_id !== "string"
        || !PROVIDER_ID_PATTERN.test(row.provider_payment_id)))
    || (row.provider_payment_status !== null
      && (typeof row.provider_payment_status !== "string"
        || !PROVIDER_STATUSES.has(row.provider_payment_status)))
    || (row.pay_address !== null
      && (typeof row.pay_address !== "string" || !ADDRESS_PATTERN.test(row.pay_address)))
    || !(
      (isDecimal(row.technical_reference_amount_usdt)
        && isDecimal(row.provider_minimum_usdt))
      || (row.technical_reference_amount_usdt === null
        && row.provider_minimum_usdt === null
        && (row.session_status === "provisioning"
          || row.session_status === "manual_recovery"))
    )
    || !isNullableTimestamp(row.provider_created_at)
    || !isNullableTimestamp(row.provider_valid_until)
    || !isNullableTimestamp(row.address_activated_at)
    || !isNullableTimestamp(row.terminal_at)
    || !isNullableDecimal(row.credited_amount_usdt)
    || !isNullableTimestamp(row.credited_at)
    || !isTimestamp(row.created_at)
  ) {
    throw new Error("invalid_session_read");
  }
  return row as SessionRow;
}

function validateProviderPayment(value: unknown, userId: string): ProviderPaymentRow {
  const row = value as Partial<ProviderPaymentRow> | null;
  if (
    !row
    || typeof row !== "object"
    || !isUuidV1ToV5(row.session_id)
    || row.user_id !== userId
    || typeof row.provider_payment_id !== "string"
    || !PROVIDER_ID_PATTERN.test(row.provider_payment_id)
    || (row.payment_kind !== "original" && row.payment_kind !== "repeated")
    || typeof row.provider_payment_status !== "string"
    || !PROVIDER_STATUSES.has(row.provider_payment_status)
    || !isNullableDecimal(row.credited_amount_usdt)
    || !isNullableTimestamp(row.credited_at)
    || !isTimestamp(row.created_at)
  ) {
    throw new Error("invalid_provider_payment_read");
  }
  return row as ProviderPaymentRow;
}

function historyStatus(status: string | null, fallback: string): string {
  if (status && PROVIDER_STATUSES.has(status)) return status;
  return fallback;
}

function buildHistory(
  sessions: SessionRow[],
  providerPayments: ProviderPaymentRow[],
  nowMs: number,
): HistoryView[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const providerRowsBySession = new Map<string, ProviderPaymentRow[]>();
  for (const payment of providerPayments) {
    const rows = providerRowsBySession.get(payment.session_id) ?? [];
    rows.push(payment);
    providerRowsBySession.set(payment.session_id, rows);
  }

  const history: HistoryView[] = [];
  for (const payment of providerPayments) {
    const session = sessionsById.get(payment.session_id);
    if (!session) continue;
    history.push({
      asset: "USDT",
      network: "BEP20",
      status: payment.provider_payment_status,
      pay_address: session.pay_address,
      credited_amount_usdt: payment.credited_at ? payment.credited_amount_usdt : null,
      created_at: payment.created_at,
      valid_until: session.provider_valid_until,
      completed_at: payment.credited_at,
    });
  }

  for (const session of sessions) {
    const providerRows = providerRowsBySession.get(session.id) ?? [];
    const hasOriginalRow = providerRows.some((payment) => payment.payment_kind === "original");
    const waitingExpired = session.provider_payment_status === "waiting"
      && session.provider_valid_until !== null
      && new Date(session.provider_valid_until).getTime() <= nowMs;
    const shouldIncludeSession = session.session_status === "manual_recovery"
      || waitingExpired
      || (session.session_status === "terminal" && !hasOriginalRow);
    if (!shouldIncludeSession) continue;

    const status = session.session_status === "manual_recovery"
      ? "manual_review"
      : waitingExpired
        ? "expired"
        : historyStatus(session.provider_payment_status, "failed");
    history.push({
      asset: "USDT",
      network: "BEP20",
      status,
      pay_address: session.pay_address,
      credited_amount_usdt: session.credited_at ? session.credited_amount_usdt : null,
      created_at: session.created_at,
      valid_until: session.provider_valid_until,
      completed_at: session.credited_at ?? session.terminal_at ?? (waitingExpired
        ? session.provider_valid_until
        : null),
    });
  }

  return history
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .slice(0, HISTORY_LIMIT);
}

async function handleOverview(
  req: Request,
  context: Context | undefined,
  invocation: OverviewInvocation,
): Promise<Response> {
  if (!isPublishedProductionDeployContext(context)) {
    return terminalResponse(
      invocation,
      { error: "crypto_runtime_unavailable", message: "Crypto deposits are unavailable." },
      503,
      "runtime_gate",
      "crypto_runtime_unavailable",
    );
  }

  invocation.currentStage = "method_gate";
  if (req.method !== "GET") {
    return terminalResponse(
      invocation,
      { error: "method_not_allowed", message: "GET only." },
      405,
      "method_gate",
      "method_not_allowed",
    );
  }

  invocation.currentStage = "server_config";
  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL")
    ?? Netlify.env.get("SUPABASE_URL")
    ?? "";
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return terminalResponse(
      invocation,
      { error: "server_config", message: "Server is not configured." },
      500,
      "server_config",
      "server_config",
    );
  }

  invocation.currentStage = "authentication";
  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || token === authorization) {
    return terminalResponse(
      invocation,
      { error: "authentication_required", message: "Authentication required." },
      401,
      "authentication",
      "authentication_required",
    );
  }

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    return terminalResponse(
      invocation,
      { error: "invalid_session", message: "Invalid or expired session." },
      401,
      "authentication",
      "invalid_session",
    );
  }

  const userId = authData.user.id;
  invocation.currentStage = "profile_config_query";
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("is_frozen")
    .eq("id", userId)
    .maybeSingle();

  const profileRow = profile as unknown;
  if (
    profileError
    || !isRecord(profileRow)
    || typeof profileRow.is_frozen !== "boolean"
    || profileRow.is_frozen
  ) {
    return terminalResponse(
      invocation,
      { error: "account_unavailable", message: "Account is unavailable." },
      403,
      "profile_config_query",
      "account_unavailable",
    );
  }

  invocation.currentStage = "overview_queries";
  const snapshotResult = await admin.rpc(
    "get_nowpayments_usdt_deposit_overview_snapshot",
    { p_user_id: userId },
  );
  if (snapshotResult.error) {
    const rpcErrorValue = snapshotResult.error as unknown;
    const rpcFailure = isRecord(rpcErrorValue)
      && typeof rpcErrorValue["message"] === "string"
      ? rpcErrorValue["message"]
      : "";
    if (rpcFailure === "nowpayments_session_user_unavailable") {
      return terminalResponse(
        invocation,
        { error: "account_unavailable", message: "Account is unavailable." },
        403,
        "overview_queries",
        "account_unavailable",
      );
    }
    return terminalResponse(
      invocation,
      { error: "deposit_overview_unavailable", message: "Crypto deposits are unavailable." },
      503,
      "overview_queries",
      "deposit_overview_unavailable",
    );
  }

  const snapshot = snapshotResult.data as unknown;
  if (
    !isRecord(snapshot)
    || typeof snapshot.feature_enabled !== "boolean"
    || !isDecimal(snapshot.minimum_deposit_usdt)
    || canonicalDecimal(snapshot.minimum_deposit_usdt) !== "1"
    || !Array.isArray(snapshot.sessions)
    || snapshot.sessions.length > HISTORY_LIMIT
    || !Array.isArray(snapshot.provider_payments)
    || snapshot.provider_payments.length > HISTORY_LIMIT
  ) {
    return terminalResponse(
      invocation,
      { error: "deposit_overview_unavailable", message: "Crypto deposits are unavailable." },
      503,
      "wallet_validation",
      "deposit_overview_unavailable",
    );
  }

  invocation.currentStage = "wallet_validation";
  const walletValue = snapshot.wallet;
  const walletRow = isRecord(walletValue) ? walletValue : null;
  if (
    walletValue !== null
    && (
      !walletRow
      || walletRow.user_id !== userId
      || walletRow.asset !== "USDT"
      || !isDecimal(walletRow.available_balance_usdt)
      || !isDecimal(walletRow.reserved_balance_usdt)
    )
  ) {
    return terminalResponse(
      invocation,
      { error: "deposit_overview_unavailable", message: "Crypto deposits are unavailable." },
      503,
      "wallet_validation",
      "deposit_overview_unavailable",
    );
  }

  invocation.currentStage = "response_validation";
  try {
    const featureEnabled = snapshot.feature_enabled;
    const sessions = (snapshot.sessions as unknown[])
      .map((row) => validateSession(row, userId));
    const providerPayments = (snapshot.provider_payments as unknown[])
      .map((row) => validateProviderPayment(row, userId));
    if (!featureEnabled && sessions.some((session) => session.pay_address !== null)) {
      throw new Error("invalid_disabled_snapshot");
    }
    const nowMs = Date.now();
    const activatedCandidates = featureEnabled
      ? sessions.filter((session) =>
          session.address_activated_at !== null
          && session.provider_payment_status === "finished"
          && session.pay_address !== null
          && session.provider_created_at !== null
          && session.provider_valid_until !== null
          && new Date(session.address_activated_at).getTime()
            >= new Date(session.provider_created_at).getTime()
          && new Date(session.address_activated_at).getTime()
            < new Date(session.provider_valid_until).getTime()
        )
      : [];
    const activationRows = featureEnabled
      ? sessions.filter((session) => session.address_activated_at !== null)
      : [];
    const pendingCandidates = featureEnabled
      ? sessions.filter((session) =>
          session.address_activated_at === null
          && session.session_status === "ready"
          && session.provider_payment_status !== null
          && ACTIVE_STATUSES.has(session.provider_payment_status)
          && session.pay_address !== null
          && session.provider_created_at !== null
          && session.provider_valid_until !== null
          && new Date(session.provider_valid_until).getTime() > nowMs
        )
      : [];
    const existingCandidates = featureEnabled
      ? sessions.filter((session) =>
          session.address_activated_at === null
          && (
            session.session_status === "provisioning"
            || session.session_status === "manual_recovery"
            || (
              session.session_status === "terminal"
              && session.provider_valid_until !== null
              && new Date(session.provider_valid_until).getTime() > nowMs
            )
          )
        )
      : [];
    if (
      activatedCandidates.length > 1
      || pendingCandidates.length > 1
      || existingCandidates.length > 1
      || activationRows.length !== activatedCandidates.length
      || (
        activatedCandidates.length > 0
        && (pendingCandidates.length > 0 || existingCandidates.length > 0)
      )
      || (pendingCandidates.length > 0 && existingCandidates.length > 0)
    ) {
      throw new Error("invalid_session_read");
    }
    const activated = activatedCandidates[0] ?? null;
    const pending = pendingCandidates[0] ?? null;
    const existing = existingCandidates[0] ?? null;
    const currentAddress = activated ?? pending;
    if (
      currentAddress
      && (currentAddress.technical_reference_amount_usdt === null
        || currentAddress.provider_minimum_usdt === null)
    ) {
      throw new Error("invalid_session_read");
    }
    const addressLifecycle = activated ? "permanently_activated" : "pending_activation";

    const activeSession = currentAddress
      ? {
          asset: "USDT" as const,
          network: "BEP20" as const,
          status: currentAddress.provider_payment_status,
          pay_address: currentAddress.pay_address,
          minimum_deposit_usdt: currentAddress.technical_reference_amount_usdt,
          provider_minimum_usdt: currentAddress.provider_minimum_usdt,
          created_at: currentAddress.provider_created_at,
          address_lifecycle: addressLifecycle,
          valid_until: activated ? null : currentAddress.provider_valid_until,
        }
      : null;
    const hasExpiredUnactivated = sessions.some((session) =>
      session.address_activated_at === null
      && session.pay_address !== null
      && session.provider_valid_until !== null
      && new Date(session.provider_valid_until).getTime() <= nowMs
    );
    const sessionState = activated
      ? "permanently_activated"
      : pending
        ? "pending_activation"
        : existing?.session_status === "provisioning"
          ? "provisioning"
          : existing?.session_status === "manual_recovery"
            ? "manual_review"
            : existing?.session_status === "terminal"
              ? "manual_review"
              : hasExpiredUnactivated
                ? "expired_unactivated"
                : "none";

    const history = buildHistory(sessions, providerPayments, nowMs);
    const publicHistory = featureEnabled
      ? history
      : history
        .filter((entry) =>
          entry.status === "finished"
          && entry.credited_amount_usdt !== null
          && entry.completed_at !== null
        )
        .map((entry) => ({
          ...entry,
          pay_address: null,
        }));

    return terminalResponse(
      invocation,
      {
        feature_enabled: featureEnabled,
        asset: "USDT",
        network: "BEP20",
        minimum_deposit_usdt: snapshot.minimum_deposit_usdt,
        wallet: {
          available_balance_usdt: walletRow?.available_balance_usdt ?? "0",
          reserved_balance_usdt: walletRow?.reserved_balance_usdt ?? "0",
        },
        session_state: featureEnabled ? sessionState : "none",
        active_session: featureEnabled ? activeSession : null,
        history: publicHistory,
      },
      200,
      "complete",
      "overview_success",
      "success",
    );
  } catch {
    return terminalResponse(
      invocation,
      { error: "deposit_overview_unavailable", message: "Crypto deposits are unavailable." },
      503,
      "response_validation",
      "deposit_overview_unavailable",
    );
  }
}

export function createOverviewHandler(
  requestIdFactory: RequestIdFactory = randomUUID,
): (req: Request, context?: Context) => Promise<Response> {
  return async (req: Request, context?: Context): Promise<Response> => {
    const requestId = createRequestId(requestIdFactory);
    const invocation: OverviewInvocation = {
      requestId,
      currentStage: "runtime_gate",
      terminalLog: null,
    };

    try {
      return await handleOverview(req, context, invocation);
    } finally {
      writeTerminalLog(invocation.terminalLog ?? {
        event: OVERVIEW_LOG_EVENT,
        request_id: requestId,
        stage: invocation.currentStage,
        http_status: 500,
        diagnostic_code: "unexpected_exception",
        outcome: "failure",
      });
    }
  };
}

export default createOverviewHandler();

export const config: Config = {
  path: "/api/crypto/nowpayments/deposit-overview",
};

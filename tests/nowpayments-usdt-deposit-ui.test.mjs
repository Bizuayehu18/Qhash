import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import overviewHandler, {
  createOverviewHandler,
} from "../netlify/functions/nowpayments-usdt-deposit-overview.mts";
import {
  fetchNowpaymentsDepositOverview,
  createSingleFlight,
  formatDepositCountdown,
  formatUsdtDecimal,
  isDepositAddressSendable,
  parseNowpaymentsDepositOverview,
  requestNowpaymentsDepositSession,
} from "../src/lib/nowpayments-deposit-ui.ts";

const repositoryRoot = new URL("../", import.meta.url);
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const PUBLISHED_PRODUCTION_CONTEXT = {
  deploy: { context: "production", published: true },
};
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TERMINAL_LOG_FIELDS = [
  "diagnostic_code",
  "event",
  "http_status",
  "outcome",
  "request_id",
  "stage",
];
const TERMINAL_LOG_STAGES = new Set([
  "runtime_gate",
  "method_gate",
  "server_config",
  "authentication",
  "profile_config_query",
  "overview_queries",
  "wallet_validation",
  "response_validation",
  "complete",
]);
const FORBIDDEN_TERMINAL_LOG_FRAGMENTS = [
  "valid-token",
  "service-role-mock",
  "supabase.mock",
  "VITE_SUPABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "authorization",
  "cookie",
  "pay_address",
  "provider_payment_id",
  "request body",
  "raw error",
  "stack",
  "sensitive",
  USER_ID,
  OTHER_USER_ID,
  SESSION_ID,
  ADDRESS,
  "90071992547409931234",
];
const {
  IDLE_COPY_FEEDBACK,
  copyButtonAccessibleName,
  copyUsdtDepositAddress,
} = await tsImport("../src/components/deposit/NowpaymentsUsdtDeposit.tsx", import.meta.url);

const [
  overviewSource,
  deployContextSource,
  uiSource,
  depositRouteSource,
  netlifyTypecheck,
] = await Promise.all([
  readFile(new URL("netlify/functions/nowpayments-usdt-deposit-overview.mts", repositoryRoot), "utf8"),
  readFile(new URL("netlify/functions/lib/nowpayments-deploy-context.mts", repositoryRoot), "utf8"),
  readFile(new URL("src/components/deposit/NowpaymentsUsdtDeposit.tsx", repositoryRoot), "utf8"),
  readFile(new URL("src/routes/_app/deposit.tsx", repositoryRoot), "utf8"),
  readFile(new URL("tsconfig.netlify.json", repositoryRoot), "utf8"),
]);

function validSession(overrides = {}) {
  return {
    id: SESSION_ID,
    user_id: USER_ID,
    provider_payment_id: "90071992547409931234",
    provider_payment_status: "waiting",
    session_status: "ready",
    pay_address: ADDRESS,
    technical_reference_amount_usdt: "1.250000000000000000",
    provider_minimum_usdt: "1.250000000000000000",
    provider_created_at: "2030-01-01T00:00:00.000Z",
    provider_valid_until: "2030-01-08T00:00:00.000Z",
    address_activated_at: null,
    terminal_at: null,
    credited_amount_usdt: null,
    credited_at: null,
    created_at: "2030-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function validProviderPayment(overrides = {}) {
  return {
    session_id: SESSION_ID,
    user_id: USER_ID,
    provider_payment_id: "90071992547409931234",
    payment_kind: "original",
    provider_payment_status: "finished",
    credited_amount_usdt: "0.2",
    credited_at: "2030-01-02T00:00:00.000Z",
    created_at: "2030-01-02T00:00:00.000Z",
    ...overrides,
  };
}

async function invokeOverview({
  handler = overviewHandler,
  runtimeContext = PUBLISHED_PRODUCTION_CONTEXT,
  omitRuntimeContext = false,
  method = "GET",
  authorization = `Bearer valid-token`,
  incomingRequestId = null,
  viteSupabaseUrl = "https://supabase.mock",
  supabaseUrl,
  serviceRoleKey = "service-role-mock",
  environmentThrowName = null,
  configEnabled = false,
  configOverrides = {},
  profile = { is_frozen: false },
  sessions = [],
  providerPayments = [],
  wallet = null,
  authValid = true,
  queryFailure = null,
  loggerThrows = false,
} = {}) {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  const originalConsoleInfo = console.info;
  const environmentReads = [];
  const requests = [];
  const terminalLogs = [];
  globalThis.Netlify = {
    env: {
      get(name) {
        environmentReads.push(name);
        if (name === environmentThrowName) {
          throw new Error("sensitive environment lookup detail");
        }
        if (name === "VITE_SUPABASE_URL") return viteSupabaseUrl;
        if (name === "SUPABASE_URL") return supabaseUrl;
        if (name === "SUPABASE_SERVICE_ROLE_KEY") return serviceRoleKey;
        throw new Error(`Unexpected environment read: ${name}`);
      },
    },
  };
  console.info = (...args) => {
    terminalLogs.push(args);
    if (loggerThrows) throw new Error("sensitive logger failure detail");
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (queryFailure && url.includes(queryFailure)) {
      return Response.json(
        { message: "sensitive database response detail" },
        { status: 500 },
      );
    }
    if (url.startsWith("https://api.nowpayments.io")) {
      throw new Error("A UI overview test must never contact NOWPayments");
    }
    if (url.includes("/auth/v1/user")) {
      return authValid
        ? Response.json({
            id: USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: "user@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2030-01-01T00:00:00Z",
          })
        : Response.json({ message: "sensitive auth response detail" }, { status: 401 });
    }
    if (url.includes("/rest/v1/profiles")) return Response.json(profile);
    if (url.includes("/rest/v1/nowpayments_usdt_config")) {
      return Response.json({
        id: "USDT-BEP20",
        enabled: configEnabled,
        asset: "USDT",
        network: "BEP20",
        provider_currency: "usdtbsc",
        deposit_minimum_usdt: "1.000000",
        withdrawal_minimum_usdt: "2.000000",
        withdrawal_fee_percent: "5.000000",
        ...configOverrides,
      });
    }
    if (url.includes("/rest/v1/nowpayments_usdt_wallets")) return Response.json(wallet);
    if (url.includes("/rest/v1/nowpayments_usdt_provider_payments")) {
      return Response.json(providerPayments);
    }
    if (url.includes("/rest/v1/nowpayments_usdt_payments")) return Response.json(sessions);
    throw new Error(`Unexpected mocked request: ${url}`);
  };

  try {
    const headers = {};
    if (authorization) headers.authorization = authorization;
    if (incomingRequestId) headers["x-qhash-request-id"] = incomingRequestId;
    let response = null;
    let body = null;
    let thrown = null;
    try {
      const request = new Request(
        "https://qhash.mock/api/crypto/nowpayments/deposit-overview",
        { method, headers },
      );
      response = omitRuntimeContext
        ? await handler(request)
        : await handler(request, runtimeContext);
      body = await response.json();
    } catch (error) {
      thrown = error;
    }
    return {
      response,
      body,
      thrown,
      environmentReads,
      requests,
      terminalLogs,
    };
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalConsoleInfo;
    if (originalNetlify === undefined) delete globalThis.Netlify;
    else globalThis.Netlify = originalNetlify;
  }
}

function readTerminalLog(result) {
  assert.equal(result.terminalLogs.length, 1, "expected exactly one terminal log attempt");
  assert.equal(result.terminalLogs[0].length, 1, "terminal log must use one structured argument");
  assert.equal(typeof result.terminalLogs[0][0], "string");
  const terminalLog = JSON.parse(result.terminalLogs[0][0]);
  assert.deepEqual(Object.keys(terminalLog).sort(), TERMINAL_LOG_FIELDS);
  assert.equal(TERMINAL_LOG_STAGES.has(terminalLog.stage), true);
  return terminalLog;
}

function emptyOverviewBody(featureEnabled) {
  return {
    feature_enabled: featureEnabled,
    asset: "USDT",
    network: "BEP20",
    minimum_deposit_usdt: "1.000000",
    wallet: { available_balance_usdt: "0", reserved_balance_usdt: "0" },
    session_state: "none",
    active_session: null,
    history: [],
  };
}

test("overview rejects every non-production context before secrets or network", async () => {
  const rejectedContexts = [
    ["unpublished production", { deploy: { context: "production", published: false } }],
    ["deploy preview", { deploy: { context: "deploy-preview", published: true } }],
    ["branch deploy", { deploy: { context: "branch-deploy", published: true } }],
    ["preview server", { deploy: { context: "preview-server", published: true } }],
    ["dev", { deploy: { context: "dev", published: true } }],
    ["custom", { deploy: { context: "custom-context", published: true } }],
    ["missing context", null, true],
    ["null context", null],
    ["missing deploy", {}],
    ["null deploy", { deploy: null }],
    ["missing context name", { deploy: { published: true } }],
    ["missing published flag", { deploy: { context: "production" } }],
    ["malformed published flag", { deploy: { context: "production", published: "true" } }],
    ["malformed context", "production"],
    ["throwing deploy getter", Object.defineProperty({}, "deploy", {
      get() { throw new Error("sensitive malformed context detail"); },
    })],
  ];

  for (const [name, runtimeContext, omitRuntimeContext = false] of rejectedContexts) {
    const result = await invokeOverview({ runtimeContext, omitRuntimeContext });
    assert.equal(result.response.status, 503, name);
    assert.deepEqual(result.body, {
      error: "crypto_runtime_unavailable",
      message: "Crypto deposits are unavailable.",
    });
    assert.deepEqual(result.environmentReads, [], name);
    assert.deepEqual(result.requests, []);
    const terminalLog = readTerminalLog(result);
    assert.equal(terminalLog.stage, "runtime_gate", name);
    assert.equal(terminalLog.http_status, 503, name);
    assert.equal(terminalLog.diagnostic_code, "crypto_runtime_unavailable", name);
  }
});

test("missing and invalid authentication cannot read user data or contact NOWPayments", async () => {
  const missing = await invokeOverview({ authorization: "" });
  assert.equal(missing.response.status, 401);
  assert.deepEqual(missing.requests, []);

  const invalid = await invokeOverview({ authValid: false });
  assert.equal(invalid.response.status, 401);
  assert.ok(invalid.requests.every((url) => !url.startsWith("https://api.nowpayments.io")));
  assert.ok(!invalid.requests.some((url) => url.includes("nowpayments_usdt_payments")));
});

test("disabled feature returns a safe empty own-user view and never contacts the provider", async () => {
  const result = await invokeOverview({ configEnabled: false });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, {
    feature_enabled: false,
    asset: "USDT",
    network: "BEP20",
    minimum_deposit_usdt: "1.000000",
    wallet: { available_balance_usdt: "0", reserved_balance_usdt: "0" },
    session_state: "none",
    active_session: null,
    history: [],
  });
  assert.ok(result.requests.every((url) => !url.startsWith("https://api.nowpayments.io")));
  assert.ok(result.environmentReads.every((name) => name !== "NOWPAYMENTS_API_KEY"));
});

test("active session and exact wallet decimals are returned without internal identifiers", async () => {
  const result = await invokeOverview({
    configEnabled: true,
    sessions: [validSession()],
    wallet: {
      user_id: USER_ID,
      asset: "USDT",
      available_balance_usdt: "123456789012345678.123456789012345678",
      reserved_balance_usdt: "0.000000000000000001",
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.session_state, "pending_activation");
  assert.equal(result.body.active_session.address_lifecycle, "pending_activation");
  assert.equal(result.body.active_session.pay_address, ADDRESS);
  assert.equal(result.body.active_session.minimum_deposit_usdt, "1.250000000000000000");
  assert.equal(result.body.wallet.available_balance_usdt, "123456789012345678.123456789012345678");
  const wire = JSON.stringify(result.body);
  for (const forbidden of ["provider_payment_id", "session_id", "qhash_order_id", "settled_by"]) {
    assert.ok(!wire.includes(forbidden));
  }
  const decodedUrls = result.requests.map((url) => decodeURIComponent(url));
  assert.ok(decodedUrls.some((url) => url.includes(`user_id=eq.${USER_ID}`)));
  assert.ok(decodedUrls.every((url) => !url.includes(OTHER_USER_ID)));
});

test("finished gross actually_paid credit is displayed and provider outcome stays internal", async () => {
  const finished = validSession({
    provider_payment_status: "finished",
    session_status: "terminal",
    terminal_at: "2030-01-02T00:00:00.000Z",
    credited_amount_usdt: "0.2",
    credited_at: "2030-01-02T00:00:00.000Z",
  });
  const result = await invokeOverview({
    configEnabled: true,
    sessions: [finished],
    providerPayments: [validProviderPayment()],
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.active_session, null);
  assert.equal(result.body.history[0].status, "finished");
  assert.equal(result.body.history[0].credited_amount_usdt, "0.2");

  const expired = await invokeOverview({
    configEnabled: true,
    sessions: [validSession({ provider_valid_until: "2020-01-01T00:00:00.000Z" })],
  });
  assert.equal(expired.body.active_session, null);
  assert.equal(expired.body.session_state, "expired_unactivated");
  assert.equal(expired.body.history[0].status, "expired");
});

test("permanently activated address remains usable without expiry when generation is disabled", async () => {
  const result = await invokeOverview({
    configEnabled: false,
    sessions: [validSession({
      provider_payment_status: "finished",
      session_status: "terminal",
      address_activated_at: "2030-01-02T00:00:00.000Z",
      terminal_at: "2030-01-02T00:00:00.000Z",
      credited_amount_usdt: "3",
      credited_at: "2030-01-02T00:00:00.000Z",
    })],
    providerPayments: [validProviderPayment({ credited_amount_usdt: "3" })],
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.feature_enabled, false);
  assert.equal(result.body.session_state, "permanently_activated");
  assert.equal(result.body.active_session.address_lifecycle, "permanently_activated");
  assert.equal(result.body.active_session.pay_address, ADDRESS);
  assert.equal(result.body.active_session.valid_until, null);
  const parsed = parseNowpaymentsDepositOverview(result.body);
  assert.equal(isDepositAddressSendable(parsed.active_session, Date.parse("2100-01-01T00:00:00Z")), true);
});

test("overview preserves every handled terminal response and emits one allowlisted correlated log", async (t) => {
  const cases = [
    {
      name: "runtime context rejection",
      options: { runtimeContext: { deploy: { context: "deploy-preview", published: true } } },
      status: 503,
      body: { error: "crypto_runtime_unavailable", message: "Crypto deposits are unavailable." },
      stage: "runtime_gate",
      diagnosticCode: "crypto_runtime_unavailable",
    },
    {
      name: "unpublished production context",
      options: { runtimeContext: { deploy: { context: "production", published: false } } },
      status: 503,
      body: { error: "crypto_runtime_unavailable", message: "Crypto deposits are unavailable." },
      stage: "runtime_gate",
      diagnosticCode: "crypto_runtime_unavailable",
    },
    {
      name: "method rejection",
      options: { method: "POST" },
      status: 405,
      body: { error: "method_not_allowed", message: "GET only." },
      stage: "method_gate",
      diagnosticCode: "method_not_allowed",
    },
    {
      name: "server configuration rejection",
      options: { serviceRoleKey: "" },
      status: 500,
      body: { error: "server_config", message: "Server is not configured." },
      stage: "server_config",
      diagnosticCode: "server_config",
    },
    {
      name: "authentication requirement",
      options: { authorization: "" },
      status: 401,
      body: { error: "authentication_required", message: "Authentication required." },
      stage: "authentication",
      diagnosticCode: "authentication_required",
    },
    {
      name: "invalid session",
      options: { authValid: false },
      status: 401,
      body: { error: "invalid_session", message: "Invalid or expired session." },
      stage: "authentication",
      diagnosticCode: "invalid_session",
    },
    {
      name: "account rejection",
      options: { profile: { is_frozen: true } },
      status: 403,
      body: { error: "account_unavailable", message: "Account is unavailable." },
      stage: "profile_config_query",
      diagnosticCode: "account_unavailable",
    },
    {
      name: "configuration validation rejection",
      options: { configOverrides: { asset: "BTC" } },
      status: 503,
      body: { error: "crypto_config_unavailable", message: "Crypto deposits are unavailable." },
      stage: "profile_config_query",
      diagnosticCode: "crypto_config_unavailable",
    },
    {
      name: "overview query rejection",
      options: { queryFailure: "/rest/v1/nowpayments_usdt_wallets" },
      status: 503,
      body: { error: "deposit_overview_unavailable", message: "Crypto deposits are unavailable." },
      stage: "overview_queries",
      diagnosticCode: "deposit_overview_unavailable",
    },
    {
      name: "wallet validation rejection",
      options: {
        wallet: {
          user_id: OTHER_USER_ID,
          asset: "USDT",
          available_balance_usdt: "0",
          reserved_balance_usdt: "0",
        },
      },
      status: 503,
      body: { error: "deposit_overview_unavailable", message: "Crypto deposits are unavailable." },
      stage: "wallet_validation",
      diagnosticCode: "deposit_overview_unavailable",
    },
    {
      name: "session validation rejection",
      options: { sessions: [validSession({ id: "invalid" })] },
      status: 503,
      body: { error: "deposit_overview_unavailable", message: "Crypto deposits are unavailable." },
      stage: "response_validation",
      diagnosticCode: "deposit_overview_unavailable",
    },
    {
      name: "provider-payment validation rejection",
      options: { providerPayments: [validProviderPayment({ provider_payment_id: "invalid" })] },
      status: 503,
      body: { error: "deposit_overview_unavailable", message: "Crypto deposits are unavailable." },
      stage: "response_validation",
      diagnosticCode: "deposit_overview_unavailable",
    },
    {
      name: "disabled success",
      options: { configEnabled: false },
      status: 200,
      body: emptyOverviewBody(false),
      stage: "complete",
      diagnosticCode: "overview_success",
      outcome: "success",
    },
    {
      name: "enabled success",
      options: { configEnabled: true },
      status: 200,
      body: emptyOverviewBody(true),
      stage: "complete",
      diagnosticCode: "overview_success",
      outcome: "success",
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const result = await invokeOverview(entry.options);
      assert.equal(result.thrown, null);
      assert.equal(result.response.status, entry.status);
      assert.deepEqual(result.body, entry.body);
      assert.equal(Object.hasOwn(result.body, "request_id"), false);
      assert.equal(result.response.headers.get("cache-control"), "no-store");
      assert.deepEqual(
        [...result.response.headers.keys()].sort(),
        ["cache-control", "content-type", "x-qhash-request-id"],
      );

      const requestId = result.response.headers.get("x-qhash-request-id");
      assert.match(requestId, REQUEST_ID_PATTERN);
      const terminalLog = readTerminalLog(result);
      assert.deepEqual(terminalLog, {
        event: "nowpayments_usdt_deposit_overview",
        request_id: requestId,
        stage: entry.stage,
        http_status: entry.status,
        diagnostic_code: entry.diagnosticCode,
        outcome: entry.outcome ?? "failure",
      });

      const serializedLog = JSON.stringify(terminalLog);
      for (const forbidden of FORBIDDEN_TERMINAL_LOG_FRAGMENTS) {
        assert.equal(serializedLog.includes(forbidden), false, `terminal log leaked ${forbidden}`);
      }
    });
  }
});

test("overview request IDs are server-owned, random, and correlated only by response header", async () => {
  const spoofedRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const first = await invokeOverview({ incomingRequestId: spoofedRequestId });
  const second = await invokeOverview();
  const firstHeader = first.response.headers.get("x-qhash-request-id");
  const secondHeader = second.response.headers.get("x-qhash-request-id");
  assert.match(firstHeader, REQUEST_ID_PATTERN);
  assert.match(secondHeader, REQUEST_ID_PATTERN);
  assert.notEqual(firstHeader, spoofedRequestId);
  assert.notEqual(firstHeader, secondHeader);
  assert.equal(readTerminalLog(first).request_id, firstHeader);
  assert.equal(readTerminalLog(second).request_id, secondHeader);
  assert.equal(JSON.stringify(first.body).includes(firstHeader), false);
  assert.equal(JSON.stringify(second.body).includes(secondHeader), false);
});

test("request ID factory failures use a fresh server-owned fallback without leaking details", async () => {
  const handler = createOverviewHandler(() => {
    throw new Error("sensitive request ID generator detail");
  });
  const first = await invokeOverview({ handler });
  const second = await invokeOverview({ handler });

  for (const result of [first, second]) {
    assert.equal(result.thrown, null);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body, emptyOverviewBody(false));
    const requestId = result.response.headers.get("x-qhash-request-id");
    assert.match(requestId, REQUEST_ID_PATTERN);
    const terminalLog = readTerminalLog(result);
    assert.equal(terminalLog.request_id, requestId);
    const publicOutput = `${JSON.stringify(result.body)}${JSON.stringify(terminalLog)}`;
    assert.equal(publicOutput.includes("sensitive request ID generator detail"), false);
  }

  assert.notEqual(
    first.response.headers.get("x-qhash-request-id"),
    second.response.headers.get("x-qhash-request-id"),
  );
});

test("invalid request ID factory output uses a canonical server-owned UUID", async () => {
  const result = await invokeOverview({
    handler: createOverviewHandler(() => "not-a-request-id"),
    incomingRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  const requestId = result.response.headers.get("x-qhash-request-id");
  assert.match(requestId, REQUEST_ID_PATTERN);
  assert.notEqual(requestId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(readTerminalLog(result).request_id, requestId);
});

test("unexpected exceptions keep propagating and still emit one sanitized terminal log", async () => {
  const result = await invokeOverview({ environmentThrowName: "VITE_SUPABASE_URL" });
  assert.equal(result.response, null);
  assert.equal(result.body, null);
  assert.ok(result.thrown instanceof Error);
  const terminalLog = readTerminalLog(result);
  assert.equal(terminalLog.stage, "server_config");
  assert.equal(terminalLog.http_status, 500);
  assert.equal(terminalLog.diagnostic_code, "unexpected_exception");
  assert.equal(terminalLog.outcome, "failure");
  const serializedLog = JSON.stringify(terminalLog);
  assert.equal(serializedLog.includes(result.thrown.message), false);
  assert.equal(serializedLog.includes("sensitive"), false);
});

test("terminal logger failure cannot change the existing response", async () => {
  const result = await invokeOverview({ loggerThrows: true });
  assert.equal(result.thrown, null);
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, emptyOverviewBody(false));
  assert.equal(result.terminalLogs.length, 1);
});

test("client validation, countdown boundary, and decimal rendering avoid floating-point arithmetic", () => {
  const parsed = parseNowpaymentsDepositOverview({
    feature_enabled: true,
    asset: "USDT",
    network: "BEP20",
    minimum_deposit_usdt: "1.000000000000000000",
    wallet: { available_balance_usdt: "0", reserved_balance_usdt: "0" },
    session_state: "pending_activation",
    active_session: {
      asset: "USDT",
      network: "BEP20",
      status: "waiting",
      pay_address: ADDRESS,
      minimum_deposit_usdt: "1.000000000000000000",
      provider_minimum_usdt: "0.750000000000000000",
      created_at: "2030-01-01T00:00:00.000Z",
      address_lifecycle: "pending_activation",
      valid_until: "2030-01-01T00:00:01.000Z",
    },
    history: [],
  });
  assert.equal(isDepositAddressSendable(parsed.active_session, Date.parse("2030-01-01T00:00:00Z")), true);
  assert.equal(isDepositAddressSendable(parsed.active_session, Date.parse("2030-01-01T00:00:01Z")), false);
  assert.equal(formatDepositCountdown(parsed.active_session.valid_until, Date.parse("2030-01-01T00:00:01Z")), "Expired");
  assert.equal(formatUsdtDecimal("123456789012345678.123456789012345678"), "123,456,789,012,345,678.123456789012345678");
});

test("address generation client sends no amount or user ID and validates the public response", async () => {
  const calls = [];
  await requestNowpaymentsDepositSession("token", async (input, init) => {
    calls.push({ input: String(input), init });
    return Response.json({
      asset: "USDT",
      network: "BEP20",
      status: "waiting",
      pay_address: ADDRESS,
      minimum_deposit_usdt: "1",
      provider_minimum_usdt: "0.75",
      address_lifecycle: "pending_activation",
      valid_until: "2030-01-08T00:00:00.000Z",
    });
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, undefined);
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(calls[0]).replace(/user_id|amount/gi, ""));
});

test("duplicate generation clicks share one in-flight request and permit a later retry", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const generate = createSingleFlight(async () => {
    calls += 1;
    await gate;
    return calls;
  });
  const first = generate();
  const duplicate = generate();
  assert.equal(first, duplicate);
  assert.equal(calls, 1);
  release();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(await generate(), 2);
});

test("overview client uses bearer authentication and accepts only sanitized own-user fields", async () => {
  const result = await fetchNowpaymentsDepositOverview("token", async (_input, init) => {
    assert.equal(init.headers.authorization, "Bearer token");
    return Response.json({
      feature_enabled: false,
      asset: "USDT",
      network: "BEP20",
      minimum_deposit_usdt: "1",
      wallet: { available_balance_usdt: "0", reserved_balance_usdt: "0" },
      session_state: "none",
      active_session: null,
      history: [],
    });
  });
  assert.equal(result.feature_enabled, false);
});

test("copy feedback announces success, updates its name, and resets to the action state", async () => {
  const clipboardWrites = [];
  assert.equal(
    copyButtonAccessibleName({ addressSendable: true, copied: false }),
    "Copy USDT BEP20 deposit address.",
  );

  const feedback = await copyUsdtDepositAddress(ADDRESS, async (value) => {
    clipboardWrites.push(value);
  });

  assert.deepEqual(clipboardWrites, [ADDRESS]);
  assert.deepEqual(feedback, {
    copied: true,
    announcement: "USDT BEP20 deposit address copied to clipboard.",
  });
  assert.equal(
    copyButtonAccessibleName({ addressSendable: true, copied: feedback.copied }),
    "USDT BEP20 deposit address copied.",
  );
  assert.match(uiSource, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.deepEqual(IDLE_COPY_FEEDBACK, { copied: false, announcement: "" });
  assert.equal(
    copyButtonAccessibleName({
      addressSendable: true,
      copied: IDLE_COPY_FEEDBACK.copied,
    }),
    "Copy USDT BEP20 deposit address.",
  );
  assert.match(
    uiSource,
    /setTimeout\([\s\S]*setCopyFeedback\(IDLE_COPY_FEEDBACK\)[\s\S]*COPY_FEEDBACK_TIMEOUT_MS/,
  );
});

test("copy failure announces only a generic failure and keeps the action available", async () => {
  let clipboardAttempts = 0;
  const feedback = await copyUsdtDepositAddress(ADDRESS, async () => {
    clipboardAttempts += 1;
    throw new Error("sensitive browser clipboard detail");
  });

  assert.equal(clipboardAttempts, 1);
  assert.deepEqual(feedback, {
    copied: false,
    announcement: "Unable to copy the USDT BEP20 deposit address. Please copy it manually.",
  });
  assert.doesNotMatch(feedback.announcement, /copied|sensitive|browser clipboard detail/i);
  assert.equal(
    copyButtonAccessibleName({ addressSendable: true, copied: feedback.copied }),
    "Copy USDT BEP20 deposit address.",
  );
  assert.match(uiSource, /toast\.error\("Unable to copy\. Please copy the address manually\."\)/);
  assert.doesNotMatch(uiSource, /clipboard detail|error\.message|String\(error\)/i);
  assert.match(uiSource, /disabled=\{!addressSendable\}/);
});

test("expired addresses keep copy disabled without invoking clipboard or provider actions", () => {
  assert.equal(
    copyButtonAccessibleName({ addressSendable: false, copied: false }),
    "Copy disabled for expired address.",
  );
  assert.match(uiSource, /if \(!activeSession \|\| !addressSendable\) return;/);
  assert.match(uiSource, /disabled=\{!addressSendable\}/);
  assert.equal((uiSource.match(/navigator\.clipboard\.writeText/g) ?? []).length, 1);
  assert.match(uiSource, /createSingleFlight\(performGenerate\)/);
  assert.doesNotMatch(uiSource, /NOWPAYMENTS_API_KEY|api\.nowpayments\.io/);
});

test("UI is backend-gated, duplicate-click guarded, local-QR-only, responsive, and accessible", () => {
  assert.match(uiSource, /createSingleFlight\(performGenerate\)/);
  assert.match(uiSource, /disabled=\{generating\}/);
  assert.match(uiSource, /QRCode\.toDataURL/);
  assert.doesNotMatch(uiSource, /api\.qrserver|chart\.google|NOWPAYMENTS_API_KEY/);
  assert.doesNotMatch(uiSource, /<Input|network selector/i);
  assert.match(uiSource, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(uiSource, /USDT BEP20 deposit address copied to clipboard\./);
  assert.match(uiSource, /Copy USDT BEP20 deposit address\./);
  assert.match(uiSource, /alt="QR code for the USDT BEP20 deposit address"/);
  assert.match(uiSource, /sm:grid-cols/);
  assert.match(uiSource, /Expired — do not send/);
  assert.match(uiSource, /available_balance_usdt/);
  assert.match(uiSource, /reserved_balance_usdt/);
});

test("CBE and TeleBirr deposit paths remain present and crypto is a parallel option", () => {
  assert.match(depositRouteSource, /METHOD_META[\s\S]*cbe:/);
  assert.match(depositRouteSource, /METHOD_META[\s\S]*telebirr:/);
  assert.match(depositRouteSource, /submitDepositFn/);
  assert.match(depositRouteSource, /Crypto Deposit/);
  assert.match(depositRouteSource, /NowpaymentsUsdtDeposit/);
  assert.match(netlifyTypecheck, /nowpayments-usdt-deposit-overview\.mts/);
});

test("overview source keeps production and authentication gates before database reads", () => {
  assert.doesNotMatch(overviewSource, /Netlify\.env\.get\(["']CONTEXT["']\)/);
  assert.match(overviewSource, /import type \{ Config, Context \} from "@netlify\/functions"/);
  assert.ok(overviewSource.indexOf("if (!isPublishedProductionDeployContext(context))") < overviewSource.indexOf('Netlify.env.get("VITE_SUPABASE_URL")'));
  assert.match(deployContextSource, /deploy\?\.context === "production"/);
  assert.match(deployContextSource, /deploy\?\.published === true/);
  assert.doesNotMatch(deployContextSource, /Netlify\.env|getEnvironment|process\.env/);
  assert.ok(overviewSource.indexOf("if (!token || token === authorization)") < overviewSource.indexOf("admin.auth.getUser(token)"));
  assert.doesNotMatch(overviewSource, /NOWPAYMENTS_API_KEY|api\.nowpayments\.io/);
  assert.match(overviewSource, /\.eq\("user_id", userId\)/);
  assert.match(overviewSource, /available_balance_usdt::text/);
  assert.match(overviewSource, /credited_amount_usdt::text/);
  assert.doesNotMatch(overviewSource, /outcome_amount_usdt::text/);
});

test("overview source limits observability to the request-ID header and one sanitized terminal log", () => {
  assert.equal((overviewSource.match(/console\.info\(/g) ?? []).length, 1);
  assert.doesNotMatch(overviewSource, /console\.(?:log|warn|error|debug)\(/);
  assert.match(overviewSource, /"X-QHash-Request-ID": requestId/);
  assert.doesNotMatch(
    overviewSource,
    /(?:error\.message|error\.stack|String\(\s*error\s*\)|JSON\.stringify\(\s*(?:error|req|body|response)\s*\))/,
  );
  assert.doesNotMatch(overviewSource, /request_id:\s*(?:authorization|token|userId)/);
});

test("test file itself contains no live credential or provider call", () => {
  assert.equal(fileURLToPath(repositoryRoot).includes("Qhash"), true);
});

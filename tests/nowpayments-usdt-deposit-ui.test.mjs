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
  createNowpaymentsOverviewRequestGate,
  createSingleFlight,
  formatDepositCountdown,
  formatUsdtDecimal,
  isNowpaymentsAuthGenerationCurrent,
  isDepositAddressSendable,
  parseNowpaymentsDepositOverview,
  requestNowpaymentsDepositSession,
  sanitizeDisabledNowpaymentsDepositOverview,
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
  INITIAL_NOWPAYMENTS_DEPOSIT_UI_STATE,
  copyButtonAccessibleName,
  copyUsdtDepositAddress,
  nowpaymentsDepositUiReducer,
  nowpaymentsDepositUiVisibility,
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
  configResponse = undefined,
  snapshotResponse = undefined,
  snapshotRpcErrorMessage = null,
  snapshotFeatureEnabled = undefined,
  globalSettingRows = [{ key: "deposits_paused", value: "false" }],
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
    if (
      queryFailure
      && (
        url.includes(queryFailure)
        || url.includes("/rest/v1/rpc/get_nowpayments_usdt_deposit_overview_snapshot")
      )
    ) {
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
    if (url.includes("/rest/v1/rpc/get_nowpayments_usdt_deposit_overview_snapshot")) {
      if (snapshotRpcErrorMessage) {
        return Response.json(
          { message: snapshotRpcErrorMessage },
          { status: 400 },
        );
      }
      if (snapshotResponse !== undefined) return Response.json(snapshotResponse);
      const configValue = configResponse !== undefined
        ? configResponse
        : {
        id: "USDT-BEP20",
        enabled: configEnabled,
        asset: "USDT",
        network: "BEP20",
        provider_currency: "usdtbsc",
        deposit_minimum_usdt: "1.000000",
        withdrawal_minimum_usdt: "2.000000",
        withdrawal_fee_percent: "5.000000",
        ...configOverrides,
      };
      const globalRow = Array.isArray(globalSettingRows)
        && globalSettingRows.length === 1
        && globalSettingRows[0]
        && typeof globalSettingRows[0] === "object"
        && !Array.isArray(globalSettingRows[0])
        ? globalSettingRows[0]
        : null;
      const configRow = configValue
        && typeof configValue === "object"
        && !Array.isArray(configValue)
        ? configValue
        : null;
      if (
        !globalRow
        || globalRow.key !== "deposits_paused"
        || (globalRow.value !== "true" && globalRow.value !== "false")
        || !configRow
        || configRow.id !== "USDT-BEP20"
        || configRow.asset !== "USDT"
        || configRow.network !== "BEP20"
        || configRow.provider_currency !== "usdtbsc"
        || typeof configRow.deposit_minimum_usdt !== "string"
        || !/^1(?:\.0+)?$/.test(configRow.deposit_minimum_usdt)
        || typeof configRow.withdrawal_minimum_usdt !== "string"
        || !/^2(?:\.0+)?$/.test(configRow.withdrawal_minimum_usdt)
        || typeof configRow.withdrawal_fee_percent !== "string"
        || !/^5(?:\.0+)?$/.test(configRow.withdrawal_fee_percent)
        || typeof configRow.enabled !== "boolean"
      ) {
        return Response.json(
          { message: "nowpayments_deposit_availability_unavailable" },
          { status: 400 },
        );
      }
      const featureEnabled = snapshotFeatureEnabled
        ?? (globalRow.value === "false" && configRow.enabled === true);
      return Response.json({
        feature_enabled: featureEnabled,
        minimum_deposit_usdt: configRow.deposit_minimum_usdt,
        wallet,
        sessions: featureEnabled
          ? sessions
          : sessions.map((session) =>
              session && typeof session === "object" && !Array.isArray(session)
                ? { ...session, pay_address: null }
                : session
            ),
        provider_payments: providerPayments,
      });
    }
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

function activeOverviewBody({
  address = ADDRESS,
  availableBalance = "9",
  history = [],
} = {}) {
  return {
    feature_enabled: true,
    asset: "USDT",
    network: "BEP20",
    minimum_deposit_usdt: "1",
    wallet: {
      available_balance_usdt: availableBalance,
      reserved_balance_usdt: "0",
    },
    session_state: "pending_activation",
    active_session: {
      asset: "USDT",
      network: "BEP20",
      status: "waiting",
      pay_address: address,
      minimum_deposit_usdt: "1",
      provider_minimum_usdt: "1",
      created_at: "2030-01-01T00:00:00.000Z",
      address_lifecycle: "pending_activation",
      valid_until: "2030-01-08T00:00:00.000Z",
    },
    history,
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

  const frozen = await invokeOverview({ profile: { is_frozen: true }, configEnabled: true });
  assert.equal(frozen.response.status, 403);
  assert.ok(frozen.requests.some((url) => url.includes("/rest/v1/profiles")));
  assert.ok(!frozen.requests.some((url) => url.includes("/rest/v1/app_settings")));
  assert.ok(!frozen.requests.some((url) => url.includes("/rest/v1/nowpayments_usdt_config")));
  assert.ok(frozen.environmentReads.every((name) => name !== "NOWPAYMENTS_API_KEY"));
});

test("missing or malformed profile freeze state fails closed before availability or session access", async () => {
  const invalidProfiles = [
    null,
    {},
    { is_frozen: null },
    { is_frozen: "false" },
    [],
    "active",
  ];
  for (const profile of invalidProfiles) {
    const result = await invokeOverview({ profile, configEnabled: true });
    assert.equal(result.response.status, 403, JSON.stringify(profile));
    assert.deepEqual(result.body, {
      error: "account_unavailable",
      message: "Account is unavailable.",
    });
    assert.equal(
      result.requests.some((url) => url.includes("/rest/v1/app_settings")),
      false,
    );
    assert.equal(
      result.requests.some((url) => url.includes("/rest/v1/rpc/")),
      false,
    );
    assert.ok(!result.environmentReads.includes("NOWPAYMENTS_API_KEY"));
  }
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

test("global pause and crypto-rail disablement return byte-identical sanitized views", async () => {
  const finished = validSession({
    provider_payment_status: "finished",
    session_status: "terminal",
    address_activated_at: "2030-01-02T00:00:00.000Z",
    terminal_at: "2030-01-02T00:00:00.000Z",
    credited_amount_usdt: "3",
    credited_at: "2030-01-02T00:00:00.000Z",
  });
  const shared = {
    sessions: [finished],
    providerPayments: [validProviderPayment({ credited_amount_usdt: "3" })],
    wallet: {
      user_id: USER_ID,
      asset: "USDT",
      available_balance_usdt: "9.000000000000000000",
      reserved_balance_usdt: "0.000000000000000000",
    },
  };
  const globalPaused = await invokeOverview({
    ...shared,
    configEnabled: true,
    globalSettingRows: [{ key: "deposits_paused", value: "true" }],
  });
  const railDisabled = await invokeOverview({
    ...shared,
    configEnabled: false,
  });
  const bothBlocked = await invokeOverview({
    ...shared,
    configEnabled: false,
    globalSettingRows: [{ key: "deposits_paused", value: "true" }],
  });

  assert.equal(globalPaused.response.status, 200);
  assert.deepEqual(globalPaused.body, railDisabled.body);
  assert.deepEqual(globalPaused.body, bothBlocked.body);
  assert.equal(globalPaused.body.feature_enabled, false);
  assert.equal(globalPaused.body.session_state, "none");
  assert.equal(globalPaused.body.active_session, null);
  assert.deepEqual(globalPaused.body.history, [{
    asset: "USDT",
    network: "BEP20",
    status: "finished",
    pay_address: null,
    credited_amount_usdt: "3",
    created_at: "2030-01-02T00:00:00.000Z",
    valid_until: "2030-01-08T00:00:00.000Z",
    completed_at: "2030-01-02T00:00:00.000Z",
  }]);
  for (const result of [globalPaused, railDisabled, bothBlocked]) {
    assert.ok(result.requests.every((url) => !url.startsWith("https://api.nowpayments.io")));
    assert.ok(result.environmentReads.every((name) => name !== "NOWPAYMENTS_API_KEY"));
    assert.equal(JSON.stringify(result.body).includes(ADDRESS), false);
  }
});

test("a pending address is hidden completely while the global pause is active", async () => {
  const result = await invokeOverview({
    configEnabled: true,
    globalSettingRows: [{ key: "deposits_paused", value: "true" }],
    sessions: [validSession()],
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.feature_enabled, false);
  assert.equal(result.body.session_state, "none");
  assert.equal(result.body.active_session, null);
  assert.deepEqual(result.body.history, []);
  assert.equal(JSON.stringify(result.body).includes(ADDRESS), false);
  assert.ok(result.requests.every((url) => !url.startsWith("https://api.nowpayments.io")));
  assert.ok(result.environmentReads.every((name) => name !== "NOWPAYMENTS_API_KEY"));
});

test("the authoritative snapshot wins over stale enabled state and returns a sanitized no-address view", async () => {
  const shared = {
    configEnabled: true,
    sessions: [validSession()],
    wallet: {
      user_id: USER_ID,
      asset: "USDT",
      available_balance_usdt: "9",
      reserved_balance_usdt: "0",
    },
  };
  const paused = await invokeOverview({
    ...shared,
    snapshotFeatureEnabled: false,
  });
  const railDisabled = await invokeOverview({
    ...shared,
    snapshotFeatureEnabled: false,
  });

  for (const result of [paused, railDisabled]) {
    assert.equal(result.response.status, 200);
    assert.equal(result.body.feature_enabled, false);
    assert.equal(result.body.session_state, "none");
    assert.equal(result.body.active_session, null);
    assert.deepEqual(result.body.history, []);
    assert.equal(JSON.stringify(result.body).includes(ADDRESS), false);
    assert.equal(
      result.requests.filter((url) =>
        url.includes("/rest/v1/rpc/get_nowpayments_usdt_deposit_overview_snapshot")
      ).length,
      1,
    );
    assert.ok(!result.environmentReads.includes("NOWPAYMENTS_API_KEY"));
  }
  assert.deepEqual(paused.body, railDisabled.body);
});

test("missing, duplicate, and malformed global deposit settings fail closed", async () => {
  const cases = [
    ["missing", []],
    ["duplicate", [
      { key: "deposits_paused", value: "false" },
      { key: "deposits_paused", value: "false" },
    ]],
    ["wrong key", [{ key: "withdrawals_paused", value: "false" }]],
    ["malformed", [{ key: "deposits_paused", value: "FALSE" }]],
    ["null row", [null]],
    ["string row", ["false"]],
    ["array row", [[]]],
  ];

  for (const [name, globalSettingRows] of cases) {
    const result = await invokeOverview({
      configEnabled: true,
      globalSettingRows,
      sessions: [validSession()],
    });
    assert.equal(result.response.status, 503, name);
    assert.deepEqual(result.body, {
      error: "deposit_overview_unavailable",
      message: "Crypto deposits are unavailable.",
    }, name);
    assert.equal(result.requests.some((url) => url.includes("nowpayments_usdt_payments")), false);
    assert.ok(result.environmentReads.every((entry) => entry !== "NOWPAYMENTS_API_KEY"));
  }
});

test("missing or malformed rail configuration fails inside the snapshot before disclosure", async () => {
  const invalidConfigurations = [
    null,
    [],
    "USDT-BEP20",
    {},
    {
      id: "USDT-BEP20",
      enabled: "true",
      asset: "USDT",
      network: "BEP20",
      provider_currency: "usdtbsc",
      deposit_minimum_usdt: "1",
      withdrawal_minimum_usdt: "2",
      withdrawal_fee_percent: "5",
    },
    {
      id: "USDT-BEP20",
      enabled: true,
      asset: "USDT",
      network: "BEP20",
      provider_currency: "usdtbsc",
      deposit_minimum_usdt: null,
      withdrawal_minimum_usdt: "2",
      withdrawal_fee_percent: "5",
    },
  ];
  for (const configResponse of invalidConfigurations) {
    const result = await invokeOverview({
      configEnabled: true,
      configResponse,
      sessions: [validSession()],
    });
    assert.equal(result.response.status, 503, JSON.stringify(configResponse));
    assert.deepEqual(result.body, {
      error: "deposit_overview_unavailable",
      message: "Crypto deposits are unavailable.",
    });
    assert.equal(
      result.requests.filter((url) =>
        url.includes("/rest/v1/rpc/get_nowpayments_usdt_deposit_overview_snapshot")
      ).length,
      1,
    );
    assert.equal(
      result.requests.some((url) => url.includes("nowpayments_usdt_payments")),
      false,
    );
    assert.ok(!result.environmentReads.includes("NOWPAYMENTS_API_KEY"));
  }
});

test("authoritative snapshot config or response drift is a generic failure with no disclosure", async () => {
  const configDrift = await invokeOverview({
    configEnabled: true,
    sessions: [validSession()],
    snapshotRpcErrorMessage: "nowpayments_deposit_availability_unavailable",
  });
  assert.equal(configDrift.response.status, 503);
  assert.deepEqual(configDrift.body, {
    error: "deposit_overview_unavailable",
    message: "Crypto deposits are unavailable.",
  });

  const malformed = await invokeOverview({
    configEnabled: true,
    sessions: [validSession()],
    snapshotResponse: { feature_enabled: true, pay_address: ADDRESS },
  });
  assert.equal(malformed.response.status, 503);
  assert.deepEqual(malformed.body, {
    error: "deposit_overview_unavailable",
    message: "Crypto deposits are unavailable.",
  });
  for (const result of [configDrift, malformed]) {
    assert.equal(JSON.stringify(result.body).includes(ADDRESS), false);
    assert.equal(
      result.requests.some((url) => url.includes("nowpayments_usdt_wallets")),
      false,
    );
  }
});

test("a disabled snapshot that contains any address fails closed instead of relying on client hiding", async () => {
  const result = await invokeOverview({
    snapshotResponse: {
      feature_enabled: false,
      minimum_deposit_usdt: "1",
      wallet: null,
      sessions: [validSession()],
      provider_payments: [],
    },
  });
  assert.equal(result.response.status, 503);
  assert.deepEqual(result.body, {
    error: "deposit_overview_unavailable",
    message: "Crypto deposits are unavailable.",
  });
  assert.equal(JSON.stringify(result.body).includes(ADDRESS), false);
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
  assert.equal(
    decodedUrls.filter((url) =>
      url.includes("/rest/v1/rpc/get_nowpayments_usdt_deposit_overview_snapshot")
    ).length,
    1,
  );
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
  assert.equal(expired.response.status, 200, JSON.stringify({
    body: expired.body,
    terminalLog: readTerminalLog(expired),
  }));
  assert.equal(expired.body.active_session, null);
  assert.equal(expired.body.session_state, "expired_unactivated");
  assert.equal(expired.body.history[0].status, "expired");
});

test("terminal unactivated sessions stay non-generating strictly before, but not at, the provider deadline", async () => {
  const originalDateNow = Date.now;
  const deadline = Date.parse("2030-01-08T00:00:00.000Z");
  const terminal = validSession({
    provider_payment_status: "finished",
    session_status: "terminal",
    terminal_at: "2030-01-02T00:00:00.000Z",
  });

  try {
    Date.now = () => deadline - 1;
    const beforeDeadline = await invokeOverview({
      configEnabled: true,
      sessions: [terminal],
    });
    assert.equal(beforeDeadline.response.status, 200);
    assert.equal(beforeDeadline.body.session_state, "manual_review");
    assert.equal(beforeDeadline.body.active_session, null);
    assert.equal(parseNowpaymentsDepositOverview(beforeDeadline.body).active_session, null);
    assert.ok(beforeDeadline.requests.every((url) => !url.startsWith("https://api.nowpayments.io")));
    assert.ok(beforeDeadline.environmentReads.every((name) => name !== "NOWPAYMENTS_API_KEY"));

    Date.now = () => deadline;
    const atDeadline = await invokeOverview({
      configEnabled: true,
      sessions: [terminal],
    });
    assert.equal(atDeadline.response.status, 200);
    assert.equal(atDeadline.body.session_state, "expired_unactivated");
    assert.equal(atDeadline.body.active_session, null);
  } finally {
    Date.now = originalDateNow;
  }
});

test("permanently activated address and controls are hidden while generation is disabled", async () => {
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
  assert.equal(result.body.session_state, "none");
  assert.equal(result.body.active_session, null);
  assert.equal(result.body.history[0].pay_address, null);
  assert.equal(JSON.stringify(result.body).includes(ADDRESS), false);
  const parsed = parseNowpaymentsDepositOverview(result.body);
  assert.equal(parsed.active_session, null);
});

test("overview does not accept exact-deadline activation evidence", async () => {
  const result = await invokeOverview({
    configEnabled: true,
    sessions: [validSession({
      provider_payment_status: "finished",
      session_status: "terminal",
      address_activated_at: "2030-01-08T00:00:00.000Z",
      terminal_at: "2030-01-08T00:00:00.000Z",
      credited_amount_usdt: "3",
      credited_at: "2030-01-08T00:00:00.000Z",
    })],
    providerPayments: [validProviderPayment({ credited_amount_usdt: "3" })],
  });
  assert.equal(result.response.status, 503);
  assert.deepEqual(result.body, {
    error: "deposit_overview_unavailable",
    message: "Crypto deposits are unavailable.",
  });
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
      body: { error: "deposit_overview_unavailable", message: "Crypto deposits are unavailable." },
      stage: "overview_queries",
      diagnosticCode: "deposit_overview_unavailable",
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

test("client parser rejects disabled payloads that expose active or historical addresses", () => {
  const active = {
    feature_enabled: false,
    asset: "USDT",
    network: "BEP20",
    minimum_deposit_usdt: "1",
    wallet: { available_balance_usdt: "0", reserved_balance_usdt: "0" },
    session_state: "pending_activation",
    active_session: {
      asset: "USDT",
      network: "BEP20",
      status: "waiting",
      pay_address: ADDRESS,
      minimum_deposit_usdt: "1",
      provider_minimum_usdt: "1",
      created_at: "2030-01-01T00:00:00.000Z",
      address_lifecycle: "pending_activation",
      valid_until: "2030-01-08T00:00:00.000Z",
    },
    history: [],
  };
  assert.throws(() => parseNowpaymentsDepositOverview(active), /unavailable/);

  const historyAddress = {
    ...emptyOverviewBody(false),
    history: [{
      asset: "USDT",
      network: "BEP20",
      status: "finished",
      pay_address: ADDRESS,
      credited_amount_usdt: "3",
      created_at: "2030-01-01T00:00:00.000Z",
      valid_until: "2030-01-08T00:00:00.000Z",
      completed_at: "2030-01-02T00:00:00.000Z",
    }],
  };
  assert.throws(() => parseNowpaymentsDepositOverview(historyAddress), /unavailable/);
});

test("client sanitization removes a previously usable address after confirmed disablement", () => {
  const staleEnabledOverview = parseNowpaymentsDepositOverview({
    feature_enabled: true,
    asset: "USDT",
    network: "BEP20",
    minimum_deposit_usdt: "1",
    wallet: { available_balance_usdt: "9", reserved_balance_usdt: "0" },
    session_state: "pending_activation",
    active_session: {
      asset: "USDT",
      network: "BEP20",
      status: "waiting",
      pay_address: ADDRESS,
      minimum_deposit_usdt: "1",
      provider_minimum_usdt: "1",
      created_at: "2030-01-01T00:00:00.000Z",
      address_lifecycle: "pending_activation",
      valid_until: "2030-01-08T00:00:00.000Z",
    },
    history: [{
      asset: "USDT",
      network: "BEP20",
      status: "waiting",
      pay_address: ADDRESS,
      credited_amount_usdt: null,
      created_at: "2030-01-01T00:00:00.000Z",
      valid_until: "2030-01-08T00:00:00.000Z",
      completed_at: null,
    }],
  });

  const sanitized = sanitizeDisabledNowpaymentsDepositOverview(staleEnabledOverview);
  assert.equal(sanitized.feature_enabled, false);
  assert.equal(sanitized.session_state, "none");
  assert.equal(sanitized.active_session, null);
  assert.deepEqual(sanitized.history, []);
  assert.equal(JSON.stringify(sanitized).includes(ADDRESS), false);
  assert.doesNotThrow(() => parseNowpaymentsDepositOverview(sanitized));
});

test("address generation client sends no amount or user ID and validates the public response", async () => {
  const calls = [];
  const controller = new AbortController();
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
  }, controller.signal);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.signal, controller.signal);
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
  const controller = new AbortController();
  const result = await fetchNowpaymentsDepositOverview("token", async (_input, init) => {
    assert.equal(init.headers.authorization, "Bearer token");
    assert.equal(init.signal, controller.signal);
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
  }, controller.signal);
  assert.equal(result.feature_enabled, false);
});

test("overview client distinguishes a confirmed rail pause from generic runtime failure", async () => {
  await assert.rejects(
    fetchNowpaymentsDepositOverview("token", async () =>
      Response.json(
        { error: "crypto_deposits_disabled", message: "Crypto deposits are disabled." },
        { status: 503 },
      )
    ),
    (error) => error?.kind === "disabled",
  );
  await assert.rejects(
    fetchNowpaymentsDepositOverview("token", async () =>
      Response.json(
        { error: "crypto_runtime_unavailable", message: "Crypto deposits are unavailable." },
        { status: 503 },
      )
    ),
    (error) => error?.kind === "unavailable",
  );
});

test("overview request generations abort and ignore stale work while a later refresh can recover", async () => {
  const gate = createNowpaymentsOverviewRequestGate();
  const first = gate.begin();
  assert.equal(first.signal.aborted, false);
  assert.equal(gate.isCurrent(first.generation), true);

  const second = gate.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(gate.isCurrent(first.generation), false);
  assert.equal(gate.isCurrent(second.generation), true);

  gate.invalidate();
  assert.equal(second.signal.aborted, true);
  assert.equal(gate.isCurrent(second.generation), false);

  const recovered = gate.begin();
  assert.equal(recovered.signal.aborted, false);
  assert.equal(gate.isCurrent(recovered.generation), true);
  first.abort();
  assert.equal(recovered.signal.aborted, false);
});

test("state harness applies only the newest overview resolution and purges disclosure on pause or failure", async () => {
  const gate = createNowpaymentsOverviewRequestGate();
  const observedSignals = [];
  let state = { ...INITIAL_NOWPAYMENTS_DEPOSIT_UI_STATE };
  const dispatch = (action) => {
    state = nowpaymentsDepositUiReducer(state, action);
  };
  const beginLoad = (responsePromise) => {
    const ticket = gate.begin();
    dispatch({ type: "overview_loading" });
    const completion = (async () => {
      try {
        const overview = await fetchNowpaymentsDepositOverview(
          "current-token",
          async (_input, init) => {
            observedSignals.push(init.signal);
            return responsePromise;
          },
          ticket.signal,
        );
        if (gate.isCurrent(ticket.generation)) {
          dispatch({ type: "overview_success", overview });
        }
      } catch {
        if (gate.isCurrent(ticket.generation)) {
          dispatch({ type: "overview_failure" });
        }
      }
    })();
    return { ticket, completion };
  };
  const completedHistory = {
    asset: "USDT",
    network: "BEP20",
    status: "finished",
    pay_address: ADDRESS,
    credited_amount_usdt: "3",
    created_at: "2029-12-01T00:00:00.000Z",
    valid_until: null,
    completed_at: "2029-12-02T00:00:00.000Z",
  };

  await beginLoad(Promise.resolve(Response.json(activeOverviewBody({
    history: [completedHistory],
  })))).completion;
  dispatch({ type: "set_qr_data_url", qrDataUrl: "data:image/png;base64,safe" });
  dispatch({
    type: "set_copy_feedback",
    copyFeedback: { copied: true, announcement: "copied" },
  });
  assert.deepEqual(nowpaymentsDepositUiVisibility(state), {
    address: true,
    qr: true,
    qrData: true,
    copy: true,
    generate: false,
    safety: true,
    balances: true,
    history: true,
    retry: false,
  });

  const pausedBody = {
    ...emptyOverviewBody(false),
    wallet: { available_balance_usdt: "9", reserved_balance_usdt: "0" },
    history: [{ ...completedHistory, pay_address: null }],
  };
  await beginLoad(Promise.resolve(Response.json(pausedBody))).completion;
  const pausedVisibility = nowpaymentsDepositUiVisibility(state);
  assert.equal(pausedVisibility.address, false);
  assert.equal(pausedVisibility.qr, false);
  assert.equal(pausedVisibility.qrData, false);
  assert.equal(pausedVisibility.copy, false);
  assert.equal(pausedVisibility.generate, false);
  assert.equal(pausedVisibility.safety, false);
  assert.equal(state.qrDataUrl, null);
  assert.deepEqual(state.copyFeedback, IDLE_COPY_FEEDBACK);
  assert.equal(JSON.stringify(state).includes(ADDRESS), false);

  await beginLoad(Promise.resolve(Response.json(emptyOverviewBody(true)))).completion;
  assert.equal(nowpaymentsDepositUiVisibility(state).generate, true);
  await beginLoad(Promise.resolve(Response.json(pausedBody))).completion;
  assert.equal(nowpaymentsDepositUiVisibility(state).generate, false);

  await beginLoad(Promise.resolve(Response.json(activeOverviewBody({
    history: [completedHistory],
  })))).completion;
  dispatch({ type: "set_qr_data_url", qrDataUrl: "data:image/png;base64,cached" });
  await beginLoad(Promise.reject(new Error("network unavailable"))).completion;
  assert.equal(state.overview, null);
  assert.deepEqual(nowpaymentsDepositUiVisibility(state), {
    address: false,
    qr: false,
    qrData: false,
    copy: false,
    generate: false,
    safety: false,
    balances: false,
    history: false,
    retry: true,
  });

  const staleAddress = "0x2222222222222222222222222222222222222222";
  const stale = createDeferred();
  const recovery = createDeferred();
  const staleLoad = beginLoad(stale.promise);
  const recoveryLoad = beginLoad(recovery.promise);
  assert.equal(staleLoad.ticket.signal.aborted, true);
  assert.equal(recoveryLoad.ticket.signal.aborted, false);

  recovery.resolve(Response.json(activeOverviewBody({
    address: ADDRESS,
    availableBalance: "7",
    history: [],
  })));
  await recoveryLoad.completion;
  stale.resolve(Response.json(activeOverviewBody({
    address: staleAddress,
    availableBalance: "999",
    history: [],
  })));
  await staleLoad.completion;

  assert.equal(state.overview.active_session.pay_address, ADDRESS);
  assert.equal(state.overview.wallet.available_balance_usdt, "7");
  assert.equal(JSON.stringify(state).includes(staleAddress), false);
  assert.equal(nowpaymentsDepositUiVisibility(state).retry, false);
  assert.ok(observedSignals.length >= 8);
});

test("authentication generations deterministically reject old-token and same-user refresh results", () => {
  const adminAToken = "admin-a-token";
  const adminBToken = "admin-b-token";
  assert.equal(
    isNowpaymentsAuthGenerationCurrent(adminAToken, 4, adminAToken, 4),
    true,
  );
  assert.equal(
    isNowpaymentsAuthGenerationCurrent(adminBToken, 5, adminAToken, 4),
    false,
  );
  assert.equal(
    isNowpaymentsAuthGenerationCurrent(adminAToken, 5, adminAToken, 4),
    false,
  );
  assert.equal(
    isNowpaymentsAuthGenerationCurrent(adminAToken, 4, adminBToken, 4),
    false,
  );
});

test("generation source guards bind Generate lifecycle to the current token and pause polling", () => {
  assert.match(uiSource, /const authGenerationRef = useRef\(0\)/);
  assert.match(uiSource, /const accessTokenRef = useRef\(accessToken\)/);
  assert.match(uiSource, /const submissionControllerRef = useRef<AbortController \| null>\(null\)/);
  assert.match(uiSource, /const submissionBusyRef = useRef\(false\)/);
  assert.match(
    uiSource,
    /isNowpaymentsAuthGenerationCurrent\([\s\S]*accessTokenRef\.current,[\s\S]*authGenerationRef\.current,[\s\S]*accessToken,[\s\S]*authGeneration,[\s\S]*submissionBusyRef\.current && !allowDuringSubmission/,
  );
  assert.match(uiSource, /overviewRequestGateRef\.current\?\.invalidate\(\)/);
  assert.match(uiSource, /submissionControllerRef\.current\?\.abort\(\)/);
  assert.match(uiSource, /requestNowpaymentsDepositSession\(token, fetch, controller\.signal\)/);
  assert.match(uiSource, /if \(!isCurrentAuthGeneration\(\)\) return;/);
  assert.match(
    uiSource,
    /if \(!isCurrentAuthGeneration\(\) \|\| \(controller\.signal\.aborted && !timedOut\)\)/,
  );
  assert.match(
    uiSource,
    /if \(isCurrentAuthGeneration\(\)\) \{[\s\S]*submissionBusyRef\.current = false;[\s\S]*setGenerating\(false\);/,
  );
  assert.ok(
    uiSource.indexOf("if (!isCurrentAuthGeneration() || !refreshed) return;")
      < uiSource.indexOf('toast.success("Your USDT BEP20 deposit address is ready.");'),
  );
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
    /setTimeout\([\s\S]*type: "set_copy_feedback"[\s\S]*copyFeedback: IDLE_COPY_FEEDBACK[\s\S]*COPY_FEEDBACK_TIMEOUT_MS/,
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
  assert.match(
    uiSource,
    /if \(!overview\?\.feature_enabled \|\| !activeSession \|\| !addressSendable\) return;/,
  );
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
  const disabledState = uiSource.slice(
    uiSource.indexOf("function DisabledCryptoState"),
    uiSource.indexOf("function ActiveDepositCard"),
  );
  assert.doesNotMatch(disabledState, /Generate Deposit Address|Retry|QRCode\.toDataURL|navigator\.clipboard/);
  assert.ok(
    uiSource.indexOf("!overview.feature_enabled ?")
      < uiSource.indexOf("activeSession ?"),
  );
  assert.match(uiSource, /error && overview\.feature_enabled && <InlineRetry/);
  assert.ok(
    (uiSource.match(/sanitizeDisabledNowpaymentsDepositOverview\(state\.overview\)/g) ?? []).length >= 1,
  );
  assert.match(uiSource, /createNowpaymentsOverviewRequestGate/);
  assert.match(uiSource, /new AbortController|ticket\.signal/);
  assert.match(uiSource, /isCurrent\(ticket\.generation\)/);
  assert.match(uiSource, /setInterval\(refresh, OVERVIEW_REFRESH_INTERVAL_MS\)/);
  assert.match(uiSource, /document\.visibilityState === "visible"/);
  assert.match(
    uiSource,
    /catch \{[\s\S]*clearAddressPresentation\(\);[\s\S]*type: "overview_failure"/,
  );
  assert.ok(
    uiSource.indexOf("!overview.feature_enabled ?")
      < uiSource.indexOf("activeSession ?"),
  );
});

test("CBE and TeleBirr deposit paths remain present and crypto is a parallel option", () => {
  assert.match(depositRouteSource, /METHOD_META[\s\S]*cbe:/);
  assert.match(depositRouteSource, /METHOD_META[\s\S]*telebirr:/);
  assert.match(depositRouteSource, /submitDepositFn/);
  assert.match(depositRouteSource, /Crypto Deposit/);
  assert.match(depositRouteSource, /\/deposit\/crypto\/usdt\/bep20/);
  assert.match(netlifyTypecheck, /netlify\/functions\/\*\*\/\*\.mts/);
});

test("overview source keeps production and authentication gates before database reads", () => {
  assert.doesNotMatch(overviewSource, /Netlify\.env\.get\(["']CONTEXT["']\)/);
  assert.match(overviewSource, /import type \{ Config, Context \} from "@netlify\/functions"/);
  assert.ok(overviewSource.indexOf("if (!isPublishedProductionDeployContext(context))") < overviewSource.indexOf('Netlify.env.get("VITE_SUPABASE_URL")'));
  assert.match(deployContextSource, /deploy\?\.context === "production"/);
  assert.match(deployContextSource, /deploy\?\.published === true/);
  assert.doesNotMatch(deployContextSource, /Netlify\.env|getEnvironment|process\.env/);
  assert.ok(overviewSource.indexOf("if (!token || token === authorization)") < overviewSource.indexOf("admin.auth.getUser(token)"));
  assert.ok(
    overviewSource.indexOf('from("profiles")')
      < overviewSource.indexOf('"get_nowpayments_usdt_deposit_overview_snapshot"'),
  );
  assert.doesNotMatch(overviewSource, /NOWPAYMENTS_API_KEY|api\.nowpayments\.io/);
  assert.match(overviewSource, /\{ p_user_id: userId \}/);
  assert.doesNotMatch(
    overviewSource,
    /\.from\("(?:app_settings|nowpayments_usdt_config|nowpayments_usdt_wallets|nowpayments_usdt_payments|nowpayments_usdt_provider_payments)"\)/,
  );
  assert.equal(
    (overviewSource.match(/get_nowpayments_usdt_deposit_overview_snapshot/g) ?? []).length,
    1,
  );
  assert.match(overviewSource, /available_balance_usdt/);
  assert.match(overviewSource, /credited_amount_usdt/);
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

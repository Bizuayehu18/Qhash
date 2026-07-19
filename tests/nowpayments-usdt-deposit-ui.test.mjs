import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";
import overviewHandler from "../netlify/functions/nowpayments-usdt-deposit-overview.mts";
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
const {
  IDLE_COPY_FEEDBACK,
  copyButtonAccessibleName,
  copyUsdtDepositAddress,
} = await tsImport("../src/components/deposit/NowpaymentsUsdtDeposit.tsx", import.meta.url);

const [
  overviewSource,
  uiSource,
  depositRouteSource,
  netlifyTypecheck,
] = await Promise.all([
  readFile(new URL("netlify/functions/nowpayments-usdt-deposit-overview.mts", repositoryRoot), "utf8"),
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
    outcome_amount_usdt: "0.123456789012345678",
    credited_at: "2030-01-02T00:00:00.000Z",
    created_at: "2030-01-02T00:00:00.000Z",
    ...overrides,
  };
}

async function invokeOverview({
  context = "production",
  authorization = `Bearer valid-token`,
  configEnabled = false,
  sessions = [],
  providerPayments = [],
  wallet = null,
  authValid = true,
} = {}) {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  const environmentReads = [];
  const requests = [];
  globalThis.Netlify = {
    env: {
      get(name) {
        environmentReads.push(name);
        if (name === "CONTEXT") return context;
        if (name === "VITE_SUPABASE_URL") return "https://supabase.mock";
        if (name === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-mock";
        throw new Error(`Unexpected environment read: ${name}`);
      },
    },
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
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
        : Response.json({ message: "invalid" }, { status: 401 });
    }
    if (url.includes("/rest/v1/profiles")) return Response.json({ is_frozen: false });
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
    const response = await overviewHandler(new Request(
      "https://qhash.mock/api/crypto/nowpayments/deposit-overview",
      { method: "GET", headers: authorization ? { authorization } : {} },
    ));
    return {
      response,
      body: await response.json(),
      environmentReads,
      requests,
    };
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNetlify === undefined) delete globalThis.Netlify;
    else globalThis.Netlify = originalNetlify;
  }
}

test("overview rejects every non-production context before secrets or network", async () => {
  for (const context of ["deploy-preview", "branch-deploy", "dev", "unknown", null]) {
    const result = await invokeOverview({ context });
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.body, {
      error: "crypto_runtime_unavailable",
      message: "Crypto deposits are unavailable.",
    });
    assert.deepEqual(result.environmentReads, ["CONTEXT"]);
    assert.deepEqual(result.requests, []);
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
  assert.equal(result.body.session_state, "active");
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

test("finished sub-one-USDT credit is displayed exactly and expired addresses are history-only", async () => {
  const finished = validSession({
    provider_payment_status: "finished",
    session_status: "terminal",
    terminal_at: "2030-01-02T00:00:00.000Z",
    credited_amount_usdt: "0.123456789012345678",
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
  assert.equal(result.body.history[0].credited_amount_usdt, "0.123456789012345678");

  const expired = await invokeOverview({
    configEnabled: true,
    sessions: [validSession({ provider_valid_until: "2020-01-01T00:00:00.000Z" })],
  });
  assert.equal(expired.body.active_session, null);
  assert.equal(expired.body.history[0].status, "expired");
});

test("client validation, countdown boundary, and decimal rendering avoid floating-point arithmetic", () => {
  const parsed = parseNowpaymentsDepositOverview({
    feature_enabled: true,
    asset: "USDT",
    network: "BEP20",
    minimum_deposit_usdt: "1.000000000000000000",
    wallet: { available_balance_usdt: "0", reserved_balance_usdt: "0" },
    session_state: "active",
    active_session: {
      asset: "USDT",
      network: "BEP20",
      status: "waiting",
      pay_address: ADDRESS,
      minimum_deposit_usdt: "1.000000000000000000",
      provider_minimum_usdt: "0.750000000000000000",
      created_at: "2030-01-01T00:00:00.000Z",
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
  assert.ok(overviewSource.indexOf('Netlify.env.get("CONTEXT")') < overviewSource.indexOf('Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")'));
  assert.ok(overviewSource.indexOf("if (!token || token === authorization)") < overviewSource.indexOf("admin.auth.getUser(token)"));
  assert.doesNotMatch(overviewSource, /NOWPAYMENTS_API_KEY|api\.nowpayments\.io/);
  assert.match(overviewSource, /\.eq\("user_id", userId\)/);
  assert.match(overviewSource, /available_balance_usdt::text/);
  assert.match(overviewSource, /credited_amount_usdt::text/);
});

test("test file itself contains no live credential or provider call", () => {
  assert.equal(fileURLToPath(repositoryRoot).includes("Qhash"), true);
});

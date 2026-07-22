import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import overviewHandler from "../netlify/functions/nowpayments-usdt-withdrawal-overview.mts";
import requestHandler from "../netlify/functions/nowpayments-usdt-withdrawal-request.mts";
import {
  calculateWithdrawalPreview,
  createWithdrawalAttemptKeyManager,
  fetchNowpaymentsWithdrawalOverview,
  floorUsdtToSix,
  formatUsdtMicros,
  isMinimumWithdrawal,
  nowpaymentsWithdrawalStatusLabel,
  parseUsdtMicros,
  runSingleFlight,
  submitNowpaymentsWithdrawalRequest,
} from "../src/lib/nowpayments-withdrawal-ui.ts";

const root = new URL("../", import.meta.url);
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "33333333-3333-4333-8333-333333333333";
const BROADCAST_ID = "44444444-4444-4444-8444-444444444444";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER_ADDRESS = "0x2222222222222222222222222222222222222222";
const HASH = `0x${"a".repeat(64)}`;
const PUBLISHED_PRODUCTION_CONTEXT = { deploy: { context: "production", published: true } };

function validOverviewWithdrawal(overrides = {}) {
  return {
    user_id: USER_ID,
    destination_address: ADDRESS,
    gross_amount_usdt: "3.000000",
    fee_percent: "5.000000",
    fee_amount_usdt: "0.150000",
    net_amount_usdt: "2.850000",
    status: "broadcasted",
    requested_at: "2030-01-01T00:00:00.000Z",
    updated_at: "2030-01-02T00:00:00.000Z",
    broadcasted_at: "2030-01-02T00:00:00.000Z",
    completed_at: null,
    rejected_at: null,
    current_broadcast_id: BROADCAST_ID,
    ...overrides,
  };
}

function validRpcResult(overrides = {}) {
  return {
    withdrawal_id: ACTION_ID,
    destination_address: ADDRESS,
    status: "reserved",
    gross_amount_usdt: "3.000000",
    fee_amount_usdt: "0.150000",
    net_amount_usdt: "2.850000",
    available_balance_usdt: "6.000000000000000000",
    reserved_balance_usdt: "3.000000000000000000",
    ...overrides,
  };
}

async function withRuntime(options, operation) {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  const environmentReads = [];
  const requests = [];
  const rpcBodies = [];
  const state = options.rpcState ?? new Map();
  globalThis.Netlify = {
    env: {
      get(name) {
        environmentReads.push(name);
        if (name === "VITE_SUPABASE_URL") return "https://supabase.mock";
        if (name === "SUPABASE_URL") return "";
        if (name === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-mock";
        throw new Error(`Unexpected environment read: ${name}`);
      },
    },
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.startsWith("https://api.nowpayments.io") || url.includes("bscscan")) {
      throw new Error("Withdrawal user tests must not contact a provider or blockchain");
    }
    if (url.includes("/auth/v1/user")) {
      return options.authValid === false
        ? Response.json({ message: "sensitive auth error" }, { status: 401 })
        : Response.json({
            id: USER_ID,
            aud: "authenticated",
            role: "authenticated",
            email: "user@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2030-01-01T00:00:00.000Z",
          });
    }
    if (url.includes("/rest/v1/profiles")) {
      return Response.json(options.profile ?? { is_frozen: false, is_admin: false });
    }
    if (url.includes("/rest/v1/nowpayments_usdt_config")) {
      return Response.json({
        id: "USDT-BEP20",
        asset: "USDT",
        network: "BEP20",
        provider_currency: "usdtbsc",
        withdrawals_enabled: options.withdrawalsEnabled ?? false,
        withdrawal_minimum_usdt: "2.000000",
        withdrawal_fee_percent: "5.000000",
      });
    }
    if (url.includes("/rest/v1/nowpayments_usdt_wallets")) {
      return Response.json(options.wallet ?? {
        user_id: USER_ID,
        asset: "USDT",
        available_balance_usdt: "9.123456789000000000",
        reserved_balance_usdt: "0.000000000000000000",
      });
    }
    if (url.includes("/rest/v1/nowpayments_usdt_withdrawals")) {
      return Response.json(options.withdrawals ?? []);
    }
    if (url.includes("/rest/v1/nowpayments_usdt_withdrawal_broadcasts")) {
      return Response.json(options.broadcasts ?? [{ id: BROADCAST_ID, transaction_hash: HASH }]);
    }
    if (url.includes("/rest/v1/rpc/request_nowpayments_usdt_withdrawal")) {
      const rawBody = typeof init.body === "string" ? init.body : "{}";
      const body = JSON.parse(rawBody);
      rpcBodies.push(body);
      if (options.rpcError) {
        return Response.json(
          { code: "P0001", message: options.rpcError, details: null, hint: null },
          { status: 400 },
        );
      }
      const fingerprint = `${body.p_user_id}|${body.p_gross_amount_usdt}|${body.p_destination_address}`;
      const existing = state.get(body.p_request_id);
      if (existing && existing.fingerprint !== fingerprint) {
        return Response.json(
          { code: "P0001", message: "nowpayments_usdt_action_id_conflict", details: null, hint: null },
          { status: 400 },
        );
      }
      const result = existing?.result ?? options.rpcResult ?? validRpcResult({
        gross_amount_usdt: body.p_gross_amount_usdt,
      });
      state.set(body.p_request_id, { fingerprint, result });
      return Response.json(result);
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  try {
    return await operation({ environmentReads, requests, rpcBodies, rpcState: state });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  }
}

function overviewRequest(authorization = "Bearer valid-token") {
  return new Request("https://qhash.test/api/crypto/nowpayments/withdrawal-overview", {
    method: "GET",
    headers: authorization ? { authorization } : {},
  });
}

function withdrawalRequest(body, options = {}) {
  return new Request("https://qhash.test/api/crypto/nowpayments/withdrawal-request", {
    method: "POST",
    headers: {
      authorization: options.authorization ?? "Bearer valid-token",
      "content-type": options.contentType ?? "application/json",
      ...(options.contentLength ? { "content-length": options.contentLength } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validRequestBody(overrides = {}) {
  return {
    gross_amount_usdt: "3",
    destination_address: ADDRESS,
    idempotency_key: ACTION_ID,
    ...overrides,
  };
}

test("both endpoints fail closed outside a published production deploy before environment or network access", async () => {
  for (const context of [
    undefined,
    {},
    { deploy: {} },
    { deploy: { context: "production", published: false } },
    { deploy: { context: "deploy-preview", published: true } },
    { deploy: { context: "branch-deploy", published: true } },
    { deploy: { context: "dev", published: true } },
  ]) {
    await withRuntime({}, async ({ environmentReads, requests }) => {
      const overview = await overviewHandler(overviewRequest(), context);
      const submission = await requestHandler(withdrawalRequest(validRequestBody()), context);
      assert.equal(overview.status, 503);
      assert.equal(submission.status, 503);
      assert.deepEqual(environmentReads, []);
      assert.deepEqual(requests, []);
    });
  }
});

test("authentication failures and frozen profiles are denied without database financial access", async () => {
  await withRuntime({}, async ({ requests, rpcBodies }) => {
    const overview = await overviewHandler(overviewRequest(""), PUBLISHED_PRODUCTION_CONTEXT);
    const submission = await requestHandler(
      withdrawalRequest(validRequestBody(), { authorization: "" }),
      PUBLISHED_PRODUCTION_CONTEXT,
    );
    assert.equal(overview.status, 401);
    assert.equal(submission.status, 401);
    assert.equal(requests.length, 0);
    assert.equal(rpcBodies.length, 0);
  });
  await withRuntime({ profile: { is_frozen: true, is_admin: false } }, async ({ rpcBodies }) => {
    const overview = await overviewHandler(overviewRequest(), PUBLISHED_PRODUCTION_CONTEXT);
    const submission = await requestHandler(
      withdrawalRequest(validRequestBody()),
      PUBLISHED_PRODUCTION_CONTEXT,
    );
    assert.equal(overview.status, 403);
    assert.equal(submission.status, 403);
    assert.equal(rpcBodies.length, 0);
  });
});

test("overview is user-scoped, exact-string, readable while disabled, and sanitizes history", async () => {
  const withdrawal = validOverviewWithdrawal({
    initial_admin_id: OTHER_USER_ID,
    current_admin_id: OTHER_USER_ID,
    rejection_reason: "sensitive internal reason",
    internal_action_id: ACTION_ID,
  });
  await withRuntime({ withdrawals: [withdrawal] }, async ({ requests }) => {
    const response = await overviewHandler(overviewRequest(), PUBLISHED_PRODUCTION_CONTEXT);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.withdrawals_enabled, false);
    assert.equal(body.asset, "USDT");
    assert.equal(body.network, "BEP20");
    assert.equal(body.available_balance_usdt, "9.123456789000000000");
    assert.equal(body.reserved_balance_usdt, "0.000000000000000000");
    assert.deepEqual(Object.keys(body.history[0]).sort(), [
      "completed_at",
      "destination",
      "fee_amount_usdt",
      "gross_amount_usdt",
      "net_amount_usdt",
      "rejected_at",
      "rejection_message",
      "requested_at",
      "status",
      "transaction_hash",
      "updated_at",
    ]);
    assert.equal(body.history[0].transaction_hash, HASH);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /admin|sensitive|service-role|withdrawal_id|idempotency/i);
    const scopedUrls = requests
      .map((request) => request.url)
      .filter((url) => url.includes("nowpayments_usdt_wallets") || url.includes("nowpayments_usdt_withdrawals"));
    assert.equal(scopedUrls.length, 2);
    assert.ok(scopedUrls.every((url) => url.includes(`user_id=eq.${USER_ID}`)));
    assert.ok(scopedUrls.every((url) => !url.includes(OTHER_USER_ID)));
  });
});

test("overview rejects ownership drift and never exposes another user", async () => {
  await withRuntime(
    { withdrawals: [validOverviewWithdrawal({ user_id: OTHER_USER_ID })] },
    async () => {
      const response = await overviewHandler(overviewRequest(), PUBLISHED_PRODUCTION_CONTEXT);
      assert.equal(response.status, 503);
      assert.doesNotMatch(await response.text(), new RegExp(OTHER_USER_ID));
    },
  );
});

test("fixed-point helpers enforce six decimals, minimum, exact rounding, and Max flooring", () => {
  assert.equal(parseUsdtMicros("2"), 2_000_000n);
  assert.equal(parseUsdtMicros("2.000001"), 2_000_001n);
  assert.equal(parseUsdtMicros("2.0000001"), null);
  assert.equal(parseUsdtMicros("2e0"), null);
  assert.equal(parseUsdtMicros("02"), null);
  assert.equal(isMinimumWithdrawal("1.999999"), false);
  assert.equal(isMinimumWithdrawal("2"), true);
  assert.equal(floorUsdtToSix("9.123456999999999999"), "9.123456");
  assert.equal(floorUsdtToSix("9.999999999999999999"), "9.999999");
  const exact = calculateWithdrawalPreview("10");
  assert.equal(formatUsdtMicros(exact.feeMicros), "0.5");
  assert.equal(formatUsdtMicros(exact.netMicros), "9.5");
  const rounded = calculateWithdrawalPreview("2.00001");
  assert.equal(formatUsdtMicros(rounded.feeMicros), "0.100001");
  assert.equal(formatUsdtMicros(rounded.netMicros), "1.900009");
});

test("friendly status labels never describe send-locked or broadcasted as completed", () => {
  assert.equal(nowpaymentsWithdrawalStatusLabel("reserved"), "Submitted");
  assert.equal(nowpaymentsWithdrawalStatusLabel("reviewing"), "Under review");
  assert.equal(nowpaymentsWithdrawalStatusLabel("send_locked"), "Approved for sending");
  assert.equal(nowpaymentsWithdrawalStatusLabel("broadcasted"), "Sent — confirming");
  assert.equal(nowpaymentsWithdrawalStatusLabel("completed"), "Completed");
  assert.equal(nowpaymentsWithdrawalStatusLabel("rejected"), "Rejected — funds returned");
});

test("POST schema rejects wrong media types, oversized bodies, unknown fields, bad UUIDs, decimals, and addresses before RPC", async () => {
  const invalidRequests = [
    withdrawalRequest(validRequestBody(), { contentType: "text/plain" }),
    withdrawalRequest(validRequestBody(), { contentLength: "4097" }),
    withdrawalRequest({ ...validRequestBody(), user_id: USER_ID }),
    withdrawalRequest(validRequestBody({ idempotency_key: "not-a-uuid" })),
    withdrawalRequest(validRequestBody({ gross_amount_usdt: "2.0000001" })),
    withdrawalRequest(validRequestBody({ gross_amount_usdt: "2e0" })),
    withdrawalRequest(validRequestBody({ destination_address: "0x1234" })),
    withdrawalRequest("{not-json"),
  ];
  for (const request of invalidRequests) {
    await withRuntime({}, async ({ rpcBodies }) => {
      const response = await requestHandler(request, PUBLISHED_PRODUCTION_CONTEXT);
      assert.ok([400, 413, 415].includes(response.status));
      assert.equal(rpcBodies.length, 0);
    });
  }
});

test("POST derives the authenticated user and calls the deployed financial RPC exactly once", async () => {
  await withRuntime({ withdrawalsEnabled: true }, async ({ rpcBodies }) => {
    const response = await requestHandler(
      withdrawalRequest(validRequestBody()),
      PUBLISHED_PRODUCTION_CONTEXT,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(rpcBodies.length, 1);
    assert.deepEqual(rpcBodies[0], {
      p_user_id: USER_ID,
      p_request_id: ACTION_ID,
      p_gross_amount_usdt: "3",
      p_destination_address: ADDRESS,
    });
    const body = await response.json();
    assert.deepEqual(Object.keys(body).sort(), [
      "available_balance_usdt",
      "fee_amount_usdt",
      "gross_amount_usdt",
      "net_amount_usdt",
      "reserved_balance_usdt",
      "status",
    ]);
    assert.equal(body.withdrawal_id, undefined);
  });
});

test("exact retries preserve their result while changed payloads conflict", async () => {
  const rpcState = new Map();
  await withRuntime({ withdrawalsEnabled: true, rpcState }, async () => {
    const first = await requestHandler(withdrawalRequest(validRequestBody()), PUBLISHED_PRODUCTION_CONTEXT);
    const second = await requestHandler(withdrawalRequest(validRequestBody()), PUBLISHED_PRODUCTION_CONTEXT);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(await first.json(), await second.json());
    const changed = await requestHandler(
      withdrawalRequest(validRequestBody({ destination_address: OTHER_ADDRESS })),
      PUBLISHED_PRODUCTION_CONTEXT,
    );
    assert.equal(changed.status, 409);
    assert.equal((await changed.json()).error, "idempotency_conflict");
  });
});

test("database-authoritative disabled, minimum, balance, and prohibited-destination failures are sanitized", async () => {
  const cases = [
    ["nowpayments_usdt_withdrawals_disabled", 503, "crypto_withdrawals_disabled"],
    ["invalid_nowpayments_usdt_withdrawal_request", 400, "invalid_withdrawal_request"],
    ["insufficient_nowpayments_usdt_available_balance", 409, "insufficient_balance"],
    ["qhash_controlled_withdrawal_destination", 400, "invalid_destination"],
  ];
  for (const [rpcError, status, publicError] of cases) {
    await withRuntime({ rpcError }, async ({ rpcBodies }) => {
      const response = await requestHandler(
        withdrawalRequest(validRequestBody({ gross_amount_usdt: rpcError.includes("invalid_") ? "1.999999" : "3" })),
        PUBLISHED_PRODUCTION_CONTEXT,
      );
      assert.equal(response.status, status);
      assert.equal(rpcBodies.length, 1);
      const body = await response.json();
      assert.equal(body.error, publicError);
      assert.doesNotMatch(JSON.stringify(body), new RegExp(rpcError));
    });
  }
});

test("single-flight prevents double submission and attempt keys persist only for the same deliberate payload", async () => {
  let calls = 0;
  let release;
  const holder = { current: null };
  const operation = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const first = runSingleFlight(holder, operation);
  const second = runSingleFlight(holder, operation);
  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  release("ok");
  await first;

  const keys = [ACTION_ID, BROADCAST_ID];
  const manager = createWithdrawalAttemptKeyManager(() => keys.shift());
  assert.equal(manager.keyFor("3", ADDRESS), ACTION_ID);
  assert.equal(manager.keyFor("3", ADDRESS.toUpperCase().replace("0X", "0x")), ACTION_ID);
  assert.equal(manager.keyFor("4", ADDRESS), BROADCAST_ID);
});

test("browser helpers call only QHash endpoints and reject disabled requests without leaking response details", async () => {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("withdrawal-overview")) {
      return Response.json({
        withdrawals_enabled: false,
        asset: "USDT",
        network: "BEP20",
        available_balance_usdt: "9.000000000000000000",
        reserved_balance_usdt: "0.000000000000000000",
        minimum_withdrawal_usdt: "2.000000",
        withdrawal_fee_percent: "5.000000",
        history: [],
      });
    }
    return Response.json(
      { error: "crypto_withdrawals_disabled", message: "internal detail" },
      { status: 503 },
    );
  };
  const overview = await fetchNowpaymentsWithdrawalOverview("token", request);
  assert.equal(overview.withdrawals_enabled, false);
  await assert.rejects(
    submitNowpaymentsWithdrawalRequest("token", validRequestBody(), request),
    (error) => error?.kind === "disabled" && !error.message.includes("internal detail"),
  );
  assert.deepEqual(calls.map((call) => call.url), [
    "/api/crypto/nowpayments/withdrawal-overview",
    "/api/crypto/nowpayments/withdrawal-request",
  ]);
});

test("source boundaries contain no provider, signing, payout, client database, or sensitive logging path", async () => {
  const [overviewSource, requestSource, uiSource, uiLibSource, withdrawRoute, depositRoute, typecheck] =
    await Promise.all([
      readFile(new URL("netlify/functions/nowpayments-usdt-withdrawal-overview.mts", root), "utf8"),
      readFile(new URL("netlify/functions/nowpayments-usdt-withdrawal-request.mts", root), "utf8"),
      readFile(new URL("src/components/withdrawal/NowpaymentsUsdtWithdrawal.tsx", root), "utf8"),
      readFile(new URL("src/lib/nowpayments-withdrawal-ui.ts", root), "utf8"),
      readFile(new URL("src/routes/_app/withdraw.tsx", root), "utf8"),
      readFile(new URL("src/routes/_app/deposit.tsx", root), "utf8"),
      readFile(new URL("tsconfig.netlify.json", root), "utf8"),
    ]);
  const serverSource = `${overviewSource}\n${requestSource}`;
  const clientSource = `${uiSource}\n${uiLibSource}`;
  assert.doesNotMatch(serverSource, /NOWPAYMENTS_API_KEY|api\.nowpayments|payout|private.?key|seed.?phrase|signTransaction|eth_sendTransaction/i);
  assert.doesNotMatch(clientSource, /SUPABASE_SERVICE_ROLE_KEY|createClient|\.from\(|\.rpc\(|api\.nowpayments|bscscan|private.?key|seed.?phrase|signTransaction/i);
  assert.doesNotMatch(serverSource, /console\.(log|info|warn|error)|authorization.*console|request\.headers.*console/i);
  assert.match(requestSource, /\.rpc\("request_nowpayments_usdt_withdrawal"/);
  assert.equal((requestSource.match(/\.rpc\("request_nowpayments_usdt_withdrawal"/g) ?? []).length, 1);
  assert.match(uiSource, /BigInt|formatUsdtMicros/);
  assert.doesNotMatch(uiSource, /Number\(|parseFloat|parseInt/);
  assert.match(withdrawRoute, /submitWithdrawalFn/);
  assert.match(withdrawRoute, /CBE Withdrawal/);
  assert.match(withdrawRoute, /TeleBirr Withdrawal/);
  assert.match(depositRoute, /NowpaymentsUsdtDeposit/);
  assert.match(typecheck, /nowpayments-usdt-withdrawal-overview\.mts/);
  assert.match(typecheck, /nowpayments-usdt-withdrawal-request\.mts/);
});

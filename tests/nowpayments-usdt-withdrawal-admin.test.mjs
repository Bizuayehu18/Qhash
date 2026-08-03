import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import adminHandler from "../netlify/functions/nowpayments-usdt-withdrawal-admin.mts";
import {
  createAdminWithdrawalActionKeyManager,
  createAdminWithdrawalActionLifecycle,
  createLatestAdminWithdrawalRequestGuard,
  fetchNowpaymentsAdminWithdrawalOverview,
  formatAdminUsdtSix,
  parseNowpaymentsAdminWithdrawalOverview,
  runAdminWithdrawalSingleFlight,
  submitNowpaymentsAdminWithdrawalAction,
} from "../src/lib/nowpayments-withdrawal-admin-ui.ts";

const root = new URL("../", import.meta.url);
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ADMIN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const WITHDRAWAL_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_WITHDRAWAL_ID = "44444444-4444-4444-8444-444444444444";
const BROADCAST_ID = "55555555-5555-4555-8555-555555555555";
const ACTION_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_ACTION_ID = "77777777-7777-4777-8777-777777777777";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"a".repeat(64)}`;
const PUBLISHED_PRODUCTION_CONTEXT = { deploy: { context: "production", published: true } };

function validWithdrawal(overrides = {}) {
  return {
    id: WITHDRAWAL_ID,
    user_id: USER_ID,
    destination_address: ADDRESS,
    gross_amount_usdt: "2.000000",
    fee_percent: "5.0000",
    fee_amount_usdt: "0.100000",
    net_amount_usdt: "1.900000",
    status: "reviewing",
    requested_at: "2030-01-01T00:00:00.000Z",
    current_broadcast_id: null,
    ...overrides,
  };
}

function validCompleteResult(overrides = {}) {
  return {
    withdrawal_id: WITHDRAWAL_ID,
    status: "completed",
    gross_amount_usdt: "2.000000",
    fee_amount_usdt: "0.100000",
    net_amount_usdt: "1.900000",
    available_balance_usdt: "7.000000000000000000",
    reserved_balance_usdt: "0.000000000000000000",
    ...overrides,
  };
}

function validRejectResult(overrides = {}) {
  return {
    withdrawal_id: WITHDRAWAL_ID,
    status: "rejected",
    available_balance_usdt: "9.000000000000000000",
    reserved_balance_usdt: "0.000000000000000000",
    ...overrides,
  };
}

async function withRuntime(options, operation) {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  const requests = [];
  const rpcCalls = [];
  globalThis.Netlify = {
    env: {
      get(name) {
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
    if (
      url.includes("nowpayments.io")
      || url.includes("bscscan")
      || url.includes("etherscan")
    ) {
      throw new Error("Administrator tests must not contact a provider or blockchain");
    }
    if (url.includes("/auth/v1/user")) {
      return options.authValid === false
        ? Response.json({ message: "private auth detail" }, { status: 401 })
        : Response.json({
            id: options.authUserId ?? ADMIN_ID,
            aud: "authenticated",
            role: "authenticated",
            email: "admin@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2030-01-01T00:00:00.000Z",
          });
    }
    if (url.includes("/rest/v1/profiles")) {
      if (url.includes("is_admin")) {
        return Response.json(options.adminProfile ?? {
          id: ADMIN_ID,
          is_admin: true,
          is_frozen: false,
        });
      }
      return Response.json(options.profiles ?? [{
        id: USER_ID,
        username: "ordinary-user",
      }]);
    }
    if (url.includes("/rest/v1/nowpayments_usdt_config")) {
      return Response.json({
        id: "USDT-BEP20",
        asset: "USDT",
        network: "BEP20",
        provider_currency: "usdtbsc",
        withdrawals_enabled: options.withdrawalsEnabled ?? false,
      });
    }
    if (url.includes("/rest/v1/nowpayments_usdt_withdrawals")) {
      return Response.json(options.withdrawals ?? [validWithdrawal()]);
    }
    if (url.includes("/rest/v1/nowpayments_usdt_withdrawal_broadcasts")) {
      return Response.json(options.broadcasts ?? []);
    }
    if (
      url.includes("/rest/v1/rpc/complete_nowpayments_usdt_withdrawal_manual")
      || url.includes("/rest/v1/rpc/reject_nowpayments_usdt_withdrawal_manual")
    ) {
      const body = JSON.parse(typeof init.body === "string" ? init.body : "{}");
      rpcCalls.push({
        name: url.split("/rpc/")[1]?.split("?")[0],
        body,
      });
      if (options.rpcError) {
        return Response.json(
          { code: "P0001", message: options.rpcError, details: null, hint: null },
          { status: 400 },
        );
      }
      return Response.json(
        url.includes("complete_")
          ? (options.rpcResult ?? validCompleteResult({
              ...(body.p_transaction_hash ? { transaction_hash: body.p_transaction_hash } : {}),
            }))
          : (options.rpcResult ?? validRejectResult()),
      );
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  try {
    return await operation({ requests, rpcCalls });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  }
}

function adminRequest(method, body, authorization = "Bearer valid-token") {
  return new Request("https://qhash.test/api/admin/crypto/nowpayments/withdrawals", {
    method,
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

function completeBody(overrides = {}) {
  return {
    action: "complete",
    withdrawal_id: WITHDRAWAL_ID,
    action_id: ACTION_ID,
    transaction_hash: null,
    ...overrides,
  };
}

function rejectBody(overrides = {}) {
  return {
    action: "reject",
    withdrawal_id: WITHDRAWAL_ID,
    action_id: ACTION_ID,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test("runtime, authentication, and administrator eligibility fail closed before financial access", async () => {
  let environmentRead = false;
  const originalNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get() { environmentRead = true; return ""; } } };
  try {
    const response = await adminHandler(adminRequest("GET"), {
      deploy: { context: "deploy-preview", published: true },
    });
    assert.equal(response.status, 503);
    assert.equal(environmentRead, false);
  } finally {
    globalThis.Netlify = originalNetlify;
  }

  for (const options of [
    { authValid: false },
    { adminProfile: { id: ADMIN_ID, is_admin: false, is_frozen: false } },
    { adminProfile: { id: ADMIN_ID, is_admin: true, is_frozen: true } },
  ]) {
    await withRuntime(options, async ({ rpcCalls }) => {
      const response = await adminHandler(adminRequest("GET"), PUBLISHED_PRODUCTION_CONTEXT);
      assert.ok(response.status === 401 || response.status === 403);
      assert.equal(rpcCalls.length, 0);
      assert.doesNotMatch(JSON.stringify(await response.json()), /private auth detail/i);
    });
  }
});

test("overview exposes only the simplified admin record and optional private audit hash", async () => {
  await withRuntime({
    withdrawalsEnabled: false,
    withdrawals: [validWithdrawal({
      status: "completed",
      current_broadcast_id: BROADCAST_ID,
    })],
    broadcasts: [{
      id: BROADCAST_ID,
      withdrawal_id: WITHDRAWAL_ID,
      transaction_hash: HASH,
    }],
  }, async () => {
    const response = await adminHandler(adminRequest("GET"), PUBLISHED_PRODUCTION_CONTEXT);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.withdrawals_enabled, false);
    assert.deepEqual(Object.keys(body.withdrawals[0]).sort(), [
      "destination_address",
      "fee_amount_usdt",
      "gross_amount_usdt",
      "id",
      "net_amount_usdt",
      "requested_at",
      "status",
      "transaction_hash",
      "username",
    ]);
    assert.equal(body.withdrawals[0].status, "completed");
    assert.equal(body.withdrawals[0].transaction_hash, HASH);
    assert.doesNotMatch(JSON.stringify(body), /user_id|current_broadcast_id|verification|confirmations/);
  });
});

test("overview maps every internal nonterminal state to pending", async () => {
  for (const status of ["reserved", "reviewing", "send_locked", "broadcasted"]) {
    await withRuntime({
      withdrawals: [validWithdrawal({
        status,
        current_broadcast_id: status === "broadcasted" ? BROADCAST_ID : null,
      })],
      broadcasts: status === "broadcasted" ? [{
        id: BROADCAST_ID,
        withdrawal_id: WITHDRAWAL_ID,
        transaction_hash: HASH,
      }] : [],
    }, async () => {
      const response = await adminHandler(adminRequest("GET"), PUBLISHED_PRODUCTION_CONTEXT);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).withdrawals[0].status, "pending");
    });
  }
});

test("overview fails closed for missing, duplicate, or cross-withdrawal broadcast relationships", async () => {
  const cases = [
    [],
    [{
      id: BROADCAST_ID,
      withdrawal_id: OTHER_WITHDRAWAL_ID,
      transaction_hash: HASH,
    }],
    [
      { id: BROADCAST_ID, withdrawal_id: WITHDRAWAL_ID, transaction_hash: HASH },
      { id: BROADCAST_ID, withdrawal_id: WITHDRAWAL_ID, transaction_hash: HASH },
    ],
  ];
  for (const broadcasts of cases) {
    await withRuntime({
      withdrawals: [validWithdrawal({
        status: "completed",
        current_broadcast_id: BROADCAST_ID,
      })],
      broadcasts,
    }, async () => {
      const response = await adminHandler(adminRequest("GET"), PUBLISHED_PRODUCTION_CONTEXT);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: "withdrawal_admin_unavailable",
        message: "USDT withdrawals are unavailable.",
      });
    });
  }
});

test("Complete works with no hash or one normalized valid hash and calls only the new RPC", async () => {
  for (const transactionHash of [null, HASH.toUpperCase().replace("0X", "0x")]) {
    await withRuntime({}, async ({ rpcCalls }) => {
      const response = await adminHandler(
        adminRequest("POST", completeBody({ transaction_hash: transactionHash })),
        PUBLISHED_PRODUCTION_CONTEXT,
      );
      assert.equal(response.status, 200);
      const normalized = transactionHash?.toLowerCase() ?? null;
      assert.deepEqual(rpcCalls, [{
        name: "complete_nowpayments_usdt_withdrawal_manual",
        body: {
          p_withdrawal_id: WITHDRAWAL_ID,
          p_admin_id: ADMIN_ID,
          p_action_id: ACTION_ID,
          p_transaction_hash: normalized,
        },
      }]);
      const body = await response.json();
      assert.equal(body.status, "completed");
      assert.equal(body.net_amount_usdt, "1.900000");
      assert.equal(body.transaction_hash, normalized);
      assert.doesNotMatch(JSON.stringify(body), /withdrawal_id|admin_id|verification/);
    });
  }
});

test("invalid optional hash and unknown fields fail before any RPC", async () => {
  for (const body of [
    completeBody({ transaction_hash: "0x1234" }),
    completeBody({ transaction_hash: HASH, extra: true }),
    completeBody({ transaction_hash: ` ${HASH}` }),
  ]) {
    await withRuntime({}, async ({ rpcCalls }) => {
      const response = await adminHandler(
        adminRequest("POST", body),
        PUBLISHED_PRODUCTION_CONTEXT,
      );
      assert.equal(response.status, 400);
      assert.equal(rpcCalls.length, 0);
    });
  }
});

test("Reject calls only the new atomic release RPC and returns a simple result", async () => {
  await withRuntime({}, async ({ rpcCalls }) => {
    const response = await adminHandler(
      adminRequest("POST", rejectBody()),
      PUBLISHED_PRODUCTION_CONTEXT,
    );
    assert.equal(response.status, 200);
    assert.deepEqual(rpcCalls, [{
      name: "reject_nowpayments_usdt_withdrawal_manual",
      body: {
        p_withdrawal_id: WITHDRAWAL_ID,
        p_admin_id: ADMIN_ID,
        p_action_id: ACTION_ID,
      },
    }]);
    assert.deepEqual(await response.json(), {
      status: "rejected",
      available_balance_usdt: "9.000000000000000000",
      reserved_balance_usdt: "0.000000000000000000",
    });
  });
});

test("action conflicts and raw database errors are sanitized", async () => {
  for (const [rpcError, status, publicError] of [
    ["nowpayments_usdt_action_id_conflict private", 409, "idempotency_conflict"],
    ["invalid_nowpayments_usdt_withdrawal_owner_or_state private", 409, "withdrawal_state_conflict"],
    ["unexpected database secret", 500, "withdrawal_action_failed"],
  ]) {
    await withRuntime({ rpcError }, async () => {
      const response = await adminHandler(
        adminRequest("POST", rejectBody()),
        PUBLISHED_PRODUCTION_CONTEXT,
      );
      assert.equal(response.status, status);
      const body = await response.json();
      assert.equal(body.error, publicError);
      assert.doesNotMatch(JSON.stringify(body), /private|database secret/i);
    });
  }
});

test("browser helpers validate simplified responses and use only QHash Functions", async () => {
  const calls = [];
  const overview = await fetchNowpaymentsAdminWithdrawalOverview(
    "token",
    async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        withdrawals_enabled: false,
        asset: "USDT",
        network: "BEP20",
        withdrawals: [{
          id: WITHDRAWAL_ID,
          username: "ordinary-user",
          status: "pending",
          destination_address: ADDRESS,
          gross_amount_usdt: "2.000000",
          fee_amount_usdt: "0.100000",
          net_amount_usdt: "1.900000",
          requested_at: "2030-01-01T00:00:00.000Z",
          transaction_hash: null,
        }],
      });
    },
  );
  assert.equal(overview.withdrawals[0].status, "pending");

  const action = await submitNowpaymentsAdminWithdrawalAction(
    "token",
    rejectBody(),
    async (url, init) => {
      calls.push({ url, init });
      return Response.json(validRejectResult());
    },
  );
  assert.equal(action.status, "rejected");
  assert.ok(calls.every(({ url }) => String(url).startsWith("/api/")));
  assert.ok(calls.every(({ init }) => init.headers.authorization === "Bearer token"));
});

test("parser rejects internal states and malformed or mismatched financial results", () => {
  const value = {
    withdrawals_enabled: false,
    asset: "USDT",
    network: "BEP20",
    withdrawals: [{
      id: WITHDRAWAL_ID,
      username: "ordinary-user",
      status: "reviewing",
      destination_address: ADDRESS,
      gross_amount_usdt: "2",
      fee_amount_usdt: "0.1",
      net_amount_usdt: "1.9",
      requested_at: "2030-01-01T00:00:00.000Z",
      transaction_hash: null,
    }],
  };
  assert.throws(() => parseNowpaymentsAdminWithdrawalOverview(value));
  value.withdrawals[0].status = "pending";
  value.withdrawals[0].net_amount_usdt = "1.8";
  assert.throws(() => parseNowpaymentsAdminWithdrawalOverview(value));
});

test("latest overview guard prevents stale cross-auth commits", async () => {
  const guard = createLatestAdminWithdrawalRequestGuard();
  const adminA = { userId: ADMIN_ID };
  const adminB = { userId: OTHER_ADMIN_ID };
  const first = guard.begin(adminA);
  const second = guard.begin(adminB);
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  guard.invalidate();
  assert.equal(second.signal.aborted, true);
});

test("action lifecycle isolates administrator and token generations", async () => {
  const keys = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const pendingA = deferred();
  const busyA = [];
  const lifecycleA = createAdminWithdrawalActionLifecycle(
    { userId: ADMIN_ID, tokenGeneration: 1 },
    () => keys[0],
  );
  let actionIdA;
  const runA = lifecycleA.run(
    `complete|${WITHDRAWAL_ID}|`,
    async ({ actionId }) => {
      actionIdA = actionId;
      await pendingA.promise;
    },
    (value) => busyA.push(value),
  );
  assert.equal(lifecycleA.isBusy(), true);

  lifecycleA.invalidate();
  const busyB = [];
  const lifecycleB = createAdminWithdrawalActionLifecycle(
    { userId: OTHER_ADMIN_ID, tokenGeneration: 2 },
    () => keys[1],
  );
  let actionIdB;
  await lifecycleB.run(
    `complete|${WITHDRAWAL_ID}|`,
    async ({ actionId }) => {
      actionIdB = actionId;
    },
    (value) => busyB.push(value),
  );
  assert.notEqual(actionIdA, actionIdB);
  assert.deepEqual(busyB, [true, false]);
  pendingA.resolve();
  await runA;
  assert.deepEqual(busyA, [true]);
  assert.equal(lifecycleB.isBusy(), false);
});

test("late success, failure, and finally from an invalidated generation cannot affect the next one", async () => {
  for (const outcome of ["success", "failure"]) {
    const pending = deferred();
    const oldBusy = [];
    const nextBusy = [];
    const old = createAdminWithdrawalActionLifecycle(
      { userId: ADMIN_ID, tokenGeneration: 1 },
      () => ACTION_ID,
    );
    const run = old.run(
      `reject|${WITHDRAWAL_ID}`,
      async () => {
        await pending.promise;
        if (outcome === "failure") throw new Error("late failure");
      },
      (value) => oldBusy.push(value),
    );
    old.invalidate();
    const next = createAdminWithdrawalActionLifecycle(
      { userId: ADMIN_ID, tokenGeneration: 2 },
      () => OTHER_ACTION_ID,
    );
    await next.run(
      `reject|${WITHDRAWAL_ID}`,
      async () => undefined,
      (value) => nextBusy.push(value),
    );
    outcome === "failure" ? pending.resolve() : pending.resolve();
    if (outcome === "failure") await assert.rejects(run);
    else await run;
    assert.deepEqual(oldBusy, [true]);
    assert.deepEqual(nextBusy, [true, false]);
    assert.equal(next.isBusy(), false);
  }
});

test("same-generation exact retries reuse keys while changed action or payload uses a new key", () => {
  const values = [
    ACTION_ID,
    OTHER_ACTION_ID,
    "88888888-8888-4888-8888-888888888888",
  ];
  let index = 0;
  const manager = createAdminWithdrawalActionKeyManager(() => values[index++]);
  assert.equal(manager.keyFor(`complete|${WITHDRAWAL_ID}|${HASH}`), ACTION_ID);
  assert.equal(manager.keyFor(`complete|${WITHDRAWAL_ID}|${HASH}`), ACTION_ID);
  assert.equal(manager.keyFor(`complete|${WITHDRAWAL_ID}|`), OTHER_ACTION_ID);
  assert.equal(manager.keyFor(`reject|${WITHDRAWAL_ID}`), values[2]);
});

test("single-flight permits only one active POST-equivalent operation", async () => {
  const holder = { current: null };
  const pending = deferred();
  let calls = 0;
  const operation = () => {
    calls += 1;
    return pending.promise;
  };
  const first = runAdminWithdrawalSingleFlight(holder, operation);
  const second = runAdminWithdrawalSingleFlight(holder, operation);
  assert.equal(first, second);
  assert.equal(calls, 1);
  pending.resolve("done");
  assert.equal(await first, "done");
});

test("canonical source exposes only Complete and Reject and contains no provider, signing, or direct-write path", async () => {
  const [handler, panel, card, dialog, controller, userOverview, migration] = await Promise.all([
    readFile(new URL("netlify/functions/nowpayments-usdt-withdrawal-admin.mts", root), "utf8"),
    readFile(
      new URL(
        "src/domains/withdrawals/ui/admin/AdminUsdtBep20WithdrawalOperationsPanel.tsx",
        root,
      ),
      "utf8",
    ),
    readFile(
      new URL("src/domains/withdrawals/ui/admin/AdminUsdtWithdrawalCard.tsx", root),
      "utf8",
    ),
    readFile(
      new URL(
        "src/domains/withdrawals/ui/admin/AdminUsdtWithdrawalActionDialog.tsx",
        root,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "src/domains/withdrawals/ui/admin/useAdminUsdtWithdrawalOperations.ts",
        root,
      ),
      "utf8",
    ),
    readFile(new URL("netlify/functions/nowpayments-usdt-withdrawal-overview.mts", root), "utf8"),
    readFile(
      new URL(
        "supabase/migrations/20260724120000_nowpayments_simplified_manual_usdt_withdrawal/migration.sql",
        root,
      ),
      "utf8",
    ),
  ]);
  assert.match(handler, /complete_nowpayments_usdt_withdrawal_manual/);
  assert.match(handler, /reject_nowpayments_usdt_withdrawal_manual/);
  assert.match(panel, /AdminUsdtWithdrawalList/);
  assert.match(panel, /AdminUsdtWithdrawalActionDialog/);
  assert.match(card, /withdrawal\.status === "pending"/);
  assert.match(card, />\s*Complete\s*</);
  assert.match(card, />\s*Reject\s*</);
  assert.match(dialog, /Public BSC transaction hash \(optional\)/);
  assert.match(controller, /action: "complete"/);
  assert.match(controller, /action: "reject"/);
  assert.doesNotMatch(
    `${panel}\n${card}\n${dialog}\n${controller}`,
    /begin_review|send_lock|record_broadcast|confirmations|block_number|log_index/,
  );
  assert.doesNotMatch(
    `${handler}\n${panel}\n${card}\n${dialog}\n${controller}`,
    /api\.nowpayments|bscscan|etherscan|private[_ -]?key|seed phrase|mnemonic|signTransaction|payout/i,
  );
  assert.doesNotMatch(
    userOverview,
    /transaction_hash|current_broadcast|verification|provider_payment|provider_identifier/,
  );
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = pg_catalog, public/);
  assert.doesNotMatch(handler, /\.insert\(|\.update\(|\.delete\(/);
});

test("display helper preserves exact six-decimal values without floating point", () => {
  assert.equal(formatAdminUsdtSix("123456789012345678.123456"), "123,456,789,012,345,678.123456");
});

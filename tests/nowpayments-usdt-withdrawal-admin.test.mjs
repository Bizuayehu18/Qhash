import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import adminHandler from "../netlify/functions/nowpayments-usdt-withdrawal-admin.mts";
import {
  createAdminWithdrawalActionKeyManager,
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
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const WITHDRAWAL_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_WITHDRAWAL_ID = "44444444-4444-4444-8444-444444444444";
const BROADCAST_ID = "55555555-5555-4555-8555-555555555555";
const ACTION_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_ACTION_ID = "77777777-7777-4777-8777-777777777777";
const ADDRESS = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"a".repeat(64)}`;
const TOKEN_CONTRACT = "0x55d398326f99059ff775485246999027b3197955";
const PUBLISHED_PRODUCTION_CONTEXT = { deploy: { context: "production", published: true } };

function validWithdrawal(overrides = {}) {
  return {
    id: WITHDRAWAL_ID,
    user_id: USER_ID,
    destination_address: ADDRESS,
    asset: "USDT",
    network: "BEP20",
    provider_currency: "usdtbsc",
    gross_amount_usdt: "10.000000",
    fee_percent: "5.0000",
    fee_amount_usdt: "0.500000",
    net_amount_usdt: "9.500000",
    status: "broadcasted",
    requested_at: "2030-01-01T00:00:00.000Z",
    initial_admin_id: ADMIN_ID,
    current_admin_id: ADMIN_ID,
    claimed_at: "2030-01-01T01:00:00.000Z",
    send_locked_at: "2030-01-01T02:00:00.000Z",
    broadcasted_at: "2030-01-01T03:00:00.000Z",
    completed_at: null,
    rejected_at: null,
    rejection_reason: null,
    current_broadcast_id: BROADCAST_ID,
    created_at: "2030-01-01T00:00:00.000Z",
    updated_at: "2030-01-01T03:00:00.000Z",
    ...overrides,
  };
}

function validProfiles(overrides = []) {
  return [
    { id: USER_ID, username: "ordinary-user", is_admin: false, is_frozen: false },
    { id: ADMIN_ID, username: "admin-user", is_admin: true, is_frozen: false },
    ...overrides,
  ];
}

function event(id, actionId, actionType, fromStatus, toStatus, actorId, createdAt, result = {}) {
  return {
    id,
    withdrawal_id: WITHDRAWAL_ID,
    user_id: USER_ID,
    actor_id: actorId,
    action_id: actionId,
    action_type: actionType,
    from_status: fromStatus,
    to_status: toStatus,
    result_snapshot: {
      withdrawal_id: WITHDRAWAL_ID,
      status: toStatus,
      ...result,
    },
    created_at: createdAt,
  };
}

function validEvents() {
  return [
    event(
      "81000000-0000-4000-8000-000000000001",
      "82000000-0000-4000-8000-000000000001",
      "request",
      null,
      "reserved",
      USER_ID,
      "2030-01-01T00:00:00.000Z",
    ),
    event(
      "81000000-0000-4000-8000-000000000002",
      "82000000-0000-4000-8000-000000000002",
      "claim_review",
      "reserved",
      "reviewing",
      ADMIN_ID,
      "2030-01-01T01:00:00.000Z",
    ),
    event(
      "81000000-0000-4000-8000-000000000003",
      "82000000-0000-4000-8000-000000000003",
      "send_lock",
      "reviewing",
      "send_locked",
      ADMIN_ID,
      "2030-01-01T02:00:00.000Z",
    ),
    event(
      "81000000-0000-4000-8000-000000000004",
      "82000000-0000-4000-8000-000000000004",
      "record_broadcast",
      "send_locked",
      "broadcasted",
      ADMIN_ID,
      "2030-01-01T03:00:00.000Z",
      { broadcast_id: BROADCAST_ID, transaction_hash: HASH },
    ),
  ];
}

function validBroadcast(overrides = {}) {
  return {
    id: BROADCAST_ID,
    withdrawal_id: WITHDRAWAL_ID,
    recorded_by: ADMIN_ID,
    transaction_hash: HASH,
    destination_address: ADDRESS,
    net_amount_usdt: "9.500000",
    supersedes_broadcast_id: null,
    correction_reason: null,
    recorded_at: "2030-01-01T03:00:00.000Z",
    ...overrides,
  };
}

function validPublicOverview(overrides = {}) {
  return {
    withdrawals_enabled: false,
    asset: "USDT",
    network: "BEP20",
    minimum_withdrawal_usdt: "2.000000",
    withdrawal_fee_percent: "5.0000",
    required_confirmations: 120,
    withdrawals: [{
      id: WITHDRAWAL_ID,
      username: "ordinary-user",
      destination_address: ADDRESS,
      gross_amount_usdt: "10.000000",
      fee_amount_usdt: "0.500000",
      net_amount_usdt: "9.500000",
      status: "broadcasted",
      requested_at: "2030-01-01T00:00:00.000Z",
      claimed_at: "2030-01-01T01:00:00.000Z",
      send_locked_at: "2030-01-01T02:00:00.000Z",
      broadcasted_at: "2030-01-01T03:00:00.000Z",
      completed_at: null,
      rejected_at: null,
      rejection_reason: null,
      assigned_to_current_admin: true,
      events: [
        ["request", null, "reserved", "2030-01-01T00:00:00.000Z"],
        ["claim_review", "reserved", "reviewing", "2030-01-01T01:00:00.000Z"],
        ["send_lock", "reviewing", "send_locked", "2030-01-01T02:00:00.000Z"],
        ["record_broadcast", "send_locked", "broadcasted", "2030-01-01T03:00:00.000Z"],
      ].map(([action, from_status, to_status, created_at]) => ({
        action,
        from_status,
        to_status,
        created_at,
      })),
      broadcasts: [{
        transaction_hash: HASH,
        recorded_at: "2030-01-01T03:00:00.000Z",
        is_current: true,
        correction_reason: null,
      }],
      verification: null,
    }],
    ...overrides,
  };
}

function validActionBody(action, overrides = {}) {
  const common = {
    action,
    withdrawal_id: WITHDRAWAL_ID,
    action_id: ACTION_ID,
  };
  if (action === "begin_review") return { ...common, ...overrides };
  if (action === "reject") return { ...common, reason: "Destination could not be verified", ...overrides };
  if (action === "send_lock") {
    return {
      ...common,
      external_liquidity_confirmed: true,
      destination_manually_verified: true,
      irreversible_send_confirmed: true,
      ...overrides,
    };
  }
  if (action === "record_broadcast") {
    return {
      ...common,
      transaction_hash: HASH,
      correction_reason: null,
      ...overrides,
    };
  }
  return {
    ...common,
    transaction_hash: HASH,
    chain_id: 56,
    token_contract: TOKEN_CONTRACT,
    transaction_success: true,
    exactly_one_matching_transfer: true,
    destination_address: ADDRESS,
    net_amount_usdt: "9.500000",
    block_number: 12345678,
    transfer_log_index: 2,
    confirmations: 120,
    verified_at: "2026-07-23T12:00:00.000Z",
    ...overrides,
  };
}

function adminRequest(method = "GET", body, options = {}) {
  return new Request("https://qhash.test/api/admin/crypto/nowpayments/usdt-withdrawals", {
    method,
    headers: {
      ...(options.authorization === "" ? {} : {
        authorization: options.authorization ?? "Bearer valid-token",
      }),
      ...(method === "POST" ? {
        "content-type": options.contentType ?? "application/json",
      } : {}),
      ...(options.contentLength ? { "content-length": options.contentLength } : {}),
    },
    ...(method === "POST" ? {
      body: typeof body === "string" ? body : JSON.stringify(body),
    } : {}),
  });
}

async function withRuntime(options, operation) {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  const environmentReads = [];
  const requests = [];
  const rpcCalls = [];
  const actionState = options.actionState ?? new Map();
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
    if (
      url.includes("api.nowpayments")
      || url.includes("bscscan")
      || url.includes("eth_send")
      || url.includes("payout")
    ) {
      throw new Error("Administrator withdrawal tests must not contact an external provider");
    }
    if (url.includes("/auth/v1/user")) {
      return options.authValid === false
        ? Response.json({ message: "sensitive auth error" }, { status: 401 })
        : Response.json({
            id: ADMIN_ID,
            aud: "authenticated",
            role: "authenticated",
            email: "admin@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2030-01-01T00:00:00.000Z",
          });
    }
    if (url.includes("/rest/v1/profiles")) {
      if (url.includes(`id=eq.${ADMIN_ID}`)) {
        return Response.json(options.adminProfile ?? {
          id: ADMIN_ID,
          is_admin: true,
          is_frozen: false,
        });
      }
      return Response.json(options.profiles ?? validProfiles());
    }
    if (url.includes("/rest/v1/nowpayments_usdt_config")) {
      return Response.json(options.config ?? {
        id: "USDT-BEP20",
        asset: "USDT",
        network: "BEP20",
        provider_currency: "usdtbsc",
        withdrawals_enabled: false,
        withdrawal_minimum_usdt: "2.000000",
        withdrawal_fee_percent: "5.0000",
      });
    }
    if (url.includes("/rest/v1/nowpayments_usdt_withdrawals")) {
      return Response.json(options.withdrawals ?? [validWithdrawal()]);
    }
    if (url.includes("/rest/v1/nowpayments_usdt_withdrawal_events")) {
      return Response.json(options.events ?? validEvents());
    }
    if (url.includes("/rest/v1/nowpayments_usdt_withdrawal_broadcasts")) {
      return Response.json(options.broadcasts ?? [validBroadcast()]);
    }
    if (url.includes("/rest/v1/nowpayments_usdt_withdrawal_verifications")) {
      return Response.json(options.verifications ?? []);
    }
    if (url.includes("/rest/v1/rpc/")) {
      const rpc = new URL(url).pathname.split("/").at(-1);
      const body = JSON.parse(typeof init.body === "string" ? init.body : "{}");
      rpcCalls.push({ rpc, body });
      if (options.rpcError) {
        return Response.json(
          {
            code: options.rpcErrorCode ?? "P0001",
            message: options.rpcError,
            details: "sensitive details",
            hint: "sensitive hint",
          },
          { status: 400 },
        );
      }
      const fingerprint = JSON.stringify({ rpc, body });
      const existing = actionState.get(body.p_action_id);
      if (existing && existing.fingerprint !== fingerprint) {
        return Response.json(
          {
            code: "P0001",
            message: "nowpayments_usdt_action_id_conflict",
            details: null,
            hint: null,
          },
          { status: 400 },
        );
      }
      const statusByRpc = {
        claim_nowpayments_usdt_withdrawal_review: "reviewing",
        reject_nowpayments_usdt_withdrawal: "rejected",
        lock_nowpayments_usdt_withdrawal_send: "send_locked",
        record_nowpayments_usdt_withdrawal_broadcast: "broadcasted",
        complete_nowpayments_usdt_withdrawal: "completed",
      };
      const result = options.rpcResult ?? {
        withdrawal_id: body.p_withdrawal_id,
        status: statusByRpc[rpc],
        ...(rpc === "record_nowpayments_usdt_withdrawal_broadcast"
          || rpc === "complete_nowpayments_usdt_withdrawal"
          ? { transaction_hash: body.p_transaction_hash }
          : {}),
        current_admin_id: ADMIN_ID,
        broadcast_id: BROADCAST_ID,
        available_balance_usdt: "0.000000",
        reserved_balance_usdt: "10.000000",
      };
      actionState.set(body.p_action_id, { fingerprint, result });
      return Response.json(result);
    }
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  try {
    return await operation({
      environmentReads,
      requests,
      rpcCalls,
      actionState,
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.Netlify = originalNetlify;
  }
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

function startGuarded(guard, identity, operation, commits) {
  const request = guard.begin(identity);
  const completion = (async () => {
    try {
      const value = await operation;
      if (request.isCurrent()) commits.push({ kind: "success", identity, value });
    } catch (error) {
      if (request.isCurrent()) commits.push({ kind: "failure", identity, error });
    }
  })();
  return { completion, request };
}

test("admin endpoint fails closed outside published production before environment or network access", async () => {
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
      const getResponse = await adminHandler(adminRequest(), context);
      const postResponse = await adminHandler(
        adminRequest("POST", validActionBody("begin_review")),
        context,
      );
      assert.equal(getResponse.status, 503);
      assert.equal(postResponse.status, 503);
      assert.deepEqual(environmentReads, []);
      assert.deepEqual(requests, []);
    });
  }
});

test("expired, non-admin, and frozen-admin sessions are rejected before protected data or RPC access", async () => {
  const cases = [
    [{ authValid: false }, 401],
    [{ adminProfile: { id: ADMIN_ID, is_admin: false, is_frozen: false } }, 403],
    [{ adminProfile: { id: ADMIN_ID, is_admin: true, is_frozen: true } }, 403],
  ];
  for (const [options, status] of cases) {
    await withRuntime(options, async ({ requests, rpcCalls }) => {
      const response = await adminHandler(
        adminRequest("POST", validActionBody("begin_review")),
        PUBLISHED_PRODUCTION_CONTEXT,
      );
      assert.equal(response.status, status);
      assert.equal(rpcCalls.length, 0);
      assert.equal(
        requests.some(({ url }) => url.includes("nowpayments_usdt_withdrawals")),
        false,
      );
    });
  }
});

test("read-only overview validates exact relationships and returns only sanitized processing data", async () => {
  await withRuntime({}, async ({ requests }) => {
    const response = await adminHandler(adminRequest(), PUBLISHED_PRODUCTION_CONTEXT);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.withdrawals_enabled, false);
    assert.equal(body.required_confirmations, 120);
    assert.equal(body.withdrawals.length, 1);
    assert.deepEqual(Object.keys(body.withdrawals[0]).sort(), [
      "assigned_to_current_admin",
      "broadcasted_at",
      "broadcasts",
      "claimed_at",
      "completed_at",
      "destination_address",
      "events",
      "fee_amount_usdt",
      "gross_amount_usdt",
      "id",
      "net_amount_usdt",
      "rejected_at",
      "rejection_reason",
      "requested_at",
      "send_locked_at",
      "status",
      "username",
      "verification",
    ]);
    assert.equal(body.withdrawals[0].username, "ordinary-user");
    assert.equal(body.withdrawals[0].broadcasts[0].transaction_hash, HASH);
    assert.equal(body.withdrawals[0].assigned_to_current_admin, true);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(
      serialized,
      /user_id|actor_id|action_id|broadcast_id|service-role|canonical_payload|result_snapshot/i,
    );
    assert.doesNotMatch(serialized, new RegExp(USER_ID));
    assert.doesNotMatch(serialized, new RegExp(ADMIN_ID));
    for (const table of [
      "nowpayments_usdt_withdrawal_events",
      "nowpayments_usdt_withdrawal_broadcasts",
      "nowpayments_usdt_withdrawal_verifications",
    ]) {
      const url = requests.find((entry) => entry.url.includes(table))?.url ?? "";
      assert.match(url, /withdrawal_id=in\./);
      assert.match(url, new RegExp(WITHDRAWAL_ID));
    }
  });
});

test("overview fails closed on missing, duplicate, orphaned, cross-user, or cross-withdrawal relationships", async () => {
  const cases = [
    { name: "missing events", events: [] },
    {
      name: "cross-user event",
      events: validEvents().map((row, index) => index === 0
        ? { ...row, user_id: OTHER_USER_ID }
        : row),
      profiles: validProfiles([
        { id: OTHER_USER_ID, username: "other-user", is_admin: false, is_frozen: false },
      ]),
    },
    {
      name: "cross-withdrawal broadcast",
      broadcasts: [validBroadcast({ withdrawal_id: OTHER_WITHDRAWAL_ID })],
    },
    {
      name: "orphan broadcast",
      broadcasts: [
        validBroadcast(),
        validBroadcast({
          id: "91000000-0000-4000-8000-000000000001",
          transaction_hash: `0x${"b".repeat(64)}`,
          supersedes_broadcast_id: BROADCAST_ID,
          correction_reason: "unexpected orphan",
        }),
      ],
    },
    {
      name: "missing related admin profile",
      profiles: validProfiles().filter((profile) => profile.id !== ADMIN_ID),
    },
    {
      name: "duplicate event action",
      events: [...validEvents(), validEvents()[3]],
    },
  ];
  for (const fixture of cases) {
    await withRuntime(fixture, async () => {
      const response = await adminHandler(adminRequest(), PUBLISHED_PRODUCTION_CONTEXT);
      assert.equal(response.status, 503, fixture.name);
      const serialized = await response.text();
      assert.doesNotMatch(serialized, new RegExp(OTHER_USER_ID), fixture.name);
      assert.doesNotMatch(serialized, new RegExp(OTHER_WITHDRAWAL_ID), fixture.name);
      assert.doesNotMatch(
        serialized,
        /user_id|broadcast_id|raw_error|details|hint/i,
        fixture.name,
      );
    });
  }
});

test("completed overview requires exact immutable verification tied to the current broadcast", async () => {
  const completedWithdrawal = validWithdrawal({
    status: "completed",
    completed_at: "2030-01-01T05:00:00.000Z",
    updated_at: "2030-01-01T05:00:00.000Z",
  });
  const completedEvents = [
    ...validEvents(),
    event(
      "81000000-0000-4000-8000-000000000005",
      "82000000-0000-4000-8000-000000000005",
      "complete",
      "broadcasted",
      "completed",
      ADMIN_ID,
      "2030-01-01T05:00:00.000Z",
    ),
  ];
  const verification = {
    id: "92000000-0000-4000-8000-000000000001",
    withdrawal_id: WITHDRAWAL_ID,
    broadcast_id: BROADCAST_ID,
    verified_by: ADMIN_ID,
    chain_id: 56,
    token_contract: TOKEN_CONTRACT,
    transaction_success: true,
    exactly_one_matching_transfer: true,
    destination_address: ADDRESS,
    net_amount_usdt: "9.500000",
    block_number: 12345678,
    transfer_log_index: 2,
    confirmations: 120,
    verified_at: "2030-01-01T04:59:00.000Z",
    created_at: "2030-01-01T05:00:00.000Z",
  };
  await withRuntime({
    withdrawals: [completedWithdrawal],
    events: completedEvents,
    verifications: [verification],
  }, async () => {
    const response = await adminHandler(adminRequest(), PUBLISHED_PRODUCTION_CONTEXT);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.withdrawals[0].verification.confirmations, 120);
    assert.equal(body.withdrawals[0].verification.block_number, 12345678);
  });
  for (const drift of [
    { confirmations: 119 },
    { chain_id: 1 },
    { token_contract: ADDRESS },
    { destination_address: `0x${"2".repeat(40)}` },
    { net_amount_usdt: "9.499999" },
    { broadcast_id: "93000000-0000-4000-8000-000000000001" },
  ]) {
    await withRuntime({
      withdrawals: [completedWithdrawal],
      events: completedEvents,
      verifications: [{ ...verification, ...drift }],
    }, async () => {
      const response = await adminHandler(adminRequest(), PUBLISHED_PRODUCTION_CONTEXT);
      assert.equal(response.status, 503);
    });
  }
});

test("each administrator action invokes exactly one deployed authoritative function with derived admin identity", async () => {
  const cases = [
    [
      "begin_review",
      "claim_nowpayments_usdt_withdrawal_review",
      {
        p_withdrawal_id: WITHDRAWAL_ID,
        p_admin_id: ADMIN_ID,
        p_action_id: ACTION_ID,
      },
    ],
    [
      "reject",
      "reject_nowpayments_usdt_withdrawal",
      {
        p_withdrawal_id: WITHDRAWAL_ID,
        p_admin_id: ADMIN_ID,
        p_action_id: ACTION_ID,
        p_reason: "Destination could not be verified",
      },
    ],
    [
      "send_lock",
      "lock_nowpayments_usdt_withdrawal_send",
      {
        p_withdrawal_id: WITHDRAWAL_ID,
        p_admin_id: ADMIN_ID,
        p_action_id: ACTION_ID,
        p_external_liquidity_confirmed: true,
        p_destination_manually_verified: true,
      },
    ],
    [
      "record_broadcast",
      "record_nowpayments_usdt_withdrawal_broadcast",
      {
        p_withdrawal_id: WITHDRAWAL_ID,
        p_admin_id: ADMIN_ID,
        p_action_id: ACTION_ID,
        p_transaction_hash: HASH,
        p_correction_reason: null,
      },
    ],
    [
      "complete",
      "complete_nowpayments_usdt_withdrawal",
      {
        p_withdrawal_id: WITHDRAWAL_ID,
        p_admin_id: ADMIN_ID,
        p_action_id: ACTION_ID,
        p_transaction_hash: HASH,
        p_chain_id: 56,
        p_token_contract: TOKEN_CONTRACT,
        p_transaction_success: true,
        p_exactly_one_matching_transfer: true,
        p_destination_address: ADDRESS,
        p_net_amount_usdt: "9.500000",
        p_block_number: 12345678,
        p_transfer_log_index: 2,
        p_confirmations: 120,
        p_verified_at: "2026-07-23T12:00:00.000Z",
      },
    ],
  ];
  for (const [action, rpc, expectedBody] of cases) {
    await withRuntime({}, async ({ rpcCalls }) => {
      const response = await adminHandler(
        adminRequest("POST", validActionBody(action)),
        PUBLISHED_PRODUCTION_CONTEXT,
      );
      assert.equal(response.status, 200, action);
      assert.deepEqual(rpcCalls, [{ rpc, body: expectedBody }], action);
      const body = await response.json();
      assert.deepEqual(
        Object.keys(body).sort(),
        action === "record_broadcast" || action === "complete"
          ? ["status", "transaction_hash"]
          : ["status"],
      );
      assert.doesNotMatch(JSON.stringify(body), /withdrawal_id|admin|broadcast_id|balance/i);
    });
  }
});

test("broadcast correction is append-only through the same audited RPC and requires a reason", async () => {
  const correction = validActionBody("record_broadcast", {
    action_id: OTHER_ACTION_ID,
    transaction_hash: `0x${"b".repeat(64)}`,
    correction_reason: "First external hash was recorded incorrectly",
  });
  await withRuntime({}, async ({ rpcCalls }) => {
    const response = await adminHandler(
      adminRequest("POST", correction),
      PUBLISHED_PRODUCTION_CONTEXT,
    );
    assert.equal(response.status, 200);
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].rpc, "record_nowpayments_usdt_withdrawal_broadcast");
    assert.equal(
      rpcCalls[0].body.p_correction_reason,
      "First external hash was recorded incorrectly",
    );
  });
});

test("strict action schemas reject invalid hash, evidence, confirmation, unknown fields, and oversized bodies before RPC", async () => {
  const invalid = [
    validActionBody("begin_review", { admin_id: ADMIN_ID }),
    validActionBody("reject", { reason: " " }),
    validActionBody("send_lock", { irreversible_send_confirmed: false }),
    validActionBody("record_broadcast", { transaction_hash: `0x${"A".repeat(64)}` }),
    validActionBody("record_broadcast", { transaction_hash: "0x1234" }),
    validActionBody("complete", { confirmations: 119 }),
    validActionBody("complete", { chain_id: 1 }),
    validActionBody("complete", { token_contract: ADDRESS }),
    validActionBody("complete", { transaction_success: false }),
    validActionBody("complete", { exactly_one_matching_transfer: false }),
    validActionBody("complete", { destination_address: `0x${"A".repeat(40)}` }),
    validActionBody("complete", { net_amount_usdt: "9.5000001" }),
    validActionBody("complete", { block_number: 0 }),
    validActionBody("complete", { transfer_log_index: -1 }),
    validActionBody("complete", { verified_at: "not-a-date" }),
  ];
  for (const body of invalid) {
    await withRuntime({}, async ({ rpcCalls }) => {
      const response = await adminHandler(
        adminRequest("POST", body),
        PUBLISHED_PRODUCTION_CONTEXT,
      );
      assert.equal(response.status, 400);
      assert.equal(rpcCalls.length, 0);
    });
  }
  await withRuntime({}, async ({ rpcCalls }) => {
    const response = await adminHandler(
      adminRequest("POST", validActionBody("begin_review"), {
        contentLength: "8193",
      }),
      PUBLISHED_PRODUCTION_CONTEXT,
    );
    assert.equal(response.status, 413);
    assert.equal(rpcCalls.length, 0);
  });
});

test("exact action retries are stable while changed payloads and state failures are sanitized", async () => {
  const state = new Map();
  await withRuntime({ actionState: state }, async () => {
    const request = () => adminHandler(
      adminRequest("POST", validActionBody("reject")),
      PUBLISHED_PRODUCTION_CONTEXT,
    );
    const first = await request();
    const retry = await request();
    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);
    assert.deepEqual(await first.json(), await retry.json());
    const conflict = await adminHandler(
      adminRequest("POST", validActionBody("reject", { reason: "Different reason" })),
      PUBLISHED_PRODUCTION_CONTEXT,
    );
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).error, "admin_action_conflict");
  });

  for (const [rpcError, status] of [
    ["invalid_nowpayments_usdt_withdrawal_state", 409],
    ["withdrawal_cannot_be_rejected_after_send_lock", 409],
    ["broadcast_correction_requires_new_hash_and_reason", 409],
    ["nowpayments_usdt_withdrawals_disabled", 503],
    ["nowpayments_usdt_withdrawal_verification_mismatch", 400],
  ]) {
    await withRuntime({ rpcError }, async () => {
      const response = await adminHandler(
        adminRequest("POST", validActionBody("complete")),
        PUBLISHED_PRODUCTION_CONTEXT,
      );
      assert.equal(response.status, status);
      assert.doesNotMatch(await response.text(), new RegExp(rpcError));
    });
  }
});

test("stale-response guard, single-flight, and stable keys prevent cross-auth commits and double actions", async (t) => {
  await t.test("newest success wins over an older success and failure", async () => {
    const guard = createLatestAdminWithdrawalRequestGuard();
    const identity = { userId: ADMIN_ID, tokenGeneration: 1 };
    const older = deferred();
    const newer = deferred();
    const commits = [];
    const first = startGuarded(guard, identity, older.promise, commits);
    const second = startGuarded(guard, identity, newer.promise, commits);
    assert.equal(first.request.signal.aborted, true);
    newer.resolve("new");
    await second.completion;
    older.reject(new Error("stale secret"));
    await first.completion;
    assert.deepEqual(commits.map((entry) => entry.value), ["new"]);
  });

  await t.test("token change and unmount invalidation prevent stale commits", async () => {
    const guard = createLatestAdminWithdrawalRequestGuard();
    const oldIdentity = { userId: ADMIN_ID, tokenGeneration: 1 };
    const newIdentity = { userId: OTHER_ADMIN_ID, tokenGeneration: 2 };
    const oldRequest = deferred();
    const newRequest = deferred();
    const commits = [];
    const oldAttempt = startGuarded(guard, oldIdentity, oldRequest.promise, commits);
    const newAttempt = startGuarded(guard, newIdentity, newRequest.promise, commits);
    newRequest.resolve("new-admin");
    await newAttempt.completion;
    oldRequest.resolve("old-admin");
    await oldAttempt.completion;
    guard.invalidate();
    assert.deepEqual(commits.map((entry) => entry.value), ["new-admin"]);
    assert.equal(oldAttempt.request.signal.aborted, true);
    assert.equal(newAttempt.request.signal.aborted, true);
  });

  let calls = 0;
  let release;
  const holder = { current: null };
  const operation = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  const first = runAdminWithdrawalSingleFlight(holder, operation);
  const duplicateClick = runAdminWithdrawalSingleFlight(holder, operation);
  assert.strictEqual(first, duplicateClick);
  assert.equal(calls, 1);
  release("ok");
  await first;

  const keys = [ACTION_ID, OTHER_ACTION_ID];
  const manager = createAdminWithdrawalActionKeyManager(() => keys.shift());
  assert.equal(manager.keyFor(`reject|${WITHDRAWAL_ID}|reason`), ACTION_ID);
  assert.equal(manager.keyFor(`reject|${WITHDRAWAL_ID}|reason`), ACTION_ID);
  assert.equal(manager.keyFor(`reject|${WITHDRAWAL_ID}|changed`), OTHER_ACTION_ID);
});

test("browser helpers use only the QHash admin endpoint and keep six-decimal amounts exact", async () => {
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "GET") return Response.json(validPublicOverview());
    return Response.json({ status: "reviewing" });
  };
  const controller = new AbortController();
  const overview = await fetchNowpaymentsAdminWithdrawalOverview(
    "token",
    request,
    controller.signal,
  );
  assert.equal(overview.withdrawals[0].net_amount_usdt, "9.500000");
  assert.equal(formatAdminUsdtSix("123456789012345678.123456"), "123,456,789,012,345,678.123456");
  await submitNowpaymentsAdminWithdrawalAction(
    "token",
    validActionBody("begin_review"),
    request,
  );
  assert.deepEqual(calls.map((call) => call.url), [
    "/api/admin/crypto/nowpayments/usdt-withdrawals",
    "/api/admin/crypto/nowpayments/usdt-withdrawals",
  ]);
  assert.equal(calls[0].init.signal, controller.signal);
});

test("source scope has no provider, wallet, signing, payout, direct client database, or sensitive logging path", async () => {
  const [handler, component, ui, route, typecheck, databaseMigration, precisionMigration] =
    await Promise.all([
      readFile(new URL("netlify/functions/nowpayments-usdt-withdrawal-admin.mts", root), "utf8"),
      readFile(new URL("src/components/admin/NowpaymentsUsdtWithdrawalAdmin.tsx", root), "utf8"),
      readFile(new URL("src/lib/nowpayments-withdrawal-admin-ui.ts", root), "utf8"),
      readFile(new URL("src/routes/_app/admin.tsx", root), "utf8"),
      readFile(new URL("tsconfig.netlify.json", root), "utf8"),
      readFile(
        new URL(
          "supabase/migrations/20260722120000_nowpayments_manual_usdt_withdrawal_database/migration.sql",
          root,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "supabase/migrations/20260723120000_nowpayments_usdt_withdrawal_maximum_precision/migration.sql",
          root,
        ),
        "utf8",
      ),
    ]);
  assert.doesNotMatch(
    handler,
    /NOWPAYMENTS_API_KEY|api\.nowpayments|bscscan|eth_send|payout|private.?key|seed.?phrase|signTransaction/i,
  );
  assert.doesNotMatch(
    `${component}\n${ui}`,
    /SUPABASE_SERVICE_ROLE_KEY|createClient|\.from\(|\.rpc\(|api\.nowpayments|eth_send|private.?key|seed.?phrase|signTransaction/i,
  );
  assert.doesNotMatch(handler, /console\.(log|info|warn|error)|raw.?error|stack.?trace/i);
  assert.equal((handler.match(/\.rpc\(/g) ?? []).length, 5);
  for (const functionName of [
    "claim_nowpayments_usdt_withdrawal_review",
    "reject_nowpayments_usdt_withdrawal",
    "lock_nowpayments_usdt_withdrawal_send",
    "record_nowpayments_usdt_withdrawal_broadcast",
    "complete_nowpayments_usdt_withdrawal",
  ]) {
    assert.match(handler, new RegExp(`\\.rpc\\("${functionName}"`));
  }
  assert.doesNotMatch(handler, /\.(insert|update|delete)\(/);
  assert.match(handler, /isPublishedProductionDeployContext\(context\)/);
  assert.match(component, /createLatestAdminWithdrawalRequestGuard/);
  assert.match(component, /runAdminWithdrawalSingleFlight/);
  assert.match(component, /AbortController|request\.signal/);
  assert.match(component, /120 confirmations/);
  assert.match(component, /Recipient must receive/);
  assert.match(component, /role="dialog"/);
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /aria-labelledby="usdt-withdrawal-action-title"/);
  assert.match(component, /aria-describedby="usdt-withdrawal-action-description"/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /event\.key !== "Tab"/);
  assert.match(route, /USDT Withdrawals/);
  assert.match(route, /ETB Withdrawals/);
  assert.match(typecheck, /nowpayments-usdt-withdrawal-admin\.mts/);
  assert.match(databaseMigration, /create function public\.complete_nowpayments_usdt_withdrawal/);
  assert.match(databaseMigration, /confirmations >= 120/);
  assert.match(databaseMigration, /withdrawal_release/);
  assert.match(databaseMigration, /withdrawal_settlement/);
  assert.match(precisionMigration, /trunc\(v_wallet\.available_balance_usdt, 6\)/);
});

test("public overview parser fails closed on malformed or duplicate admin data", () => {
  assert.equal(
    parseNowpaymentsAdminWithdrawalOverview(validPublicOverview()).withdrawals.length,
    1,
  );
  assert.throws(
    () => parseNowpaymentsAdminWithdrawalOverview(validPublicOverview({
      withdrawals: [
        ...validPublicOverview().withdrawals,
        ...validPublicOverview().withdrawals,
      ],
    })),
    /unavailable/,
  );
  assert.throws(
    () => parseNowpaymentsAdminWithdrawalOverview(validPublicOverview({
      required_confirmations: 119,
    })),
    /unavailable/,
  );
});

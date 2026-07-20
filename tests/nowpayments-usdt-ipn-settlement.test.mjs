import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  createNowpaymentsClient,
  NowpaymentsClientError,
} from "../netlify/functions/lib/nowpayments-client.mts";
import {
  canonicalizeNowpaymentsIpn,
  NOWPAYMENTS_IPN_MAX_BODY_BYTES,
  verifyNowpaymentsIpn,
} from "../netlify/functions/lib/nowpayments-ipn.mts";
import {
  createNowpaymentsUsdtIpnHandler,
} from "../netlify/functions/nowpayments-usdt-ipn.mts";
import {
  createNowpaymentsUsdtReconcilePaymentHandler,
} from "../netlify/functions/nowpayments-usdt-reconcile-payment.mts";
import {
  NowpaymentsSettlementStoreError,
} from "../netlify/functions/lib/nowpayments-settlement.mts";

const repositoryRoot = new URL("../", import.meta.url);
const foundationMigration = await readFile(
  new URL(
    "supabase/migrations/20260718190000_nowpayments_usdt_bep20_foundation/migration.sql",
    repositoryRoot,
  ),
  "utf8",
);
const sessionMigration = await readFile(
  new URL(
    "supabase/migrations/20260718220000_nowpayments_active_deposit_session/migration.sql",
    repositoryRoot,
  ),
  "utf8",
);
const settlementMigration = await readFile(
  new URL(
    "supabase/migrations/20260719120000_nowpayments_ipn_settlement/migration.sql",
    repositoryRoot,
  ),
  "utf8",
);
const databaseTypes = await readFile(
  new URL("src/lib/database.types.ts", repositoryRoot),
  "utf8",
);
const endpointSource = await readFile(
  new URL("netlify/functions/nowpayments-usdt-ipn.mts", repositoryRoot),
  "utf8",
);
const recoveryEndpointSource = await readFile(
  new URL(
    "netlify/functions/nowpayments-usdt-reconcile-payment.mts",
    repositoryRoot,
  ),
  "utf8",
);
const recoveryDocumentation = await readFile(
  new URL("docs/nowpayments-late-deposit-recovery.md", repositoryRoot),
  "utf8",
);
const environmentExample = await readFile(
  new URL(".env.example", repositoryRoot),
  "utf8",
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_TRANSACTION_ID = "22222222-2222-4222-8222-222222222222";
const CBE_METHOD_ID = "33333333-3333-4333-8333-333333333333";
const TELEBIRR_METHOD_ID = "44444444-4444-4444-8444-444444444444";
const ARCHIVE_ADDRESS_ID = "55555555-5555-4555-8555-555555555555";
const ARCHIVE_DEPOSIT_ID = "66666666-6666-4666-8666-666666666666";
const PAY_ADDRESS = "0x9999999999999999999999999999999999999999";
const ORIGINAL_PROVIDER_ID = "90071992547409931234";
const CHILD_PROVIDER_ID = "90071992547409931235";
const IPN_SECRET = "mock-ipn-secret-only";
const PUBLISHED_PRODUCTION_CONTEXT = {
  deploy: { context: "production", published: true },
};

function invokePublished(handler, request) {
  return handler(request, PUBLISHED_PRODUCTION_CONTEXT);
}

async function applyMigration(db, migration) {
  await db.exec("begin");
  try {
    await db.exec(migration);
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

async function createFixture(db) {
  await db.exec(`
    do $roles$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated;
      end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role;
      end if;
    end
    $roles$;

    create type public.transaction_type as enum (
      'deposit',
      'withdrawal',
      'plan_purchase',
      'earning',
      'admin_adjustment',
      'referral_reward',
      'referral_investment_bonus',
      'referral_daily_bonus'
    );
    create type public.transaction_status as enum ('pending', 'completed', 'failed');
    create type public.payment_method_type as enum ('cbe', 'telebirr');

    create table public._qhash_migrations (
      id text primary key,
      checksum text not null,
      applied_at timestamptz not null default now(),
      deploy_context text,
      commit_ref text
    );
    create table public.profiles (
      id uuid primary key,
      username text not null,
      phone text not null,
      is_frozen boolean not null default false
    );
    create table public.wallets (
      user_id uuid primary key references public.profiles(id),
      balance numeric(18, 2) not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.transactions (
      id uuid primary key,
      user_id uuid not null references public.profiles(id),
      type public.transaction_type not null,
      amount numeric(18, 2) not null,
      status public.transaction_status not null,
      description text,
      reference_id uuid,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      balance_before numeric(18, 2),
      balance_after numeric(18, 2)
    );
    create table public.payment_methods (
      id uuid primary key,
      type public.payment_method_type not null,
      account_name text not null,
      account_number text not null,
      is_active boolean not null default true
    );
    create table public.crypto_deposit_addresses (
      id uuid primary key,
      user_id uuid not null references public.profiles(id),
      network text not null,
      asset text not null,
      address text not null,
      status text not null
    );
    create table public.crypto_deposits (
      id uuid primary key,
      user_id uuid not null references public.profiles(id),
      address_id uuid references public.crypto_deposit_addresses(id),
      network text not null,
      asset text not null,
      tx_hash text not null,
      amount_usdt numeric(36, 6) not null,
      status text not null
    );
    create function public.reject_retired_native_crypto_evidence_mutation()
    returns trigger
    language plpgsql
    as $function$
    begin
      raise exception 'Retired native crypto evidence is immutable';
    end;
    $function$;

    insert into public.profiles (id, username, phone)
    values ('${USER_ID}', 'ipn-user', '+251900000000');
    insert into public.wallets (user_id, balance)
    values ('${USER_ID}', 1234.56);
    insert into public.transactions (
      id, user_id, type, amount, status, description, balance_before, balance_after
    ) values (
      '${PLAN_TRANSACTION_ID}', '${USER_ID}', 'plan_purchase', 250.00,
      'completed', 'Existing ETB plan purchase', 1484.56, 1234.56
    );
    insert into public.payment_methods (id, type, account_name, account_number)
    values
      ('${CBE_METHOD_ID}', 'cbe', 'QHash CBE', '1000000000000'),
      ('${TELEBIRR_METHOD_ID}', 'telebirr', 'QHash TeleBirr', '0900000000');
    insert into public.crypto_deposit_addresses (
      id, user_id, network, asset, address, status
    ) values (
      '${ARCHIVE_ADDRESS_ID}', '${USER_ID}', 'BSC', 'USDT',
      '0x1111111111111111111111111111111111111111', 'disabled'
    );
    insert into public.crypto_deposits (
      id, user_id, address_id, network, asset, tx_hash, amount_usdt, status
    ) values (
      '${ARCHIVE_DEPOSIT_ID}', '${USER_ID}', '${ARCHIVE_ADDRESS_ID}', 'BSC',
      'USDT', '0xarchive', 9.990000, 'credited'
    );
  `);
}

async function createMigratedDatabase(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await createFixture(db);
  await applyMigration(db, foundationMigration);
  await applyMigration(db, sessionMigration);
  await applyMigration(db, settlementMigration);
  return db;
}

async function createReadySession(db, providerPaymentId = ORIGINAL_PROVIDER_ID) {
  await db.exec(`
    update public.nowpayments_usdt_config
    set enabled = true
    where id = 'USDT-BEP20';
  `);
  const claimed = await db.query(`
    select
      response ->> 'id' as id,
      response ->> 'qhash_order_id' as qhash_order_id
    from (
      select public.claim_nowpayments_usdt_deposit_session(
        '${USER_ID}'::uuid,
        '0.25',
        '1'
      ) as response
    ) as claim
  `);
  const session = claimed.rows[0];
  await db.query(
    `select public.complete_nowpayments_usdt_deposit_session(
       $1::uuid,
       $2::uuid,
       $3,
       $4,
       'waiting',
       '2030-01-01T00:00:00Z'::timestamptz,
       '2030-02-01T00:00:00Z'::timestamptz
     )`,
    [session.id, session.qhash_order_id, providerPaymentId, PAY_ADDRESS],
  );
  await db.exec(`
    update public.nowpayments_usdt_config
    set enabled = false
    where id = 'USDT-BEP20';
  `);
  return session;
}

async function settle(db, {
  providerPaymentId = ORIGINAL_PROVIDER_ID,
  parentProviderPaymentId = null,
  qhashOrderId,
  payAddress = PAY_ADDRESS,
  payCurrency = "usdtbsc",
  providerPaymentStatus = "finished",
  outcomeAmount = "0.75",
  outcomeCurrency = "usdtbsc",
} = {}) {
  const result = await db.query(
    `select public.settle_verified_nowpayments_usdt_payment(
       $1, $2, $3, $4, $5, $6, $7, $8
     ) as result`,
    [
      providerPaymentId,
      parentProviderPaymentId,
      qhashOrderId ?? null,
      payAddress,
      payCurrency,
      providerPaymentStatus,
      providerPaymentStatus === "finished" ? outcomeAmount : null,
      providerPaymentStatus === "finished" ? outcomeCurrency : null,
    ],
  );
  return result.rows[0].result;
}

function signPayload(payload, secret = IPN_SECRET) {
  return createHmac("sha512", secret)
    .update(canonicalizeNowpaymentsIpn(payload))
    .digest("hex");
}

function createSignedRequest(payload, secret = IPN_SECRET) {
  const rawBody = JSON.stringify(payload);
  return new Request("https://qhash.mock/api/crypto/nowpayments/ipn", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-nowpayments-sig": signPayload(payload, secret),
    },
    body: rawBody,
  });
}

function createRecoveryRequest(providerPaymentId, accessToken = "admin-session-token") {
  return new Request(
    "https://qhash.mock/api/admin/crypto/nowpayments/reconcile-payment",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ payment_id: providerPaymentId }),
    },
  );
}

function verifiedFinishedPayment(overrides = {}) {
  return {
    providerPaymentId: ORIGINAL_PROVIDER_ID,
    parentProviderPaymentId: null,
    qhashOrderId: "77777777-7777-4777-8777-777777777777",
    payAddress: PAY_ADDRESS,
    payCurrency: "usdtbsc",
    providerPaymentStatus: "finished",
    outcomeAmountUsdt: "1",
    outcomeCurrency: "usdtbsc",
    ...overrides,
  };
}

function recoveryEnvironment(name) {
  return {
    VITE_SUPABASE_URL: "https://supabase.mock",
    SUPABASE_SERVICE_ROLE_KEY: "mock-service-role-key",
    NOWPAYMENTS_API_KEY: "mock-nowpayments-api-key",
  }[name];
}

async function responseFingerprint(response) {
  return {
    status: response.status,
    headers: Object.fromEntries([...response.headers.entries()].sort()),
    body: await response.text(),
  };
}

function databaseSettlementStore(db) {
  return {
    async settle(payment) {
      return settle(db, {
        providerPaymentId: payment.providerPaymentId,
        parentProviderPaymentId: payment.parentProviderPaymentId,
        qhashOrderId: payment.qhashOrderId,
        payAddress: payment.payAddress,
        payCurrency: payment.payCurrency,
        providerPaymentStatus: payment.providerPaymentStatus,
        outcomeAmount: payment.outcomeAmountUsdt,
        outcomeCurrency: payment.outcomeCurrency,
      });
    },
  };
}

function createCrossHandlerPair(db, payment) {
  const store = databaseSettlementStore(db);
  const ipn = createNowpaymentsUsdtIpnHandler({
    getEnvironment(name) {
      return {
        NOWPAYMENTS_IPN_SECRET: IPN_SECRET,
        NOWPAYMENTS_API_KEY: "mock-api-key",
        VITE_SUPABASE_URL: "https://supabase.mock",
        SUPABASE_SERVICE_ROLE_KEY: "mock-service-role-key",
      }[name];
    },
    createProvider() {
      return { async getPaymentDetails() { return payment; } };
    },
    createStore() {
      return store;
    },
  });
  const recovery = createNowpaymentsUsdtReconcilePaymentHandler({
    getEnvironment: recoveryEnvironment,
    async authorizeAdmin() {
      return "authorized";
    },
    createProvider() {
      return { async getPaymentDetails() { return payment; } };
    },
    createStore() {
      return store;
    },
  });
  return { ipn, recovery };
}

async function assertSingleCrossHandlerCredit(db, expectedAmount) {
  const result = await db.query(`
    select
      wallet.available_balance_usdt::text as available,
      wallet.reserved_balance_usdt::text as reserved,
      (select count(*)::integer from public.nowpayments_usdt_provider_payments) as provider_count,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger_count
    from public.nowpayments_usdt_wallets as wallet
    where wallet.user_id = '${USER_ID}'
  `);
  assert.deepEqual(result.rows, [{
    available: expectedAmount,
    reserved: "0.000000000000000000",
    provider_count: 1,
    ledger_count: 1,
  }]);
}

test("migration keeps crypto disabled, private, precise, and separate from ETB", async (t) => {
  const db = await createMigratedDatabase(t);
  const state = await db.query(`
    select
      (select enabled from public.nowpayments_usdt_config where id = 'USDT-BEP20') as enabled,
      (select count(*)::integer from public.nowpayments_usdt_wallets) as wallet_count,
      (select count(*)::integer from public.nowpayments_usdt_payments) as session_count,
      (select count(*)::integer from public.nowpayments_usdt_provider_payments) as provider_count,
      (select count(*)::integer from public.nowpayments_usdt_withdrawals) as withdrawal_count,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger_count,
      (select balance::text from public.wallets where user_id = '${USER_ID}') as etb_balance,
      (select type::text from public.transactions where id = '${PLAN_TRANSACTION_ID}') as transaction_type,
      (select array_agg(type::text order by type::text) from public.payment_methods) as payment_types,
      (select status from public.crypto_deposit_addresses where id = '${ARCHIVE_ADDRESS_ID}') as archive_status,
      (select amount_usdt::text from public.crypto_deposits where id = '${ARCHIVE_DEPOSIT_ID}') as archive_amount,
      (
        select numeric_scale
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'nowpayments_usdt_wallets'
          and column_name = 'available_balance_usdt'
      ) as wallet_scale
  `);
  assert.deepEqual(state.rows, [{
    enabled: false,
    wallet_count: 0,
    session_count: 0,
    provider_count: 0,
    withdrawal_count: 0,
    ledger_count: 0,
    etb_balance: "1234.56",
    transaction_type: "plan_purchase",
    payment_types: ["cbe", "telebirr"],
    archive_status: "disabled",
    archive_amount: "9.990000",
    wallet_scale: 18,
  }]);

  const security = await db.query(`
    select
      provider.relrowsecurity as rls_enabled,
      has_table_privilege('service_role', provider.oid, 'SELECT') as service_select,
      has_table_privilege('service_role', provider.oid, 'INSERT, UPDATE, DELETE') as service_write,
      has_function_privilege(
        'service_role',
        'public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text)',
        'EXECUTE'
      ) as service_settle,
      has_function_privilege(
        'authenticated',
        'public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text)',
        'EXECUTE'
      ) as authenticated_settle,
      has_function_privilege(
        'service_role',
        'public.credit_verified_nowpayments_usdt_payment(uuid,text,text)',
        'EXECUTE'
      ) as legacy_credit
    from pg_class as provider
    join pg_namespace as namespace on namespace.oid = provider.relnamespace
    where namespace.nspname = 'public'
      and provider.relname = 'nowpayments_usdt_provider_payments'
  `);
  assert.deepEqual(security.rows, [{
    rls_enabled: true,
    service_select: true,
    service_write: false,
    service_settle: true,
    authenticated_settle: false,
    legacy_credit: false,
  }]);
});

test("credits an independently verified finished payment while generation is disabled", async (t) => {
  const db = await createMigratedDatabase(t);
  const session = await createReadySession(db);
  const result = await settle(db, {
    qhashOrderId: session.qhash_order_id,
    outcomeAmount: "0.123456789012345678",
  });
  assert.equal(result.status, "credited");
  assert.equal(result.credited_amount_usdt, "0.123456789012345678");

  const state = await db.query(`
    select
      wallet.available_balance_usdt::text,
      wallet.reserved_balance_usdt::text,
      session.session_status,
      session.provider_payment_status,
      session.settled_by_provider_payment_id,
      provider.outcome_amount_usdt::text,
      provider.payment_kind,
      ledger.available_delta_usdt::text,
      ledger.reserved_delta_usdt::text,
      (select balance::text from public.wallets where user_id = '${USER_ID}') as etb_balance,
      (select count(*)::integer from public.transactions) as etb_transaction_count
    from public.nowpayments_usdt_wallets as wallet
    join public.nowpayments_usdt_payments as session on session.user_id = wallet.user_id
    join public.nowpayments_usdt_provider_payments as provider on provider.session_id = session.id
    join public.nowpayments_usdt_ledger_entries as ledger
      on ledger.provider_payment_record_id = provider.id
  `);
  assert.deepEqual(state.rows, [{
    available_balance_usdt: "0.123456789012345678",
    reserved_balance_usdt: "0.000000000000000000",
    session_status: "terminal",
    provider_payment_status: "finished",
    settled_by_provider_payment_id: ORIGINAL_PROVIDER_ID,
    outcome_amount_usdt: "0.123456789012345678",
    payment_kind: "original",
    available_delta_usdt: "0.123456789012345678",
    reserved_delta_usdt: "0.000000000000000000",
    etb_balance: "1234.56",
    etb_transaction_count: 1,
  }]);
});

test("duplicate and concurrent settlement callbacks credit once", async (t) => {
  const db = await createMigratedDatabase(t);
  const session = await createReadySession(db);
  const input = {
    qhashOrderId: session.qhash_order_id,
    outcomeAmount: "3.000000000000000001",
  };
  const results = await Promise.all([
    settle(db, input),
    settle(db, input),
    settle(db, input),
  ]);
  assert.equal(results.filter((result) => result.status === "credited").length, 1);
  assert.equal(results.filter((result) => result.status === "already_credited").length, 2);

  const counts = await db.query(`
    select
      (select available_balance_usdt::text from public.nowpayments_usdt_wallets) as available,
      (select reserved_balance_usdt::text from public.nowpayments_usdt_wallets) as reserved,
      (select count(*)::integer from public.nowpayments_usdt_provider_payments) as providers,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger
  `);
  assert.deepEqual(counts.rows, [{
    available: "3.000000000000000001",
    reserved: "0.000000000000000000",
    providers: 1,
    ledger: 1,
  }]);
});

test("stores and credits each safely matched repeated child separately", async (t) => {
  const db = await createMigratedDatabase(t);
  const session = await createReadySession(db);
  await settle(db, {
    qhashOrderId: session.qhash_order_id,
    outcomeAmount: "0.100000000000000001",
  });
  const child = await settle(db, {
    providerPaymentId: CHILD_PROVIDER_ID,
    parentProviderPaymentId: ORIGINAL_PROVIDER_ID,
    qhashOrderId: null,
    outcomeAmount: "0.200000000000000002",
  });
  assert.equal(child.status, "credited");
  assert.equal(child.payment_kind, "repeated");

  const state = await db.query(`
    select
      (select available_balance_usdt::text from public.nowpayments_usdt_wallets) as available,
      (select reserved_balance_usdt::text from public.nowpayments_usdt_wallets) as reserved,
      (select count(*)::integer from public.nowpayments_usdt_provider_payments) as provider_count,
      (select count(*)::integer from public.nowpayments_usdt_provider_payments where payment_kind = 'repeated') as child_count,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger_count,
      (select count(distinct provider_payment_record_id)::integer from public.nowpayments_usdt_ledger_entries) as distinct_credits
  `);
  assert.deepEqual(state.rows, [{
    available: "0.300000000000000003",
    reserved: "0.000000000000000000",
    provider_count: 2,
    child_count: 1,
    ledger_count: 2,
    distinct_credits: 2,
  }]);
});

test("preserves the child as first settlement when the original finishes later", async (t) => {
  const db = await createMigratedDatabase(t);
  const session = await createReadySession(db);

  const child = await settle(db, {
    providerPaymentId: CHILD_PROVIDER_ID,
    parentProviderPaymentId: ORIGINAL_PROVIDER_ID,
    qhashOrderId: null,
    outcomeAmount: "0.200000000000000002",
  });
  assert.equal(child.status, "credited");
  assert.equal(child.payment_kind, "repeated");

  const original = await settle(db, {
    qhashOrderId: session.qhash_order_id,
    outcomeAmount: "0.100000000000000001",
  });
  assert.equal(original.status, "credited");

  const state = await db.query(`
    select
      session.settled_by_provider_payment_id,
      session.provider_payment_status,
      session.session_status,
      wallet.available_balance_usdt::text,
      wallet.reserved_balance_usdt::text,
      (select count(*)::integer from public.nowpayments_usdt_provider_payments) as provider_count,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger_count
    from public.nowpayments_usdt_payments as session
    join public.nowpayments_usdt_wallets as wallet on wallet.user_id = session.user_id
  `);
  assert.deepEqual(state.rows, [{
    settled_by_provider_payment_id: CHILD_PROVIDER_ID,
    provider_payment_status: "finished",
    session_status: "terminal",
    available_balance_usdt: "0.300000000000000003",
    reserved_balance_usdt: "0.000000000000000000",
    provider_count: 2,
    ledger_count: 2,
  }]);
});

test("unknown, mismatched, unsupported, and non-positive payments never credit", async (t) => {
  const db = await createMigratedDatabase(t);
  const session = await createReadySession(db);

  await assert.rejects(
    settle(db, {
      providerPaymentId: "90071992547409939999",
      parentProviderPaymentId: "90071992547409939998",
      outcomeAmount: "1",
    }),
    /nowpayments_settlement_ownership_mismatch/,
  );
  await assert.rejects(
    settle(db, {
      qhashOrderId: session.qhash_order_id,
      payAddress: "0x1111111111111111111111111111111111111111",
    }),
    /nowpayments_settlement_ownership_mismatch/,
  );
  await assert.rejects(
    settle(db, {
      qhashOrderId: session.qhash_order_id,
      payCurrency: "usdttrc20",
    }),
    /invalid_nowpayments_settlement_input/,
  );
  await assert.rejects(
    settle(db, {
      qhashOrderId: session.qhash_order_id,
      outcomeAmount: "0",
    }),
    /invalid_nowpayments_settlement_outcome/,
  );

  const counts = await db.query(`
    select
      (select count(*)::integer from public.nowpayments_usdt_wallets) as wallets,
      (select count(*)::integer from public.nowpayments_usdt_provider_payments) as providers,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger
  `);
  assert.deepEqual(counts.rows, [{ wallets: 0, providers: 0, ledger: 0 }]);
});

test("non-finished and out-of-order statuses do not credit or downgrade", async (t) => {
  const db = await createMigratedDatabase(t);
  const session = await createReadySession(db);
  const confirming = await settle(db, {
    qhashOrderId: session.qhash_order_id,
    providerPaymentStatus: "confirming",
  });
  assert.equal(confirming.status, "recorded_no_credit");
  const older = await settle(db, {
    qhashOrderId: session.qhash_order_id,
    providerPaymentStatus: "waiting",
  });
  assert.equal(older.status, "preserved_newer_status");

  await settle(db, {
    qhashOrderId: session.qhash_order_id,
    outcomeAmount: "2.5",
  });
  const afterFinished = await settle(db, {
    qhashOrderId: session.qhash_order_id,
    providerPaymentStatus: "failed",
  });
  assert.equal(afterFinished.status, "preserved_credited");

  const state = await db.query(`
    select
      provider.provider_payment_status,
      provider.outcome_amount_usdt::text,
      session.provider_payment_status as session_provider_status,
      session.verification_status,
      session.session_status,
      (select available_balance_usdt::text from public.nowpayments_usdt_wallets) as available,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger_count
    from public.nowpayments_usdt_provider_payments as provider
    join public.nowpayments_usdt_payments as session on session.id = provider.session_id
  `);
  assert.deepEqual(state.rows, [{
    provider_payment_status: "finished",
    outcome_amount_usdt: "2.500000000000000000",
    session_provider_status: "finished",
    verification_status: "verified",
    session_status: "terminal",
    available: "2.500000000000000000",
    ledger_count: 1,
  }]);
});

test("official canonical HMAC verification handles nested keys and raw payment IDs", () => {
  const payload = {
    payment_status: "finished",
    payment_id: 123456789,
    fee: { withdrawalFee: 0, depositFee: 1 },
    pay_currency: "usdtbsc",
  };
  assert.equal(
    canonicalizeNowpaymentsIpn(payload),
    '{"fee":{"depositFee":1,"withdrawalFee":0},"pay_currency":"usdtbsc","payment_id":123456789,"payment_status":"finished"}',
  );
  const rawBody = JSON.stringify(payload);
  assert.equal(
    verifyNowpaymentsIpn({
      rawBody,
      signature: signPayload(payload),
      secret: IPN_SECRET,
    }).providerPaymentId,
    "123456789",
  );
  assert.throws(
    () => verifyNowpaymentsIpn({
      rawBody,
      signature: signPayload({ ...payload, payment_id: 1 }),
      secret: IPN_SECRET,
    }),
    /invalid_signature/,
  );
});

test("valid signed IPN is independently verified before settlement", async () => {
  const environmentReads = [];
  const providerCalls = [];
  const settlements = [];
  const handler = createNowpaymentsUsdtIpnHandler({
    getEnvironment(name) {
      environmentReads.push(name);
      return {
        NOWPAYMENTS_IPN_SECRET: IPN_SECRET,
        NOWPAYMENTS_API_KEY: "mock-api-key",
        VITE_SUPABASE_URL: "https://supabase.mock",
        SUPABASE_SERVICE_ROLE_KEY: "mock-service-key",
      }[name];
    },
    createProvider(apiKey) {
      assert.equal(apiKey, "mock-api-key");
      return {
        async getPaymentDetails(providerPaymentId) {
          providerCalls.push(providerPaymentId);
          return {
            providerPaymentId,
            parentProviderPaymentId: null,
            qhashOrderId: "77777777-7777-4777-8777-777777777777",
            payAddress: PAY_ADDRESS,
            payCurrency: "usdtbsc",
            providerPaymentStatus: "finished",
            outcomeAmountUsdt: "0.5",
            outcomeCurrency: "usdtbsc",
          };
        },
      };
    },
    createStore(url, key) {
      assert.equal(url, "https://supabase.mock");
      assert.equal(key, "mock-service-key");
      return {
        async settle(payment) {
          settlements.push(payment);
          return { status: "credited" };
        },
      };
    },
  });

  const response = await invokePublished(handler, createSignedRequest({
    payment_id: ORIGINAL_PROVIDER_ID,
    payment_status: "finished",
    pay_currency: "forged-value-is-ignored",
    outcome_amount: 999999,
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "processed" });
  assert.deepEqual(providerCalls, [ORIGINAL_PROVIDER_ID]);
  assert.equal(settlements.length, 1);
  assert.equal(settlements[0].payCurrency, "usdtbsc");
  assert.equal(settlements[0].outcomeAmountUsdt, "0.5");
  assert.equal(environmentReads[0], "NOWPAYMENTS_IPN_SECRET");
  assert.ok(environmentReads.indexOf("NOWPAYMENTS_API_KEY") > environmentReads.indexOf("NOWPAYMENTS_IPN_SECRET"));
});

test("invalid and forged signatures make no provider or database call", async () => {
  const environmentReads = [];
  let providerCalls = 0;
  let storeCalls = 0;
  const handler = createNowpaymentsUsdtIpnHandler({
    getEnvironment(name) {
      environmentReads.push(name);
      if (name === "NOWPAYMENTS_IPN_SECRET") return IPN_SECRET;
      throw new Error(`unexpected secret read: ${name}`);
    },
    createProvider() {
      providerCalls += 1;
      throw new Error("must not create provider");
    },
    createStore() {
      storeCalls += 1;
      throw new Error("must not create store");
    },
  });

  const response = await invokePublished(handler, createSignedRequest(
    { payment_id: ORIGINAL_PROVIDER_ID, payment_status: "finished" },
    "forged-secret",
  ));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "invalid_signature",
    message: "Invalid signature.",
  });
  assert.equal(providerCalls, 0);
  assert.equal(storeCalls, 0);
  assert.deepEqual(environmentReads, ["NOWPAYMENTS_IPN_SECRET"]);
});

test("non-production, method, content type, and payload-size gates fail closed", async () => {
  const rejectedContexts = [
    { deploy: { context: "production", published: false } },
    { deploy: { context: "deploy-preview", published: true } },
    { deploy: { context: "branch-deploy", published: true } },
    { deploy: { context: "preview-server", published: true } },
    { deploy: { context: "dev", published: true } },
    { deploy: { context: "custom-context", published: true } },
    undefined,
    null,
    {},
    { deploy: null },
    { deploy: { published: true } },
    { deploy: { context: "production" } },
    { deploy: { context: "production", published: "true" } },
    "production",
    Object.defineProperty({}, "deploy", {
      get() { throw new Error("sensitive malformed context detail"); },
    }),
  ];

  for (const runtimeContext of rejectedContexts) {
    const reads = [];
    let providerCalls = 0;
    let storeCalls = 0;
    const handler = createNowpaymentsUsdtIpnHandler({
      getEnvironment(name) {
        reads.push(name);
        throw new Error("non-production secret read");
      },
      createProvider() {
        providerCalls += 1;
        throw new Error("non-production provider access");
      },
      createStore() {
        storeCalls += 1;
        throw new Error("non-production store access");
      },
    });
    const response = await handler(
      createSignedRequest({ payment_id: "1" }),
      runtimeContext,
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "crypto_runtime_unavailable",
      message: "Not available.",
    });
    assert.deepEqual(reads, []);
    assert.equal(providerCalls, 0);
    assert.equal(storeCalls, 0);
  }

  const productionHandler = createNowpaymentsUsdtIpnHandler({
    getEnvironment(name) {
      throw new Error(`unexpected environment read: ${name}`);
    },
  });
  assert.equal((await invokePublished(productionHandler, new Request("https://qhash.mock", { method: "GET" }))).status, 405);
  assert.equal((await invokePublished(productionHandler, new Request("https://qhash.mock", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  }))).status, 415);
  assert.equal((await invokePublished(productionHandler, new Request("https://qhash.mock", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(NOWPAYMENTS_IPN_MAX_BODY_BYTES + 1),
      "x-nowpayments-sig": "0".repeat(128),
    },
    body: "{}",
  }))).status, 413);
});

test("provider status parsing preserves lexical decimals and callback creation is mocked", async () => {
  const requests = [];
  const qhashOrderId = "77777777-7777-4777-8777-777777777777";
  const client = createNowpaymentsClient({
    apiKey: "mock-only",
    ipnCallbackUrl: "https://www.qhashmine.com/api/crypto/nowpayments/ipn",
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith(`/payment/${CHILD_PROVIDER_ID}`)) {
        return new Response(
          `{"payment_id":${CHILD_PROVIDER_ID},"parent_payment_id":${ORIGINAL_PROVIDER_ID},"payment_status":"finished","pay_address":"${PAY_ADDRESS}","pay_currency":"usdtbsc","order_id":null,"outcome_amount":0.000000000000000123,"outcome_currency":"usdtbsc"}`,
          { status: 200 },
        );
      }
      if (String(input).endsWith("/payment")) {
        return Response.json({
          payment_id: ORIGINAL_PROVIDER_ID,
          payment_status: "waiting",
          pay_address: PAY_ADDRESS,
          pay_currency: "usdtbsc",
          pay_amount: 1,
          order_id: qhashOrderId,
          created_at: "2030-01-01T00:00:00Z",
          valid_until: "2030-02-01T00:00:00Z",
        });
      }
      throw new Error(`unexpected mock URL: ${String(input)}`);
    },
  });

  const details = await client.getPaymentDetails(CHILD_PROVIDER_ID);
  assert.deepEqual(details, {
    providerPaymentId: CHILD_PROVIDER_ID,
    parentProviderPaymentId: ORIGINAL_PROVIDER_ID,
    qhashOrderId: null,
    payAddress: PAY_ADDRESS,
    payCurrency: "usdtbsc",
    providerPaymentStatus: "finished",
    outcomeAmountUsdt: "0.000000000000000123",
    outcomeCurrency: "usdtbsc",
  });

  await client.createPayment({
    technicalReferenceAmountUsdt: "1",
    qhashOrderId,
  });
  const createRequest = requests.find((request) => request.url.endsWith("/payment"));
  const body = JSON.parse(String(createRequest.init.body));
  assert.equal(body.ipn_callback_url, "https://www.qhashmine.com/api/crypto/nowpayments/ipn");
  assert.equal(body.pay_currency, "usdtbsc");
});

test("authorized admin recovery settles verified original and repeated child payments", async () => {
  for (const payment of [
    verifiedFinishedPayment(),
    verifiedFinishedPayment({
      providerPaymentId: CHILD_PROVIDER_ID,
      parentProviderPaymentId: ORIGINAL_PROVIDER_ID,
      qhashOrderId: null,
      outcomeAmountUsdt: "0.25",
    }),
  ]) {
    const events = [];
    const settlements = [];
    const handler = createNowpaymentsUsdtReconcilePaymentHandler({
      getEnvironment(name) {
        events.push(`environment:${name}`);
        return recoveryEnvironment(name);
      },
      async authorizeAdmin(url, key, token) {
        events.push("authorized-admin");
        assert.equal(url, "https://supabase.mock");
        assert.equal(key, "mock-service-role-key");
        assert.equal(token, "admin-session-token");
        return "authorized";
      },
      createProvider(apiKey) {
        events.push("provider-created");
        assert.equal(apiKey, "mock-nowpayments-api-key");
        return {
          async getPaymentDetails(providerPaymentId) {
            assert.equal(providerPaymentId, payment.providerPaymentId);
            return payment;
          },
        };
      },
      createStore() {
        return {
          async settle(verifiedPayment) {
            settlements.push(verifiedPayment);
            return { status: "credited" };
          },
        };
      },
    });

    const response = await invokePublished(
      handler,
      createRecoveryRequest(payment.providerPaymentId),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      code: "reconciliation_completed",
      message: "The payment was reconciled successfully.",
    });
    assert.deepEqual(settlements, [payment]);
    assert.ok(events.indexOf("authorized-admin") < events.indexOf("environment:NOWPAYMENTS_API_KEY"));
    assert.ok(events.indexOf("environment:NOWPAYMENTS_API_KEY") < events.indexOf("provider-created"));
  }
});

test("duplicate and concurrent admin recovery attempts return safe idempotent results", async () => {
  let firstCreditAvailable = true;
  let settlementCalls = 0;
  const handler = createNowpaymentsUsdtReconcilePaymentHandler({
    getEnvironment: recoveryEnvironment,
    async authorizeAdmin() {
      return "authorized";
    },
    createProvider() {
      return {
        async getPaymentDetails() {
          return verifiedFinishedPayment({ outcomeAmountUsdt: "0.75" });
        },
      };
    },
    createStore() {
      return {
        async settle() {
          settlementCalls += 1;
          await Promise.resolve();
          if (firstCreditAvailable) {
            firstCreditAvailable = false;
            return { status: "credited" };
          }
          return { status: "already_credited" };
        },
      };
    },
  });

  const responses = await Promise.all([
    invokePublished(handler, createRecoveryRequest(ORIGINAL_PROVIDER_ID)),
    invokePublished(handler, createRecoveryRequest(ORIGINAL_PROVIDER_ID)),
    invokePublished(handler, createRecoveryRequest(ORIGINAL_PROVIDER_ID)),
  ]);
  const bodies = await Promise.all(responses.map((response) => response.json()));
  assert.equal(settlementCalls, 3);
  assert.deepEqual(bodies, Array(3).fill({
    success: true,
    code: "reconciliation_completed",
    message: "The payment was reconciled successfully.",
  }));
});

test("signed IPN followed by administrator recovery credits exactly once", async (t) => {
  const db = await createMigratedDatabase(t);
  const session = await createReadySession(db);
  const payment = verifiedFinishedPayment({
    qhashOrderId: session.qhash_order_id,
    outcomeAmountUsdt: "0.123456789012345678",
  });
  const handlers = createCrossHandlerPair(db, payment);

  const ipnResponse = await invokePublished(handlers.ipn, createSignedRequest({
    payment_id: ORIGINAL_PROVIDER_ID,
  }));
  assert.equal(ipnResponse.status, 200);
  assert.deepEqual(await ipnResponse.json(), { status: "processed" });

  const recoveryResponse = await invokePublished(
    handlers.recovery,
    createRecoveryRequest(ORIGINAL_PROVIDER_ID),
  );
  assert.equal(recoveryResponse.status, 200);
  assert.deepEqual(await recoveryResponse.json(), {
    success: true,
    code: "reconciliation_completed",
    message: "The payment was reconciled successfully.",
  });

  await assertSingleCrossHandlerCredit(db, "0.123456789012345678");
});

test("administrator recovery followed by signed IPN credits exactly once", async (t) => {
  const db = await createMigratedDatabase(t);
  const session = await createReadySession(db);
  const payment = verifiedFinishedPayment({
    qhashOrderId: session.qhash_order_id,
    outcomeAmountUsdt: "0.123456789012345678",
  });
  const handlers = createCrossHandlerPair(db, payment);

  const recoveryResponse = await invokePublished(
    handlers.recovery,
    createRecoveryRequest(ORIGINAL_PROVIDER_ID),
  );
  assert.equal(recoveryResponse.status, 200);
  assert.deepEqual(await recoveryResponse.json(), {
    success: true,
    code: "reconciliation_completed",
    message: "The payment was reconciled successfully.",
  });

  const ipnResponse = await invokePublished(handlers.ipn, createSignedRequest({
    payment_id: ORIGINAL_PROVIDER_ID,
  }));
  assert.equal(ipnResponse.status, 200);
  assert.deepEqual(await ipnResponse.json(), { status: "processed" });

  await assertSingleCrossHandlerCredit(db, "0.123456789012345678");
});

test("manual recovery rejects non-production, unauthorized, and non-admin requests", async () => {
  const rejectedContexts = [
    { deploy: { context: "production", published: false } },
    { deploy: { context: "deploy-preview", published: true } },
    { deploy: { context: "branch-deploy", published: true } },
    { deploy: { context: "preview-server", published: true } },
    { deploy: { context: "dev", published: true } },
    { deploy: { context: "custom-context", published: true } },
    undefined,
    null,
    {},
    { deploy: null },
    { deploy: { published: true } },
    { deploy: { context: "production" } },
    { deploy: { context: "production", published: "true" } },
    "production",
    Object.defineProperty({}, "deploy", {
      get() { throw new Error("sensitive malformed context detail"); },
    }),
  ];

  for (const runtimeContext of rejectedContexts) {
    const reads = [];
    let authorizationCalls = 0;
    let providerCalls = 0;
    let storeCalls = 0;
    const handler = createNowpaymentsUsdtReconcilePaymentHandler({
      getEnvironment(name) {
        reads.push(name);
        throw new Error("non-production credential read");
      },
      async authorizeAdmin() {
        authorizationCalls += 1;
        return "authorized";
      },
      createProvider() {
        providerCalls += 1;
        throw new Error("non-production provider access");
      },
      createStore() {
        storeCalls += 1;
        throw new Error("non-production store access");
      },
    });
    const response = await handler(
      createRecoveryRequest(ORIGINAL_PROVIDER_ID),
      runtimeContext,
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "crypto_runtime_unavailable",
      message: "Not available.",
    });
    assert.deepEqual(reads, []);
    assert.equal(authorizationCalls, 0);
    assert.equal(providerCalls, 0);
    assert.equal(storeCalls, 0);
  }

  const missingTokenHandler = createNowpaymentsUsdtReconcilePaymentHandler({
    getEnvironment(name) {
      throw new Error(`unexpected credential read: ${name}`);
    },
  });
  const missingTokenResponse = await invokePublished(
    missingTokenHandler,
    new Request(
      "https://qhash.mock/api/admin/crypto/nowpayments/reconcile-payment",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payment_id: ORIGINAL_PROVIDER_ID }),
      },
    ),
  );
  assert.equal(missingTokenResponse.status, 401);

  for (const [authorization, expectedStatus] of [
    ["unauthorized", 401],
    ["forbidden", 403],
  ]) {
    const reads = [];
    let providerCalls = 0;
    const handler = createNowpaymentsUsdtReconcilePaymentHandler({
      getEnvironment(name) {
        reads.push(name);
        return recoveryEnvironment(name);
      },
      async authorizeAdmin() {
        return authorization;
      },
      createProvider() {
        providerCalls += 1;
        throw new Error("provider must not be created");
      },
    });
    const response = await invokePublished(
      handler,
      createRecoveryRequest(ORIGINAL_PROVIDER_ID),
    );
    assert.equal(response.status, expectedStatus);
    assert.equal(providerCalls, 0);
    assert.ok(!reads.includes("NOWPAYMENTS_API_KEY"));
  }
});

test("manual recovery accepts only strict POST JSON containing one provider payment ID", async () => {
  let authorizationCalls = 0;
  let providerCalls = 0;
  const handler = createNowpaymentsUsdtReconcilePaymentHandler({
    getEnvironment: recoveryEnvironment,
    async authorizeAdmin() {
      authorizationCalls += 1;
      return "authorized";
    },
    createProvider() {
      providerCalls += 1;
      throw new Error("provider must not be reached");
    },
  });
  const url = "https://qhash.mock/api/admin/crypto/nowpayments/reconcile-payment";
  const headers = {
    authorization: "Bearer admin-session-token",
    "content-type": "application/json",
  };

  const invalidRequests = [
    new Request(url, { method: "GET", headers }),
    new Request(url, {
      method: "POST",
      headers: { ...headers, "content-type": "text/plain" },
      body: JSON.stringify({ payment_id: ORIGINAL_PROVIDER_ID }),
    }),
    new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ payment_id: Number(ORIGINAL_PROVIDER_ID) }),
    }),
    new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ payment_id: ` ${ORIGINAL_PROVIDER_ID}` }),
    }),
    new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ payment_id: ORIGINAL_PROVIDER_ID, user_id: USER_ID }),
    }),
    new Request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ payment_id: "1".repeat(4_097) }),
    }),
  ];

  const responses = [];
  for (const request of invalidRequests) {
    responses.push(await invokePublished(handler, request));
  }
  assert.deepEqual(
    responses.map((response) => response.status),
    [405, 415, 400, 400, 400, 413],
  );
  assert.equal(authorizationCalls, 0);
  assert.equal(providerCalls, 0);
});

test("manual recovery failures are byte-for-byte indistinguishable", async () => {
  const providerFailure = (code) => ({
    async getPaymentDetails() {
      throw new NowpaymentsClientError(code);
    },
  });
  const providerPayment = (payment) => ({
    async getPaymentDetails() {
      return payment;
    },
  });
  const rejectedStore = () => ({
    async settle() {
      throw new NowpaymentsSettlementStoreError("settlement_rpc_failed", true);
    },
  });

  const cases = [
    { name: "unknown provider payment", provider: providerFailure("payment_status_request_failed") },
    { name: "provider timeout", provider: providerFailure("payment_status_request_failed") },
    {
      name: "non-finished payment",
      provider: providerPayment(verifiedFinishedPayment({
        providerPaymentStatus: "confirming",
        outcomeAmountUsdt: null,
        outcomeCurrency: null,
      })),
    },
    {
      name: "wrong currency",
      provider: providerPayment(verifiedFinishedPayment({ payCurrency: "usdttrc20" })),
    },
    {
      name: "invalid outcome amount",
      provider: providerPayment(verifiedFinishedPayment({ outcomeAmountUsdt: "0" })),
    },
    {
      name: "returned provider ID mismatch",
      provider: providerPayment(verifiedFinishedPayment({ providerPaymentId: CHILD_PROVIDER_ID })),
    },
    {
      name: "non-QHash-owned payment",
      provider: providerPayment(verifiedFinishedPayment()),
      store: rejectedStore(),
    },
    {
      name: "parent ownership mismatch",
      provider: providerPayment(verifiedFinishedPayment({
        providerPaymentId: CHILD_PROVIDER_ID,
        parentProviderPaymentId: "90071992547409939999",
        qhashOrderId: null,
      })),
      requestPaymentId: CHILD_PROVIDER_ID,
      store: rejectedStore(),
    },
    {
      name: "address ownership mismatch",
      provider: providerPayment(verifiedFinishedPayment({
        payAddress: "0x8888888888888888888888888888888888888888",
      })),
      store: rejectedStore(),
    },
    {
      name: "order ownership mismatch",
      provider: providerPayment(verifiedFinishedPayment({
        qhashOrderId: "88888888-8888-4888-8888-888888888888",
      })),
      store: rejectedStore(),
    },
    {
      name: "session ownership mismatch",
      provider: providerPayment(verifiedFinishedPayment()),
      store: rejectedStore(),
    },
    {
      name: "database settlement failure",
      provider: providerPayment(verifiedFinishedPayment()),
      store: {
        async settle() {
          throw new NowpaymentsSettlementStoreError("settlement_rpc_failed", false);
        },
      },
    },
  ];

  const fingerprints = [];
  for (const testCase of cases) {
    let settlementCalls = 0;
    const handler = createNowpaymentsUsdtReconcilePaymentHandler({
      getEnvironment: recoveryEnvironment,
      async authorizeAdmin() {
        return "authorized";
      },
      createProvider() {
        return testCase.provider;
      },
      createStore() {
        const store = testCase.store ?? {
          async settle() {
            settlementCalls += 1;
            return { status: "credited" };
          },
        };
        return {
          async settle(payment) {
            settlementCalls += 1;
            return store.settle(payment);
          },
        };
      },
    });
    const response = await invokePublished(
      handler,
      createRecoveryRequest(testCase.requestPaymentId ?? ORIGINAL_PROVIDER_ID),
    );
    fingerprints.push({ name: testCase.name, value: await responseFingerprint(response) });

    if (!testCase.store) assert.equal(settlementCalls, 0, testCase.name);
  }

  const expected = {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      success: false,
      code: "reconciliation_not_completed",
      message: "The payment could not be reconciled. Verify the payment ID or try again later.",
    }),
  };
  for (const fingerprint of fingerprints) {
    assert.deepEqual(fingerprint.value, expected, fingerprint.name);
  }
});

test("manual recovery preserves exact sub-one-USDT outcomes and fails safely", async () => {
  const exactAmount = "0.000000000000000123";
  let settledAmount = null;
  const exactHandler = createNowpaymentsUsdtReconcilePaymentHandler({
    getEnvironment: recoveryEnvironment,
    async authorizeAdmin() {
      return "authorized";
    },
    createProvider() {
      return {
        async getPaymentDetails() {
          return verifiedFinishedPayment({ outcomeAmountUsdt: exactAmount });
        },
      };
    },
    createStore() {
      return {
        async settle(payment) {
          settledAmount = payment.outcomeAmountUsdt;
          return { status: "credited" };
        },
      };
    },
  });
  assert.equal(
    (await invokePublished(exactHandler, createRecoveryRequest(ORIGINAL_PROVIDER_ID))).status,
    200,
  );
  assert.equal(settledAmount, exactAmount);

  const providerFailureHandler = createNowpaymentsUsdtReconcilePaymentHandler({
    getEnvironment: recoveryEnvironment,
    async authorizeAdmin() {
      return "authorized";
    },
    createProvider() {
      return { async getPaymentDetails() { throw new Error("mock provider failure"); } };
    },
  });
  assert.equal(
    (await invokePublished(
      providerFailureHandler,
      createRecoveryRequest(ORIGINAL_PROVIDER_ID),
    )).status,
    503,
  );

  const databaseFailureHandler = createNowpaymentsUsdtReconcilePaymentHandler({
    getEnvironment: recoveryEnvironment,
    async authorizeAdmin() {
      return "authorized";
    },
    createProvider() {
      return { async getPaymentDetails() { return verifiedFinishedPayment(); } };
    },
    createStore() {
      return { async settle() { throw new Error("mock database failure"); } };
    },
  });
  assert.equal(
    (await invokePublished(
      databaseFailureHandler,
      createRecoveryRequest(ORIGINAL_PROVIDER_ID),
    )).status,
    503,
  );
});

test("types, endpoint source, and secret documentation stay server-only", () => {
  assert.match(databaseTypes, /\bnowpayments_usdt_provider_payments:\s*\{/);
  assert.match(databaseTypes, /\bsettle_verified_nowpayments_usdt_payment:\s*\{/);
  assert.match(databaseTypes, /provider_payment_record_id: string \| null/);
  assert.match(environmentExample, /^NOWPAYMENTS_IPN_SECRET=$/m);
  assert.doesNotMatch(environmentExample, /^VITE_NOWPAYMENTS/m);
  assert.doesNotMatch(endpointSource, /(?:Netlify\.env\.get|getEnvironment)\(["']CONTEXT["']\)/);
  assert.doesNotMatch(recoveryEndpointSource, /(?:Netlify\.env\.get|getEnvironment)\(["']CONTEXT["']\)/);
  assert.match(endpointSource, /import type \{ Config, Context \} from "@netlify\/functions"/);
  assert.match(recoveryEndpointSource, /import type \{ Config, Context \} from "@netlify\/functions"/);
  assert.ok(
    endpointSource.indexOf("if (!isPublishedProductionDeployContext(context))")
      < endpointSource.indexOf('getEnvironment("NOWPAYMENTS_IPN_SECRET")'),
  );
  assert.ok(
    recoveryEndpointSource.indexOf("if (!isPublishedProductionDeployContext(context))")
      < recoveryEndpointSource.indexOf('getEnvironment("VITE_SUPABASE_URL")'),
  );
  assert.ok(
    endpointSource.indexOf('getEnvironment("NOWPAYMENTS_IPN_SECRET")')
      < endpointSource.indexOf('getEnvironment("NOWPAYMENTS_API_KEY")'),
  );
  assert.doesNotMatch(endpointSource, /console\.(log|info|warn|error)/);
  assert.doesNotMatch(recoveryEndpointSource, /console\.(log|info|warn|error)/);
  assert.doesNotMatch(
    recoveryEndpointSource,
    /(?:error|code):\s*"(?:payment_not_finished|provider_payment_invalid|provider_unavailable|payment_not_owned|settlement_unavailable)"/,
  );
  assert.match(recoveryEndpointSource, /code: "reconciliation_not_completed"/);
  assert.match(recoveryEndpointSource, /\.select\("is_admin, is_frozen"\)/);
  assert.match(recoveryEndpointSource, /providerPaymentStatus !== "finished"/);
  assert.match(recoveryDocumentation, /cannot automatically discover/i);
  assert.match(recoveryDocumentation, /contacts NOWPayments support/i);
  assert.match(recoveryDocumentation, /manual reconciliation, not automatic discovery/i);
});

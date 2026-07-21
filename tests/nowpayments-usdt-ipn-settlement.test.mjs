import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";
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
import {
  getOrCreateNowpaymentsDepositSession,
} from "../netlify/functions/lib/nowpayments-deposit-session.mts";

const { Client } = pg;

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
const grossCreditMigration = await readFile(
  new URL(
    "supabase/migrations/20260720213000_nowpayments_gross_deposit_credit/migration.sql",
    repositoryRoot,
  ),
  "utf8",
);
const permanentAddressMigration = await readFile(
  new URL(
    "supabase/migrations/20260721120000_nowpayments_permanent_deposit_address_lifecycle/migration.sql",
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
const PRODUCTION_ORIGINAL_PROVIDER_ID = "5649600523";
const PRODUCTION_CHILD_PROVIDER_ID = "5470246076";
const PRODUCTION_SECOND_CHILD_PROVIDER_ID = "4713337973";
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

async function createPreGrossDatabase(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await createFixture(db);
  await applyMigration(db, foundationMigration);
  await applyMigration(db, sessionMigration);
  await applyMigration(db, settlementMigration);
  return db;
}

async function createMigratedDatabase(t) {
  const db = await createPreGrossDatabase(t);
  await applyMigration(db, grossCreditMigration);
  return db;
}

async function createReadySession(db, providerPaymentId = ORIGINAL_PROVIDER_ID) {
  await db.exec(`
    update public.nowpayments_usdt_config
    set enabled = true
    where id = 'USDT-BEP20';
  `);
  const usesProviderFreeClaim = (await db.query(`
    select to_regprocedure(
      'public.claim_nowpayments_usdt_deposit_session(uuid)'
    ) is not null as enabled
  `)).rows[0].enabled;
  let session;
  if (usesProviderFreeClaim) {
    const reserved = (await db.query(`
      select public.claim_nowpayments_usdt_deposit_session(
        '${USER_ID}'::uuid
      ) as response
    `)).rows[0].response;
    session = (await db.query(
      `select public.configure_nowpayments_usdt_deposit_session_amounts(
         $1::uuid, $2::uuid, $3::uuid, '0.25', '1'
       ) as response`,
      [USER_ID, reserved.id, reserved.qhash_order_id],
    )).rows[0].response;
  } else {
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
    session = claimed.rows[0];
  }
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

async function createProductionLifecycleBaseline(t) {
  const db = await createPreGrossDatabase(t);
  const session = await createReadySession(db, PRODUCTION_ORIGINAL_PROVIDER_ID);
  await settleNetOutcome(db, {
    providerPaymentId: PRODUCTION_ORIGINAL_PROVIDER_ID,
    qhashOrderId: session.qhash_order_id,
    outcomeAmount: "2.95192543",
  });
  await settleNetOutcome(db, {
    providerPaymentId: PRODUCTION_CHILD_PROVIDER_ID,
    parentProviderPaymentId: PRODUCTION_ORIGINAL_PROVIDER_ID,
    outcomeAmount: "2.9519285",
  });
  await applyMigration(db, grossCreditMigration);
  await settle(db, {
    providerPaymentId: PRODUCTION_SECOND_CHILD_PROVIDER_ID,
    parentProviderPaymentId: PRODUCTION_ORIGINAL_PROVIDER_ID,
    actuallyPaid: "3",
    outcomeAmount: "2.9519",
  });
  await db.exec(`
    update public.nowpayments_usdt_payments
    set provider_created_at = '2026-07-20T15:13:56Z',
        provider_valid_until = '2026-07-27T15:13:56Z';
    update public.nowpayments_usdt_provider_payments
    set provider_verified_at = '2026-07-20T16:35:38Z'
    where payment_kind = 'original';
  `);
  return { db, session };
}

async function settle(db, {
  providerPaymentId = ORIGINAL_PROVIDER_ID,
  parentProviderPaymentId = null,
  qhashOrderId,
  payAddress = PAY_ADDRESS,
  payCurrency = "usdtbsc",
  providerPaymentStatus = "finished",
  outcomeAmount = "0.75",
  actuallyPaid = outcomeAmount,
  outcomeCurrency = "usdtbsc",
} = {}) {
  const result = await db.query(
    `select public.settle_verified_nowpayments_usdt_payment(
       $1, $2, $3, $4, $5, $6, $7, $8, $9
     ) as result`,
    [
      providerPaymentId,
      parentProviderPaymentId,
      qhashOrderId ?? null,
      payAddress,
      payCurrency,
      providerPaymentStatus,
      providerPaymentStatus === "finished" ? actuallyPaid : null,
      providerPaymentStatus === "finished" ? outcomeAmount : null,
      providerPaymentStatus === "finished" ? outcomeCurrency : null,
    ],
  );
  return result.rows[0].result;
}

async function settleNetOutcome(db, {
  providerPaymentId,
  parentProviderPaymentId = null,
  qhashOrderId = null,
  outcomeAmount,
}) {
  const result = await db.query(
    `select public.settle_verified_nowpayments_usdt_payment(
       $1, $2, $3, $4, 'usdtbsc', 'finished', $5, 'usdtbsc'
     ) as result`,
    [
      providerPaymentId,
      parentProviderPaymentId,
      qhashOrderId,
      PAY_ADDRESS,
      outcomeAmount,
    ],
  );
  return result.rows[0].result;
}

async function claimSession(db) {
  const result = await db.query(`
    select public.claim_nowpayments_usdt_deposit_session('${USER_ID}'::uuid) as result
  `);
  const reserved = result.rows[0].result;
  if (reserved.disposition !== "claimed") return reserved;
  const configured = await db.query(
    `select public.configure_nowpayments_usdt_deposit_session_amounts(
       $1::uuid, $2::uuid, $3::uuid, '1', '1'
     ) as result`,
    [USER_ID, reserved.id, reserved.qhash_order_id],
  );
  return { ...configured.rows[0].result, disposition: "claimed" };
}

async function lifecycleCounts(db) {
  const result = await db.query(`
    select
      (select count(*)::integer from public.nowpayments_usdt_payments) as sessions,
      (select count(*)::integer from public.nowpayments_usdt_provider_payments) as providers,
      (select count(*)::integer from public.nowpayments_usdt_payments where address_activated_at is not null) as activated,
      (select count(*)::integer from public.nowpayments_usdt_payments where session_status = 'provisioning') as provisioning,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries where entry_type = 'deposit_credit') as credits,
      (select coalesce(sum(available_balance_usdt), 0)::text from public.nowpayments_usdt_wallets) as available
  `);
  return result.rows[0];
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
  const payment = {
    providerPaymentId: ORIGINAL_PROVIDER_ID,
    parentProviderPaymentId: null,
    qhashOrderId: "77777777-7777-4777-8777-777777777777",
    payAddress: PAY_ADDRESS,
    payCurrency: "usdtbsc",
    providerPaymentStatus: "finished",
    actuallyPaidUsdt: "1",
    outcomeAmountUsdt: "1",
    outcomeCurrency: "usdtbsc",
    ...overrides,
  };
  if (!Object.hasOwn(overrides, "actuallyPaidUsdt")) {
    payment.actuallyPaidUsdt = payment.providerPaymentStatus === "finished"
      ? payment.outcomeAmountUsdt
      : null;
  }
  return payment;
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
        actuallyPaid: payment.actuallyPaidUsdt,
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
        'public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text,text)',
        'EXECUTE'
      ) as service_settle,
      has_function_privilege(
        'authenticated',
        'public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text,text)',
        'EXECUTE'
      ) as authenticated_settle,
      to_regprocedure(
        'public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text)'
      ) is null as net_settle_dropped,
      to_regprocedure(
        'public.credit_verified_nowpayments_usdt_payment(uuid,text,text)'
      ) is null as legacy_credit_dropped
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
    net_settle_dropped: true,
    legacy_credit_dropped: true,
  }]);
});

test("production fingerprint receives two immutable gross-credit corrections exactly once", async (t) => {
  const db = await createPreGrossDatabase(t);
  const session = await createReadySession(db, PRODUCTION_ORIGINAL_PROVIDER_ID);
  await settleNetOutcome(db, {
    providerPaymentId: PRODUCTION_ORIGINAL_PROVIDER_ID,
    qhashOrderId: session.qhash_order_id,
    outcomeAmount: "2.95192543",
  });
  await settleNetOutcome(db, {
    providerPaymentId: PRODUCTION_CHILD_PROVIDER_ID,
    parentProviderPaymentId: PRODUCTION_ORIGINAL_PROVIDER_ID,
    outcomeAmount: "2.9519285",
  });

  const immutableBefore = await db.query(`
    select
      ledger.id::text,
      provider.provider_payment_id,
      ledger.entry_type,
      ledger.available_before_usdt::text,
      ledger.available_delta_usdt::text,
      ledger.available_after_usdt::text,
      ledger.reserved_before_usdt::text,
      ledger.reserved_delta_usdt::text,
      ledger.reserved_after_usdt::text,
      ledger.created_at::text
    from public.nowpayments_usdt_ledger_entries ledger
    join public.nowpayments_usdt_provider_payments provider
      on provider.id = ledger.provider_payment_record_id
    order by ledger.created_at, ledger.id
  `);

  await applyMigration(db, grossCreditMigration);

  const state = await db.query(`
    select
      (select enabled from public.nowpayments_usdt_config where id = 'USDT-BEP20') as enabled,
      (select available_balance_usdt::text from public.nowpayments_usdt_wallets) as available,
      (select reserved_balance_usdt::text from public.nowpayments_usdt_wallets) as reserved,
      (select credited_amount_usdt::text from public.nowpayments_usdt_payments) as session_credited,
      (select outcome_amount::text from public.nowpayments_usdt_payments) as session_outcome,
      (select count(*)::integer from public.nowpayments_usdt_provider_payments) as providers,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger_entries,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries where entry_type = 'deposit_credit') as original_credits,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries where entry_type = 'deposit_credit_correction') as corrections,
      (select sum(available_delta_usdt)::text from public.nowpayments_usdt_ledger_entries) as ledger_total,
      (select count(*)::integer from public.nowpayments_usdt_withdrawals) as withdrawals,
      (select balance::text from public.wallets where user_id = '${USER_ID}') as etb_balance,
      (select count(*)::integer from public.transactions) as etb_transactions,
      (select array_agg(type::text order by type::text) from public.payment_methods) as payment_types,
      (select status from public.crypto_deposit_addresses where id = '${ARCHIVE_ADDRESS_ID}') as archive_status,
      (select amount_usdt::text from public.crypto_deposits where id = '${ARCHIVE_DEPOSIT_ID}') as archive_amount
  `);
  assert.deepEqual(state.rows, [{
    enabled: false,
    available: "6.000000000000000000",
    reserved: "0.000000000000000000",
    session_credited: "3.000000000000000000",
    session_outcome: "2.951925430000000000",
    providers: 2,
    ledger_entries: 4,
    original_credits: 2,
    corrections: 2,
    ledger_total: "6.000000000000000000",
    withdrawals: 0,
    etb_balance: "1234.56",
    etb_transactions: 1,
    payment_types: ["cbe", "telebirr"],
    archive_status: "disabled",
    archive_amount: "9.990000",
  }]);

  const providers = await db.query(`
    select
      provider_payment_id,
      parent_provider_payment_id,
      payment_kind,
      actually_paid_usdt::text,
      outcome_amount_usdt::text,
      credited_amount_usdt::text,
      (actually_paid_usdt - outcome_amount_usdt)::text as merchant_fee_absorbed
    from public.nowpayments_usdt_provider_payments
    order by payment_kind, provider_payment_id
  `);
  assert.deepEqual(providers.rows, [
    {
      provider_payment_id: PRODUCTION_ORIGINAL_PROVIDER_ID,
      parent_provider_payment_id: null,
      payment_kind: "original",
      actually_paid_usdt: "3.000000000000000000",
      outcome_amount_usdt: "2.951925430000000000",
      credited_amount_usdt: "3.000000000000000000",
      merchant_fee_absorbed: "0.048074570000000000",
    },
    {
      provider_payment_id: PRODUCTION_CHILD_PROVIDER_ID,
      parent_provider_payment_id: PRODUCTION_ORIGINAL_PROVIDER_ID,
      payment_kind: "repeated",
      actually_paid_usdt: "3.000000000000000000",
      outcome_amount_usdt: "2.951928500000000000",
      credited_amount_usdt: "3.000000000000000000",
      merchant_fee_absorbed: "0.048071500000000000",
    },
  ]);

  const corrections = await db.query(`
    select
      provider.provider_payment_id,
      ledger.available_before_usdt::text,
      ledger.available_delta_usdt::text,
      ledger.available_after_usdt::text,
      ledger.metadata ->> 'source_amount_field' as source_amount_field
    from public.nowpayments_usdt_ledger_entries ledger
    join public.nowpayments_usdt_provider_payments provider
      on provider.id = ledger.provider_payment_record_id
    where ledger.entry_type = 'deposit_credit_correction'
    order by ledger.available_before_usdt
  `);
  assert.deepEqual(corrections.rows, [
    {
      provider_payment_id: PRODUCTION_ORIGINAL_PROVIDER_ID,
      available_before_usdt: "5.903853930000000000",
      available_delta_usdt: "0.048074570000000000",
      available_after_usdt: "5.951928500000000000",
      source_amount_field: "actually_paid",
    },
    {
      provider_payment_id: PRODUCTION_CHILD_PROVIDER_ID,
      available_before_usdt: "5.951928500000000000",
      available_delta_usdt: "0.048071500000000000",
      available_after_usdt: "6.000000000000000000",
      source_amount_field: "actually_paid",
    },
  ]);

  const immutableAfter = await db.query(`
    select
      ledger.id::text,
      provider.provider_payment_id,
      ledger.entry_type,
      ledger.available_before_usdt::text,
      ledger.available_delta_usdt::text,
      ledger.available_after_usdt::text,
      ledger.reserved_before_usdt::text,
      ledger.reserved_delta_usdt::text,
      ledger.reserved_after_usdt::text,
      ledger.created_at::text
    from public.nowpayments_usdt_ledger_entries ledger
    join public.nowpayments_usdt_provider_payments provider
      on provider.id = ledger.provider_payment_record_id
    where ledger.entry_type = 'deposit_credit'
    order by ledger.created_at, ledger.id
  `);
  assert.deepEqual(immutableAfter.rows, immutableBefore.rows);

  await assert.rejects(
    applyMigration(db, grossCreditMigration),
    /NOWPayments settlement foundation is incomplete|gross-credit objects already exist outside migration tracking/,
  );
  assert.equal(
    (await db.query(`select count(*)::integer as count from public.nowpayments_usdt_ledger_entries`)).rows[0].count,
    4,
  );
});

test("gross-credit migration preflight refuses any unexpected populated fingerprint", async (t) => {
  const db = await createPreGrossDatabase(t);
  await createReadySession(db);

  await assert.rejects(
    applyMigration(db, grossCreditMigration),
    /unexpected NOWPayments production row counts/,
  );
  const unchanged = await db.query(`
    select
      to_regprocedure(
        'public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text)'
      ) is not null as net_settle_preserved,
      to_regprocedure(
        'public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text,text)'
      ) is null as gross_settle_absent,
      not exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'nowpayments_usdt_provider_payments'
          and column_name = 'actually_paid_usdt'
      ) as schema_unchanged,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger_count
  `);
  assert.deepEqual(unchanged.rows, [{
    net_settle_preserved: true,
    gross_settle_absent: true,
    schema_unchanged: true,
    ledger_count: 0,
  }]);
});

test("production lifecycle backfill activates exactly one address without financial or legacy drift", async (t) => {
  const { db } = await createProductionLifecycleBaseline(t);
  const immutableBefore = await db.query(`
    select jsonb_build_object(
      'providers', (select jsonb_agg(to_jsonb(provider) order by provider.provider_payment_id) from public.nowpayments_usdt_provider_payments provider),
      'ledger', (select jsonb_agg(to_jsonb(ledger) order by ledger.created_at, ledger.id) from public.nowpayments_usdt_ledger_entries ledger),
      'wallet', (select to_jsonb(wallet) from public.nowpayments_usdt_wallets wallet),
      'legacy_wallet', (select to_jsonb(wallet) from public.wallets wallet where user_id = '${USER_ID}'),
      'legacy_transactions', (select jsonb_agg(to_jsonb(transaction) order by transaction.id) from public.transactions transaction),
      'payment_methods', (select jsonb_agg(to_jsonb(method) order by method.id) from public.payment_methods method),
      'retired_address', (select to_jsonb(address) from public.crypto_deposit_addresses address where id = '${ARCHIVE_ADDRESS_ID}'),
      'retired_deposit', (select to_jsonb(deposit) from public.crypto_deposits deposit where id = '${ARCHIVE_DEPOSIT_ID}')
    ) as evidence
  `);

  await applyMigration(db, permanentAddressMigration);

  const settlementSecurity = await db.query(`
    select
      has_function_privilege(
        'service_role',
        'public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text,text)',
        'EXECUTE'
      ) as service_wrapper,
      has_function_privilege(
        'service_role',
        'public.settle_verified_nowpayments_usdt_payment_serialized_inner(text,text,text,text,text,text,text,text,text)',
        'EXECUTE'
      ) as service_inner,
      has_function_privilege(
        'authenticated',
        'public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text,text)',
        'EXECUTE'
      ) as authenticated_wrapper,
      coalesce(array_to_string(proconfig, ','), '') as wrapper_config
    from pg_proc
    where oid = 'public.settle_verified_nowpayments_usdt_payment(text,text,text,text,text,text,text,text,text)'::regprocedure
  `);
  assert.deepEqual(settlementSecurity.rows, [{
    service_wrapper: true,
    service_inner: false,
    authenticated_wrapper: false,
    wrapper_config: "search_path=pg_catalog, public",
  }]);

  const lifecycle = await db.query(`
    select
      session.provider_payment_id,
      session.address_activated_at::text,
      session.provider_valid_until::text,
      original.provider_verified_at::text,
      original.credited_at::text as original_credited_at,
      (select count(*)::integer from public.nowpayments_usdt_payments where address_activated_at is not null) as activated_count,
      (select count(*)::integer from public.nowpayments_usdt_provider_payments) as provider_count,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger_count,
      (select available_balance_usdt::text from public.nowpayments_usdt_wallets) as available,
      (select reserved_balance_usdt::text from public.nowpayments_usdt_wallets) as reserved
    from public.nowpayments_usdt_payments session
    join public.nowpayments_usdt_provider_payments original
      on original.session_id = session.id and original.payment_kind = 'original'
  `);
  assert.equal(lifecycle.rows[0].provider_payment_id, PRODUCTION_ORIGINAL_PROVIDER_ID);
  assert.equal(
    new Date(lifecycle.rows[0].address_activated_at).getTime(),
    Math.max(
      new Date(lifecycle.rows[0].provider_verified_at).getTime(),
      new Date(lifecycle.rows[0].original_credited_at).getTime(),
    ),
  );
  assert.ok(new Date(lifecycle.rows[0].address_activated_at) < new Date(lifecycle.rows[0].provider_valid_until));
  assert.equal(lifecycle.rows[0].activated_count, 1);
  assert.equal(lifecycle.rows[0].provider_count, 3);
  assert.equal(lifecycle.rows[0].ledger_count, 5);
  assert.equal(lifecycle.rows[0].available, "9.000000000000000000");
  assert.equal(lifecycle.rows[0].reserved, "0.000000000000000000");

  const immutableAfter = await db.query(`
    select jsonb_build_object(
      'providers', (select jsonb_agg(to_jsonb(provider) order by provider.provider_payment_id) from public.nowpayments_usdt_provider_payments provider),
      'ledger', (select jsonb_agg(to_jsonb(ledger) order by ledger.created_at, ledger.id) from public.nowpayments_usdt_ledger_entries ledger),
      'wallet', (select to_jsonb(wallet) from public.nowpayments_usdt_wallets wallet),
      'legacy_wallet', (select to_jsonb(wallet) from public.wallets wallet where user_id = '${USER_ID}'),
      'legacy_transactions', (select jsonb_agg(to_jsonb(transaction) order by transaction.id) from public.transactions transaction),
      'payment_methods', (select jsonb_agg(to_jsonb(method) order by method.id) from public.payment_methods method),
      'retired_address', (select to_jsonb(address) from public.crypto_deposit_addresses address where id = '${ARCHIVE_ADDRESS_ID}'),
      'retired_deposit', (select to_jsonb(deposit) from public.crypto_deposits deposit where id = '${ARCHIVE_DEPOSIT_ID}')
    ) as evidence
  `);
  assert.deepEqual(immutableAfter.rows[0].evidence, immutableBefore.rows[0].evidence);

  await db.exec("update public.nowpayments_usdt_config set enabled = true where id = 'USDT-BEP20'");
  const reused = await Promise.all([
    db.query(`select public.get_current_nowpayments_usdt_deposit_session('${USER_ID}'::uuid) as result`),
    db.query(`select public.claim_nowpayments_usdt_deposit_session('${USER_ID}'::uuid) as result`),
  ]);
  assert.equal(reused[0].rows[0].result.disposition, "activated");
  assert.equal(reused[1].rows[0].result.disposition, "activated");
  assert.equal(
    (await db.query("select count(*)::integer as count from public.nowpayments_usdt_payments")).rows[0].count,
    1,
  );
  await db.exec("update public.nowpayments_usdt_config set enabled = false where id = 'USDT-BEP20'");

  await assert.rejects(
    db.exec("update public.nowpayments_usdt_payments set address_activated_at = address_activated_at + interval '1 second'"),
    /activation timestamp is immutable/,
  );
  await assert.rejects(
    db.exec("update public.nowpayments_usdt_payments set provider_valid_until = provider_valid_until + interval '1 day'"),
    /activation deadline is immutable/,
  );
  await assert.rejects(
    db.exec(`
      insert into public.nowpayments_usdt_payments (
        user_id, provider_payment_id, provider_payment_status,
        verification_status, asset, network, provider_currency,
        qhash_order_id, session_status, pay_address,
        technical_reference_amount_usdt, provider_minimum_usdt,
        provider_created_at, provider_valid_until, address_activated_at,
        provisioning_started_at, provisioned_at, terminal_at, terminal_reason,
        settled_by_provider_payment_id, outcome_amount, outcome_currency,
        verified_at, credited_amount_usdt, credited_at
      )
      select
        user_id, '5649600524', provider_payment_status,
        verification_status, asset, network, provider_currency,
        gen_random_uuid(), session_status, pay_address,
        technical_reference_amount_usdt, provider_minimum_usdt,
        provider_created_at, provider_valid_until, address_activated_at,
        provisioning_started_at, provisioned_at, terminal_at, terminal_reason,
        '5649600524', outcome_amount, outcome_currency,
        verified_at, credited_amount_usdt, credited_at
      from public.nowpayments_usdt_payments
      where provider_payment_id = '${PRODUCTION_ORIGINAL_PROVIDER_ID}'
    `),
    /one_activated_address_per_user|duplicate key value/,
  );
});

test("repeated settlement after the original deadline credits gross and never changes activation evidence", async (t) => {
  const { db } = await createProductionLifecycleBaseline(t);
  await db.exec(`
    update public.nowpayments_usdt_payments
    set provider_created_at = '2020-01-01T00:00:00Z',
        provider_valid_until = '2020-01-08T00:00:00Z';
    update public.nowpayments_usdt_provider_payments
    set provider_verified_at = '2020-01-02T00:00:00Z',
        credited_at = '2020-01-03T00:00:00Z'
    where payment_kind = 'original';
  `);
  await applyMigration(db, permanentAddressMigration);
  const before = await db.query(`
    select address_activated_at::text, provider_valid_until::text
    from public.nowpayments_usdt_payments
  `);
  const result = await settle(db, {
    providerPaymentId: "4713337974",
    parentProviderPaymentId: PRODUCTION_ORIGINAL_PROVIDER_ID,
    actuallyPaid: "3",
    outcomeAmount: "2.95",
  });
  assert.equal(result.status, "credited");
  assert.equal(result.credited_amount_usdt, "3.000000000000000000");
  const after = await db.query(`
    select
      session.address_activated_at::text,
      session.provider_valid_until::text,
      wallet.available_balance_usdt::text as available,
      wallet.reserved_balance_usdt::text as reserved,
      (select count(*)::integer from public.nowpayments_usdt_provider_payments) as providers,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries where entry_type = 'deposit_credit_correction') as corrections
    from public.nowpayments_usdt_payments session
    join public.nowpayments_usdt_wallets wallet on wallet.user_id = session.user_id
  `);
  assert.equal(after.rows[0].address_activated_at, before.rows[0].address_activated_at);
  assert.equal(after.rows[0].provider_valid_until, before.rows[0].provider_valid_until);
  assert.equal(after.rows[0].available, "12.000000000000000000");
  assert.equal(after.rows[0].reserved, "0.000000000000000000");
  assert.equal(after.rows[0].providers, 4);
  assert.equal(after.rows[0].ledger, 6);
  assert.equal(after.rows[0].corrections, 2);
  await db.exec("update public.nowpayments_usdt_config set enabled = true where id = 'USDT-BEP20'");
  const reused = await claimSession(db);
  assert.equal(reused.disposition, "activated");
  assert.equal(reused.provider_payment_id, PRODUCTION_ORIGINAL_PROVIDER_ID);
  assert.equal((await lifecycleCounts(db)).sessions, 1);
  await db.exec("update public.nowpayments_usdt_config set enabled = false where id = 'USDT-BEP20'");
});

test("late original settlement credits safely but cannot activate and replacement history is retained", async (t) => {
  const db = await createMigratedDatabase(t);
  await applyMigration(db, permanentAddressMigration);
  await db.exec("update public.nowpayments_usdt_config set enabled = true where id = 'USDT-BEP20'");
  const session = await claimSession(db);
  await db.query(`
    update public.nowpayments_usdt_payments
    set provider_payment_id = '88001',
        provider_payment_status = 'waiting',
        pay_address = $1,
        provider_created_at = '2020-01-01T00:00:00Z',
        provider_valid_until = '2020-01-08T00:00:00Z',
        session_status = 'ready',
        provisioned_at = now()
    where id = $2::uuid
  `, [PAY_ADDRESS, session.id]);
  await db.exec("update public.nowpayments_usdt_config set enabled = false where id = 'USDT-BEP20'");

  const credited = await settle(db, {
    providerPaymentId: "88001",
    qhashOrderId: session.qhash_order_id,
    actuallyPaid: "3",
    outcomeAmount: "2.95",
  });
  assert.equal(credited.status, "credited");
  const late = await db.query(`
    select
      address_activated_at,
      provider_valid_until::text,
      credited_amount_usdt::text,
      (select available_balance_usdt::text from public.nowpayments_usdt_wallets) as available,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger
    from public.nowpayments_usdt_payments
    where id = '${session.id}'::uuid
  `);
  assert.equal(late.rows[0].address_activated_at, null);
  assert.equal(late.rows[0].credited_amount_usdt, "3.000000000000000000");
  assert.equal(late.rows[0].available, "3.000000000000000000");
  assert.equal(late.rows[0].ledger, 1);

  await db.exec("update public.nowpayments_usdt_config set enabled = true where id = 'USDT-BEP20'");
  const replacement = await claimSession(db);
  assert.equal(replacement.disposition, "claimed");
  assert.notEqual(replacement.id, session.id);
  assert.equal(
    (await db.query("select count(*)::integer as count from public.nowpayments_usdt_payments")).rows[0].count,
    2,
  );
  await db.exec("update public.nowpayments_usdt_config set enabled = false where id = 'USDT-BEP20'");
});

test("deadline equality and credited-after-deadline evidence never activate", async (t) => {
  const db = await createMigratedDatabase(t);
  await applyMigration(db, permanentAddressMigration);
  await db.exec("update public.nowpayments_usdt_config set enabled = true where id = 'USDT-BEP20'");
  const session = await claimSession(db);
  await db.query(`
    update public.nowpayments_usdt_payments
    set provider_payment_id = '88101',
        provider_payment_status = 'waiting',
        pay_address = $1,
        provider_created_at = '2020-01-01T00:00:00Z',
        provider_valid_until = '2020-01-08T00:00:00Z',
        session_status = 'ready',
        provisioned_at = now()
    where id = $2::uuid
  `, [PAY_ADDRESS, session.id]);

  await settle(db, {
    providerPaymentId: "88101",
    qhashOrderId: session.qhash_order_id,
    actuallyPaid: "3",
    outcomeAmount: "2.95",
  });
  await db.exec(`
    update public.nowpayments_usdt_provider_payments
    set provider_verified_at = '2020-01-08T00:00:00Z',
        credited_at = '2020-01-08T00:00:00Z'
    where provider_payment_id = '88101';
  `);
  assert.equal(
    (await db.query("select address_activated_at from public.nowpayments_usdt_payments")).rows[0].address_activated_at,
    null,
  );

  await db.exec(`
    update public.nowpayments_usdt_provider_payments
    set provider_verified_at = '2020-01-07T23:59:59Z',
        credited_at = '2020-01-08T00:00:01Z'
    where provider_payment_id = '88101';
  `);
  assert.equal(
    (await db.query("select address_activated_at from public.nowpayments_usdt_payments")).rows[0].address_activated_at,
    null,
  );
  await assert.rejects(
    db.exec("update public.nowpayments_usdt_payments set address_activated_at = provider_valid_until"),
    /activation evidence is outside|address_activation_check/,
  );
  await db.exec("update public.nowpayments_usdt_config set enabled = false where id = 'USDT-BEP20'");
});

test("a repeated child finishing before the deadline never activates without original evidence", async (t) => {
  const db = await createMigratedDatabase(t);
  await applyMigration(db, permanentAddressMigration);
  const session = await createReadySession(db, "88201");
  const child = await settle(db, {
    providerPaymentId: "88202",
    parentProviderPaymentId: "88201",
    actuallyPaid: "3",
    outcomeAmount: "2.95",
  });
  assert.equal(child.status, "credited");
  const evidence = await db.query(`
    select
      session.address_activated_at,
      provider.payment_kind,
      provider.parent_provider_payment_id,
      (select count(*)::integer from public.nowpayments_usdt_provider_payments) as providers
    from public.nowpayments_usdt_payments session
    join public.nowpayments_usdt_provider_payments provider on provider.session_id = session.id
  `);
  assert.deepEqual(evidence.rows, [{
    address_activated_at: null,
    payment_kind: "repeated",
    parent_provider_payment_id: "88201",
    providers: 1,
  }]);
});

function disposablePostgresUrl(t) {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    t.skip("TEST_DATABASE_URL is required for the native PostgreSQL concurrency fixture");
    return null;
  }
  const parsed = new URL(raw);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:"
    || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    || !/^qhash_test_[a-z0-9_]+$/.test(databaseName)
  ) {
    throw new Error(
      "TEST_DATABASE_URL must target an explicitly disposable local qhash_test_* database",
    );
  }
  return raw;
}

function nativeDb(client) {
  return {
    exec(sql) { return client.query(sql); },
    query(sql, parameters) { return client.query(sql, parameters); },
  };
}

async function resetNativeLifecycleFixture(client) {
  await client.query("drop schema if exists public cascade; create schema public");
  const db = nativeDb(client);
  await createFixture(db);
  for (const migration of [
    foundationMigration,
    sessionMigration,
    settlementMigration,
    grossCreditMigration,
    permanentAddressMigration,
  ]) {
    await applyMigration(db, migration);
  }
}

async function seedTerminalNativeOriginal(client, providerPaymentId) {
  await client.query(
    "update public.nowpayments_usdt_config set enabled = true where id = 'USDT-BEP20'",
  );
  const reserved = (await client.query(
    "select public.claim_nowpayments_usdt_deposit_session($1::uuid) as result",
    [USER_ID],
  )).rows[0].result;
  assert.equal(reserved.disposition, "claimed");
  await client.query(
    `select public.configure_nowpayments_usdt_deposit_session_amounts(
       $1::uuid, $2::uuid, $3::uuid, '1', '1'
     )`,
    [USER_ID, reserved.id, reserved.qhash_order_id],
  );
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  const deadline = new Date(Date.now() + 120_000).toISOString();
  await client.query(
    `select public.complete_nowpayments_usdt_deposit_session(
       $1::uuid, $2::uuid, $3, $4, 'waiting', $5::timestamptz, $6::timestamptz
     )`,
    [reserved.id, reserved.qhash_order_id, providerPaymentId, PAY_ADDRESS, createdAt, deadline],
  );
  await client.query(
    `select public.record_nowpayments_usdt_deposit_session_status(
       $1::uuid, $2::uuid, $3, 'expired'
     )`,
    [reserved.id, reserved.qhash_order_id, providerPaymentId],
  );
  return { ...reserved, deadline };
}

async function settleNativeOriginal(client, session, providerPaymentId, functionName) {
  const result = await client.query(
    `select public.${functionName}(
       $1, null, $2, $3, 'usdtbsc', 'finished', '3', '2.95', 'usdtbsc'
     ) as result`,
    [providerPaymentId, session.qhash_order_id, PAY_ADDRESS],
  );
  return result.rows[0].result;
}

async function waitForBackendWait(
  observer,
  backendPid,
  expectedWaitType,
  expectedBlockerPid = null,
  timeoutMs = 3_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const activity = await observer.query(
      `select
         wait_event_type,
         wait_event,
         query,
         case when $2::integer is null then null
              else $2::integer = any(pg_catalog.pg_blocking_pids(pid))
          end as expected_blocker
       from pg_catalog.pg_stat_activity
       where pid = $1`,
      [backendPid, expectedBlockerPid],
    );
    if (
      activity.rows[0]?.wait_event_type === expectedWaitType
      && (expectedBlockerPid === null || activity.rows[0].expected_blocker === true)
    ) return activity.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${backendPid} did not enter ${expectedWaitType} wait within ${timeoutMs}ms`);
}

async function bounded(promise, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function nativeLifecycleCounts(client) {
  return (await client.query(`
    select
      (select count(*)::integer from public.nowpayments_usdt_payments) as sessions,
      (select count(*)::integer from public.nowpayments_usdt_provider_payments) as providers,
      (select count(*)::integer from public.nowpayments_usdt_payments where address_activated_at is not null) as activated,
      (select count(*)::integer from public.nowpayments_usdt_payments where session_status = 'provisioning') as provisioning,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries where entry_type = 'deposit_credit') as credits,
      (select coalesce(sum(available_balance_usdt), 0)::text from public.nowpayments_usdt_wallets) as available
  `)).rows[0];
}

test("native PostgreSQL serializes qualifying settlement against replacement claim", {
  timeout: 30_000,
}, async (t) => {
  const connectionString = disposablePostgresUrl(t);
  if (!connectionString) return;

  const setup = new Client({ connectionString, application_name: "qhash-lifecycle-observer" });
  const settlementClient = new Client({ connectionString, application_name: "qhash-lifecycle-settlement" });
  const claimClient = new Client({ connectionString, application_name: "qhash-lifecycle-claim" });
  await Promise.all([setup.connect(), settlementClient.connect(), claimClient.connect()]);
  t.after(async () => {
    await Promise.allSettled([
      setup.query("rollback"),
      settlementClient.query("rollback"),
      claimClient.query("rollback"),
    ]);
    await Promise.allSettled([setup.end(), settlementClient.end(), claimClient.end()]);
  });

  const backendIds = await Promise.all(
    [setup, settlementClient, claimClient].map(async (client) => (
      await client.query("select pg_backend_pid()::integer as pid")
    ).rows[0].pid),
  );
  assert.equal(new Set(backendIds).size, 3, "fixture must use three independent backends");

  await t.test("negative control exposes the former permanent-plus-pending race", async () => {
    await resetNativeLifecycleFixture(setup);
    const session = await seedTerminalNativeOriginal(setup, "88300");
    await setup.query(`
      create function public.test_old_unlocked_nowpayments_claim(p_user_id uuid)
      returns jsonb
      language plpgsql
      set search_path = pg_catalog, public
      as $old$
      declare
        v_session public.nowpayments_usdt_payments%rowtype;
      begin
        select * into v_session
        from public.nowpayments_usdt_payments
        where user_id = p_user_id and address_activated_at is not null
        limit 1;
        if found then
          return to_jsonb(v_session) || jsonb_build_object('disposition', 'activated');
        end if;

        select * into v_session
        from public.nowpayments_usdt_payments
        where user_id = p_user_id
          and session_status in ('provisioning', 'ready', 'manual_recovery')
        limit 1;
        if found then
          return to_jsonb(v_session) || jsonb_build_object('disposition', 'existing');
        end if;

        insert into public.nowpayments_usdt_payments (
          user_id, provider_payment_id, provider_payment_status,
          verification_status, asset, network, provider_currency,
          technical_reference_amount_usdt, provider_minimum_usdt,
          outcome_amount, outcome_currency, verified_at, session_status
        ) values (
          p_user_id, null, null, 'pending', 'USDT', 'BEP20', 'usdtbsc',
          null, null, null, 'USDT', null, 'provisioning'
        ) returning * into v_session;
        return to_jsonb(v_session) || jsonb_build_object('disposition', 'claimed');
      end;
      $old$;
    `);

    await settlementClient.query("begin");
    await settlementClient.query("set local statement_timeout = '8s'; set local lock_timeout = '4s'");
    const settlement = await settleNativeOriginal(
      settlementClient,
      session,
      "88300",
      "settle_verified_nowpayments_usdt_payment_serialized_inner",
    );
    assert.equal(settlement.status, "credited");

    const oldProviderCounters = {
      configurationReads: 0,
      minimumLookups: 0,
      createPaymentCalls: 0,
    };
    oldProviderCounters.configurationReads += 1;
    oldProviderCounters.minimumLookups += 1;
    await claimClient.query("begin");
    await claimClient.query("set local statement_timeout = '8s'; set local lock_timeout = '4s'");
    const oldClaim = (await claimClient.query(
      "select public.test_old_unlocked_nowpayments_claim($1::uuid) as result",
      [USER_ID],
    )).rows[0].result;
    if (oldClaim.disposition === "claimed") oldProviderCounters.createPaymentCalls += 1;
    await claimClient.query("commit");
    await settlementClient.query("commit");

    assert.equal(oldClaim.disposition, "claimed");
    assert.deepEqual(oldProviderCounters, {
      configurationReads: 1,
      minimumLookups: 1,
      createPaymentCalls: 1,
    });
    assert.deepEqual(await nativeLifecycleCounts(setup), {
      sessions: 2,
      providers: 1,
      activated: 1,
      provisioning: 1,
      credits: 1,
      available: "3.000000000000000000",
    });
  });

  await t.test("fixed claim blocks on the settlement transaction and returns the permanent address", async () => {
    await resetNativeLifecycleFixture(setup);
    const session = await seedTerminalNativeOriginal(setup, "88301");

    await settlementClient.query("begin");
    await settlementClient.query("set local statement_timeout = '8s'; set local lock_timeout = '4s'");
    const settlement = await settleNativeOriginal(
      settlementClient,
      session,
      "88301",
      "settle_verified_nowpayments_usdt_payment",
    );
    assert.equal(settlement.status, "credited");

    await claimClient.query("begin");
    await claimClient.query("set local statement_timeout = '8s'; set local lock_timeout = '4s'");
    const providerCounters = {
      configurationReads: 0,
      minimumLookups: 0,
      createPaymentCalls: 0,
    };
    let getCurrentCalls = 0;
    let claimRpcCalls = 0;
    const store = {
      async getCurrent() {
        // Model the stale pre-settlement read that motivated the production
        // claim recheck. The actual database claim below must do the blocking.
        getCurrentCalls += 1;
        return { disposition: "none" };
      },
      async claim(userId) {
        claimRpcCalls += 1;
        return (await claimClient.query(
          "select public.claim_nowpayments_usdt_deposit_session($1::uuid) as result",
          [userId],
        )).rows[0].result;
      },
      async configureAmounts() {
        throw new Error("permanent-address reuse must not configure an amount");
      },
      async complete() {
        throw new Error("permanent-address reuse must not complete a payment");
      },
      async markManualRecovery() {
        throw new Error("permanent-address reuse must not mark recovery");
      },
    };
    const provider = {
      async getMinimum() {
        providerCounters.configurationReads += 1;
        providerCounters.minimumLookups += 1;
        throw new Error("permanent-address reuse must not read provider configuration");
      },
      async createPayment() {
        providerCounters.createPaymentCalls += 1;
        throw new Error("permanent-address reuse must not create a payment");
      },
    };
    const claimPromise = getOrCreateNowpaymentsDepositSession({
      userId: USER_ID,
      store,
      provider,
    });
    const wait = await waitForBackendWait(
      setup,
      backendIds[2],
      "Lock",
      backendIds[1],
    );
    assert.ok(wait.wait_event, "claim must expose a concrete transaction-held lock wait");
    assert.equal(wait.expected_blocker, true);
    assert.match(wait.query, /claim_nowpayments_usdt_deposit_session/);
    assert.equal(getCurrentCalls, 1);
    assert.equal(claimRpcCalls, 1);

    const resolvedWhileLocked = await Promise.race([
      claimPromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 75)),
    ]);
    assert.equal(resolvedWhileLocked, false, "claim must remain blocked until settlement commits");

    await settlementClient.query("commit");
    const claim = await bounded(claimPromise, 3_000, "serialized claim");
    await claimClient.query("commit");

    assert.equal(claim.disposition, "activated");
    assert.equal(claim.id, session.id);
    assert.equal(getCurrentCalls, 1);
    assert.equal(claimRpcCalls, 1);
    assert.deepEqual(providerCounters, {
      configurationReads: 0,
      minimumLookups: 0,
      createPaymentCalls: 0,
    });
    assert.ok(new Date(claim.address_activated_at) < new Date(session.deadline));
    assert.deepEqual(await nativeLifecycleCounts(setup), {
      sessions: 1,
      providers: 1,
      activated: 1,
      provisioning: 0,
      credits: 1,
      available: "3.000000000000000000",
    });
  });

  await t.test("claim-first ordering holds the shared lock without replacing a future terminal original", async () => {
    await resetNativeLifecycleFixture(setup);
    const session = await seedTerminalNativeOriginal(setup, "88302");

    await claimClient.query("begin");
    await claimClient.query("set local statement_timeout = '8s'; set local lock_timeout = '4s'");
    const providerCounters = {
      configurationReads: 0,
      minimumLookups: 0,
      createPaymentCalls: 0,
    };
    const claim = (await claimClient.query(
      "select public.claim_nowpayments_usdt_deposit_session($1::uuid) as result",
      [USER_ID],
    )).rows[0].result;
    if (claim.disposition === "claimed") {
      providerCounters.configurationReads += 1;
      providerCounters.minimumLookups += 1;
      providerCounters.createPaymentCalls += 1;
    }
    assert.equal(claim.disposition, "existing");
    assert.equal(claim.id, session.id);
    assert.deepEqual(providerCounters, {
      configurationReads: 0,
      minimumLookups: 0,
      createPaymentCalls: 0,
    });
    assert.deepEqual(await nativeLifecycleCounts(setup), {
      sessions: 1,
      providers: 0,
      activated: 0,
      provisioning: 0,
      credits: 0,
      available: "0",
    });

    await settlementClient.query("begin");
    await settlementClient.query("set local statement_timeout = '8s'; set local lock_timeout = '4s'");
    const settlementPromise = settleNativeOriginal(
      settlementClient,
      session,
      "88302",
      "settle_verified_nowpayments_usdt_payment",
    );
    const wait = await waitForBackendWait(
      setup,
      backendIds[1],
      "Lock",
      backendIds[2],
    );
    assert.ok(wait.wait_event, "settlement must expose a concrete transaction-held lock wait");
    assert.equal(wait.expected_blocker, true);
    assert.match(wait.query, /settle_verified_nowpayments_usdt_payment/);

    const resolvedWhileLocked = await Promise.race([
      settlementPromise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 75)),
    ]);
    assert.equal(resolvedWhileLocked, false, "settlement must remain blocked until claim commits");

    await claimClient.query("commit");
    const settlement = await bounded(settlementPromise, 3_000, "claim-first settlement");
    await settlementClient.query("commit");

    assert.equal(settlement.status, "credited");
    assert.deepEqual(await nativeLifecycleCounts(setup), {
      sessions: 1,
      providers: 1,
      activated: 1,
      provisioning: 0,
      credits: 1,
      available: "3.000000000000000000",
    });
  });
});

test("migration preflight rejects missing original evidence and every ownership linkage drift", async (t) => {
  const cases = [
    ["missing original evidence", `update public.nowpayments_usdt_provider_payments set payment_kind = 'repeated', parent_provider_payment_id = 'missing' where payment_kind = 'original'`],
    ["wrong owner", `insert into public.profiles (id, username, phone) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'other', '+251911111111'); update public.nowpayments_usdt_provider_payments set user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where provider_payment_id = '${PRODUCTION_CHILD_PROVIDER_ID}'`],
    ["wrong address", `update public.nowpayments_usdt_provider_payments set pay_address = '0x8888888888888888888888888888888888888888' where provider_payment_id = '${PRODUCTION_CHILD_PROVIDER_ID}'`],
    ["wrong order", `update public.nowpayments_usdt_provider_payments set qhash_order_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where provider_payment_id = '${PRODUCTION_CHILD_PROVIDER_ID}'`],
    ["wrong session", `update public.nowpayments_usdt_provider_payments set session_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where provider_payment_id = '${PRODUCTION_CHILD_PROVIDER_ID}'`],
  ];
  for (const [name, drift] of cases) {
    await t.test(name, async (t) => {
      const { db } = await createProductionLifecycleBaseline(t);
      if (name === "missing original evidence") {
        await db.exec("alter table public.nowpayments_usdt_provider_payments drop constraint nowpayments_usdt_provider_payments_parent_id_check");
      }
      if (name === "wrong session") {
        await db.exec("alter table public.nowpayments_usdt_provider_payments drop constraint nowpayments_usdt_provider_payments_session_id_fkey");
      }
      await db.exec(drift);
      await assert.rejects(
        applyMigration(db, permanentAddressMigration),
        /unexpected NOWPayments permanent-address production fingerprint/,
      );
    });
  }
});

test("migration preflight rejects each production financial fingerprint drift", async (t) => {
  const cases = [
    ["wallet", "update public.nowpayments_usdt_wallets set available_balance_usdt = 8"],
    ["ledger", `insert into public.nowpayments_usdt_ledger_entries (user_id, entry_type, available_delta_usdt, available_before_usdt, available_after_usdt, reserved_before_usdt, reserved_after_usdt, description) values ('${USER_ID}', 'admin_adjustment', 1, 9, 10, 0, 0, 'fixture drift')`],
    ["provider payment", `update public.nowpayments_usdt_provider_payments set actually_paid_usdt = 4, credited_amount_usdt = 4 where provider_payment_id = '${PRODUCTION_CHILD_PROVIDER_ID}'`],
    ["session", "update public.nowpayments_usdt_payments set credited_amount_usdt = 4"],
  ];
  for (const [name, drift] of cases) {
    await t.test(name, async (t) => {
      const { db } = await createProductionLifecycleBaseline(t);
      await db.exec(drift);
      await assert.rejects(
        applyMigration(db, permanentAddressMigration),
        /unexpected NOWPayments permanent-address production fingerprint/,
      );
    });
  }
});

test("migration fails closed on pre-existing activation state and duplicate permanent candidates", async (t) => {
  await t.test("pre-existing activation state", async (t) => {
    const { db } = await createProductionLifecycleBaseline(t);
    await db.exec("alter table public.nowpayments_usdt_payments add column address_activated_at timestamptz; update public.nowpayments_usdt_payments set address_activated_at = provider_created_at");
    await assert.rejects(
      applyMigration(db, permanentAddressMigration),
      /permanent-address objects already exist outside migration tracking/,
    );
  });
  await t.test("duplicate permanent candidates", async (t) => {
    const { db } = await createProductionLifecycleBaseline(t);
    await db.exec(`
      alter table public.nowpayments_usdt_payments add column address_activated_at timestamptz;
      update public.nowpayments_usdt_payments set address_activated_at = provider_created_at;
      insert into public.nowpayments_usdt_payments
      select (jsonb_populate_record(
        null::public.nowpayments_usdt_payments,
        to_jsonb(source) || jsonb_build_object(
          'id', gen_random_uuid(),
          'provider_payment_id', '9999999001',
          'qhash_order_id', gen_random_uuid(),
          'settled_by_provider_payment_id', '9999999001'
        )
      )).*
      from public.nowpayments_usdt_payments source
      limit 1;
    `);
    assert.equal(
      (await db.query("select count(*)::integer as count from public.nowpayments_usdt_payments where address_activated_at is not null")).rows[0].count,
      2,
    );
    await assert.rejects(
      applyMigration(db, permanentAddressMigration),
      /permanent-address objects already exist outside migration tracking/,
    );
  });
});

test("permanent-address migration refuses ambiguous populated session state", async (t) => {
  const { db } = await createProductionLifecycleBaseline(t);
  await db.exec("update public.nowpayments_usdt_config set enabled = true where id = 'USDT-BEP20'");
  await db.query(`select public.claim_nowpayments_usdt_deposit_session('${USER_ID}'::uuid, '1', '1')`);
  await db.exec("update public.nowpayments_usdt_config set enabled = false where id = 'USDT-BEP20'");
  await assert.rejects(
    applyMigration(db, permanentAddressMigration),
    /unexpected NOWPayments permanent-address production fingerprint/,
  );
  const unchanged = await db.query(`
    select
      not exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name = 'nowpayments_usdt_payments'
          and column_name = 'address_activated_at'
      ) as schema_unchanged,
      (select available_balance_usdt::text from public.nowpayments_usdt_wallets) as available,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger
  `);
  assert.deepEqual(unchanged.rows, [{
    schema_unchanged: true,
    available: "9.000000000000000000",
    ledger: 5,
  }]);
});

test("credits an independently verified finished payment while generation is disabled", async (t) => {
  const db = await createMigratedDatabase(t);
  const session = await createReadySession(db);
  const result = await settle(db, {
    qhashOrderId: session.qhash_order_id,
    actuallyPaid: "0.2",
    outcomeAmount: "0.123456789012345678",
  });
  assert.equal(result.status, "credited");
  assert.equal(result.credited_amount_usdt, "0.200000000000000000");

  const state = await db.query(`
    select
      wallet.available_balance_usdt::text,
      wallet.reserved_balance_usdt::text,
      session.session_status,
      session.provider_payment_status,
      session.settled_by_provider_payment_id,
      session.credited_amount_usdt::text as session_credited_amount_usdt,
      provider.actually_paid_usdt::text,
      provider.outcome_amount_usdt::text,
      provider.credited_amount_usdt::text as provider_credited_amount_usdt,
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
    available_balance_usdt: "0.200000000000000000",
    reserved_balance_usdt: "0.000000000000000000",
    session_status: "terminal",
    provider_payment_status: "finished",
    settled_by_provider_payment_id: ORIGINAL_PROVIDER_ID,
    session_credited_amount_usdt: "0.200000000000000000",
    actually_paid_usdt: "0.200000000000000000",
    outcome_amount_usdt: "0.123456789012345678",
    provider_credited_amount_usdt: "0.200000000000000000",
    payment_kind: "original",
    available_delta_usdt: "0.200000000000000000",
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
    actuallyPaid: "3.000000000000000001",
    outcomeAmount: "2.5",
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
    actuallyPaid: "0.3",
    outcomeAmount: "0.100000000000000001",
  });
  const child = await settle(db, {
    providerPaymentId: CHILD_PROVIDER_ID,
    parentProviderPaymentId: ORIGINAL_PROVIDER_ID,
    qhashOrderId: null,
    actuallyPaid: "0.4",
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
    available: "0.700000000000000000",
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

  for (const actuallyPaid of [
    null,
    "0",
    "-1",
    "not-a-decimal",
    "1e0",
    "1.0000000000000000001",
    "1000000000000000000",
  ]) {
    await assert.rejects(
      settle(db, {
        qhashOrderId: session.qhash_order_id,
        actuallyPaid,
        outcomeAmount: "0.5",
      }),
      /invalid_nowpayments_settlement_outcome/,
      `actually_paid=${String(actuallyPaid)}`,
    );
  }

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
            actuallyPaidUsdt: "0.75",
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
  assert.equal(settlements[0].actuallyPaidUsdt, "0.75");
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
          `{"payment_id":${CHILD_PROVIDER_ID},"parent_payment_id":${ORIGINAL_PROVIDER_ID},"payment_status":"finished","pay_address":"${PAY_ADDRESS}","pay_currency":"usdtbsc","order_id":null,"pay_amount":999999,"actually_paid":3.000000000000000123,"outcome_amount":0.000000000000000123,"outcome_currency":"usdtbsc"}`,
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
    actuallyPaidUsdt: "3.000000000000000123",
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

test("provider status parsing rejects every non-exact actually_paid lexical form", async () => {
  const invalidActuallyPaid = [
    "null",
    "0",
    "-1",
    '"not-a-decimal"',
    "1e0",
    "1.0000000000000000001",
    "1000000000000000000",
  ];

  for (const rawActuallyPaid of invalidActuallyPaid) {
    const client = createNowpaymentsClient({
      apiKey: "mock-only",
      fetchImpl: async () => new Response(
        `{"payment_id":${ORIGINAL_PROVIDER_ID},"parent_payment_id":null,"payment_status":"finished","pay_address":"${PAY_ADDRESS}","pay_currency":"usdtbsc","order_id":"77777777-7777-4777-8777-777777777777","pay_amount":999999,"actually_paid":${rawActuallyPaid},"outcome_amount":0.5,"outcome_currency":"usdtbsc"}`,
        { status: 200 },
      ),
    });
    await assert.rejects(
      client.getPaymentDetails(ORIGINAL_PROVIDER_ID),
      /payment_status_invalid_response/,
      rawActuallyPaid,
    );
  }
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
    actuallyPaidUsdt: "0.2",
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

  await assertSingleCrossHandlerCredit(db, "0.200000000000000000");
});

test("administrator recovery followed by signed IPN credits exactly once", async (t) => {
  const db = await createMigratedDatabase(t);
  const session = await createReadySession(db);
  const payment = verifiedFinishedPayment({
    qhashOrderId: session.qhash_order_id,
    actuallyPaidUsdt: "0.2",
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

  await assertSingleCrossHandlerCredit(db, "0.200000000000000000");
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
  assert.match(databaseTypes, /actually_paid_usdt: number \| null/);
  assert.match(databaseTypes, /credited_amount_usdt: number \| null/);
  assert.doesNotMatch(databaseTypes, /\bcredit_verified_nowpayments_usdt_payment:\s*\{/);
  assert.match(grossCreditMigration, /drop function public\.credit_verified_nowpayments_usdt_payment/);
  assert.match(grossCreditMigration, /v_available_after := v_wallet\.available_balance_usdt \+ v_actually_paid/);
  assert.match(grossCreditMigration, /credited_amount_usdt = v_actually_paid/);
  assert.match(grossCreditMigration, /'source_amount_field', 'actually_paid'/);
  assert.match(grossCreditMigration, /set search_path = pg_catalog, public/);
  assert.doesNotMatch(grossCreditMigration, /p_pay_amount|is_fee_paid_by_user/);
  assert.match(databaseTypes, /address_activated_at: string \| null/);
  assert.match(permanentAddressMigration, /create unique index nowpayments_usdt_payments_one_activated_address_per_user/);
  assert.match(permanentAddressMigration, /new\.payment_kind <> 'original'/);
  assert.match(permanentAddressMigration, /new\.provider_verified_at < session\.provider_valid_until/);
  assert.match(permanentAddressMigration, /new\.credited_at < session\.provider_valid_until/);
  assert.doesNotMatch(permanentAddressMigration, /provider_verified_at\s*<=\s*session\.provider_valid_until|between session\.provider_created_at and session\.provider_valid_until/i);
  assert.match(permanentAddressMigration, /set search_path = pg_catalog, public/);
  assert.match(permanentAddressMigration, /from public, anon, authenticated, service_role/);
  assert.doesNotMatch(
    permanentAddressMigration,
    /jwt|account_(?:email|password)|payment[-_ ]list|payout|is_fee_paid_by_user/i,
  );
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

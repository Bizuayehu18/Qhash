import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  createNowpaymentsClient,
  NowpaymentsUncertainCreateError,
  technicalReferenceAmount,
} from "../netlify/functions/lib/nowpayments-client.mts";
import {
  getOrCreateNowpaymentsDepositSession,
  NowpaymentsDepositSessionError,
} from "../netlify/functions/lib/nowpayments-deposit-session.mts";
import nowpaymentsDepositSessionHandler from "../netlify/functions/nowpayments-usdt-deposit-session.mts";

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
const databaseTypes = await readFile(
  new URL("src/lib/database.types.ts", repositoryRoot),
  "utf8",
);
const endpointSource = await readFile(
  new URL("netlify/functions/nowpayments-usdt-deposit-session.mts", repositoryRoot),
  "utf8",
);
const environmentExample = await readFile(
  new URL(".env.example", repositoryRoot),
  "utf8",
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PUBLISHED_PRODUCTION_CONTEXT = {
  deploy: { context: "production", published: true },
};
const PLAN_TRANSACTION_ID = "22222222-2222-4222-8222-222222222222";
const CBE_METHOD_ID = "33333333-3333-4333-8333-333333333333";
const TELEBIRR_METHOD_ID = "44444444-4444-4444-8444-444444444444";
const ARCHIVE_ADDRESS_ID = "55555555-5555-4555-8555-555555555555";
const ARCHIVE_DEPOSIT_ID = "66666666-6666-4666-8666-666666666666";
const PAY_ADDRESS = "0x9999999999999999999999999999999999999999";

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
    values ('${USER_ID}', 'session-user', '+251900000000');
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
  return db;
}

async function enableFoundation(db) {
  await db.exec(`
    update public.nowpayments_usdt_config
    set enabled = true
    where id = 'USDT-BEP20';
  `);
}

async function claimSession(db, providerMinimum = "0.75", technicalAmount = "1") {
  const result = await db.query(
    `select
       response ->> 'disposition' as disposition,
       response ->> 'id' as id,
       response ->> 'qhash_order_id' as qhash_order_id,
       response ->> 'technical_reference_amount_usdt' as technical_reference_amount_usdt,
       response ->> 'provider_minimum_usdt' as provider_minimum_usdt
     from (
       select public.claim_nowpayments_usdt_deposit_session($1::uuid, $2, $3) as response
     ) as claimed`,
    [USER_ID, providerMinimum, technicalAmount],
  );
  return result.rows[0];
}

test("keeps the deployed foundation disabled and refuses provisioning", async (t) => {
  const db = await createMigratedDatabase(t);
  await assert.rejects(
    db.query("select public.get_current_nowpayments_usdt_deposit_session($1::uuid)", [USER_ID]),
    /nowpayments_usdt_bep20_disabled/,
  );
  await assert.rejects(
    claimSession(db),
    /nowpayments_usdt_bep20_disabled/,
  );

  const state = await db.query(`
    select
      (select enabled from public.nowpayments_usdt_config where id = 'USDT-BEP20') as enabled,
      (select count(*)::integer from public.nowpayments_usdt_payments) as payment_count,
      (select count(*)::integer from public.nowpayments_usdt_wallets) as wallet_count,
      (select count(*)::integer from public.nowpayments_usdt_withdrawals) as withdrawal_count,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger_count
  `);
  assert.deepEqual(state.rows, [{
    enabled: false,
    payment_count: 0,
    wallet_count: 0,
    withdrawal_count: 0,
    ledger_count: 0,
  }]);
});

test("claims exactly one provisioning session and enforces max(1, provider minimum)", async (t) => {
  const db = await createMigratedDatabase(t);
  await enableFoundation(db);

  await assert.rejects(claimSession(db, "0.75", "2"), /invalid_nowpayments_session_claim/);
  await assert.rejects(claimSession(db, "1.25", "1"), /invalid_nowpayments_session_claim/);

  const [first, second] = await Promise.all([
    claimSession(db, "1.25", "1.25"),
    claimSession(db, "1.25", "1.25"),
  ]);
  assert.deepEqual(
    [first.disposition, second.disposition].sort(),
    ["claimed", "existing"],
  );
  assert.equal(first.id, second.id);
  assert.equal(first.qhash_order_id, second.qhash_order_id);
  assert.equal(first.technical_reference_amount_usdt, "1.250000000000000000");
  assert.equal(first.provider_minimum_usdt, "1.250000000000000000");

  const open = await db.query(`
    select count(*)::integer as count
    from public.nowpayments_usdt_payments
    where user_id = '${USER_ID}'
      and session_status in ('provisioning', 'ready', 'manual_recovery')
  `);
  assert.deepEqual(open.rows, [{ count: 1 }]);
});

test("stores the provider address and expiry, reuses active sessions, and retains terminal history", async (t) => {
  const db = await createMigratedDatabase(t);
  await enableFoundation(db);
  const claimed = await claimSession(db);
  const createdAt = "2030-01-01T00:00:00.000Z";
  const validUntil = "2030-01-08T12:34:56.000Z";

  const completed = await db.query(
    `select
       response ->> 'disposition' as disposition,
       response ->> 'pay_address' as pay_address,
       response ->> 'provider_payment_id' as provider_payment_id,
       response ->> 'provider_valid_until' as provider_valid_until
     from (
       select public.complete_nowpayments_usdt_deposit_session(
         $1::uuid, $2::uuid, $3, $4, 'waiting', $5::timestamptz, $6::timestamptz
       ) as response
     ) as completed`,
    [claimed.id, claimed.qhash_order_id, "90071992547409931234", PAY_ADDRESS, createdAt, validUntil],
  );
  assert.deepEqual(completed.rows, [{
    disposition: "completed",
    pay_address: PAY_ADDRESS,
    provider_payment_id: "90071992547409931234",
    provider_valid_until: "2030-01-08T12:34:56+00:00",
  }]);

  const revisited = await db.query(
    `select
       response ->> 'disposition' as disposition,
       response ->> 'id' as id,
       response ->> 'pay_address' as pay_address
     from (
       select public.get_current_nowpayments_usdt_deposit_session($1::uuid) as response
     ) as current`,
    [USER_ID],
  );
  assert.deepEqual(revisited.rows, [{
    disposition: "existing",
    id: claimed.id,
    pay_address: PAY_ADDRESS,
  }]);

  await db.query(
    `select public.record_nowpayments_usdt_deposit_session_status(
       $1::uuid, $2::uuid, $3, 'finished'
     )`,
    [claimed.id, claimed.qhash_order_id, "90071992547409931234"],
  );
  const replacement = await claimSession(db, "0.5", "1");
  assert.equal(replacement.disposition, "claimed");
  assert.notEqual(replacement.id, claimed.id);

  const history = await db.query(`
    select
      count(*)::integer as total_count,
      count(*) filter (where session_status = 'terminal')::integer as terminal_count,
      count(*) filter (where session_status = 'provisioning')::integer as provisioning_count
    from public.nowpayments_usdt_payments
  `);
  assert.deepEqual(history.rows, [{
    total_count: 2,
    terminal_count: 1,
    provisioning_count: 1,
  }]);
});

test("claim terminalizes an elapsed waiting session and permits a replacement", async (t) => {
  const db = await createMigratedDatabase(t);
  await enableFoundation(db);
  const claimed = await claimSession(db);
  await db.query(
    `select public.complete_nowpayments_usdt_deposit_session(
       $1::uuid, $2::uuid, '10001', $3, 'waiting',
       '2030-01-01T00:00:00Z'::timestamptz,
       '2030-01-02T00:00:00Z'::timestamptz
     )`,
    [claimed.id, claimed.qhash_order_id, PAY_ADDRESS],
  );
  await db.exec(`
    update public.nowpayments_usdt_payments
    set provider_created_at = now() - interval '2 days',
        provider_valid_until = now() - interval '1 day'
    where id = '${claimed.id}';
  `);

  const replacement = await claimSession(db);
  assert.equal(replacement.disposition, "claimed");
  const expired = await db.query(`
    select session_status, provider_payment_status, terminal_reason
    from public.nowpayments_usdt_payments
    where id = '${claimed.id}'
  `);
  assert.deepEqual(expired.rows, [{
    session_status: "terminal",
    provider_payment_status: "expired",
    terminal_reason: "provider_valid_until_elapsed",
  }]);
});

test("uncertain creates enter manual recovery and known finalize evidence is retained", async (t) => {
  const db = await createMigratedDatabase(t);
  await enableFoundation(db);
  const uncertain = await claimSession(db);
  await db.query(
    `select public.mark_nowpayments_usdt_deposit_session_manual_recovery(
       $1::uuid, $2::uuid, 'create_payment_timeout', null, null, null, null, null
     )`,
    [uncertain.id, uncertain.qhash_order_id],
  );
  assert.equal((await claimSession(db)).disposition, "existing");

  await db.exec(`
    update public.nowpayments_usdt_payments
    set session_status = 'terminal',
        provider_payment_id = '10002',
        provider_payment_status = 'expired',
        pay_address = '${PAY_ADDRESS}',
        provider_created_at = now() - interval '2 days',
        provider_valid_until = now() - interval '1 day',
        provisioned_at = now() - interval '2 days',
        manual_recovery_at = null,
        manual_recovery_reason = null,
        terminal_at = now(),
        terminal_reason = 'manual_test_terminal'
    where id = '${uncertain.id}';
  `);
  const finalize = await claimSession(db);
  await db.query(
    `select public.mark_nowpayments_usdt_deposit_session_manual_recovery(
       $1::uuid, $2::uuid, 'create_payment_finalize_failed', '10003', $3,
       'waiting', '2030-01-01T00:00:00Z'::timestamptz,
       '2030-01-08T00:00:00Z'::timestamptz
     )`,
    [finalize.id, finalize.qhash_order_id, PAY_ADDRESS],
  );
  const retained = await db.query(`
    select
      session_status,
      manual_recovery_reason,
      provider_payment_id,
      pay_address,
      provider_valid_until::text
    from public.nowpayments_usdt_payments
    where id = '${finalize.id}'
  `);
  assert.equal(retained.rows[0].session_status, "manual_recovery");
  assert.equal(retained.rows[0].manual_recovery_reason, "create_payment_finalize_failed");
  assert.equal(retained.rows[0].provider_payment_id, "10003");
  assert.equal(retained.rows[0].pay_address, PAY_ADDRESS);
  assert.match(retained.rows[0].provider_valid_until, /^2030-01-08/);
});

test("keeps RPC writes service-only, RLS enabled, and payment mappings undeletable", async (t) => {
  const db = await createMigratedDatabase(t);
  const security = await db.query(`
    select
      payment.relrowsecurity as rls_enabled,
      has_table_privilege('service_role', payment.oid, 'SELECT') as service_select,
      has_table_privilege('service_role', payment.oid, 'INSERT') as service_insert,
      has_table_privilege('service_role', payment.oid, 'UPDATE') as service_update,
      has_table_privilege('service_role', payment.oid, 'DELETE') as service_delete,
      has_column_privilege(
        'service_role', payment.oid, 'provider_payment_status', 'UPDATE'
      ) as service_status_update,
      has_function_privilege(
        'service_role',
        'public.claim_nowpayments_usdt_deposit_session(uuid,text,text)',
        'EXECUTE'
      ) as service_claim,
      has_function_privilege(
        'authenticated',
        'public.claim_nowpayments_usdt_deposit_session(uuid,text,text)',
        'EXECUTE'
      ) as authenticated_claim,
      has_function_privilege(
        'anon',
        'public.claim_nowpayments_usdt_deposit_session(uuid,text,text)',
        'EXECUTE'
      ) as anon_claim
    from pg_class as payment
    join pg_namespace as namespace on namespace.oid = payment.relnamespace
    where namespace.nspname = 'public'
      and payment.relname = 'nowpayments_usdt_payments'
  `);
  assert.deepEqual(security.rows, [{
    rls_enabled: true,
    service_select: true,
    service_insert: false,
    service_update: false,
    service_delete: false,
    service_status_update: false,
    service_claim: true,
    authenticated_claim: false,
    anon_claim: false,
  }]);

  await assert.rejects(
    db.exec("delete from public.nowpayments_usdt_payments where false"),
    /immutable evidence/,
  );
  await assert.rejects(
    db.exec("truncate public.nowpayments_usdt_payments"),
    /immutable evidence|foreign key constraint/,
  );
});

test("preserves ETB rails, plan_purchase history, and retired native-crypto evidence", async (t) => {
  const db = await createMigratedDatabase(t);
  const preserved = await db.query(`
    select
      (select balance::text from public.wallets where user_id = '${USER_ID}') as etb_balance,
      (select type::text from public.transactions where id = '${PLAN_TRANSACTION_ID}') as transaction_type,
      (select amount::text from public.transactions where id = '${PLAN_TRANSACTION_ID}') as transaction_amount,
      (select array_agg(type::text order by type::text) from public.payment_methods) as payment_types,
      (select status from public.crypto_deposit_addresses where id = '${ARCHIVE_ADDRESS_ID}') as archive_address_status,
      (select amount_usdt::text from public.crypto_deposits where id = '${ARCHIVE_DEPOSIT_ID}') as archive_amount_usdt,
      to_regprocedure('public.reject_retired_native_crypto_evidence_mutation()') is not null as archive_blocker_present
  `);
  assert.deepEqual(preserved.rows, [{
    etb_balance: "1234.56",
    transaction_type: "plan_purchase",
    transaction_amount: "250.00",
    payment_types: ["cbe", "telebirr"],
    archive_address_status: "disabled",
    archive_amount_usdt: "9.990000",
    archive_blocker_present: true,
  }]);
});

test("NOWPayments client uses exact mocked USDTBSC amounts and provider expiry", async () => {
  assert.deepEqual(technicalReferenceAmount("0.123456789012345678"), {
    providerMinimumUsdt: "0.123456789012345678",
    technicalReferenceAmountUsdt: "1",
  });
  assert.deepEqual(technicalReferenceAmount("1.250000000000000000"), {
    providerMinimumUsdt: "1.25",
    technicalReferenceAmountUsdt: "1.25",
  });

  const requests = [];
  const qhashOrderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const fetchMock = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("min-amount")) {
      return new Response(
        '{"currency_from":"usdtbsc","currency_to":"usdtbsc","min_amount":1.250000000000000001}',
        { status: 200 },
      );
    }
    if (init?.method === "POST") {
      return new Response(
        `{"payment_id":90071992547409931234,"payment_status":"waiting","pay_address":"${PAY_ADDRESS}","pay_amount":1.250000000000000001,"pay_currency":"usdtbsc","order_id":"${qhashOrderId}","created_at":"2030-01-01T00:00:00Z","valid_until":"2030-01-08T12:34:56Z"}`,
        { status: 200 },
      );
    }
    return new Response(
      '{"payment_id":90071992547409931234,"payment_status":"confirming"}',
      { status: 200 },
    );
  };
  const client = createNowpaymentsClient({ apiKey: "mock-only", fetchImpl: fetchMock });
  const minimum = await client.getMinimum();
  assert.equal(minimum, "1.250000000000000001");
  const created = await client.createPayment({
    technicalReferenceAmountUsdt: minimum,
    qhashOrderId,
  });
  assert.deepEqual(created, {
    providerPaymentId: "90071992547409931234",
    qhashOrderId,
    payAddress: PAY_ADDRESS,
    payCurrency: "usdtbsc",
    providerPaymentStatus: "waiting",
    providerCreatedAt: "2030-01-01T00:00:00.000Z",
    providerValidUntil: "2030-01-08T12:34:56.000Z",
  });
  assert.deepEqual(await client.getPaymentStatus(created.providerPaymentId), {
    providerPaymentId: "90071992547409931234",
    providerPaymentStatus: "confirming",
  });

  const minimumRequest = requests[0];
  assert.match(minimumRequest.url, /currency_from=usdtbsc/);
  assert.match(minimumRequest.url, /currency_to=usdtbsc/);
  assert.equal(minimumRequest.init.headers["x-api-key"], "mock-only");
  const createBody = requests[1].init.body;
  assert.match(createBody, /"price_amount":1\.250000000000000001/);
  assert.match(createBody, /"pay_amount":1\.250000000000000001/);
  assert.doesNotMatch(createBody, /ipn|callback|payout/i);
});

test("ambiguous or invalid mocked create responses are always uncertain", async () => {
  const qhashOrderId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const abortingClient = createNowpaymentsClient({
    apiKey: "mock-only",
    fetchImpl: async () => {
      throw new DOMException("mock abort", "AbortError");
    },
  });
  await assert.rejects(
    abortingClient.createPayment({ technicalReferenceAmountUsdt: "1", qhashOrderId }),
    (error) => error instanceof NowpaymentsUncertainCreateError
      && error.recoveryReason === "create_payment_timeout",
  );

  const invalidClient = createNowpaymentsClient({
    apiKey: "mock-only",
    fetchImpl: async () => new Response(
      `{"payment_id":"123","payment_status":"waiting","pay_address":"${PAY_ADDRESS}","pay_amount":"2","pay_currency":"usdtbsc","order_id":"${qhashOrderId}","created_at":"2030-01-01T00:00:00Z","valid_until":"2030-01-08T00:00:00Z"}`,
      { status: 200 },
    ),
  });
  await assert.rejects(
    invalidClient.createPayment({ technicalReferenceAmountUsdt: "1", qhashOrderId }),
    (error) => error instanceof NowpaymentsUncertainCreateError
      && error.recoveryReason === "create_payment_invalid_response",
  );
});

function newSession({
  userId = USER_ID,
  status = "provisioning",
  providerStatus = null,
  validUntil = null,
} = {}) {
  return {
    id: randomUUID(),
    user_id: userId,
    qhash_order_id: randomUUID(),
    session_status: status,
    provider_payment_id: status === "provisioning" ? null : "12345",
    provider_payment_status: providerStatus,
    pay_address: status === "provisioning" ? null : PAY_ADDRESS,
    technical_reference_amount_usdt: "1",
    provider_minimum_usdt: "0.75",
    provider_created_at: status === "provisioning" ? null : "2030-01-01T00:00:00.000Z",
    provider_valid_until: validUntil,
    address_activated_at: null,
    provisioning_started_at: "2030-01-01T00:00:00.000Z",
    created_at: "2030-01-01T00:00:00.000Z",
  };
}

class MemoryStore {
  sessions = [];
  failComplete = false;
  recoveryEvidence = null;

  async getCurrent(userId) {
    const activated = this.sessions.find(
      (candidate) => candidate.user_id === userId && candidate.address_activated_at !== null,
    );
    if (activated) return { ...activated, disposition: "activated" };
    const session = this.sessions.find(
      (candidate) => candidate.user_id === userId
        && ["provisioning", "ready", "manual_recovery"].includes(candidate.session_status),
    );
    return session
      ? { ...session, disposition: session.session_status === "ready" ? "pending" : "existing" }
      : { disposition: "none" };
  }

  async claim(userId, providerMinimumUsdt, technicalReferenceAmountUsdt) {
    const activated = this.sessions.find(
      (candidate) => candidate.user_id === userId && candidate.address_activated_at !== null,
    );
    if (activated) return { ...activated, disposition: "activated" };
    const current = this.sessions.find(
      (candidate) => candidate.user_id === userId
        && ["provisioning", "ready", "manual_recovery"].includes(candidate.session_status),
    );
    if (current) {
      return {
        ...current,
        disposition: current.session_status === "ready" ? "pending" : "existing",
      };
    }
    const session = {
      ...newSession({ userId }),
      provider_minimum_usdt: providerMinimumUsdt,
      technical_reference_amount_usdt: technicalReferenceAmountUsdt,
    };
    this.sessions.push(session);
    return { ...session, disposition: "claimed" };
  }

  async complete(session, result) {
    if (this.failComplete) throw new Error("mock finalize failure");
    const stored = this.sessions.find((candidate) => candidate.id === session.id);
    if (!stored) throw new Error("mock session missing");
    Object.assign(stored, {
      session_status: "ready",
      provider_payment_id: result.providerPaymentId,
      provider_payment_status: result.providerPaymentStatus,
      pay_address: result.payAddress,
      provider_created_at: result.providerCreatedAt,
      provider_valid_until: result.providerValidUntil,
    });
    return { ...stored };
  }

  async markManualRecovery(session, reason, evidence) {
    const stored = this.sessions.find((candidate) => candidate.id === session.id);
    if (!stored) throw new Error("mock session missing");
    stored.session_status = "manual_recovery";
    if (evidence) {
      this.recoveryEvidence = evidence;
      stored.provider_payment_id = evidence.providerPaymentId;
      stored.provider_payment_status = evidence.providerPaymentStatus;
      stored.pay_address = evidence.payAddress;
      stored.provider_created_at = evidence.providerCreatedAt;
      stored.provider_valid_until = evidence.providerValidUntil;
    }
    stored.manual_recovery_reason = reason;
    return { ...stored };
  }

  async recordStatus(session, providerStatus) {
    const stored = this.sessions.find((candidate) => candidate.id === session.id);
    if (!stored) throw new Error("mock session missing");
    stored.provider_payment_status = providerStatus;
    stored.session_status = ["finished", "failed", "refunded", "expired"].includes(providerStatus)
      ? "terminal"
      : "ready";
    return { ...stored };
  }
}

function createdPayment(qhashOrderId, providerPaymentId = "20001") {
  return {
    providerPaymentId,
    qhashOrderId,
    payAddress: PAY_ADDRESS,
    payCurrency: "usdtbsc",
    providerPaymentStatus: "waiting",
    providerCreatedAt: "2030-01-01T00:00:00.000Z",
    providerValidUntil: "2030-01-08T00:00:00.000Z",
  };
}

test("orchestration reuses active sessions and creates at most once under concurrency", async () => {
  const store = new MemoryStore();
  let createCount = 0;
  const provider = {
    async getMinimum() { return "0.75"; },
    async createPayment({ qhashOrderId }) {
      createCount += 1;
      return createdPayment(qhashOrderId);
    },
    async getPaymentStatus(providerPaymentId) {
      return { providerPaymentId, providerPaymentStatus: "confirming" };
    },
  };
  const now = () => new Date("2030-01-02T00:00:00Z");
  const results = await Promise.allSettled([
    getOrCreateNowpaymentsDepositSession({ userId: USER_ID, store, provider, now }),
    getOrCreateNowpaymentsDepositSession({ userId: USER_ID, store, provider, now }),
  ]);
  assert.equal(createCount, 1);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);

  const existing = store.sessions[0];
  const revisited = await getOrCreateNowpaymentsDepositSession({
    userId: USER_ID,
    store,
    provider,
    now,
  });
  assert.equal(revisited.id, existing.id);
  assert.equal(revisited.pay_address, PAY_ADDRESS);
  assert.equal(revisited.provider_payment_status, "waiting");
  assert.equal(createCount, 1);
});

test("orchestration replaces terminal/expired sessions but never retries an uncertain create", async () => {
  const terminalStore = new MemoryStore();
  terminalStore.sessions.push(newSession({
    status: "terminal",
    providerStatus: "expired",
    validUntil: "2030-01-08T00:00:00.000Z",
  }));
  let terminalCreateCount = 0;
  const terminalProvider = {
    async getMinimum() { return "1.5"; },
    async createPayment({ qhashOrderId }) {
      terminalCreateCount += 1;
      return createdPayment(qhashOrderId, "20002");
    },
  };
  const replacement = await getOrCreateNowpaymentsDepositSession({
    userId: USER_ID,
    store: terminalStore,
    provider: terminalProvider,
    now: () => new Date("2030-01-02T00:00:00Z"),
  });
  assert.equal(terminalCreateCount, 1);
  assert.equal(replacement.technical_reference_amount_usdt, "1.5");
  assert.equal(terminalStore.sessions.length, 2);
  assert.equal(terminalStore.sessions[0].session_status, "terminal");

  const uncertainStore = new MemoryStore();
  let uncertainCreateCount = 0;
  const uncertainProvider = {
    async getMinimum() { return "0.5"; },
    async getPaymentStatus() { throw new Error("not used"); },
    async createPayment() {
      uncertainCreateCount += 1;
      throw { recoveryReason: "create_payment_timeout" };
    },
  };
  await assert.rejects(
    getOrCreateNowpaymentsDepositSession({
      userId: USER_ID,
      store: uncertainStore,
      provider: uncertainProvider,
    }),
    (error) => error instanceof NowpaymentsDepositSessionError
      && error.code === "payment_creation_uncertain",
  );
  assert.equal(uncertainStore.sessions[0].session_status, "manual_recovery");
  await assert.rejects(
    getOrCreateNowpaymentsDepositSession({
      userId: USER_ID,
      store: uncertainStore,
      provider: uncertainProvider,
    }),
    (error) => error instanceof NowpaymentsDepositSessionError
      && error.code === "session_manual_recovery",
  );
  assert.equal(uncertainCreateCount, 1);
});

test("permanent addresses reuse after the original deadline without provider access", async () => {
  const store = new MemoryStore();
  const permanent = newSession({
    status: "terminal",
    providerStatus: "finished",
    validUntil: "2030-01-08T00:00:00.000Z",
  });
  permanent.address_activated_at = "2030-01-02T00:00:00.000Z";
  store.sessions.push(permanent);
  const provider = {
    async getMinimum() { throw new Error("provider must not be contacted"); },
    async createPayment() { throw new Error("provider must not be contacted"); },
  };
  const reused = await getOrCreateNowpaymentsDepositSession({
    userId: USER_ID,
    store,
    provider,
    now: () => new Date("2040-01-01T00:00:00Z"),
  });
  assert.equal(reused.id, permanent.id);
  assert.equal(reused.address_activated_at, "2030-01-02T00:00:00.000Z");
});

test("defensive session validation rejects activation at exact deadline", async () => {
  const store = new MemoryStore();
  const candidate = newSession({
    status: "terminal",
    providerStatus: "finished",
    validUntil: "2030-01-08T00:00:00.000Z",
  });
  candidate.address_activated_at = candidate.provider_valid_until;
  store.sessions.push(candidate);
  let providerCalls = 0;
  const provider = {
    async getMinimum() { providerCalls += 1; return "1"; },
    async createPayment() { providerCalls += 1; throw new Error("unexpected provider call"); },
  };
  await assert.rejects(
    getOrCreateNowpaymentsDepositSession({ userId: USER_ID, store, provider }),
    (error) => error instanceof NowpaymentsDepositSessionError
      && error.code === "session_invalid",
  );
  assert.equal(providerCalls, 0);
});

test("all stored pending statuses reuse without a provider status request", async () => {
  for (const providerStatus of [
    "waiting",
    "partially_paid",
    "confirming",
    "confirmed",
    "sending",
  ]) {
    const store = new MemoryStore();
    const current = newSession({
      status: "ready",
      providerStatus,
      validUntil: "2030-01-08T00:00:00.000Z",
    });
    store.sessions.push(current);
    const provider = {
      async getMinimum() { throw new Error("not used"); },
      async createPayment() { throw new Error("not used"); },
    };
    const reused = await getOrCreateNowpaymentsDepositSession({
      userId: USER_ID,
      store,
      provider,
      now: () => new Date("2030-01-02T00:00:00Z"),
    });
    assert.equal(reused.id, current.id);
    assert.equal(reused.provider_payment_status, providerStatus);
  }

});

test("orchestration retains validated provider evidence when database finalization fails", async () => {
  const store = new MemoryStore();
  store.failComplete = true;
  const provider = {
    async getMinimum() { return "1"; },
    async getPaymentStatus() { throw new Error("not used"); },
    async createPayment({ qhashOrderId }) { return createdPayment(qhashOrderId, "20003"); },
  };
  await assert.rejects(
    getOrCreateNowpaymentsDepositSession({ userId: USER_ID, store, provider }),
    (error) => error instanceof NowpaymentsDepositSessionError
      && error.code === "payment_creation_uncertain",
  );
  assert.equal(store.sessions[0].session_status, "manual_recovery");
  assert.equal(store.sessions[0].provider_payment_id, "20003");
  assert.equal(store.recoveryEvidence.providerValidUntil, "2030-01-08T00:00:00.000Z");
});

test("types and endpoint expose only the hidden server-side session contract", () => {
  for (const field of [
    "qhash_order_id",
    "technical_reference_amount_usdt",
    "provider_minimum_usdt",
    "pay_address",
    "provider_valid_until",
    "address_activated_at",
    "session_status",
  ]) {
    assert.match(databaseTypes, new RegExp(`\\b${field}:`));
  }
  for (const rpc of [
    "get_current_nowpayments_usdt_deposit_session",
    "claim_nowpayments_usdt_deposit_session",
    "complete_nowpayments_usdt_deposit_session",
    "mark_nowpayments_usdt_deposit_session_manual_recovery",
    "record_nowpayments_usdt_deposit_session_status",
  ]) {
    assert.match(databaseTypes, new RegExp(`\\b${rpc}:`));
  }
  assert.match(environmentExample, /^NOWPAYMENTS_API_KEY=$/m);
  assert.doesNotMatch(environmentExample, /^VITE_NOWPAYMENTS/m);
  assert.match(environmentExample, /Netlify scope: Functions\/runtime only/);
  assert.match(environmentExample, /Netlify deploy context: Production only/);
  assert.match(environmentExample, /No value for Deploy Previews, Branch deploys/);
  assert.doesNotMatch(endpointSource, /Netlify\.env\.get\(["']CONTEXT["']\)/);
  assert.match(endpointSource, /import type \{ Config, Context \} from "@netlify\/functions"/);
  assert.ok(
    endpointSource.indexOf("if (!isPublishedProductionDeployContext(context))")
      < endpointSource.indexOf('Netlify.env.get("VITE_SUPABASE_URL")'),
  );
  assert.match(endpointSource, /if \(!config\.enabled\)/);
  assert.ok(
    endpointSource.indexOf('if (!config.enabled)')
      < endpointSource.indexOf('Netlify.env.get("NOWPAYMENTS_API_KEY")'),
  );
  assert.doesNotMatch(endpointSource, /req\.json\(|requested_amount|price_amount/);
  assert.match(endpointSource, /path: "\/api\/crypto\/nowpayments\/deposit-session"/);
});

async function invokeRejectedRuntimeEndpoint(runtimeContext) {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  const environmentReads = [];
  const requests = [];
  globalThis.Netlify = {
    env: {
      get(name) {
        environmentReads.push(name);
        throw new Error(`Rejected runtime read forbidden variable: ${name}`);
      },
    },
  };
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    throw new Error("Non-production runtime must not make a network request");
  };

  try {
    const response = await nowpaymentsDepositSessionHandler(
      new Request("https://qhash.mock/api/crypto/nowpayments/deposit-session", {
        method: "POST",
        headers: { authorization: "Bearer must-not-be-used" },
      }),
      runtimeContext,
    );
    return {
      status: response.status,
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

function assertNonProductionRejected(result) {
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, {
    error: "crypto_runtime_unavailable",
    message: "Crypto deposits are unavailable.",
  });
  assert.deepEqual(result.environmentReads, []);
  assert.deepEqual(result.requests, []);
}

test("only a published production deploy reaches secrets, database, or provider access", async () => {
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
    assertNonProductionRejected(await invokeRejectedRuntimeEndpoint(runtimeContext));
  }
});

test("production context reaches authentication, configuration, and disabled gate", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  const environmentReads = [];
  const requests = [];
  globalThis.Netlify = {
    env: {
      get(name) {
        environmentReads.push(name);
        if (name === "VITE_SUPABASE_URL") return "https://supabase.mock";
        if (name === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-mock";
        if (name === "NOWPAYMENTS_API_KEY") return "must-not-be-read";
        return undefined;
      },
    },
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.startsWith("https://api.nowpayments.io")) {
      throw new Error("NOWPayments must not be called while disabled");
    }
    if (url.includes("/auth/v1/user")) {
      return Response.json({
        id: USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "mock@example.test",
        app_metadata: {},
        user_metadata: {},
        created_at: "2030-01-01T00:00:00Z",
      });
    }
    if (url.includes("/rest/v1/profiles")) {
      return Response.json({ is_frozen: false });
    }
    if (url.includes("/rest/v1/nowpayments_usdt_config")) {
      return Response.json({
        id: "USDT-BEP20",
        enabled: false,
        asset: "USDT",
        network: "BEP20",
        provider_currency: "usdtbsc",
        deposit_minimum_usdt: 1,
        withdrawal_minimum_usdt: 2,
        withdrawal_fee_percent: 5,
      });
    }
    throw new Error(`Unexpected mock request: ${url}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalNetlify === undefined) delete globalThis.Netlify;
    else globalThis.Netlify = originalNetlify;
  });

  const response = await nowpaymentsDepositSessionHandler(
    new Request("https://qhash.mock/api/crypto/nowpayments/deposit-session", {
      method: "POST",
      headers: { authorization: "Bearer mock-user-token" },
    }),
    PUBLISHED_PRODUCTION_CONTEXT,
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "crypto_deposits_disabled",
    message: "Crypto deposits are disabled.",
  });
  assert.ok(requests.some((url) => url.includes("/auth/v1/user")));
  assert.ok(requests.some((url) => url.includes("/rest/v1/profiles")));
  assert.ok(requests.some((url) => url.includes("/rest/v1/nowpayments_usdt_config")));
  assert.ok(!requests.some((url) => url.startsWith("https://api.nowpayments.io")));
  assert.equal(environmentReads[0], "VITE_SUPABASE_URL");
  assert.ok(environmentReads.includes("SUPABASE_SERVICE_ROLE_KEY"));
  assert.ok(!environmentReads.includes("NOWPAYMENTS_API_KEY"));
});

test("enabled endpoint returns stored pending and permanent addresses without provider access", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalNetlify = globalThis.Netlify;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalNetlify === undefined) delete globalThis.Netlify;
    else globalThis.Netlify = originalNetlify;
  });

  for (const lifecycle of ["pending", "activated"]) {
    const environmentReads = [];
    const requests = [];
    globalThis.Netlify = {
      env: {
        get(name) {
          environmentReads.push(name);
          if (name === "VITE_SUPABASE_URL") return "https://supabase.mock";
          if (name === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-mock";
          if (name === "NOWPAYMENTS_API_KEY" || name === "URL") {
            throw new Error("stored-address reuse must not read provider configuration");
          }
          return undefined;
        },
      },
    };
    globalThis.fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.startsWith("https://api.nowpayments.io")) {
        throw new Error("stored-address reuse must not contact NOWPayments");
      }
      if (url.includes("/auth/v1/user")) {
        return Response.json({
          id: USER_ID,
          aud: "authenticated",
          role: "authenticated",
          email: "mock@example.test",
          app_metadata: {},
          user_metadata: {},
          created_at: "2030-01-01T00:00:00Z",
        });
      }
      if (url.includes("/rest/v1/profiles")) return Response.json({ is_frozen: false });
      if (url.includes("/rest/v1/nowpayments_usdt_config")) {
        return Response.json({
          id: "USDT-BEP20",
          enabled: true,
          asset: "USDT",
          network: "BEP20",
          provider_currency: "usdtbsc",
          deposit_minimum_usdt: 1,
          withdrawal_minimum_usdt: 2,
          withdrawal_fee_percent: 5,
        });
      }
      if (url.includes("/rest/v1/rpc/get_current_nowpayments_usdt_deposit_session")) {
        return Response.json({
          disposition: lifecycle,
          ...newSession({
            status: lifecycle === "activated" ? "terminal" : "ready",
            providerStatus: lifecycle === "activated" ? "finished" : "waiting",
            validUntil: "2030-01-08T00:00:00.000Z",
          }),
          address_activated_at: lifecycle === "activated"
            ? "2030-01-02T00:00:00.000Z"
            : null,
        });
      }
      throw new Error(`Unexpected mock request: ${url}`);
    };

    const response = await nowpaymentsDepositSessionHandler(
      new Request("https://qhash.mock/api/crypto/nowpayments/deposit-session", {
        method: "POST",
        headers: { authorization: "Bearer mock-user-token" },
      }),
      PUBLISHED_PRODUCTION_CONTEXT,
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(
      body.address_lifecycle,
      lifecycle === "activated" ? "permanently_activated" : "pending_activation",
    );
    assert.equal(body.pay_address, PAY_ADDRESS);
    assert.equal(body.valid_until, lifecycle === "activated" ? null : "2030-01-08T00:00:00.000Z");
    assert.ok(!environmentReads.includes("NOWPAYMENTS_API_KEY"));
    assert.ok(!environmentReads.includes("URL"));
    assert.ok(!requests.some((url) => url.startsWith("https://api.nowpayments.io")));
  }
});

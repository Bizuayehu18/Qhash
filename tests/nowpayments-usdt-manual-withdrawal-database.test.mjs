import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import pg from "pg";

const { Client } = pg;
const root = new URL("../", import.meta.url);
const migrationPaths = [
  "supabase/migrations/20260718190000_nowpayments_usdt_bep20_foundation/migration.sql",
  "supabase/migrations/20260718220000_nowpayments_active_deposit_session/migration.sql",
  "supabase/migrations/20260719120000_nowpayments_ipn_settlement/migration.sql",
  "supabase/migrations/20260720213000_nowpayments_gross_deposit_credit/migration.sql",
  "supabase/migrations/20260721120000_nowpayments_permanent_deposit_address_lifecycle/migration.sql",
];
const prerequisiteMigrations = await Promise.all(
  migrationPaths.map((path) => readFile(new URL(path, root), "utf8")),
);
const withdrawalMigration = await readFile(
  new URL(
    "supabase/migrations/20260722120000_nowpayments_manual_usdt_withdrawal_database/migration.sql",
    root,
  ),
  "utf8",
);
const databaseTypes = await readFile(new URL("src/lib/database.types.ts", root), "utf8");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const USER_2_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_1_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ADMIN_2_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUEST_1 = "10000000-0000-4000-8000-000000000001";
const REQUEST_2 = "10000000-0000-4000-8000-000000000002";
const DESTINATION = "0x1234567890abcdef1234567890abcdef12345678";
const DESTINATION_2 = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const TREASURY = "0xbe19677ee642cfe21fff5899b258f5010651c33e";
const TOKEN = "0x55d398326f99059ff775485246999027b3197955";
const HASH_1 = `0x${"1".repeat(64)}`;
const HASH_2 = `0x${"2".repeat(64)}`;
const BSC_PRECOMPILE_SOURCE =
  "https://github.com/bnb-chain/bsc/blob/v1.7.3/core/vm/contracts.go";
const BSC_PRECOMPILE_VALUES = [
  ...Array.from({ length: 0x11 }, (_, index) => index + 1),
  ...Array.from({ length: 0x06 }, (_, index) => 0x64 + index),
  0x100,
];

function evmAddress(value) {
  return `0x${BigInt(value).toString(16).padStart(40, "0")}`;
}

function migrationFunctionBody(name) {
  const start = withdrawalMigration.indexOf(`create function public.${name}(`);
  if (start < 0) throw new Error(`missing migration function ${name}`);
  const end = withdrawalMigration.indexOf("\n$function$;", start);
  if (end < 0) throw new Error(`unterminated migration function ${name}`);
  return withdrawalMigration.slice(start, end);
}

function actionId(suffix) {
  return `90000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

async function applyMigration(db, sql) {
  await db.exec("begin");
  try {
    await db.exec(sql);
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

async function createFoundation(db) {
  await db.exec(`
    do $roles$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $roles$;

    create type public.transaction_type as enum (
      'deposit', 'withdrawal', 'plan_purchase', 'earning', 'admin_adjustment',
      'referral_reward', 'referral_investment_bonus', 'referral_daily_bonus'
    );
    create type public.transaction_status as enum ('pending', 'completed', 'failed');
    create type public.payment_method_type as enum ('cbe', 'telebirr');
    create table public._qhash_migrations (
      id text primary key, checksum text not null,
      applied_at timestamptz not null default now(), deploy_context text, commit_ref text
    );
    create table public.profiles (
      id uuid primary key, username text not null, phone text not null,
      is_admin boolean not null default false,
      is_frozen boolean not null default false
    );
    create table public.wallets (
      user_id uuid primary key references public.profiles(id),
      balance numeric(18,2) not null default 0,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table public.transactions (
      id uuid primary key, user_id uuid not null references public.profiles(id),
      type public.transaction_type not null, amount numeric(18,2) not null,
      status public.transaction_status not null, description text, reference_id uuid,
      metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
      balance_before numeric(18,2), balance_after numeric(18,2)
    );
    create table public.payment_methods (
      id uuid primary key, type public.payment_method_type not null,
      account_name text not null, account_number text not null,
      is_active boolean not null default true
    );
    create table public.crypto_deposit_addresses (
      id uuid primary key, user_id uuid not null references public.profiles(id),
      network text not null, asset text not null, address text not null, status text not null
    );
    create table public.crypto_deposits (
      id uuid primary key, user_id uuid not null references public.profiles(id),
      address_id uuid references public.crypto_deposit_addresses(id),
      network text not null, asset text not null, tx_hash text not null,
      amount_usdt numeric(36,6) not null, status text not null
    );
    create function public.reject_retired_native_crypto_evidence_mutation()
    returns trigger language plpgsql as $f$
    begin raise exception 'Retired native crypto evidence is immutable'; end $f$;

    insert into public.profiles (id, username, phone, is_admin) values
      ('${USER_ID}', 'user-one', '+251900000001', false),
      ('${USER_2_ID}', 'user-two', '+251900000002', false),
      ('${ADMIN_1_ID}', 'admin-one', '+251900000003', true),
      ('${ADMIN_2_ID}', 'admin-two', '+251900000004', true);
    insert into public.wallets (user_id, balance) values ('${USER_ID}', 5898.70);
    insert into public.transactions (
      id,user_id,type,amount,status,description,balance_before,balance_after
    ) values (
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd','${USER_ID}','plan_purchase',100,
      'completed','Immutable ETB plan purchase',5998.70,5898.70
    );
    insert into public.payment_methods (id,type,account_name,account_number) values
      ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','cbe','QHash CBE','1000000000000'),
      ('ffffffff-ffff-4fff-8fff-ffffffffffff','telebirr','QHash TeleBirr','0900000000');
    insert into public.crypto_deposit_addresses (id,user_id,network,asset,address,status)
    values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${USER_ID}','BSC','USDT','${TREASURY}','retired');
  `);
}

async function installWithdrawalDatabase(db) {
  await createFoundation(db);
  for (const migration of prerequisiteMigrations) await applyMigration(db, migration);
  await db.exec("update public.nowpayments_usdt_config set enabled = true where id = 'USDT-BEP20'");
  await applyMigration(db, withdrawalMigration);
}

async function createDatabase(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await installWithdrawalDatabase(db);
  return db;
}

async function assertPreflightDriftFails(driftSql, expectedError) {
  const db = new PGlite();
  try {
    await createFoundation(db);
    for (const migration of prerequisiteMigrations) await applyMigration(db, migration);
    await db.exec(driftSql);
    await assert.rejects(applyMigration(db, withdrawalMigration), expectedError);
    const untouched = (await db.query(`
      select
        exists (
          select 1 from information_schema.columns
          where table_schema='public' and table_name='nowpayments_usdt_config'
            and column_name='withdrawals_enabled'
        ) as flag_added,
        to_regclass('public.nowpayments_usdt_withdrawal_events') is not null as events_added,
        to_regprocedure('public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)') is not null as request_added
    `)).rows[0];
    assert.deepEqual(untouched, { flag_added: false, events_added: false, request_added: false });
  } finally {
    await db.close();
  }
}

async function seedWallet(db, userId = USER_ID, available = "20") {
  await db.query(
    `insert into public.nowpayments_usdt_wallets
       (user_id, available_balance_usdt, reserved_balance_usdt)
     values ($1, $2::numeric, 0)`,
    [userId, available],
  );
}

async function setWithdrawals(db, enabled) {
  await db.query(
    "update public.nowpayments_usdt_config set withdrawals_enabled = $1 where id = 'USDT-BEP20'",
    [enabled],
  );
}

async function requestWithdrawal(db, {
  userId = USER_ID,
  requestId = REQUEST_1,
  amount = "10",
  destination = DESTINATION,
} = {}) {
  return (await db.query(
    `select public.request_nowpayments_usdt_withdrawal($1::uuid,$2,$3,$4) as result`,
    [userId, requestId, amount, destination],
  )).rows[0].result;
}

async function claim(db, withdrawalId = REQUEST_1, adminId = ADMIN_1_ID, id = actionId(1)) {
  return (await db.query(
    `select public.claim_nowpayments_usdt_withdrawal_review($1::uuid,$2::uuid,$3) as result`,
    [withdrawalId, adminId, id],
  )).rows[0].result;
}

async function sendLock(db, withdrawalId = REQUEST_1, adminId = ADMIN_1_ID, id = actionId(2)) {
  return (await db.query(
    `select public.lock_nowpayments_usdt_withdrawal_send(
       $1::uuid,$2::uuid,$3,true,true
     ) as result`,
    [withdrawalId, adminId, id],
  )).rows[0].result;
}

async function broadcast(db, {
  withdrawalId = REQUEST_1, adminId = ADMIN_1_ID, id = actionId(3),
  hash = HASH_1, reason = null,
} = {}) {
  return (await db.query(
    `select public.record_nowpayments_usdt_withdrawal_broadcast($1::uuid,$2::uuid,$3,$4,$5) as result`,
    [withdrawalId, adminId, id, hash, reason],
  )).rows[0].result;
}

async function complete(db, {
  withdrawalId = REQUEST_1, adminId = ADMIN_1_ID, id = actionId(4),
  hash = HASH_1, destination = DESTINATION, net = "9.5",
  token = TOKEN, confirmations = 120, success = true, uniqueTransfer = true,
  verifiedAt = "2026-07-22T10:00:00.000Z",
} = {}) {
  return (await db.query(
    `select public.complete_nowpayments_usdt_withdrawal(
       $1::uuid,$2::uuid,$3,$4,56,$5,$6,$7,$8,$9,123456::bigint,7,$10,$11::timestamptz
     ) as result`,
    [withdrawalId, adminId, id, hash, token, success, uniqueTransfer,
      destination, net, confirmations, verifiedAt],
  )).rows[0].result;
}

test("migration is withdrawal-only, disabled by default, and service-role-only", async (t) => {
  const db = await createDatabase(t);
  const state = await db.query(`
    select enabled, withdrawals_enabled,
      (select count(*)::integer from public.nowpayments_usdt_withdrawals) as withdrawals,
      has_function_privilege('service_role', 'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)', 'EXECUTE') as service_exec,
      has_function_privilege('authenticated', 'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)', 'EXECUTE') as client_exec,
      has_table_privilege('authenticated', 'public.nowpayments_usdt_withdrawal_events', 'SELECT') as client_events
    from public.nowpayments_usdt_config where id = 'USDT-BEP20'
  `);
  assert.deepEqual(state.rows, [{
    enabled: true,
    withdrawals_enabled: false,
    withdrawals: 0,
    service_exec: true,
    client_exec: false,
    client_events: false,
  }]);
  assert.match(databaseTypes, /withdrawals_enabled: boolean/);
  assert.match(databaseTypes, /send_locked.*broadcasted.*completed.*rejected/);
  assert.doesNotMatch(withdrawalMigration, /http_request|net\.http|fetch\(|private_key|seed_phrase/i);
  assert.match(withdrawalMigration, /drop column provider_payout_id/);

  const security = await db.query(`
    select
      count(*)::integer as functions,
      count(*) filter (where p.prosecdef)::integer as security_definer,
      count(*) filter (
        where coalesce(array_to_string(p.proconfig, ','), '') = 'search_path=pg_catalog, public'
      )::integer as locked_path,
      count(*) filter (where has_function_privilege('service_role', p.oid, 'EXECUTE'))::integer as service_exec,
      count(*) filter (
        where has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE')
      )::integer as client_exec
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'request_nowpayments_usdt_withdrawal',
      'claim_nowpayments_usdt_withdrawal_review',
      'lock_nowpayments_usdt_withdrawal_send',
      'record_nowpayments_usdt_withdrawal_broadcast',
      'complete_nowpayments_usdt_withdrawal',
      'reject_nowpayments_usdt_withdrawal',
      'take_over_nowpayments_usdt_withdrawal'
    )
  `);
  assert.deepEqual(security.rows, [{
    functions: 7, security_definer: 7, locked_path: 7, service_exec: 7, client_exec: 0,
  }]);
  const tableSecurity = await db.query(`
    select
      count(*) filter (where c.relrowsecurity)::integer as rls_tables,
      count(*) filter (
        where has_table_privilege('service_role', c.oid, 'INSERT')
           or has_table_privilege('service_role', c.oid, 'UPDATE')
           or has_table_privilege('service_role', c.oid, 'DELETE')
      )::integer as service_mutable
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (
      'nowpayments_usdt_withdrawals', 'nowpayments_usdt_withdrawal_events',
      'nowpayments_usdt_withdrawal_broadcasts', 'nowpayments_usdt_withdrawal_verifications'
    )
  `);
  assert.deepEqual(tableSecurity.rows, [{ rls_tables: 4, service_mutable: 0 }]);
  const foreignKeys = await db.query(`
    select count(*)::integer as foreign_keys,
      count(*) filter (where con.confdeltype <> 'a')::integer as cascading
    from pg_constraint con
    join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where con.contype='f' and n.nspname='public' and c.relname in (
      'nowpayments_usdt_withdrawals', 'nowpayments_usdt_withdrawal_events',
      'nowpayments_usdt_withdrawal_broadcasts', 'nowpayments_usdt_withdrawal_verifications'
    )
  `);
  assert.deepEqual(foreignKeys.rows, [{ foreign_keys: 13, cascading: 0 }]);
});

test("every withdrawal function follows the profile-withdrawal-wallet lock order", () => {
  const requestBody = migrationFunctionBody("request_nowpayments_usdt_withdrawal");
  const requestProfile = requestBody.indexOf("from public.profiles");
  const matchingWithdrawal = requestBody.indexOf("where id = v_request_id", requestProfile);
  const openWithdrawal = requestBody.indexOf("where user_id = p_user_id", matchingWithdrawal);
  const exactEvent = requestBody.indexOf("where action_id = v_request_id", openWithdrawal);
  const flagRead = requestBody.indexOf("select withdrawals_enabled", exactEvent);
  const walletLock = requestBody.indexOf("select * into v_wallet", flagRead);
  assert.ok(
    requestProfile >= 0
      && requestProfile < matchingWithdrawal
      && matchingWithdrawal < openWithdrawal
      && openWithdrawal < exactEvent
      && exactEvent < flagRead
      && flagRead < walletLock,
    "request must lock profile, matching/open withdrawal, then read flag, then lock wallet",
  );

  for (const name of [
    "claim_nowpayments_usdt_withdrawal_review",
    "lock_nowpayments_usdt_withdrawal_send",
    "record_nowpayments_usdt_withdrawal_broadcast",
    "complete_nowpayments_usdt_withdrawal",
    "reject_nowpayments_usdt_withdrawal",
    "take_over_nowpayments_usdt_withdrawal",
  ]) {
    const body = migrationFunctionBody(name);
    const profile = body.indexOf("perform 1 from public.profiles");
    const withdrawal = body.indexOf("select * into v_withdrawal", profile);
    const wallet = body.indexOf("select * into v_wallet", withdrawal);
    assert.ok(
      profile >= 0 && profile < withdrawal && withdrawal < wallet,
      `${name} must lock profile, withdrawal, then wallet`,
    );
  }
});

test("request reserves gross, computes exact fee/net, and completion settles gross once", async (t) => {
  const db = await createDatabase(t);
  await seedWallet(db);
  await setWithdrawals(db, true);

  const requested = await requestWithdrawal(db);
  assert.equal(requested.status, "reserved");
  assert.equal(requested.gross_amount_usdt, "10.000000");
  assert.equal(requested.fee_amount_usdt, "0.500000");
  assert.equal(requested.net_amount_usdt, "9.500000");
  assert.equal((await claim(db)).status, "reviewing");
  assert.equal((await sendLock(db)).status, "send_locked");
  assert.equal((await broadcast(db)).status, "broadcasted");
  const completed = await complete(db);
  assert.equal(completed.status, "completed");
  assert.equal(completed.available_balance_usdt, "10.000000000000000000");
  assert.equal(completed.reserved_balance_usdt, "0.000000000000000000");

  await setWithdrawals(db, false);
  assert.deepEqual(await complete(db), completed, "exact retry survives disabled flag");
  const evidence = await db.query(`
    select
      (select count(*)::integer from public.nowpayments_usdt_withdrawal_events) as events,
      (select count(*)::integer from public.nowpayments_usdt_withdrawal_broadcasts) as broadcasts,
      (select count(*)::integer from public.nowpayments_usdt_withdrawal_verifications) as verifications,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries where withdrawal_id = '${REQUEST_1}') as ledger,
      (select available_balance_usdt::text from public.nowpayments_usdt_wallets where user_id = '${USER_ID}') as available,
      (select reserved_balance_usdt::text from public.nowpayments_usdt_wallets where user_id = '${USER_ID}') as reserved
  `);
  assert.deepEqual(evidence.rows, [{
    events: 5, broadcasts: 1, verifications: 1, ledger: 2,
    available: "10.000000000000000000", reserved: "0.000000000000000000",
  }]);
});

test("rejection fully refunds gross, retains no fee, and is impossible after send lock", async (t) => {
  const db = await createDatabase(t);
  await seedWallet(db);
  await setWithdrawals(db, true);
  await requestWithdrawal(db);
  await claim(db);
  const rejected = (await db.query(
    `select public.reject_nowpayments_usdt_withdrawal($1::uuid,$2::uuid,$3,$4) as result`,
    [REQUEST_1, ADMIN_1_ID, actionId(20), "destination could not be verified"],
  )).rows[0].result;
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.available_balance_usdt, "20.000000000000000000");
  assert.equal(rejected.reserved_balance_usdt, "0.000000000000000000");

  const db2 = await createDatabase(t);
  await seedWallet(db2);
  await setWithdrawals(db2, true);
  await requestWithdrawal(db2);
  await claim(db2);
  await assert.rejects(
    db2.query(
      `select public.lock_nowpayments_usdt_withdrawal_send(
         $1::uuid,$2::uuid,$3,false,true
       )`,
      [REQUEST_1, ADMIN_1_ID, actionId(22)],
    ),
    /invalid_nowpayments_usdt_withdrawal_action/,
  );
  await sendLock(db2);
  await assert.rejects(
    db2.query(
      `select public.reject_nowpayments_usdt_withdrawal($1::uuid,$2::uuid,$3,$4)`,
      [REQUEST_1, ADMIN_1_ID, actionId(21), "must not release"],
    ),
    /cannot_be_rejected_after_send_lock/,
  );
});

test("destination, decimal, idempotency, hash, and verification evidence fail closed", async (t) => {
  const invalidDestinations = [
    TREASURY,
    "0x0000000000000000000000000000000000000000",
    "0x000000000000000000000000000000000000dead",
    "0xdead000000000000000000000000000000000000",
    "not-an-address",
  ];
  for (const [index, destination] of invalidDestinations.entries()) {
    const db = await createDatabase(t);
    await seedWallet(db);
    await setWithdrawals(db, true);
    await assert.rejects(
      requestWithdrawal(db, { requestId: actionId(100 + index), destination }),
      /destination|request/,
    );
  }

  const db = await createDatabase(t);
  await seedWallet(db);
  await setWithdrawals(db, true);
  for (const amount of ["1.999999", "2.0000001", "1e1", "-2", "9999999999999999999999999999999"])
    await assert.rejects(requestWithdrawal(db, { requestId: actionId(200 + amount.length), amount }), /invalid|minimum|range/);

  await requestWithdrawal(db);
  await assert.rejects(
    requestWithdrawal(db, { amount: "11" }),
    /action_id_conflict/,
  );
  await claim(db);
  await sendLock(db);
  await broadcast(db);
  for (const invalid of [
    { id: actionId(300), confirmations: 119 },
    { id: actionId(301), token: "0x0000000000000000000000000000000000000002" },
    { id: actionId(302), destination: DESTINATION_2 },
    { id: actionId(303), net: "9.499999" },
    { id: actionId(304), success: false },
    { id: actionId(305), uniqueTransfer: false },
  ]) await assert.rejects(complete(db, invalid), /verification/);
});

test("every pinned BSC precompile is rejected case-insensitively with boundary controls allowed", async (t) => {
  const db = await createDatabase(t);
  assert.match(withdrawalMigration, new RegExp(BSC_PRECOMPILE_SOURCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(withdrawalMigration, /f8b2d0856d0d1a492ecf12032ea34dc0ca380055/);

  for (const lowercase of [
    evmAddress(0),
    "0x000000000000000000000000000000000000dead",
    "0xdead000000000000000000000000000000000000",
    TREASURY,
  ]) {
    for (const address of [lowercase, lowercase.toUpperCase()]) {
      await assert.rejects(
        db.query("select public.assert_safe_nowpayments_usdt_withdrawal_destination($1)", [address]),
        /invalid_nowpayments_usdt_withdrawal_destination|qhash_controlled_withdrawal_destination/,
      );
    }
  }

  for (const value of BSC_PRECOMPILE_VALUES) {
    const lowercase = evmAddress(value);
    for (const address of [lowercase, lowercase.toUpperCase()]) {
      await assert.rejects(
        db.query("select public.assert_safe_nowpayments_usdt_withdrawal_destination($1)", [address]),
        /invalid_nowpayments_usdt_withdrawal_destination/,
        `${address} from ${BSC_PRECOMPILE_SOURCE}`,
      );
    }
  }

  for (const value of [0x12, 0x63, 0x6a, 0xff, 0x101]) {
    const expected = evmAddress(value);
    for (const address of [expected, expected.toUpperCase()]) {
      assert.equal((await db.query(
        "select public.assert_safe_nowpayments_usdt_withdrawal_destination($1) as address",
        [address],
      )).rows[0].address, expected);
    }
  }
});

test("broadcast correction is append-only, takeover is audited, and hashes are globally unique", async (t) => {
  const db = await createDatabase(t);
  await seedWallet(db);
  await seedWallet(db, USER_2_ID);
  await setWithdrawals(db, true);
  await requestWithdrawal(db);
  await claim(db);
  await sendLock(db);
  await broadcast(db);
  const takeover = (await db.query(
    `select public.take_over_nowpayments_usdt_withdrawal($1::uuid,$2::uuid,$3,$4) as result`,
    [REQUEST_1, ADMIN_2_ID, actionId(400), "original administrator unavailable"],
  )).rows[0].result;
  assert.equal(takeover.previous_admin_id, ADMIN_1_ID);
  assert.equal(takeover.current_admin_id, ADMIN_2_ID);
  await broadcast(db, {
    adminId: ADMIN_2_ID, id: actionId(401), hash: HASH_2,
    reason: "original explorer hash was transcribed incorrectly",
  });
  await complete(db, { adminId: ADMIN_2_ID, id: actionId(402), hash: HASH_2 });

  await requestWithdrawal(db, {
    userId: USER_2_ID, requestId: REQUEST_2, amount: "2", destination: DESTINATION_2,
  });
  await claim(db, REQUEST_2, ADMIN_1_ID, actionId(403));
  await sendLock(db, REQUEST_2, ADMIN_1_ID, actionId(404));
  await assert.rejects(
    broadcast(db, { withdrawalId: REQUEST_2, id: actionId(405), hash: HASH_2 }),
    /duplicate key|hash_key/,
  );

  const counts = await db.query(`
    select
      (select count(*)::integer from public.nowpayments_usdt_withdrawal_broadcasts where withdrawal_id='${REQUEST_1}') as broadcasts,
      (select count(*)::integer from public.nowpayments_usdt_withdrawal_events where withdrawal_id='${REQUEST_1}' and action_type='admin_takeover') as takeovers
  `);
  assert.deepEqual(counts.rows, [{ broadcasts: 2, takeovers: 1 }]);
  await assert.rejects(
    db.exec(`update public.nowpayments_usdt_withdrawal_events set canonical_payload='tampered'`),
    /audit evidence is immutable/,
  );
  await assert.rejects(
    db.exec(`update public.nowpayments_usdt_ledger_entries set description='tampered'`),
    /ledger entries are immutable/,
  );
});

test("max floors 18-decimal balances to six decimals and leaves sub-unit dust available", async (t) => {
  const db = await createDatabase(t);
  await seedWallet(db, USER_ID, "2.000000900000000000");
  await setWithdrawals(db, true);
  await assert.rejects(
    requestWithdrawal(db, { amount: "2.000001" }),
    /insufficient_nowpayments_usdt_available_balance/,
  );
  const result = await requestWithdrawal(db, { amount: "2.000000" });
  assert.equal(result.fee_amount_usdt, "0.100000");
  assert.equal(result.net_amount_usdt, "1.900000");
  assert.equal(result.available_balance_usdt, "0.000000900000000000");
});

test("pending, permanent, historical, and retired controlled addresses are rejected before mutation", async (t) => {
  const db = await createDatabase(t);
  await seedWallet(db);
  await setWithdrawals(db, true);
  await seedNativeDepositSession(db, "88100");
  await assert.rejects(
    requestWithdrawal(db, {
      requestId: actionId(600),
      destination: "0x9999999999999999999999999999999999999999",
    }),
    /qhash_controlled_withdrawal_destination/,
  );
  await db.query(`
    insert into public.crypto_deposit_addresses (id,user_id,network,asset,address,status) values
      ('cccccccc-cccc-4ccc-8ccc-cccccccccca1','${USER_ID}','BSC','USDT','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','active'),
      ('cccccccc-cccc-4ccc-8ccc-cccccccccca2','${USER_ID}','BSC','USDT','0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','historical')
  `);
  for (const address of [
    TREASURY.toUpperCase(),
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  ]) await assert.rejects(
    db.query("select public.assert_safe_nowpayments_usdt_withdrawal_destination($1)", [address]),
    /qhash_controlled_withdrawal_destination|invalid_nowpayments_usdt_withdrawal_destination/,
  );

  await db.query("update public.profiles set is_frozen=true where id=$1", [USER_ID]);
  await assert.rejects(
    requestWithdrawal(db, { requestId: actionId(601) }),
    /user_ineligible/,
  );
  await db.query("update public.profiles set is_frozen=false where id=$1", [USER_ID]);
  await requestWithdrawal(db, { requestId: actionId(602) });
  await db.query("update public.profiles set is_frozen=true where id=$1", [ADMIN_1_ID]);
  await assert.rejects(
    claim(db, actionId(602), ADMIN_1_ID, actionId(603)),
    /admin_ineligible/,
  );

  const permanentDb = await createDatabase(t);
  await seedWallet(permanentDb);
  const permanentSession = await seedNativeDepositSession(permanentDb, "88101");
  await settleNativeDeposit(permanentDb, permanentSession, "88101");
  assert.ok((await permanentDb.query(
    "select address_activated_at from public.nowpayments_usdt_payments where id=$1::uuid",
    [permanentSession.id],
  )).rows[0].address_activated_at);
  await assert.rejects(
    permanentDb.query(
      "select public.assert_safe_nowpayments_usdt_withdrawal_destination($1)",
      ["0X9999999999999999999999999999999999999999"],
    ),
    /qhash_controlled_withdrawal_destination/,
  );
});

test("migration preflight refuses any pre-existing withdrawal row", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await createFoundation(db);
  for (const migration of prerequisiteMigrations) await applyMigration(db, migration);
  await db.query(`
    insert into public.nowpayments_usdt_withdrawals (
      id,user_id,destination_address,amount_usdt,status
    ) values ($1::uuid,$2::uuid,$3,2,'requested')
  `, [REQUEST_1, USER_ID, DESTINATION]);
  await assert.rejects(
    applyMigration(db, withdrawalMigration),
    /withdrawal table must be empty/,
  );
});

test("migration preflight rejects wallet and ledger catalog drift before mutation", async (t) => {
  await t.test("wallet column type and precision drift", () => assertPreflightDriftFails(
    "alter table public.nowpayments_usdt_wallets alter column available_balance_usdt type numeric(36,17)",
    /wallet column fingerprint/,
  ));
  await t.test("ledger balance/reference constraint drift", () => assertPreflightDriftFails(`
    alter table public.nowpayments_usdt_ledger_entries
      drop constraint nowpayments_usdt_ledger_entries_reference_check,
      add constraint nowpayments_usdt_ledger_entries_reference_check check (entry_type <> '')
  `, /ledger constraint fingerprint/));
  await t.test("ledger index and predicate drift", () => assertPreflightDriftFails(
    "drop index public.nowpayments_usdt_ledger_entries_provider_correction_key",
    /ledger index fingerprint/,
  ));
  await t.test("wallet RLS drift", () => assertPreflightDriftFails(
    "alter table public.nowpayments_usdt_wallets disable row level security",
    /RLS fingerprint/,
  ));
  await t.test("ledger grant drift", () => assertPreflightDriftFails(
    "grant insert on public.nowpayments_usdt_ledger_entries to service_role",
    /grant fingerprint/,
  ));
  await t.test("wallet updated-at trigger identity drift", () => assertPreflightDriftFails(
    "drop trigger set_nowpayments_usdt_wallets_updated_at on public.nowpayments_usdt_wallets",
    /trigger fingerprint/,
  ));
  await t.test("ledger foreign-key delete-action drift", () => assertPreflightDriftFails(`
    alter table public.nowpayments_usdt_ledger_entries
      drop constraint nowpayments_usdt_ledger_entries_withdrawal_id_fkey,
      add constraint nowpayments_usdt_ledger_entries_withdrawal_id_fkey
        foreign key (withdrawal_id) references public.nowpayments_usdt_withdrawals(id) on delete cascade
  `, /ledger constraint fingerprint/));
});

test("migration and withdrawal lifecycle leave ETB, CBE, TeleBirr, plan purchase, deposits, and retired evidence untouched", async (t) => {
  const db = await createDatabase(t);
  const before = (await db.query(`
    select
      (select balance::text from public.wallets where user_id='${USER_ID}') as etb,
      (select count(*)::integer from public.transactions where type='plan_purchase') as plans,
      (select count(*)::integer from public.payment_methods where type='cbe') as cbe,
      (select count(*)::integer from public.payment_methods where type='telebirr') as telebirr,
      (select count(*)::integer from public.crypto_deposit_addresses) as retired,
      (select enabled from public.nowpayments_usdt_config where id='USDT-BEP20') as deposits_enabled
  `)).rows[0];
  await seedWallet(db);
  await setWithdrawals(db, true);
  await requestWithdrawal(db);
  await claim(db);
  await sendLock(db);
  await broadcast(db);
  await complete(db);
  const after = (await db.query(`
    select
      (select balance::text from public.wallets where user_id='${USER_ID}') as etb,
      (select count(*)::integer from public.transactions where type='plan_purchase') as plans,
      (select count(*)::integer from public.payment_methods where type='cbe') as cbe,
      (select count(*)::integer from public.payment_methods where type='telebirr') as telebirr,
      (select count(*)::integer from public.crypto_deposit_addresses) as retired,
      (select enabled from public.nowpayments_usdt_config where id='USDT-BEP20') as deposits_enabled
  `)).rows[0];
  assert.deepEqual(after, before);
});

function disposablePostgresUrl(t) {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    t.skip("TEST_DATABASE_URL is required for native withdrawal concurrency tests");
    return null;
  }
  const parsed = new URL(raw);
  const name = decodeURIComponent(parsed.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    || !/^qhash_test_[a-z0-9_]+$/.test(name)) {
    throw new Error("TEST_DATABASE_URL must target a disposable local qhash_test_* database");
  }
  return raw;
}

function nativeDb(client) {
  return { exec: (sql) => client.query(sql), query: (sql, params) => client.query(sql, params) };
}

async function waitForLock(observer, pid, blocker, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = (await observer.query(
      `select wait_event_type, $2::integer = any(pg_blocking_pids(pid)) as blocked
       from pg_stat_activity where pid=$1`, [pid, blocker],
    )).rows[0];
    if (row?.wait_event_type === "Lock" && row.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("expected independent PostgreSQL backend to block on a lock");
}

async function seedNativeDepositSession(client, providerPaymentId) {
  const claimed = (await client.query(
    "select public.claim_nowpayments_usdt_deposit_session($1::uuid) as result",
    [USER_ID],
  )).rows[0].result;
  await client.query(
    `select public.configure_nowpayments_usdt_deposit_session_amounts(
       $1::uuid,$2::uuid,$3::uuid,'1','1'
     )`,
    [USER_ID, claimed.id, claimed.qhash_order_id],
  );
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  const validUntil = new Date(Date.now() + 600_000).toISOString();
  await client.query(
    `select public.complete_nowpayments_usdt_deposit_session(
       $1::uuid,$2::uuid,$3,$4,'waiting',$5::timestamptz,$6::timestamptz
     )`,
    [claimed.id, claimed.qhash_order_id, providerPaymentId,
      "0x9999999999999999999999999999999999999999", createdAt, validUntil],
  );
  return claimed;
}

async function settleNativeDeposit(client, session, providerPaymentId) {
  return (await client.query(
    `select public.settle_verified_nowpayments_usdt_payment(
       $1,null,$2,$3,'usdtbsc','finished','3','2.95','usdtbsc'
     ) as result`,
    [providerPaymentId, session.qhash_order_id,
      "0x9999999999999999999999999999999999999999"],
  )).rows[0].result;
}

test("native PostgreSQL serializes requests, admin actions, and balance races on profile rows", {
  timeout: 120_000,
}, async (t) => {
  const connectionString = disposablePostgresUrl(t);
  if (!connectionString) return;
  const observer = new Client({ connectionString, application_name: "qhash-withdrawal-observer" });
  const first = new Client({ connectionString, application_name: "qhash-withdrawal-first" });
  const second = new Client({ connectionString, application_name: "qhash-withdrawal-second" });
  await Promise.all([observer.connect(), first.connect(), second.connect()]);
  t.after(async () => {
    await Promise.allSettled([first.query("rollback"), second.query("rollback")]);
    await Promise.allSettled([observer.end(), first.end(), second.end()]);
  });
  const pids = await Promise.all([observer, first, second].map(async (client) => (
    await client.query("select pg_backend_pid()::integer as pid")
  ).rows[0].pid));
  assert.equal(new Set(pids).size, 3);

  async function resetNative() {
    await Promise.allSettled([first.query("rollback"), second.query("rollback")]);
    await observer.query("drop schema if exists public cascade; create schema public");
    await installWithdrawalDatabase(nativeDb(observer));
    await seedWallet(nativeDb(observer));
    await setWithdrawals(nativeDb(observer), true);
  }

  async function resetNativePrerequisites() {
    await Promise.allSettled([first.query("rollback"), second.query("rollback")]);
    await observer.query("drop schema if exists public cascade; create schema public");
    await createFoundation(nativeDb(observer));
    for (const migration of prerequisiteMigrations) {
      await applyMigration(nativeDb(observer), migration);
    }
  }

  await t.test("unsafe wallet-first versus withdrawal-first negative control deadlocks without the profile lock", async () => {
    await resetNative();
    await requestWithdrawal(nativeDb(observer));
    await first.query("begin");
    await second.query("begin");
    await first.query("set local statement_timeout='8s'; set local deadlock_timeout='100ms'");
    await second.query("set local statement_timeout='8s'; set local deadlock_timeout='100ms'");
    await first.query(
      "select 1 from public.nowpayments_usdt_wallets where user_id=$1::uuid for update",
      [USER_ID],
    );
    await second.query(
      "select 1 from public.nowpayments_usdt_withdrawals where id=$1::uuid for update",
      [REQUEST_1],
    );
    const walletFirstThenWithdrawal = first.query(
      "select 1 from public.nowpayments_usdt_withdrawals where id=$1::uuid for update",
      [REQUEST_1],
    );
    await waitForLock(observer, pids[1], pids[2]);
    const withdrawalFirstThenWallet = second.query(
      "select 1 from public.nowpayments_usdt_wallets where user_id=$1::uuid for update",
      [USER_ID],
    );
    const unsafeResults = await Promise.allSettled([
      walletFirstThenWithdrawal,
      withdrawalFirstThenWallet,
    ]);
    const deadlocks = unsafeResults.filter(
      (result) => result.status === "rejected" && result.reason?.code === "40P01",
    );
    assert.equal(deadlocks.length, 1, "the old opposing lock order must produce a real PostgreSQL deadlock");
    assert.equal(unsafeResults.filter((result) => result.status === "fulfilled").length, 1);
    await Promise.allSettled([first.query("rollback"), second.query("rollback")]);
  });

  await t.test("native wallet and ledger catalog drift aborts before withdrawal mutation", async () => {
    for (const fixture of [
      {
        name: "wallet precision",
        drift: "alter table public.nowpayments_usdt_wallets alter column reserved_balance_usdt type numeric(36,17)",
        error: /wallet column fingerprint/,
      },
      {
        name: "ledger immutable trigger",
        drift: "drop trigger reject_nowpayments_usdt_ledger_mutation on public.nowpayments_usdt_ledger_entries",
        error: /trigger fingerprint/,
      },
    ]) {
      await resetNativePrerequisites();
      await observer.query(fixture.drift);
      await assert.rejects(
        applyMigration(nativeDb(observer), withdrawalMigration),
        fixture.error,
        fixture.name,
      );
      assert.deepEqual((await observer.query(`
        select
          exists (
            select 1 from information_schema.columns
            where table_schema='public' and table_name='nowpayments_usdt_config'
              and column_name='withdrawals_enabled'
          ) as flag_added,
          to_regclass('public.nowpayments_usdt_withdrawal_events') is not null as events_added
      `)).rows, [{ flag_added: false, events_added: false }]);
    }
  });

  await resetNative();

  await first.query("begin");
  await first.query("set local statement_timeout='8s'; set local lock_timeout='4s'");
  const firstResult = await requestWithdrawal(nativeDb(first));
  assert.equal(firstResult.status, "reserved");

  await second.query("begin");
  await second.query("set local statement_timeout='8s'; set local lock_timeout='4s'");
  const secondPromise = requestWithdrawal(nativeDb(second), {
    requestId: REQUEST_2, amount: "5", destination: DESTINATION_2,
  });
  await waitForLock(observer, pids[2], pids[1]);
  await first.query("commit");
  await assert.rejects(secondPromise, /open_nowpayments_usdt_withdrawal_exists/);
  await second.query("rollback");

  assert.deepEqual((await observer.query(`
    select
      (select count(*)::integer from public.nowpayments_usdt_withdrawals) as withdrawals,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries where entry_type='withdrawal_reserve') as reserves,
      (select available_balance_usdt::text from public.nowpayments_usdt_wallets where user_id='${USER_ID}') as available,
      (select reserved_balance_usdt::text from public.nowpayments_usdt_wallets where user_id='${USER_ID}') as reserved
  `)).rows, [{ withdrawals: 1, reserves: 1, available: "10.000000000000000000", reserved: "10.000000000000000000" }]);

  await first.query("begin");
  await claim(nativeDb(first));
  const competingClaim = claim(nativeDb(second), REQUEST_1, ADMIN_2_ID, actionId(501));
  await waitForLock(observer, pids[2], pids[1]);
  await first.query("commit");
  await assert.rejects(competingClaim, /invalid_nowpayments_usdt_withdrawal_state/);

  await first.query("begin");
  await sendLock(nativeDb(first));
  const rejection = second.query(
    `select public.reject_nowpayments_usdt_withdrawal($1::uuid,$2::uuid,$3,$4)`,
    [REQUEST_1, ADMIN_1_ID, actionId(502), "concurrent rejection"],
  );
  await waitForLock(observer, pids[2], pids[1]);
  await first.query("commit");
  await assert.rejects(rejection, /cannot_be_rejected_after_send_lock/);

  const final = (await observer.query(`
    select status,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries where withdrawal_id=w.id) as ledger,
      (select reserved_balance_usdt::text from public.nowpayments_usdt_wallets where user_id=w.user_id) as reserved
    from public.nowpayments_usdt_withdrawals w where id='${REQUEST_1}'
  `)).rows[0];
  assert.deepEqual(final, { status: "send_locked", ledger: 1, reserved: "10.000000000000000000" });

  await t.test("deposit credit first blocks reservation, then both exact mutations survive", async () => {
    await resetNative();
    const session = await seedNativeDepositSession(observer, "88001");
    await first.query("begin");
    const credited = await settleNativeDeposit(first, session, "88001");
    assert.equal(credited.status, "credited");
    const reservation = requestWithdrawal(nativeDb(second));
    await waitForLock(observer, pids[2], pids[1]);
    await first.query("commit");
    assert.equal((await reservation).status, "reserved");
    assert.deepEqual((await observer.query(`
      select available_balance_usdt::text as available,
             reserved_balance_usdt::text as reserved,
             (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger
      from public.nowpayments_usdt_wallets where user_id='${USER_ID}'
    `)).rows, [{ available: "13.000000000000000000", reserved: "10.000000000000000000", ledger: 2 }]);
  });

  await t.test("reservation first blocks deposit credit without losing either mutation", async () => {
    await resetNative();
    const session = await seedNativeDepositSession(observer, "88002");
    await first.query("begin");
    assert.equal((await requestWithdrawal(nativeDb(first))).status, "reserved");
    const settlement = settleNativeDeposit(second, session, "88002");
    await waitForLock(observer, pids[2], pids[1]);
    await first.query("commit");
    assert.equal((await settlement).status, "credited");
    assert.deepEqual((await observer.query(`
      select available_balance_usdt::text as available,
             reserved_balance_usdt::text as reserved,
             (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger
      from public.nowpayments_usdt_wallets where user_id='${USER_ID}'
    `)).rows, [{ available: "13.000000000000000000", reserved: "10.000000000000000000", ledger: 2 }]);
  });

  await t.test("rejection first blocks send lock and fully refunds", async () => {
    await resetNative();
    await requestWithdrawal(nativeDb(observer));
    await claim(nativeDb(observer));
    await first.query("begin");
    const rejected = (await first.query(
      `select public.reject_nowpayments_usdt_withdrawal($1::uuid,$2::uuid,$3,$4) as result`,
      [REQUEST_1, ADMIN_1_ID, actionId(510), "concurrent rejection wins"],
    )).rows[0].result;
    assert.equal(rejected.status, "rejected");
    const lockAttempt = sendLock(nativeDb(second), REQUEST_1, ADMIN_1_ID, actionId(511));
    await waitForLock(observer, pids[2], pids[1]);
    await first.query("commit");
    await assert.rejects(lockAttempt, /owner_or_state/);
    assert.deepEqual((await observer.query(`
      select available_balance_usdt::text as available, reserved_balance_usdt::text as reserved
      from public.nowpayments_usdt_wallets where user_id='${USER_ID}'
    `)).rows, [{ available: "20.000000000000000000", reserved: "0.000000000000000000" }]);
  });

  await t.test("broadcast and completion each defeat a concurrent rejection", async () => {
    await resetNative();
    await requestWithdrawal(nativeDb(observer));
    await claim(nativeDb(observer));
    await sendLock(nativeDb(observer));

    await first.query("begin");
    assert.equal((await broadcast(nativeDb(first))).status, "broadcasted");
    const rejectDuringBroadcast = second.query(
      `select public.reject_nowpayments_usdt_withdrawal($1::uuid,$2::uuid,$3,$4)`,
      [REQUEST_1, ADMIN_1_ID, actionId(512), "must remain locked"],
    );
    await waitForLock(observer, pids[2], pids[1]);
    await first.query("commit");
    await assert.rejects(rejectDuringBroadcast, /cannot_be_rejected_after_send_lock/);

    await first.query("begin");
    assert.equal((await complete(nativeDb(first))).status, "completed");
    const rejectDuringCompletion = second.query(
      `select public.reject_nowpayments_usdt_withdrawal($1::uuid,$2::uuid,$3,$4)`,
      [REQUEST_1, ADMIN_1_ID, actionId(513), "must remain settled"],
    );
    await waitForLock(observer, pids[2], pids[1]);
    await first.query("commit");
    await assert.rejects(rejectDuringCompletion, /cannot_be_rejected_after_send_lock/);
  });

  await t.test("duplicate request and completion actions return one durable result", async () => {
    await resetNative();
    await first.query("begin");
    const originalRequest = await requestWithdrawal(nativeDb(first));
    const duplicateRequest = requestWithdrawal(nativeDb(second));
    await waitForLock(observer, pids[2], pids[1]);
    await first.query("commit");
    assert.deepEqual(await duplicateRequest, originalRequest);
    await claim(nativeDb(observer));
    await sendLock(nativeDb(observer));
    await broadcast(nativeDb(observer));

    await first.query("begin");
    const originalCompletion = await complete(nativeDb(first));
    const duplicateCompletion = complete(nativeDb(second));
    await waitForLock(observer, pids[2], pids[1]);
    await first.query("commit");
    assert.deepEqual(await duplicateCompletion, originalCompletion);
    assert.deepEqual((await observer.query(`
      select
        (select count(*)::integer from public.nowpayments_usdt_withdrawals) as withdrawals,
        (select count(*)::integer from public.nowpayments_usdt_withdrawal_events) as events,
        (select count(*)::integer from public.nowpayments_usdt_ledger_entries where withdrawal_id='${REQUEST_1}') as ledger,
        (select reserved_balance_usdt::text from public.nowpayments_usdt_wallets where user_id='${USER_ID}') as reserved
    `)).rows, [{ withdrawals: 1, events: 5, ledger: 2, reserved: "0.000000000000000000" }]);
  });

  await t.test("the disabled flag blocks only new request/review/send boundaries", async () => {
    await resetNative();
    await setWithdrawals(nativeDb(observer), false);
    await assert.rejects(requestWithdrawal(nativeDb(observer)), /withdrawals_disabled/);
    await setWithdrawals(nativeDb(observer), true);
    const requested = await requestWithdrawal(nativeDb(observer));
    await setWithdrawals(nativeDb(observer), false);
    assert.deepEqual(await requestWithdrawal(nativeDb(observer)), requested);
    await assert.rejects(claim(nativeDb(observer)), /withdrawals_disabled/);
    await setWithdrawals(nativeDb(observer), true);
    const claimed = await claim(nativeDb(observer));
    await setWithdrawals(nativeDb(observer), false);
    assert.deepEqual(await claim(nativeDb(observer)), claimed);
    await assert.rejects(sendLock(nativeDb(observer)), /withdrawals_disabled/);
    await setWithdrawals(nativeDb(observer), true);
    const locked = await sendLock(nativeDb(observer));
    await setWithdrawals(nativeDb(observer), false);
    assert.deepEqual(await sendLock(nativeDb(observer)), locked);
    const takeover = (await observer.query(
      `select public.take_over_nowpayments_usdt_withdrawal($1::uuid,$2::uuid,$3,$4) as result`,
      [REQUEST_1, ADMIN_2_ID, actionId(525), "disabled incident handoff"],
    )).rows[0].result;
    assert.equal(takeover.current_admin_id, ADMIN_2_ID);
    assert.equal((await broadcast(nativeDb(observer), {
      adminId: ADMIN_2_ID, id: actionId(526),
    })).status, "broadcasted");
    assert.equal((await complete(nativeDb(observer), {
      adminId: ADMIN_2_ID, id: actionId(527),
    })).status, "completed");

    await resetNative();
    await requestWithdrawal(nativeDb(observer));
    await setWithdrawals(nativeDb(observer), false);
    const rejected = (await observer.query(
      `select public.reject_nowpayments_usdt_withdrawal($1::uuid,$2::uuid,$3,$4) as result`,
      [REQUEST_1, ADMIN_1_ID, actionId(520), "disabled flag still permits release"],
    )).rows[0].result;
    assert.equal(rejected.status, "rejected");
  });

  await t.test("concurrent flag disable serializes with request, review, and send-lock boundaries", async () => {
    const stages = [
      {
        name: "request",
        expected: "reserved",
        prepare: async () => {},
        run: (client, suffix) => requestWithdrawal(nativeDb(client), { requestId: actionId(suffix) }),
      },
      {
        name: "review",
        expected: "reviewing",
        prepare: async () => { await requestWithdrawal(nativeDb(observer)); },
        run: (client, suffix) => claim(nativeDb(client), REQUEST_1, ADMIN_1_ID, actionId(suffix)),
      },
      {
        name: "send-lock",
        expected: "send_locked",
        prepare: async () => {
          await requestWithdrawal(nativeDb(observer));
          await claim(nativeDb(observer));
        },
        run: (client, suffix) => sendLock(nativeDb(client), REQUEST_1, ADMIN_1_ID, actionId(suffix)),
      },
    ];

    for (const [index, stage] of stages.entries()) {
      await resetNative();
      await stage.prepare();
      await first.query("begin");
      const operationResult = await stage.run(first, 540 + index * 10);
      assert.equal(operationResult.status, stage.expected);
      const disableAfterOperation = second.query(`
        update public.nowpayments_usdt_config
        set withdrawals_enabled=false where id='USDT-BEP20'
      `);
      await waitForLock(observer, pids[2], pids[1]);
      await first.query("commit");
      await disableAfterOperation;
      assert.equal((await observer.query(
        "select withdrawals_enabled from public.nowpayments_usdt_config where id='USDT-BEP20'",
      )).rows[0].withdrawals_enabled, false, `${stage.name} must finish before disable commits`);

      await resetNative();
      await stage.prepare();
      await first.query("begin");
      await first.query(`
        update public.nowpayments_usdt_config
        set withdrawals_enabled=false where id='USDT-BEP20'
      `);
      const operationAfterDisable = stage.run(second, 545 + index * 10);
      await waitForLock(observer, pids[2], pids[1]);
      await first.query("commit");
      await assert.rejects(operationAfterDisable, /nowpayments_usdt_withdrawals_disabled/);
    }
  });

  await t.test("committed send lock survives worker disconnect and hash reuse fails globally", async () => {
    await resetNative();
    await requestWithdrawal(nativeDb(observer));
    await claim(nativeDb(observer));
    const crash = new Client({ connectionString, application_name: "qhash-withdrawal-crash-worker" });
    await crash.connect();
    await crash.query("begin");
    assert.equal((await sendLock(nativeDb(crash))).status, "send_locked");
    await crash.query("commit");
    await crash.end();
    assert.equal((await observer.query(
      `select status from public.nowpayments_usdt_withdrawals where id='${REQUEST_1}'`,
    )).rows[0].status, "send_locked");
    await assert.rejects(
      observer.query(
        `select public.reject_nowpayments_usdt_withdrawal($1::uuid,$2::uuid,$3,$4)`,
        [REQUEST_1, ADMIN_1_ID, actionId(521), "crashed worker"],
      ),
      /cannot_be_rejected_after_send_lock/,
    );
    await broadcast(nativeDb(observer));
    await complete(nativeDb(observer));

    await seedWallet(nativeDb(observer), USER_2_ID);
    await requestWithdrawal(nativeDb(observer), {
      userId: USER_2_ID, requestId: REQUEST_2, amount: "2", destination: DESTINATION_2,
    });
    await claim(nativeDb(observer), REQUEST_2, ADMIN_1_ID, actionId(522));
    await sendLock(nativeDb(observer), REQUEST_2, ADMIN_1_ID, actionId(523));
    await assert.rejects(
      broadcast(nativeDb(observer), { withdrawalId: REQUEST_2, id: actionId(524), hash: HASH_1 }),
      /duplicate key|hash_key/,
    );
  });

  await t.test("immutable event, evidence, terminal, and ledger rows reject mutation", async () => {
    await resetNative();
    await requestWithdrawal(nativeDb(observer));
    await claim(nativeDb(observer));
    await sendLock(nativeDb(observer));
    await broadcast(nativeDb(observer));
    await complete(nativeDb(observer));
    for (const sql of [
      "update public.nowpayments_usdt_withdrawal_events set canonical_payload='x'",
      "update public.nowpayments_usdt_withdrawal_broadcasts set transaction_hash='0x' || repeat('f',64)",
      "update public.nowpayments_usdt_withdrawal_verifications set confirmations=121",
      "update public.nowpayments_usdt_ledger_entries set description='x'",
      "update public.nowpayments_usdt_withdrawals set rejection_reason='x' where id='10000000-0000-4000-8000-000000000001'",
    ]) await assert.rejects(observer.query(sql), /immutable/);
  });
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const repositoryRoot = new URL("../", import.meta.url);
const migration = await readFile(
  new URL(
    "supabase/migrations/20260718190000_nowpayments_usdt_bep20_foundation/migration.sql",
    repositoryRoot,
  ),
  "utf8",
);

const databaseTypes = await readFile(
  new URL("src/lib/database.types.ts", repositoryRoot),
  "utf8",
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PLAN_TRANSACTION_ID = "22222222-2222-4222-8222-222222222222";
const CBE_METHOD_ID = "33333333-3333-4333-8333-333333333333";
const TELEBIRR_METHOD_ID = "44444444-4444-4444-8444-444444444444";
const ARCHIVE_ADDRESS_ID = "55555555-5555-4555-8555-555555555555";
const ARCHIVE_DEPOSIT_ID = "66666666-6666-4666-8666-666666666666";
const PAYMENT_ID = "77777777-7777-4777-8777-777777777777";

async function applyMigration(db) {
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
      phone text not null
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
    values ('${USER_ID}', 'foundation-user', '+251900000000');

    insert into public.wallets (user_id, balance)
    values ('${USER_ID}', 1234.56);

    insert into public.transactions (
      id, user_id, type, amount, status, description,
      balance_before, balance_after
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
  await applyMigration(db);
  return db;
}

test("creates an empty, disabled USDT-BEP20 foundation with locked rules", async (t) => {
  const db = await createMigratedDatabase(t);

  const config = await db.query(`
    select
      id,
      enabled,
      asset,
      network,
      provider_currency,
      deposit_minimum_usdt::text,
      withdrawal_minimum_usdt::text,
      withdrawal_fee_percent::text
    from public.nowpayments_usdt_config
  `);
  assert.deepEqual(config.rows, [
    {
      id: "USDT-BEP20",
      enabled: false,
      asset: "USDT",
      network: "BEP20",
      provider_currency: "usdtbsc",
      deposit_minimum_usdt: "1.000000",
      withdrawal_minimum_usdt: "2.000000",
      withdrawal_fee_percent: "5.0000",
    },
  ]);

  const emptyTables = await db.query(`
    select
      (select count(*)::integer from public.nowpayments_usdt_wallets) as wallet_count,
      (select count(*)::integer from public.nowpayments_usdt_payments) as payment_count,
      (select count(*)::integer from public.nowpayments_usdt_withdrawals) as withdrawal_count,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger_count
  `);
  assert.deepEqual(emptyTables.rows, [
    { wallet_count: 0, payment_count: 0, withdrawal_count: 0, ledger_count: 0 },
  ]);

  const etbNamedColumns = await db.query(`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name like 'nowpayments\_usdt\_%' escape '\'
      and column_name ilike '%etb%'
  `);
  assert.deepEqual(etbNamedColumns.rows, []);
});

test("preserves CBE, TeleBirr, plan_purchase, ETB balances, and retired evidence", async (t) => {
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
  assert.deepEqual(preserved.rows, [
    {
      etb_balance: "1234.56",
      transaction_type: "plan_purchase",
      transaction_amount: "250.00",
      payment_types: ["cbe", "telebirr"],
      archive_address_status: "disabled",
      archive_amount_usdt: "9.990000",
      archive_blocker_present: true,
    },
  ]);
});

test("credits only a verified finished payment using exact net outcome_amount", async (t) => {
  const db = await createMigratedDatabase(t);

  await db.exec(`
    insert into public.nowpayments_usdt_payments (
      id,
      user_id,
      provider_payment_id,
      provider_payment_status,
      verification_status,
      requested_amount_usdt,
      outcome_amount,
      verified_at
    ) values (
      '${PAYMENT_ID}',
      '${USER_ID}',
      'np-payment-1',
      'finished',
      'verified',
      10.000000,
      9.750000,
      now()
    );
  `);

  await assert.rejects(
    db.query(
      "select public.credit_verified_nowpayments_usdt_payment($1::uuid, $2, $3)",
      [PAYMENT_ID, "np-payment-1", "9.750000"],
    ),
    /nowpayments_usdt_bep20_disabled/,
  );

  await db.exec(`
    update public.nowpayments_usdt_config
    set enabled = true
    where id = 'USDT-BEP20';
  `);

  await assert.rejects(
    db.query(
      "select public.credit_verified_nowpayments_usdt_payment($1::uuid, $2, $3)",
      [PAYMENT_ID, "np-payment-1", "10.000000"],
    ),
    /nowpayments_payment_credit_verification_failed/,
  );

  const credited = await db.query(
    `select
       result ->> 'status' as status,
       result ->> 'asset' as asset,
       result ->> 'credited_amount_usdt' as credited_amount_usdt,
       result ->> 'available_balance_usdt' as available_balance_usdt,
       result ->> 'reserved_balance_usdt' as reserved_balance_usdt
     from (
       select public.credit_verified_nowpayments_usdt_payment($1::uuid, $2, $3) as result
     ) as credit_result`,
    [PAYMENT_ID, "np-payment-1", "9.750000"],
  );
  assert.deepEqual(credited.rows, [
    {
      status: "credited",
      asset: "USDT",
      credited_amount_usdt: "9.750000",
      available_balance_usdt: "9.750000",
      reserved_balance_usdt: "0.000000",
    },
  ]);

  const repeated = await db.query(
    `select result ->> 'status' as status
     from (
       select public.credit_verified_nowpayments_usdt_payment($1::uuid, $2, $3) as result
     ) as credit_result`,
    [PAYMENT_ID, "np-payment-1", "9.750000"],
  );
  assert.deepEqual(repeated.rows, [{ status: "already_credited" }]);

  const balances = await db.query(`
    select
      wallet.available_balance_usdt::text,
      wallet.reserved_balance_usdt::text,
      payment.requested_amount_usdt::text,
      payment.outcome_amount::text,
      payment.credited_amount_usdt::text,
      (select count(*)::integer from public.nowpayments_usdt_ledger_entries) as ledger_count,
      (select available_delta_usdt::text from public.nowpayments_usdt_ledger_entries) as ledger_delta,
      (select metadata ->> 'source_amount_field' from public.nowpayments_usdt_ledger_entries) as source_amount_field,
      (select balance::text from public.wallets where user_id = '${USER_ID}') as etb_balance
    from public.nowpayments_usdt_wallets as wallet
    join public.nowpayments_usdt_payments as payment
      on payment.user_id = wallet.user_id
    where payment.id = '${PAYMENT_ID}'
  `);
  assert.deepEqual(balances.rows, [
    {
      available_balance_usdt: "9.750000",
      reserved_balance_usdt: "0.000000",
      requested_amount_usdt: "10.000000",
      outcome_amount: "9.750000",
      credited_amount_usdt: "9.750000",
      ledger_count: 1,
      ledger_delta: "9.750000",
      source_amount_field: "outcome_amount",
      etb_balance: "1234.56",
    },
  ]);
});

test("enforces deposit and withdrawal minimums plus the generated five-percent fee", async (t) => {
  const db = await createMigratedDatabase(t);

  await assert.rejects(
    db.exec(`
      insert into public.nowpayments_usdt_payments (
        user_id, provider_payment_id, requested_amount_usdt
      ) values ('${USER_ID}', 'below-minimum', 0.999999);
    `),
    /nowpayments_usdt_payments_minimum_check/,
  );

  await assert.rejects(
    db.exec(`
      insert into public.nowpayments_usdt_payments (
        user_id,
        provider_payment_id,
        provider_payment_status,
        verification_status,
        requested_amount_usdt,
        outcome_amount,
        verified_at
      ) values (
        '${USER_ID}', 'not-finished', 'confirming', 'verified', 1, 1, now()
      );
    `),
    /nowpayments_usdt_payments_verification_check/,
  );

  await assert.rejects(
    db.exec(`
      insert into public.nowpayments_usdt_withdrawals (
        user_id, destination_address, amount_usdt
      ) values ('${USER_ID}', '0x2222222222222222222222222222222222222222', 1.999999);
    `),
    /nowpayments_usdt_withdrawals_minimum_check/,
  );

  await assert.rejects(
    db.exec(`
      insert into public.nowpayments_usdt_withdrawals (
        user_id, destination_address, amount_usdt, fee_percent
      ) values ('${USER_ID}', '0x2222222222222222222222222222222222222222', 2, 4);
    `),
    /nowpayments_usdt_withdrawals_fee_percent_check/,
  );

  const withdrawal = await db.query(`
    insert into public.nowpayments_usdt_withdrawals (
      user_id, destination_address, amount_usdt
    ) values (
      '${USER_ID}', '0x2222222222222222222222222222222222222222', 2
    )
    returning
      asset,
      network,
      amount_usdt::text,
      fee_percent::text,
      fee_amount_usdt::text,
      net_amount_usdt::text
  `);
  assert.deepEqual(withdrawal.rows, [
    {
      asset: "USDT",
      network: "BEP20",
      amount_usdt: "2.000000",
      fee_percent: "5.0000",
      fee_amount_usdt: "0.100000",
      net_amount_usdt: "1.900000",
    },
  ]);
});

test("keeps new tables private and the USDT ledger immutable", async (t) => {
  const db = await createMigratedDatabase(t);

  const security = await db.query(`
    select
      bool_and(table_info.relrowsecurity) as all_rls_enabled,
      bool_and(not has_table_privilege('anon', table_info.oid, 'SELECT, INSERT, UPDATE, DELETE')) as anon_blocked,
      bool_and(not has_table_privilege('authenticated', table_info.oid, 'SELECT, INSERT, UPDATE, DELETE')) as authenticated_blocked
    from pg_class as table_info
    join pg_namespace as namespace_info
      on namespace_info.oid = table_info.relnamespace
    where namespace_info.nspname = 'public'
      and table_info.relname in (
        'nowpayments_usdt_config',
        'nowpayments_usdt_wallets',
        'nowpayments_usdt_payments',
        'nowpayments_usdt_withdrawals',
        'nowpayments_usdt_ledger_entries'
      )
  `);
  assert.deepEqual(security.rows, [
    { all_rls_enabled: true, anon_blocked: true, authenticated_blocked: true },
  ]);

  const servicePrivileges = await db.query(`
    select
      has_table_privilege('service_role', 'public.nowpayments_usdt_wallets', 'SELECT') as wallet_select,
      has_table_privilege('service_role', 'public.nowpayments_usdt_wallets', 'UPDATE') as wallet_update,
      has_table_privilege('service_role', 'public.nowpayments_usdt_ledger_entries', 'SELECT') as ledger_select,
      has_table_privilege('service_role', 'public.nowpayments_usdt_ledger_entries', 'INSERT') as ledger_insert,
      has_column_privilege(
        'service_role', 'public.nowpayments_usdt_config', 'enabled', 'UPDATE'
      ) as config_enable_update,
      has_column_privilege(
        'service_role', 'public.nowpayments_usdt_payments', 'provider_payment_status', 'UPDATE'
      ) as payment_status_update,
      has_column_privilege(
        'service_role', 'public.nowpayments_usdt_payments', 'credited_amount_usdt', 'UPDATE'
      ) as payment_credit_update,
      has_column_privilege(
        'service_role', 'public.nowpayments_usdt_withdrawals', 'status', 'UPDATE'
      ) as withdrawal_status_update,
      has_column_privilege(
        'service_role', 'public.nowpayments_usdt_withdrawals', 'amount_usdt', 'UPDATE'
      ) as withdrawal_amount_update,
      has_function_privilege(
        'service_role',
        'public.credit_verified_nowpayments_usdt_payment(uuid,text,text)',
        'EXECUTE'
      ) as credit_execute,
      has_function_privilege(
        'anon',
        'public.credit_verified_nowpayments_usdt_payment(uuid,text,text)',
        'EXECUTE'
      ) as anon_credit_execute
  `);
  assert.deepEqual(servicePrivileges.rows, [
    {
      wallet_select: true,
      wallet_update: false,
      ledger_select: true,
      ledger_insert: false,
      config_enable_update: false,
      payment_status_update: true,
      payment_credit_update: false,
      withdrawal_status_update: true,
      withdrawal_amount_update: false,
      credit_execute: true,
      anon_credit_execute: false,
    },
  ]);

  await assert.rejects(
    db.exec(`
      update public.nowpayments_usdt_ledger_entries
      set description = description
      where false;
    `),
    /NOWPayments USDT ledger entries are immutable/,
  );
});

test("database types expose USDT foundation objects without changing ETB enums", () => {
  for (const tableName of [
    "nowpayments_usdt_config",
    "nowpayments_usdt_wallets",
    "nowpayments_usdt_payments",
    "nowpayments_usdt_withdrawals",
    "nowpayments_usdt_ledger_entries",
  ]) {
    assert.match(databaseTypes, new RegExp(`\\b${tableName}:\\s*\\{`));
  }

  assert.doesNotMatch(databaseTypes, /\bcredit_verified_nowpayments_usdt_payment:\s*\{/);
  assert.match(databaseTypes, /\bsettle_verified_nowpayments_usdt_payment:\s*\{/);
  assert.match(databaseTypes, /actually_paid_usdt: number \| null/);
  assert.match(databaseTypes, /credited_amount_usdt: number \| null/);
  assert.match(databaseTypes, /available_balance_usdt: number/);
  assert.match(databaseTypes, /reserved_balance_usdt: number/);
  assert.match(databaseTypes, /outcome_amount: number \| null/);
  assert.match(databaseTypes, /export type PaymentMethodType = 'cbe' \| 'telebirr'/);
  assert.match(databaseTypes, /'plan_purchase'/);
  assert.match(databaseTypes, /\bcrypto_deposit_addresses:\s*\{/);
  assert.match(databaseTypes, /\bcrypto_deposits:\s*\{/);
});

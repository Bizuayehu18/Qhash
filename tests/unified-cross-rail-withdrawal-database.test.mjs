import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

const { Client } = pg;
const root = new URL("../", import.meta.url);
const migrationPath =
  "supabase/migrations/20260726120000_unified_cross_rail_withdrawal_policy/migration.sql";
const migration = await readFile(new URL(migrationPath, root), "utf8");

const prerequisitePaths = [
  "supabase/migrations/20260718190000_nowpayments_usdt_bep20_foundation/migration.sql",
  "supabase/migrations/20260718220000_nowpayments_active_deposit_session/migration.sql",
  "supabase/migrations/20260719120000_nowpayments_ipn_settlement/migration.sql",
  "supabase/migrations/20260720213000_nowpayments_gross_deposit_credit/migration.sql",
  "supabase/migrations/20260721120000_nowpayments_permanent_deposit_address_lifecycle/migration.sql",
];
const prerequisiteMigrations = await Promise.all(
  prerequisitePaths.map((path) => readFile(new URL(path, root), "utf8")),
);
const withdrawalMigration = await readFile(
  new URL(
    "supabase/migrations/20260722120000_nowpayments_manual_usdt_withdrawal_database/migration.sql",
    root,
  ),
  "utf8",
);
const maximumPrecisionMigration = await readFile(
  new URL(
    "supabase/migrations/20260723120000_nowpayments_usdt_withdrawal_maximum_precision/migration.sql",
    root,
  ),
  "utf8",
);
const USER_IDS = Array.from(
  { length: 30 },
  (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DESTINATION = "0x1234567890abcdef1234567890abcdef12345678";

function requestId(index) {
  return `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function occurrences(source, value) {
  return source.split(value).length - 1;
}

test("portable migration source pins the unified policy and strict 24-hour boundary", () => {
  const preflightEnd = migration.indexOf("\n$preflight$;");
  const firstMutation = migration.indexOf(
    "create or replace function public.request_withdrawal_tx(",
  );
  assert.ok(preflightEnd > 0 && preflightEnd < firstMutation);
  assert.match(
    migration,
    /select profile_row\.id, profile_row\.is_frozen[\s\S]+?for update;/,
  );
  assert.match(
    migration,
    /select profile_row\.is_frozen, profile_row\.is_admin[\s\S]+?for update;/,
  );
  assert.equal(
    occurrences(
      migration,
      "select max(accepted_request.requested_at)",
    ),
    2,
  );
  assert.equal(
    occurrences(migration, "if v_now < v_next_allowed_at then"),
    2,
  );
  assert.equal(
    occurrences(migration, "if v_now <= v_next_allowed_at then"),
    0,
  );
  assert.equal(
    occurrences(migration, "message = 'withdrawal_cooldown_active'"),
    2,
  );
  assert.equal(
    occurrences(
      migration,
      "'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"'",
    ),
    2,
  );
  assert.equal(
    occurrences(migration, "raise exception 'withdrawal_already_open'"),
    2,
  );
  for (const status of [
    "reserved",
    "reviewing",
    "send_locked",
    "broadcasted",
  ]) {
    assert.ok(
      occurrences(migration, `'${status}'`) >= 2,
      `${status} must be active in both request functions`,
    );
  }
  assert.match(
    migration,
    /where withdrawal_row\.user_id = p_user_id\s+union all\s+select withdrawal_row\.created_at/,
  );
  assert.doesNotMatch(migration, /date_trunc|current_date|calendar day/i);
});

test("portable source keeps USDT replay before cross-rail gates and failures before writes", () => {
  const usdtStart = migration.indexOf(
    "create or replace function public.request_nowpayments_usdt_withdrawal(",
  );
  const usdtEnd = migration.indexOf("\n$usdt_function$;", usdtStart);
  assert.ok(usdtStart >= 0 && usdtEnd > usdtStart);
  const source = migration.slice(usdtStart, usdtEnd);

  const replay = source.indexOf("return v_existing_event.result_snapshot;");
  const conflicts = [
    ...source.matchAll(
      /raise exception 'nowpayments_usdt_action_id_conflict';/g,
    ),
  ].map((match) => match.index);
  const active = source.indexOf("raise exception 'withdrawal_already_open';");
  const cooldown = source.indexOf("message = 'withdrawal_cooldown_active'");
  const config = source.indexOf("from public.nowpayments_usdt_config");
  const destination = source.indexOf(
    "public.assert_safe_nowpayments_usdt_withdrawal_destination",
  );
  const wallet = source.indexOf("from public.nowpayments_usdt_wallets");
  const insert = source.indexOf(
    "insert into public.nowpayments_usdt_withdrawals",
  );

  assert.ok(replay > 0);
  assert.equal(conflicts.length, 2);
  assert.ok(conflicts[0] < replay);
  assert.ok(replay < conflicts[1]);
  assert.ok(conflicts[1] < active);
  assert.ok(active < config);
  assert.ok(config < cooldown);
  assert.ok(config < destination);
  assert.ok(destination < wallet);
  assert.ok(wallet < insert);
  assert.match(
    source,
    /v_payload := p_user_id::text \|\| '\|' \|\| v_gross::text \|\| '\|' \|\| v_destination;/,
  );
  assert.match(
    source,
    /v_max := pg_catalog\.trunc\(v_wallet\.available_balance_usdt, 6\);/,
  );
});

test("portable source hardens legacy mutation and both request function ACLs", () => {
  assert.match(
    migration,
    /revoke insert, update, delete, truncate, references, trigger, maintain\s+on table public\.withdrawals\s+from public, anon, authenticated, service_role;/,
  );
  assert.match(
    migration,
    /drop policy withdrawals_insert_own on public\.withdrawals;/,
  );
  assert.match(
    migration,
    /drop policy withdrawals_update_admin on public\.withdrawals;/,
  );
  for (const signature of [
    String.raw`public\.request_withdrawal_tx\(\s*uuid,\s*numeric,\s*public\.payment_method_type,\s*text,\s*text\s*\)`,
    String.raw`public\.request_nowpayments_usdt_withdrawal\(\s*uuid,\s*text,\s*text,\s*text\s*\)`,
  ]) {
    assert.match(migration, new RegExp(`alter function ${signature} owner to postgres;`));
    assert.match(
      migration,
      new RegExp(
        `revoke all on function ${signature}\\s+from public, anon, authenticated, service_role, postgres;`,
      ),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function ${signature}\\s+to service_role;`),
    );
  }
  assert.match(
    migration,
    /with actual as \([\s\S]+?pg_catalog\.aclexplode\(table_row\.relacl\)[\s\S]+?except all/,
  );
  assert.match(
    migration,
    /with actual as \([\s\S]+?from pg_catalog\.pg_policy[\s\S]+?except all/,
  );
});

function disposablePostgresUrl(t) {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    t.skip("TEST_DATABASE_URL is required for the native cross-rail fixture");
    return null;
  }
  const parsed = new URL(raw);
  const database = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    || !/^qhash_test_[a-z0-9_]+$/.test(database)
  ) {
    throw new Error(
      "TEST_DATABASE_URL must target a disposable local qhash_test_* database",
    );
  }
  return raw;
}

function nativeDb(client) {
  return {
    exec: (sql) => client.query(sql),
    query: (sql, params) => client.query(sql, params),
  };
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

    grant usage on schema public to anon, authenticated, service_role;

    create type public.transaction_type as enum (
      'deposit', 'withdrawal', 'plan_purchase', 'earning', 'admin_adjustment',
      'referral_reward', 'referral_investment_bonus', 'referral_daily_bonus'
    );
    create type public.transaction_status as enum ('pending', 'completed', 'failed');
    create type public.payment_method_type as enum ('cbe', 'telebirr');
    create type public.withdrawal_status as enum ('pending', 'approved', 'rejected');
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
      is_admin boolean not null default false,
      is_frozen boolean not null default false
    );
    create table public.wallets (
      user_id uuid primary key references public.profiles(id),
      balance numeric(18,2) not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.transactions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.profiles(id),
      type public.transaction_type not null,
      amount numeric(18,2) not null,
      status public.transaction_status not null,
      description text,
      reference_id uuid,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      balance_before numeric(18,2),
      balance_after numeric(18,2)
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
      amount_usdt numeric(36,6) not null,
      status text not null
    );
    create function public.reject_retired_native_crypto_evidence_mutation()
    returns trigger language plpgsql as $function$
    begin
      raise exception 'Retired native crypto evidence is immutable';
    end
    $function$;
  `);

  const profiles = [
    ...USER_IDS.map(
      (id, index) =>
        `('${id}','user-${index + 1}','+2519${String(index + 1).padStart(8, "0")}',false,false)`,
    ),
    `('${ADMIN_ID}','admin','+251999999999',true,false)`,
  ].join(",\n");
  await db.exec(`
    insert into public.profiles (id,username,phone,is_admin,is_frozen)
    values ${profiles};
    insert into public.wallets (user_id,balance)
    select id, 10000 from public.profiles where not is_admin;
  `);
}

async function normalizeWithdrawalRequestSecurityToProduction(db) {
  await db.exec(`
    do $role$
    begin
      if to_regrole('postgres') is null then
        create role postgres;
      end if;
      alter role postgres bypassrls;
    end
    $role$;

    alter function public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)
      owner to postgres;
    grant usage on schema public to postgres;
    grant execute on all functions in schema public to postgres;
    grant all privileges on all tables in schema public to postgres;
    grant all privileges on all sequences in schema public to postgres;
    revoke all on function
      public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)
      from public, anon, authenticated, service_role, postgres;
    set role postgres;
    grant execute on function
      public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)
      to postgres;
    grant execute on function
      public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)
      to service_role;
    reset role;
  `);
}

const liveLegacyBody = String.raw`
declare
  v_profile record;
  v_wallet record;
  v_withdrawal_id uuid;
  v_min_amount numeric := 200;
  v_fee_percent numeric := 5;
  v_fee_amount numeric := 0;
  v_net_amount numeric := 0;
  v_withdrawals_paused boolean := false;
  v_raw_setting text;
  v_last_withdrawal_at timestamptz;
  v_next_allowed_at timestamptz;
begin
  if p_user_id is null then
    raise exception 'missing_user_id';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;

  if p_account_name is null or length(trim(p_account_name)) < 2 then
    raise exception 'invalid_account_name';
  end if;

  if p_account_number is null or length(trim(p_account_number)) < 5 then
    raise exception 'invalid_account_number';
  end if;

  select value::text
    into v_raw_setting
  from public.app_settings
  where key = 'withdrawals_paused'
  limit 1;

  v_withdrawals_paused :=
    lower(trim(both '"' from coalesce(v_raw_setting, 'false'))) in ('true', '1', 'yes', 'on');

  if v_withdrawals_paused then
    raise exception 'withdrawals_paused';
  end if;

  select nullif(trim(both '"' from value::text), '')::numeric
    into v_min_amount
  from public.app_settings
  where key = 'min_withdrawal_amount'
  limit 1;

  v_min_amount := coalesce(v_min_amount, 200);

  select nullif(trim(both '"' from value::text), '')::numeric
    into v_fee_percent
  from public.app_settings
  where key = 'withdrawal_fee_percent'
  limit 1;

  v_fee_percent := coalesce(v_fee_percent, 5);

  if p_amount < v_min_amount then
    raise exception 'amount_below_minimum';
  end if;

  if v_fee_percent < 0 or v_fee_percent >= 100 then
    raise exception 'invalid_fee_percent';
  end if;

  select id, is_frozen
    into v_profile
  from public.profiles
  where id = p_user_id
  limit 1;

  if v_profile.id is null or v_profile.is_frozen = true then
    raise exception 'account_frozen_or_unavailable';
  end if;

  -- Lock wallet first. This serializes same-user withdrawal requests.
  select user_id, balance
    into v_wallet
  from public.wallets
  where user_id = p_user_id
  for update;

  if v_wallet.user_id is null then
    raise exception 'wallet_not_found';
  end if;

  -- Rolling 24-hour cooldown from this user's latest submitted withdrawal.
  select max(created_at)
    into v_last_withdrawal_at
  from public.withdrawals
  where user_id = p_user_id;

  if v_last_withdrawal_at is not null then
    v_next_allowed_at := v_last_withdrawal_at + interval '24 hours';

    if now() < v_next_allowed_at then
      raise exception 'withdrawal_cooldown_active:%', v_next_allowed_at;
    end if;
  end if;

  if v_wallet.balance < p_amount then
    raise exception 'insufficient_balance';
  end if;

  v_fee_amount := round((p_amount * v_fee_percent / 100)::numeric, 2);
  v_net_amount := round((p_amount - v_fee_amount)::numeric, 2);

  if v_net_amount <= 0 then
    raise exception 'invalid_net_amount';
  end if;

  update public.wallets
  set balance = balance - p_amount,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.withdrawals (
    user_id,
    amount,
    method,
    account_name,
    account_number,
    status,
    fee_percent,
    fee_amount,
    net_amount
  )
  values (
    p_user_id,
    p_amount,
    p_method,
    trim(p_account_name),
    trim(p_account_number),
    'pending',
    v_fee_percent,
    v_fee_amount,
    v_net_amount
  )
  returning id into v_withdrawal_id;

  insert into public.transactions (
    user_id,
    type,
    amount,
    status,
    reference_id,
    balance_before,
    balance_after
  )
  values (
    p_user_id,
    'withdrawal',
    p_amount,
    'pending',
    v_withdrawal_id,
    v_wallet.balance,
    v_wallet.balance - p_amount
  );

  return jsonb_build_object(
    'success', true,
    'withdrawal_id', v_withdrawal_id,
    'amount', p_amount,
    'fee_percent', v_fee_percent,
    'fee_amount', v_fee_amount,
    'net_amount', v_net_amount,
    'balance_before', v_wallet.balance,
    'balance_after', v_wallet.balance - p_amount,
    'status', 'pending',
    'processing_hours', 24
  );
end;
`;

async function installLegacyFunction(db) {
  await db.exec(`
    create or replace function public.request_withdrawal_tx(
      p_user_id uuid,
      p_amount numeric,
      p_method public.payment_method_type,
      p_account_name text,
      p_account_number text
    )
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $live_legacy$${liveLegacyBody}$live_legacy$;
    alter function public.request_withdrawal_tx(
      uuid,numeric,public.payment_method_type,text,text
    ) owner to postgres;
    revoke all on function public.request_withdrawal_tx(
      uuid,numeric,public.payment_method_type,text,text
    ) from public, anon, authenticated, service_role, postgres;
    set role postgres;
    grant execute on function public.request_withdrawal_tx(
      uuid,numeric,public.payment_method_type,text,text
    ) to postgres;
    grant execute on function public.request_withdrawal_tx(
      uuid,numeric,public.payment_method_type,text,text
    ) to service_role;
    reset role;
  `);
}

async function createLegacyBaseline(db) {
  await db.exec(`
    create schema if not exists auth;
    create or replace function auth.uid() returns uuid
      language sql stable as $function$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $function$;
    create or replace function public.is_admin() returns boolean
      language sql stable as $function$
      select false
      $function$;
    create or replace function public.update_updated_at_column()
    returns trigger language plpgsql as $function$
    begin
      new.updated_at = now();
      return new;
    end
    $function$;
    create table public.app_settings (
      key text primary key,
      value jsonb not null
    );
    insert into public.app_settings (key,value) values
      ('withdrawals_paused','false'::jsonb),
      ('min_withdrawal_amount','200'::jsonb),
      ('withdrawal_fee_percent','5'::jsonb);
    grant select on public.app_settings to postgres;
    create table public.withdrawals (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null
        constraint withdrawals_user_id_fkey
        references public.profiles(id) on delete cascade,
      amount numeric(18,2) not null,
      method public.payment_method_type not null,
      account_name text not null,
      account_number text not null,
      status public.withdrawal_status not null default 'pending',
      admin_note text,
      reviewed_by uuid
        constraint withdrawals_reviewed_by_fkey
        references public.profiles(id),
      reviewed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      fee_percent numeric not null default 5,
      fee_amount numeric not null default 0,
      net_amount numeric not null default 0
    );
    create index idx_withdrawals_user on public.withdrawals (user_id);
    create trigger trg_withdrawals_updated_at
      before update on public.withdrawals
      for each row execute function public.update_updated_at_column();
    alter table public.withdrawals owner to postgres;
    alter table public.withdrawals enable row level security;
    create policy withdrawals_insert_own on public.withdrawals
      for insert with check (auth.uid() = user_id);
    create policy withdrawals_select_admin on public.withdrawals
      for select using (is_admin());
    create policy withdrawals_select_own on public.withdrawals
      for select using (auth.uid() = user_id);
    create policy withdrawals_update_admin on public.withdrawals
      for update using (is_admin());
    grant all privileges on public.withdrawals
      to postgres, service_role, anon, authenticated;
  `);

  await installLegacyFunction(db);
}

async function installBaseline(db) {
  await createFoundation(db);
  for (const prerequisite of prerequisiteMigrations) {
    await applyMigration(db, prerequisite);
  }
  await db.exec(
    "update public.nowpayments_usdt_config set enabled=true where id='USDT-BEP20'",
  );
  await applyMigration(db, withdrawalMigration);
  await normalizeWithdrawalRequestSecurityToProduction(db);
  await applyMigration(db, maximumPrecisionMigration);
  await createLegacyBaseline(db);
  await db.exec(`
    update public.nowpayments_usdt_config
      set withdrawals_enabled=true
      where id='USDT-BEP20';
    insert into public.nowpayments_usdt_wallets
      (user_id,available_balance_usdt,reserved_balance_usdt)
    select id,100::numeric,0::numeric
      from public.profiles
      where not is_admin;
  `);
}

async function requestEtb(client, userId, method = "cbe", amount = "200") {
  return (await client.query(
    `select public.request_withdrawal_tx(
       $1::uuid,$2::numeric,$3::public.payment_method_type,'Test User','0912345678'
     ) as result`,
    [userId, amount, method],
  )).rows[0].result;
}

async function requestUsdt(
  client,
  userId,
  id,
  amount = "2",
  destination = DESTINATION,
) {
  return (await client.query(
    `select public.request_nowpayments_usdt_withdrawal(
       $1::uuid,$2::text,$3::text,$4::text
     ) as result`,
    [userId, id, amount, destination],
  )).rows[0].result;
}

async function acceptedCount(client, userId) {
  return Number((await client.query(
    `select
       (select count(*) from public.withdrawals where user_id=$1::uuid)
       +
       (select count(*) from public.nowpayments_usdt_withdrawals
          where user_id=$1::uuid) as count`,
    [userId],
  )).rows[0].count);
}

async function financialFingerprint(client) {
  return (await client.query(`
    select pg_catalog.jsonb_build_object(
      'etb_wallets', (
        select coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value)
          order by row_value.user_id), '[]'::jsonb)
        from public.wallets row_value
      ),
      'etb_withdrawals', (
        select coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value)
          order by row_value.created_at,row_value.id), '[]'::jsonb)
        from public.withdrawals row_value
      ),
      'transactions', (
        select coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value)
          order by row_value.created_at,row_value.id), '[]'::jsonb)
        from public.transactions row_value
      ),
      'usdt_wallets', (
        select coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value)
          order by row_value.user_id), '[]'::jsonb)
        from public.nowpayments_usdt_wallets row_value
      ),
      'usdt_withdrawals', (
        select coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value)
          order by row_value.created_at,row_value.id), '[]'::jsonb)
        from public.nowpayments_usdt_withdrawals row_value
      ),
      'usdt_ledger', (
        select coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value)
          order by row_value.created_at,row_value.id), '[]'::jsonb)
        from public.nowpayments_usdt_ledger_entries row_value
      ),
      'usdt_events', (
        select coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value)
          order by row_value.created_at,row_value.id), '[]'::jsonb)
        from public.nowpayments_usdt_withdrawal_events row_value
      )
    ) as fingerprint
  `)).rows[0].fingerprint;
}

async function catalogFingerprint(client) {
  return (await client.query(`
    select pg_catalog.jsonb_build_object(
      'functions', (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'identity', function_row.oid::regprocedure::text,
            'owner', pg_catalog.pg_get_userbyid(function_row.proowner),
            'source', function_row.prosrc,
            'security_definer', function_row.prosecdef,
            'config', function_row.proconfig,
            'acl', function_row.proacl::text
          )
          order by function_row.oid::regprocedure::text
        )
        from pg_catalog.pg_proc function_row
        where function_row.oid in (
          to_regprocedure(
            'public.request_withdrawal_tx(uuid,numeric,public.payment_method_type,text,text)'
          ),
          to_regprocedure(
            'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)'
          )
        )
      ),
      'table', (
        select pg_catalog.jsonb_build_object(
          'owner', pg_catalog.pg_get_userbyid(table_row.relowner),
          'rls', table_row.relrowsecurity,
          'force_rls', table_row.relforcerowsecurity,
          'acl', table_row.relacl::text
        )
        from pg_catalog.pg_class table_row
        where table_row.oid='public.withdrawals'::regclass
      ),
      'policies', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'name', policy_row.polname,
            'command', policy_row.polcmd,
            'roles', policy_row.polroles::text,
            'using', pg_catalog.pg_get_expr(
              policy_row.polqual,policy_row.polrelid
            ),
            'check', pg_catalog.pg_get_expr(
              policy_row.polwithcheck,policy_row.polrelid
            )
          ) order by policy_row.polname
        ),'[]'::jsonb)
        from pg_catalog.pg_policy policy_row
        where policy_row.polrelid='public.withdrawals'::regclass
      ),
      'constraints', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'name', constraint_row.conname,
            'definition', pg_catalog.pg_get_constraintdef(
              constraint_row.oid,true
            ),
            'validated', constraint_row.convalidated,
            'deferrable', constraint_row.condeferrable,
            'deferred', constraint_row.condeferred
          ) order by constraint_row.conname
        ),'[]'::jsonb)
        from pg_catalog.pg_constraint constraint_row
        where constraint_row.conrelid='public.withdrawals'::regclass
      ),
      'indexes', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'name', index_relation.relname,
            'definition', pg_catalog.pg_get_indexdef(index_row.indexrelid),
            'valid', index_row.indisvalid,
            'ready', index_row.indisready,
            'live', index_row.indislive
          ) order by index_relation.relname
        ),'[]'::jsonb)
        from pg_catalog.pg_index index_row
        join pg_catalog.pg_class index_relation
          on index_relation.oid=index_row.indexrelid
        where index_row.indrelid='public.withdrawals'::regclass
      ),
      'triggers', (
        select coalesce(pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'name', trigger_row.tgname,
            'enabled', trigger_row.tgenabled,
            'internal', trigger_row.tgisinternal,
            'definition', pg_catalog.pg_get_triggerdef(trigger_row.oid,true)
          ) order by trigger_row.tgname
        ),'[]'::jsonb)
        from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid='public.withdrawals'::regclass
      )
    ) as fingerprint
  `)).rows[0].fingerprint;
}

async function expectError(operation, pattern) {
  await assert.rejects(operation, pattern);
}

test("native PostgreSQL enforces unified cross-rail acceptance and privilege boundaries", {
  timeout: 360_000,
}, async (t) => {
  const connectionString = disposablePostgresUrl(t);
  if (!connectionString) return;

  const observer = new Client({
    connectionString,
    application_name: "qhash-cross-rail-observer",
  });
  const first = new Client({
    connectionString,
    application_name: "qhash-cross-rail-first",
  });
  const second = new Client({
    connectionString,
    application_name: "qhash-cross-rail-second",
  });
  await Promise.all([observer.connect(), first.connect(), second.connect()]);
  t.after(async () => {
    await Promise.allSettled([
      first.query("rollback"),
      second.query("rollback"),
      observer.end(),
      first.end(),
      second.end(),
    ]);
  });

  const pids = await Promise.all([observer, first, second].map(async (client) => (
    await client.query("select pg_backend_pid()::integer as pid")
  ).rows[0].pid));
  assert.equal(new Set(pids).size, 3);

  await observer.query("drop schema if exists public cascade; create schema public");
  await installBaseline(nativeDb(observer));

  const legacyFingerprint = (await observer.query(`
    select
      pg_catalog.length(pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n')) as length,
      pg_catalog.md5(pg_catalog.replace(p.prosrc,E'\\r\\n',E'\\n')) as md5
    from pg_catalog.pg_proc p
    where p.oid=to_regprocedure(
      'public.request_withdrawal_tx(uuid,numeric,public.payment_method_type,text,text)'
    )
  `)).rows[0];
  assert.deepEqual(legacyFingerprint, {
    length: 4095,
    md5: "464b7ef3fff3ff57eaeaec2c77f2b720",
  });

  // Negative control: neither old request function inspects the other rail,
  // so the old catalog contains no common cross-rail acceptance boundary.
  const oldRequestSources = (await observer.query(`
    select p.oid::regprocedure::text as identity,p.prosrc
    from pg_catalog.pg_proc p
    where p.oid in (
      to_regprocedure(
        'public.request_withdrawal_tx(uuid,numeric,public.payment_method_type,text,text)'
      ),
      to_regprocedure(
        'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)'
      )
    )
  `)).rows;
  assert.equal(oldRequestSources.length, 2);
  const oldLegacy = oldRequestSources.find(
    (row) => row.identity.startsWith("request_withdrawal_tx"),
  ).prosrc;
  const oldUsdt = oldRequestSources.find(
    (row) => row.identity.startsWith("request_nowpayments_usdt_withdrawal"),
  ).prosrc;
  assert.doesNotMatch(oldLegacy, /nowpayments_usdt_withdrawals/);
  assert.doesNotMatch(oldUsdt, /from public\.withdrawals/);

  const unsafePrivilegeUser = USER_IDS[15];
  await observer.query("set role authenticated");
  try {
    await observer.query(
      "select pg_catalog.set_config('request.jwt.claim.sub',$1,false)",
      [unsafePrivilegeUser],
    );
    await observer.query(`
      insert into public.withdrawals
        (user_id,amount,method,account_name,account_number)
      values ($1::uuid,200,'cbe','Unsafe Client','0911111111')
    `, [unsafePrivilegeUser]);
  } finally {
    await observer.query("reset role");
  }
  assert.equal(await acceptedCount(observer, unsafePrivilegeUser), 1);

  // Existing duplicate pending legacy rows are historical evidence and must be
  // preserved byte-for-byte by the catalog/security migration.
  const historicalUser = USER_IDS[1];
  await observer.query(`
    insert into public.withdrawals
      (user_id,amount,method,account_name,account_number,status,fee_percent,fee_amount,net_amount)
    values
      ($1::uuid,200,'cbe','Historical One','0911111111','pending',5,10,190),
      ($1::uuid,300,'telebirr','Historical Two','0922222222','pending',5,15,285)
  `, [historicalUser]);
  const historicalBefore = (await observer.query(
    `select jsonb_agg(to_jsonb(w) order by w.created_at,w.id) as rows
       from public.withdrawals w where user_id=$1::uuid`,
    [historicalUser],
  )).rows[0].rows;
  const completeFinancialBefore = await financialFingerprint(observer);

  await applyMigration(nativeDb(observer), migration);
  const historicalAfter = (await observer.query(
    `select jsonb_agg(to_jsonb(w) order by w.created_at,w.id) as rows
       from public.withdrawals w where user_id=$1::uuid`,
    [historicalUser],
  )).rows[0].rows;
  assert.deepEqual(historicalAfter, historicalBefore);
  assert.deepEqual(await financialFingerprint(observer), completeFinancialBefore);

  await t.test("sequential ETB/USDT requests block in both orders and both ETB methods", async () => {
    const etbFirst = USER_IDS[2];
    assert.equal((await requestEtb(observer, etbFirst, "cbe")).success, true);
    await expectError(
      requestUsdt(observer, etbFirst, requestId(2)),
      /withdrawal_already_open/,
    );
    assert.equal(await acceptedCount(observer, etbFirst), 1);

    const usdtFirst = USER_IDS[3];
    assert.equal(
      (await requestUsdt(observer, usdtFirst, requestId(3))).status,
      "reserved",
    );
    await expectError(
      requestEtb(observer, usdtFirst, "telebirr"),
      /withdrawal_already_open/,
    );
    assert.equal(await acceptedCount(observer, usdtFirst), 1);

    const etbMethods = USER_IDS[4];
    assert.equal((await requestEtb(observer, etbMethods, "telebirr")).success, true);
    await expectError(
      requestEtb(observer, etbMethods, "cbe"),
      /withdrawal_already_open/,
    );
    assert.equal(await acceptedCount(observer, etbMethods), 1);

    const etbMethodsReverse = USER_IDS[16];
    assert.equal((await requestEtb(observer, etbMethodsReverse, "cbe")).success, true);
    await expectError(
      requestEtb(observer, etbMethodsReverse, "telebirr"),
      /withdrawal_already_open/,
    );
    assert.equal(await acceptedCount(observer, etbMethodsReverse), 1);
  });

  await t.test("terminal requests consume 24 hours with an exact strict boundary", async () => {
    const boundaryPredicate = (await observer.query(`
      select
        (
          '2030-01-02T11:59:59Z'::timestamptz
          < '2030-01-01T12:00:00Z'::timestamptz + interval '24 hours'
        ) as one_second_before_is_blocked,
        (
          '2030-01-02T12:00:00Z'::timestamptz
          < '2030-01-01T12:00:00Z'::timestamptz + interval '24 hours'
        ) as exact_boundary_is_blocked
    `)).rows[0];
    assert.deepEqual(boundaryPredicate, {
      one_second_before_is_blocked: true,
      exact_boundary_is_blocked: false,
    });

    const legacyTerminal = USER_IDS[5];
    await observer.query(`
      insert into public.withdrawals
        (user_id,amount,method,account_name,account_number,status,fee_percent,fee_amount,net_amount,created_at)
      values
        ($1::uuid,200,'cbe','Terminal','0911111111','approved',5,10,190,
         pg_catalog.clock_timestamp()-interval '23 hours 59 minutes')
    `, [legacyTerminal]);
    await expectError(
      requestUsdt(observer, legacyTerminal, requestId(5)),
      /withdrawal_cooldown_active/,
    );

    const legacyRejected = USER_IDS[6];
    await observer.query(`
      insert into public.withdrawals
        (user_id,amount,method,account_name,account_number,status,fee_percent,fee_amount,net_amount,created_at)
      values
        ($1::uuid,200,'telebirr','Rejected','0911111111','rejected',5,10,190,
         pg_catalog.clock_timestamp()-interval '1 hour')
    `, [legacyRejected]);
    await expectError(
      requestUsdt(observer, legacyRejected, requestId(6)),
      /withdrawal_cooldown_active/,
    );

    const usdtTerminal = USER_IDS[7];
    await observer.query(`
      insert into public.nowpayments_usdt_withdrawals
        (id,user_id,destination_address,asset,network,provider_currency,
         gross_amount_usdt,fee_percent,status,rejected_at,rejection_reason,
         requested_at,created_at,updated_at)
      values
        ($2::uuid,$1::uuid,$3,'USDT','BEP20','usdtbsc',2,5,'rejected',
         pg_catalog.clock_timestamp()-interval '1 hour','terminal fixture',
         pg_catalog.clock_timestamp()-interval '1 hour',
         pg_catalog.clock_timestamp()-interval '1 hour',
         pg_catalog.clock_timestamp()-interval '1 hour')
    `, [usdtTerminal, requestId(7), DESTINATION]);
    await expectError(
      requestEtb(observer, usdtTerminal, "cbe"),
      /withdrawal_cooldown_active/,
    );

    const boundaryPassed = USER_IDS[8];
    await observer.query(`
      insert into public.withdrawals
        (user_id,amount,method,account_name,account_number,status,fee_percent,fee_amount,net_amount,created_at)
      values
        ($1::uuid,200,'cbe','Boundary','0911111111','approved',5,10,190,
         pg_catalog.clock_timestamp()-interval '24 hours 1 second')
    `, [boundaryPassed]);
    assert.equal(
      (await requestUsdt(observer, boundaryPassed, requestId(8))).status,
      "reserved",
    );

  });

  await t.test("active request remains blocking after 24 hours", async () => {
    const userId = USER_IDS[9];
    await observer.query(`
      insert into public.withdrawals
        (user_id,amount,method,account_name,account_number,status,fee_percent,fee_amount,net_amount,created_at)
      values
        ($1::uuid,200,'cbe','Old Pending','0911111111','pending',5,10,190,
         pg_catalog.clock_timestamp()-interval '25 hours')
    `, [userId]);
    await expectError(
      requestUsdt(observer, userId, requestId(9)),
      /withdrawal_already_open/,
    );
    assert.equal(await acceptedCount(observer, userId), 1);
  });

  await t.test("validation, disabled, and balance failures do not consume quota", async () => {
    const legacyUser = USER_IDS[10];
    await expectError(
      requestEtb(observer, legacyUser, "cbe", "199"),
      /amount_below_minimum/,
    );
    assert.equal(await acceptedCount(observer, legacyUser), 0);
    assert.equal((await requestEtb(observer, legacyUser, "cbe", "200")).success, true);

    const usdtUser = USER_IDS[11];
    await observer.query(`
      update public.nowpayments_usdt_config
        set withdrawals_enabled=false where id='USDT-BEP20'
    `);
    await expectError(
      requestUsdt(observer, usdtUser, requestId(11)),
      /nowpayments_usdt_withdrawals_disabled/,
    );
    assert.equal(await acceptedCount(observer, usdtUser), 0);
    await observer.query(`
      update public.nowpayments_usdt_config
        set withdrawals_enabled=true where id='USDT-BEP20'
    `);
    assert.equal(
      (await requestUsdt(observer, usdtUser, requestId(12))).status,
      "reserved",
    );

    const malformedDestinationUser = USER_IDS[18];
    await expectError(
      requestUsdt(
        observer,
        malformedDestinationUser,
        requestId(18),
        "2",
        "not-an-address",
      ),
      /invalid_nowpayments_usdt_withdrawal_request/,
    );
    assert.equal(await acceptedCount(observer, malformedDestinationUser), 0);
    assert.equal(
      (
        await requestUsdt(
          observer,
          malformedDestinationUser,
          requestId(19),
        )
      ).status,
      "reserved",
    );

    const insufficientEtbUser = USER_IDS[19];
    await observer.query(
      "update public.wallets set balance=100 where user_id=$1::uuid",
      [insufficientEtbUser],
    );
    await expectError(
      requestEtb(observer, insufficientEtbUser, "cbe", "200"),
      /insufficient_balance/,
    );
    assert.equal(await acceptedCount(observer, insufficientEtbUser), 0);
    await observer.query(
      "update public.wallets set balance=1000 where user_id=$1::uuid",
      [insufficientEtbUser],
    );
    assert.equal(
      (await requestEtb(observer, insufficientEtbUser, "cbe", "200")).success,
      true,
    );

    const insufficientUsdtUser = USER_IDS[20];
    await observer.query(
      `update public.nowpayments_usdt_wallets
          set available_balance_usdt=1
        where user_id=$1::uuid`,
      [insufficientUsdtUser],
    );
    await expectError(
      requestUsdt(observer, insufficientUsdtUser, requestId(20)),
      /insufficient_nowpayments_usdt_available_balance/,
    );
    assert.equal(await acceptedCount(observer, insufficientUsdtUser), 0);
    await observer.query(
      `update public.nowpayments_usdt_wallets
          set available_balance_usdt=100
        where user_id=$1::uuid`,
      [insufficientUsdtUser],
    );
    assert.equal(
      (
        await requestUsdt(
          observer,
          insufficientUsdtUser,
          requestId(21),
        )
      ).status,
      "reserved",
    );

    const frozenUser = USER_IDS[21];
    await observer.query(
      "update public.profiles set is_frozen=true where id=$1::uuid",
      [frozenUser],
    );
    await expectError(
      requestEtb(observer, frozenUser),
      /account_frozen_or_unavailable/,
    );
    await expectError(
      requestUsdt(observer, frozenUser, requestId(22)),
      /nowpayments_usdt_withdrawal_user_ineligible/,
    );
    assert.equal(await acceptedCount(observer, frozenUser), 0);
    await observer.query(
      "update public.profiles set is_frozen=false where id=$1::uuid",
      [frozenUser],
    );
    assert.equal((await requestEtb(observer, frozenUser)).success, true);
  });

  await t.test("USDT exact replay returns the original result and payload changes conflict", async () => {
    const userId = USER_IDS[12];
    const id = requestId(13);
    const firstResult = await requestUsdt(observer, userId, id);
    const replay = await requestUsdt(observer, userId, id);
    assert.deepEqual(replay, firstResult);
    await expectError(
      requestUsdt(observer, userId, id, "3"),
      /nowpayments_usdt_action_id_conflict/,
    );
    assert.equal(await acceptedCount(observer, userId), 1);
  });

  await t.test("authenticated cannot mutate legacy rows or execute either request function", async () => {
    const userId = USER_IDS[13];
    await observer.query("set role authenticated");
    try {
      await expectError(
        observer.query(`
          insert into public.withdrawals
            (user_id,amount,method,account_name,account_number)
          values ($1::uuid,200,'cbe','Client','0911111111')
        `, [userId]),
        /permission denied/,
      );
      await expectError(
        observer.query(
          "update public.withdrawals set admin_note='x' where user_id=$1::uuid",
          [userId],
        ),
        /permission denied/,
      );
      await expectError(
        observer.query(
          "delete from public.withdrawals where user_id=$1::uuid",
          [userId],
        ),
        /permission denied/,
      );
      await expectError(
        observer.query("truncate public.withdrawals"),
        /permission denied/,
      );
      await expectError(
        requestEtb(observer, userId),
        /permission denied/,
      );
      await expectError(
        requestUsdt(observer, userId, requestId(14)),
        /permission denied/,
      );
    } finally {
      await observer.query("reset role");
    }
    const privileges = (await observer.query(`
      select
        has_table_privilege('authenticated','public.withdrawals','SELECT') as can_select,
        has_table_privilege('authenticated','public.withdrawals','INSERT') as can_insert,
        has_table_privilege('authenticated','public.withdrawals','UPDATE') as can_update,
        has_table_privilege('authenticated','public.withdrawals','DELETE') as can_delete,
        has_table_privilege('authenticated','public.withdrawals','TRUNCATE') as can_truncate,
        has_table_privilege('authenticated','public.withdrawals','REFERENCES') as can_reference,
        has_table_privilege('authenticated','public.withdrawals','TRIGGER') as can_trigger,
        has_function_privilege(
          'authenticated',
          'public.request_withdrawal_tx(uuid,numeric,public.payment_method_type,text,text)',
          'EXECUTE'
        ) as can_request_etb,
        has_function_privilege(
          'authenticated',
          'public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)',
          'EXECUTE'
        ) as can_request_usdt
    `)).rows[0];
    assert.deepEqual(privileges, {
      can_select: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
      can_truncate: false,
      can_reference: false,
      can_trigger: false,
      can_request_etb: false,
      can_request_usdt: false,
    });
    assert.equal(await acceptedCount(observer, userId), 0);
  });

  await t.test("separate backend concurrent cross-rail requests admit exactly one", async () => {
    const userId = USER_IDS[14];
    const results = await Promise.allSettled([
      requestEtb(first, userId, "cbe"),
      requestUsdt(second, userId, requestId(15)),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.match(
      String(results.find((result) => result.status === "rejected").reason),
      /withdrawal_already_open|withdrawal_cooldown_active/,
    );
    assert.equal(await acceptedCount(observer, userId), 1);
  });
});

test("native PostgreSQL preflight rejects targeted catalog drift without financial mutation", {
  timeout: 360_000,
}, async (t) => {
  const connectionString = disposablePostgresUrl(t);
  if (!connectionString) return;
  const client = new Client({
    connectionString,
    application_name: "qhash-cross-rail-drift",
  });
  await client.connect();
  t.after(async () => {
    await Promise.allSettled([client.query("rollback"), client.end()]);
  });
  await client.query("drop schema if exists public cascade; create schema public");
  await installBaseline(nativeDb(client));
  const baselineCatalog = await catalogFingerprint(client);
  const baselineFinancial = await financialFingerprint(client);

  const functionSignature =
    "public.request_withdrawal_tx(uuid,numeric,public.payment_method_type,text,text)";
  const usdtSignature =
    "public.request_nowpayments_usdt_withdrawal(uuid,text,text,text)";
  const cases = [
    {
      name: "legacy function source",
      drift: `
        create or replace function public.request_withdrawal_tx(
          p_user_id uuid,
          p_amount numeric,
          p_method public.payment_method_type,
          p_account_name text,
          p_account_number text
        )
        returns jsonb language plpgsql security definer set search_path=public
        as $drift$ begin return '{}'::jsonb; end $drift$
      `,
      error: /Unexpected legacy withdrawal request function catalog/,
      restore: async () => installLegacyFunction(nativeDb(client)),
    },
    {
      name: "legacy function owner",
      drift: `
        do $role$
        begin
          if to_regrole('qhash_cross_rail_drift_owner') is null then
            create role qhash_cross_rail_drift_owner;
          end if;
        end
        $role$;
        alter function ${functionSignature}
          owner to qhash_cross_rail_drift_owner
      `,
      error: /Unexpected legacy withdrawal request function catalog/,
      restore: async () => installLegacyFunction(nativeDb(client)),
    },
    {
      name: "USDT function search path",
      drift: `alter function ${usdtSignature} set search_path=public`,
      error: /Unexpected USDT withdrawal request function catalog/,
      restore: async () => {
        await client.query(
          `alter function ${usdtSignature} set search_path=pg_catalog,public`,
        );
      },
    },
    {
      name: "USDT function ACL",
      drift: `grant execute on function ${usdtSignature} to authenticated`,
      error: /Unexpected USDT withdrawal request function ACL/,
      restore: async () => {
        await client.query(
          `revoke execute on function ${usdtSignature} from authenticated`,
        );
      },
    },
    {
      name: "legacy table ACL",
      drift:
        "grant update on public.withdrawals to authenticated with grant option",
      error: /Unexpected legacy withdrawal table ACL/,
      restore: async () => {
        await client.query(
          "revoke grant option for update on public.withdrawals from authenticated",
        );
      },
    },
    {
      name: "legacy policy",
      drift: "drop policy withdrawals_insert_own on public.withdrawals",
      error: /Unexpected legacy withdrawal policy catalog/,
      restore: async () => {
        await client.query(`
          create policy withdrawals_insert_own on public.withdrawals
            for insert with check (auth.uid() = user_id)
        `);
      },
    },
    {
      name: "legacy trigger",
      drift:
        "alter table public.withdrawals disable trigger trg_withdrawals_updated_at",
      error: /Unexpected legacy withdrawal structural catalog/,
      restore: async () => {
        await client.query(
          "alter table public.withdrawals enable trigger trg_withdrawals_updated_at",
        );
      },
    },
    {
      name: "legacy constraint",
      drift: `
        alter table public.withdrawals
          alter constraint withdrawals_user_id_fkey
          deferrable initially immediate
      `,
      error: /Unexpected legacy withdrawal structural catalog/,
      restore: async () => {
        await client.query(`
          alter table public.withdrawals
            alter constraint withdrawals_user_id_fkey not deferrable
        `);
      },
    },
    {
      name: "legacy index",
      drift: `
        drop index public.idx_withdrawals_user;
        create index idx_withdrawals_user
          on public.withdrawals (user_id desc)
      `,
      error: /Unexpected legacy withdrawal structural catalog/,
      restore: async () => {
        await client.query(`
          drop index public.idx_withdrawals_user;
          create index idx_withdrawals_user
            on public.withdrawals (user_id)
        `);
      },
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      await client.query(fixture.drift);
      const driftedCatalog = await catalogFingerprint(client);
      const driftedFinancial = await financialFingerprint(client);
      assert.notDeepEqual(driftedCatalog, baselineCatalog);
      assert.deepEqual(driftedFinancial, baselineFinancial);
      await assert.rejects(
        applyMigration(nativeDb(client), migration),
        fixture.error,
      );
      assert.deepEqual(await catalogFingerprint(client), driftedCatalog);
      assert.deepEqual(await financialFingerprint(client), driftedFinancial);
      await fixture.restore();
      assert.deepEqual(await catalogFingerprint(client), baselineCatalog);
      assert.deepEqual(await financialFingerprint(client), baselineFinancial);
    });
  }
});

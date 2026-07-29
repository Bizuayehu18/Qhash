import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const migrationPath =
  "supabase/migrations/20260729120000_fiat_deposit_global_pause_enforcement/migration.sql";
const serverPath = "src/lib/server/deposits.ts";
const availabilityPath =
  "src/domains/fiat-deposits/server/fiat-deposit-availability.ts";

export const migration = await readFile(new URL(migrationPath, root), "utf8");
export const serverSource = await readFile(new URL(serverPath, root), "utf8");
export const availabilitySource = await readFile(
  new URL(availabilityPath, root),
  "utf8",
);

export const USER_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
export const PAYMENT_METHOD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const EXPECTED_INHERITED_MD5 = "fcf41d198f7013cd09abd89aadc290be";
export const EXPECTED_GUARD_SOURCE_MD5 =
  "7b02423af9cfd598a0feaaf1e2b3188c";
export const PREFLIGHT_ERROR = /unexpected inherited fiat deposit catalog/;
export const PAUSED_ERROR = /Deposits are currently paused/;

export function disposablePostgresUrl(t) {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    t.skip(
      "TEST_DATABASE_URL is required for the native fiat deposit pause fixture",
    );
    return null;
  }

  const parsed = new URL(raw);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    || !/^qhash_test_[a-z0-9_]+$/.test(databaseName)
  ) {
    throw new Error(
      "TEST_DATABASE_URL must target an explicitly disposable local qhash_test_* database",
    );
  }

  return raw;
}

export async function applyMigration(client, sql = migration) {
  await client.query("begin");
  try {
    await client.query("set local role postgres");
    await client.query(sql);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function ensureFixtureRoles(client) {
  await client.query(`
    do $roles$
    begin
      if pg_catalog.to_regrole('anon') is null then
        create role anon inherit nobypassrls nologin;
      end if;
      if pg_catalog.to_regrole('authenticated') is null then
        create role authenticated inherit nobypassrls nologin;
      end if;
      if pg_catalog.to_regrole('service_role') is null then
        create role service_role inherit bypassrls nologin;
      end if;
    end
    $roles$;

    alter role anon with inherit nobypassrls nologin;
    alter role authenticated with inherit nobypassrls nologin;
    alter role service_role with inherit bypassrls nologin;

    do $memberships$
    declare
      membership record;
    begin
      for membership in
        select
          pg_catalog.pg_get_userbyid(member_row.roleid) as granted_role,
          pg_catalog.pg_get_userbyid(member_row.member) as member_role
        from pg_catalog.pg_auth_members member_row
        where member_row.member in (
          pg_catalog.to_regrole('anon'),
          pg_catalog.to_regrole('authenticated')
        )
      loop
        execute pg_catalog.format(
          'revoke %I from %I',
          membership.granted_role,
          membership.member_role
        );
      end loop;
    end
    $memberships$;
  `);
}

export async function createLiveBaseline(client, pauseValue = "false") {
  await client.query("reset role");
  await client.query(
    "drop event trigger if exists fiat_deposit_pause_mutation_sentinel",
  );
  await ensureFixtureRoles(client);
  await client.query("set role postgres");
  await client.query(`
    drop schema if exists public cascade;
    drop schema if exists auth cascade;
    create schema auth authorization postgres;
    create schema public authorization pg_database_owner;
    set role pg_database_owner;
    revoke all on schema public
      from public, anon, authenticated, postgres, service_role;
    grant create, usage on schema public to pg_database_owner;
    grant usage on schema public
      to public, anon, authenticated, postgres, service_role;
    reset role;
    set role postgres;
    grant usage on schema auth to anon, authenticated, service_role;

    create function auth.uid()
    returns uuid
    language sql
    stable
    as $uid$
      select nullif(
        current_setting('request.jwt.claim.sub', true),
        ''
      )::uuid
    $uid$;

    create function public.is_admin()
    returns boolean
    language sql
    stable
    as $admin$
      select false
    $admin$;

    create function public.update_updated_at_column()
    returns trigger
    language plpgsql
    as $updater$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$updater$;

    alter function public.update_updated_at_column() owner to postgres;
    revoke all on function public.update_updated_at_column()
      from public, anon, authenticated, service_role, postgres;
    grant execute on function public.update_updated_at_column()
      to public, anon, authenticated, postgres, service_role;

    create type public.deposit_status as enum (
      'pending',
      'approved',
      'rejected'
    );

    create table public.profiles (
      id uuid constraint profiles_pkey primary key
    );

    create table public.payment_methods (
      id uuid constraint payment_methods_pkey primary key
    );

    create table public.app_settings (
      key text constraint app_settings_pkey primary key,
      value text not null,
      updated_at timestamptz not null default now()
    );
    alter table public.app_settings owner to postgres;
    alter table public.app_settings enable row level security;
    create policy app_settings_service_role_select
      on public.app_settings
      as permissive
      for select
      to service_role
      using (true);
    revoke all on table public.app_settings
      from public, anon, authenticated, service_role, postgres;
    grant all privileges on table public.app_settings to postgres;
    grant select, insert, update on table public.app_settings to service_role;

    create table public.deposits (
      id uuid not null default gen_random_uuid(),
      user_id uuid not null,
      payment_method_id uuid not null,
      amount numeric(18, 2) not null,
      transaction_reference text not null,
      payer_name text,
      status public.deposit_status not null default 'pending',
      payer_phone text,
      proof_url text,
      reviewed_by uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      verification_status text,
      verified_at timestamptz,
      receipt_url text,
      auto_verified boolean default false,
      admin_note text,
      reviewed_at timestamptz,
      constraint deposits_pkey primary key (id),
      constraint deposits_payment_method_id_fkey
        foreign key (payment_method_id)
        references public.payment_methods(id),
      constraint deposits_user_id_fkey
        foreign key (user_id)
        references public.profiles(id)
        on delete cascade,
      constraint unique_transaction_reference
        unique (transaction_reference)
    );
    alter table public.deposits
      drop column payer_name,
      drop column payer_phone,
      drop column proof_url,
      drop column reviewed_by,
      drop column verification_status;
    create index idx_deposits_user on public.deposits using btree (user_id);
    alter table public.deposits owner to postgres;
    alter table public.deposits enable row level security;
    create policy deposits_insert_own
      on public.deposits
      as permissive
      for insert
      to public
      with check (auth.uid() = user_id);
    create policy deposits_select_admin
      on public.deposits
      as permissive
      for select
      to public
      using (is_admin());
    create policy deposits_select_own
      on public.deposits
      as permissive
      for select
      to public
      using (auth.uid() = user_id);
    create policy deposits_update_admin
      on public.deposits
      as permissive
      for update
      to public
      using (is_admin());
    revoke all on table public.deposits
      from public, anon, authenticated, service_role, postgres;
    grant all privileges on table public.deposits
      to postgres, anon, authenticated, service_role;
    create trigger trg_deposits_updated_at
      before update on public.deposits
      for each row
      execute function public.update_updated_at_column();

    create table public.deposit_verification_logs (
      id uuid primary key default gen_random_uuid(),
      deposit_id uuid,
      constraint deposit_verification_logs_deposit_id_fkey
        foreign key (deposit_id)
        references public.deposits(id)
        on delete set null
    );

    insert into public.profiles (id)
    values ('${USER_ID}'), ('${OTHER_USER_ID}');
    insert into public.payment_methods (id)
    values ('${PAYMENT_METHOD_ID}');
    insert into public.app_settings (key, value)
    values ('deposits_paused', '${pauseValue}');
  `);
  await client.query("reset role");
}

export async function installMutationSentinel(client) {
  await client.query(`
    set role postgres;
    create function public.fiat_deposit_pause_mutation_sentinel()
    returns event_trigger
    language plpgsql
    as $sentinel$
    begin
      raise exception 'fiat_pause_mutation_reached';
    end
    $sentinel$;

    create event trigger fiat_deposit_pause_mutation_sentinel
    on ddl_command_start
    when tag in (
      'CREATE FUNCTION',
      'ALTER FUNCTION',
      'DROP FUNCTION',
      'CREATE TRIGGER',
      'ALTER TABLE',
      'GRANT',
      'REVOKE'
    )
    execute function public.fiat_deposit_pause_mutation_sentinel();
    reset role;
  `);
}

export async function removeMutationSentinel(client) {
  await client.query("reset role");
  await client.query(`
    drop event trigger if exists fiat_deposit_pause_mutation_sentinel;
    drop function if exists public.fiat_deposit_pause_mutation_sentinel();
  `);
}

export async function insertDeposit(client, {
  role = "service_role",
  userId = USER_ID,
  reference,
  amount = "2000.00",
} = {}) {
  await client.query("begin");
  try {
    await client.query(`set local role ${role}`);
    await client.query(
      "select set_config('request.jwt.claim.sub', $1, true)",
      [userId],
    );
    await client.query(
      `insert into public.deposits (
         user_id,
         payment_method_id,
         amount,
         transaction_reference,
         receipt_url,
         status
       )
       values ($1::uuid, $2::uuid, $3::numeric, $4, $5, 'pending')`,
      [
        userId,
        PAYMENT_METHOD_ID,
        amount,
        reference,
        `https://receipt.test/${reference}`,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

export async function operationalState(client) {
  return (await client.query(`
    select
      (
        select count(*)::integer
        from public.deposits
      ) as deposits,
      (
        select count(*)::integer
        from public.deposit_verification_logs
      ) as verification_logs,
      (
        select value
        from public.app_settings
        where key = 'deposits_paused'
      ) as pause_value,
      pg_catalog.to_regprocedure(
        'public.enforce_fiat_deposits_open()'
      ) is not null as guard_exists,
      exists (
        select 1
        from pg_catalog.pg_trigger trigger_row
        where trigger_row.tgrelid = 'public.deposits'::regclass
          and trigger_row.tgname = 'trg_deposits_require_open'
      ) as pause_trigger_exists
  `)).rows[0];
}

export async function guardCatalog(client) {
  return (await client.query(`
    select
      pg_catalog.pg_get_userbyid(function_row.proowner) as owner,
      language_row.lanname as language,
      function_row.prosecdef as security_definer,
      function_row.provolatile as volatility,
      function_row.proisstrict as strict,
      function_row.proparallel as parallel,
      function_row.proconfig as config,
      pg_catalog.pg_get_function_identity_arguments(function_row.oid)
        as identity_arguments,
      pg_catalog.pg_get_function_result(function_row.oid) as result_type,
      pg_catalog.md5(
        pg_catalog.replace(function_row.prosrc, E'\\r\\n', E'\\n')
      ) as source_md5,
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_array(
            case
              when acl_row.grantee = 0 then 'PUBLIC'
              else pg_catalog.pg_get_userbyid(acl_row.grantee)
            end,
            pg_catalog.pg_get_userbyid(acl_row.grantor),
            acl_row.privilege_type,
            acl_row.is_grantable
          )
          order by
            pg_catalog.convert_to(
              case
                when acl_row.grantee = 0 then 'PUBLIC'
                else pg_catalog.pg_get_userbyid(acl_row.grantee)
              end,
              'UTF8'
            ),
            pg_catalog.convert_to(acl_row.privilege_type, 'UTF8')
        )
        from pg_catalog.aclexplode(function_row.proacl) acl_row
      ) as acl,
      pg_catalog.has_function_privilege(
        'anon',
        function_row.oid,
        'EXECUTE'
      ) as anon_execute,
      pg_catalog.has_function_privilege(
        'authenticated',
        function_row.oid,
        'EXECUTE'
      ) as authenticated_execute,
      pg_catalog.has_function_privilege(
        'service_role',
        function_row.oid,
        'EXECUTE'
      ) as service_role_execute,
      pg_catalog.has_function_privilege(
        'postgres',
        function_row.oid,
        'EXECUTE'
      ) as postgres_execute
    from pg_catalog.pg_proc function_row
    join pg_catalog.pg_language language_row
      on language_row.oid = function_row.prolang
    where function_row.oid =
      'public.enforce_fiat_deposits_open()'::regprocedure
  `)).rows[0];
}

export async function waitForBlocker(
  observer,
  blockedPid,
  blockerPid,
  timeoutMs = 4_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await observer.query(
      `select
         wait_event_type,
         $2::integer = any(pg_catalog.pg_blocking_pids(pid)) as blocked
       from pg_catalog.pg_stat_activity
       where pid = $1::integer`,
      [blockedPid, blockerPid],
    );
    if (
      result.rows[0]?.wait_event_type === "Lock"
      && result.rows[0]?.blocked === true
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `backend ${blockedPid} was not blocked by ${blockerPid} within ${timeoutMs}ms`,
  );
}

export async function bounded(promise, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

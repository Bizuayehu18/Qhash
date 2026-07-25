import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import pg from "pg";

const { Client } = pg;
const root = new URL("../", import.meta.url);
const migrationPath =
  "supabase/migrations/20260725120000_fund_pin_security_baseline/migration.sql";
const migration = await readFile(new URL(migrationPath, root), "utf8");
const databaseTypes = await readFile(
  new URL("src/lib/database.types.ts", root),
  "utf8",
);
const securityServer = await readFile(
  new URL("src/lib/server/security.ts", root),
  "utf8",
);
const etbWithdrawalServer = await readFile(
  new URL("src/lib/server/withdrawals.ts", root),
  "utf8",
);
const usdtWithdrawalFunction = await readFile(
  new URL("netlify/functions/nowpayments-usdt-withdrawal-request.mts", root),
  "utf8",
);

const USER_ID = "11111111-1111-4111-8111-111111111111";
const USER_2_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FUND_PIN_FUNCTIONS = [
  "get_fund_password_status_tx(uuid)",
  "set_fund_password_tx(uuid,text)",
  "verify_fund_password_tx(uuid,text)",
  "change_fund_password_tx(uuid,text,text)",
  "reset_user_fund_password_tx(uuid,uuid,text)",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function functionDefinition(source, name) {
  const startPattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${escapeRegExp(name)}\\s*\\(`,
    "i",
  );
  const match = startPattern.exec(source);
  if (!match) throw new Error(`missing authoritative ${name} definition`);
  const end = source.indexOf("$function$;", match.index);
  if (end < 0) throw new Error(`unterminated authoritative ${name} definition`);
  return source.slice(match.index, end + "$function$;".length);
}

function preMigrationDefinition(name) {
  const legacySearchPath = name === "reset_user_fund_password_tx"
    ? "set search_path to 'public'"
    : "set search_path to 'public', 'extensions'";

  return functionDefinition(migration, name)
    .replace(
      /set\s+search_path\s+(?:=|to)\s*'?pg_catalog'?\s*,\s*'?public'?/i,
      legacySearchPath,
    )
    .replace(
      /extensions\.crypt\(\s*p_fund_password,\s*extensions\.gen_salt\('bf', 10\)\s*\)/,
      "crypt(p_fund_password, gen_salt('bf', 10))",
    )
    .replace(
      /extensions\.crypt\(\s*p_fund_password,\s*v_row\.fund_password_hash\s*\)/,
      "crypt(p_fund_password, v_row.fund_password_hash)",
    )
    .replace(
      /'code', case\s+when v_locked_until is not null then 'fund_password_locked'\s+else 'incorrect_fund_password'\s+end,/,
      "'code', case when v_locked_until is not null then 'fund_password_locked' else 'incorrect_fund_password' end,",
    )
    .replace(
      /when v_locked_until is not null\s+then 'Too many incorrect attempts\. Fund password is temporarily locked\.'/,
      "when v_locked_until is not null then 'Too many incorrect attempts. Fund password is temporarily locked.'",
    )
    .replace(
      /public\.verify_fund_password_tx\(\s*p_user_id,\s*p_current_fund_password\s*\)/,
      "public.verify_fund_password_tx(p_user_id, p_current_fund_password)",
    )
    .replace(
      /extensions\.crypt\(\s*p_new_fund_password,\s*extensions\.gen_salt\('bf', 10\)\s*\)/,
      "crypt(p_new_fund_password, gen_salt('bf', 10))",
    );
}

function disposablePostgresUrl(t) {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    t.skip("TEST_DATABASE_URL is required for native Fund PIN catalog tests");
    return null;
  }

  const parsed = new URL(raw);
  const name = decodeURIComponent(parsed.pathname.slice(1));
  if (
    !["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)
    || !/^qhash_test_[a-z0-9_]+$/.test(name)
  ) {
    throw new Error(
      "TEST_DATABASE_URL must target an explicitly disposable local qhash_test_* database",
    );
  }
  return raw;
}

async function applyMigration(client, sql = migration) {
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function resetPublicSchema(client) {
  await client.query("drop schema if exists public cascade; create schema public");
  await client.query("drop schema if exists auth cascade; create schema auth");
  await client.query("drop schema if exists extensions cascade; create schema extensions");
  await client.query(`
    do $roles$
    begin
      if to_regrole('anon') is null then create role anon nologin; end if;
      if to_regrole('authenticated') is null then create role authenticated nologin; end if;
      if to_regrole('service_role') is null then create role service_role nologin; end if;
      if to_regrole('fund_pin_drift_owner') is null then
        create role fund_pin_drift_owner nologin;
      end if;
      if to_regrole('fund_pin_unexpected_grantee') is null then
        create role fund_pin_unexpected_grantee nologin;
      end if;
    end
    $roles$
  `);
  await client.query("create extension if not exists pgcrypto with schema extensions");
}

async function createLivePreMigrationCatalog(client) {
  await resetPublicSchema(client);
  await client.query(`
    create table auth.users (
      id uuid primary key
    );

    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      username text not null,
      phone text,
      is_admin boolean not null default false,
      is_frozen boolean not null default false
    );

    create table public.admin_security_reset_audit (
      id bigint generated always as identity primary key,
      admin_user_id uuid not null references public.profiles(id),
      target_user_id uuid not null references public.profiles(id),
      action text not null,
      reason text not null,
      old_had_fund_password boolean not null,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table public.user_security_settings (
      user_id uuid not null,
      fund_password_hash text not null,
      fund_password_set_at timestamptz not null default now(),
      fund_password_updated_at timestamptz not null default now(),
      fund_password_failed_attempts integer not null default 0,
      fund_password_locked_until timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint user_security_settings_pkey primary key (user_id),
      constraint user_security_settings_user_id_fkey
        foreign key (user_id) references auth.users(id) on delete cascade,
      constraint user_security_settings_fund_password_failed_attempts_check
        check (fund_password_failed_attempts >= 0)
    );

    alter table public.user_security_settings owner to postgres;
    alter table public.user_security_settings enable row level security;
    revoke all on table public.user_security_settings from public, anon, authenticated;
    grant all on table public.user_security_settings to postgres, service_role;

    insert into auth.users (id) values
      ('${USER_ID}'), ('${USER_2_ID}'), ('${ADMIN_ID}');
    insert into public.profiles (id, username, phone, is_admin) values
      ('${USER_ID}', 'user-one', '+251900000001', false),
      ('${USER_2_ID}', 'user-two', '+251900000002', false),
      ('${ADMIN_ID}', 'admin-one', '+251900000003', true);
  `);

  for (const name of [
    "get_fund_password_status_tx",
    "set_fund_password_tx",
    "verify_fund_password_tx",
    "change_fund_password_tx",
    "reset_user_fund_password_tx",
  ]) {
    await client.query(preMigrationDefinition(name));
  }

  for (const identity of FUND_PIN_FUNCTIONS.slice(0, 4)) {
    await client.query(`
      alter function public.${identity} owner to postgres;
      revoke all on function public.${identity} from public;
      grant execute on function public.${identity}
        to anon, authenticated, postgres, service_role;
    `);
  }

  await client.query(`
    alter function public.reset_user_fund_password_tx(uuid,uuid,text)
      owner to postgres;
    revoke all on function
      public.reset_user_fund_password_tx(uuid,uuid,text)
      from public, anon, authenticated;
    grant execute on function
      public.reset_user_fund_password_tx(uuid,uuid,text)
      to postgres, service_role;

    insert into public.user_security_settings (
      user_id,
      fund_password_hash,
      fund_password_set_at,
      fund_password_updated_at,
      fund_password_failed_attempts,
      fund_password_locked_until,
      created_at,
      updated_at
    ) values (
      '${USER_2_ID}',
      extensions.crypt('9876', extensions.gen_salt('bf', 10)),
      '2030-01-01T00:00:00Z',
      '2030-01-01T00:00:00Z',
      0,
      null,
      '2030-01-01T00:00:00Z',
      '2030-01-01T00:00:00Z'
    );
  `);
}

async function catalogAndDataFingerprint(client) {
  return (await client.query(`
    with target_functions as (
      select p.oid
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'get_fund_password_status_tx',
          'set_fund_password_tx',
          'verify_fund_password_tx',
          'change_fund_password_tx',
          'reset_user_fund_password_tx'
        )
    )
    select jsonb_build_object(
      'table', (
        select jsonb_build_array(
          pg_get_userbyid(c.relowner),
          c.relkind,
          c.relpersistence,
          c.relrowsecurity,
          c.relforcerowsecurity,
          c.relacl
        )
        from pg_class c
        where c.oid = 'public.user_security_settings'::regclass
      ),
      'columns', (
        select jsonb_agg(
          jsonb_build_array(
            a.attname,
            a.attnum,
            format_type(a.atttypid, a.atttypmod),
            a.attnotnull,
            a.attidentity,
            a.attgenerated,
            pg_get_expr(d.adbin, d.adrelid),
            a.attacl
          )
          order by a.attnum
        )
        from pg_attribute a
        left join pg_attrdef d
          on d.adrelid = a.attrelid and d.adnum = a.attnum
        where a.attrelid = 'public.user_security_settings'::regclass
          and a.attnum > 0
          and not a.attisdropped
      ),
      'functions', (
        select jsonb_agg(
          jsonb_build_array(
            p.oid::regprocedure::text,
            pg_get_userbyid(p.proowner),
            l.lanname,
            pg_get_function_result(p.oid),
            p.prosrc,
            p.prosecdef,
            p.provolatile,
            p.proisstrict,
            p.proparallel,
            p.proconfig,
            p.proacl
          )
          order by p.oid::regprocedure::text collate "C"
        )
        from target_functions t
        join pg_proc p on p.oid = t.oid
        join pg_language l on l.oid = p.prolang
      ),
      'constraints', (
        select jsonb_agg(
          jsonb_build_array(
            conname,
            contype,
            pg_get_constraintdef(oid, true),
            convalidated,
            condeferrable,
            condeferred
          )
          order by conname
        )
        from pg_constraint
        where conrelid = 'public.user_security_settings'::regclass
      ),
      'triggers', (
        select coalesce(jsonb_agg(
          jsonb_build_array(
            tgname,
            tgenabled,
            pg_get_triggerdef(oid, true)
          )
          order by tgname
        ), '[]'::jsonb)
        from pg_trigger
        where tgrelid = 'public.user_security_settings'::regclass
          and not tgisinternal
      ),
      'indexes', (
        select jsonb_agg(
          jsonb_build_array(
            indexrelid::regclass::text,
            pg_get_indexdef(indexrelid),
            indisunique,
            indisvalid,
            indisready,
            indislive,
            pg_get_expr(indpred, indrelid)
          )
          order by indexrelid::regclass::text collate "C"
        )
        from pg_index
        where indrelid = 'public.user_security_settings'::regclass
      ),
      'policies', (
        select coalesce(jsonb_agg(
          jsonb_build_array(
            policyname,
            permissive,
            roles,
            cmd,
            qual,
            with_check
          )
          order by policyname
        ), '[]'::jsonb)
        from pg_policies
        where schemaname = 'public'
          and tablename = 'user_security_settings'
      ),
      'rows', (
        select coalesce(jsonb_agg(to_jsonb(s) order by s.user_id), '[]'::jsonb)
        from public.user_security_settings s
      ),
      'reset_audit', (
        select coalesce(jsonb_agg(to_jsonb(a) order by a.id), '[]'::jsonb)
        from public.admin_security_reset_audit a
      )
    ) as fingerprint
  `)).rows[0].fingerprint;
}

async function functionSecurityRows(client) {
  return (await client.query(`
    select
      p.oid::regprocedure::text as identity,
      pg_get_userbyid(p.proowner) as owner,
      l.lanname as language,
      pg_get_function_result(p.oid) as result,
      p.prosecdef as security_definer,
      p.proconfig as config,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'grantee',
              case when x.grantee = 0 then 'PUBLIC' else grantee.rolname end,
            'grantor', grantor.rolname,
            'privilege', x.privilege_type,
            'grantable', x.is_grantable
          )
          order by
            case when x.grantee = 0 then 'PUBLIC' else grantee.rolname end,
            grantor.rolname,
            x.privilege_type,
            x.is_grantable
        )
        from aclexplode(p.proacl) x
        left join pg_roles grantee on grantee.oid = x.grantee
        left join pg_roles grantor on grantor.oid = x.grantor
      ), '[]'::jsonb) as acl
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.oid = any(array[
        to_regprocedure('public.get_fund_password_status_tx(uuid)'),
        to_regprocedure('public.set_fund_password_tx(uuid,text)'),
        to_regprocedure('public.verify_fund_password_tx(uuid,text)'),
        to_regprocedure('public.change_fund_password_tx(uuid,text,text)'),
        to_regprocedure('public.reset_user_fund_password_tx(uuid,uuid,text)')
      ])
    order by p.oid::regprocedure::text collate "C"
  `)).rows;
}

test("migration commits the complete Fund PIN catalog and service-only boundary", () => {
  const firstMutationCandidates = [
    /\bcreate\s+or\s+replace\s+function\b/i,
    /\balter\s+table\b/i,
    /\brevoke\b/i,
    /\bgrant\b/i,
    /\bcomment\s+on\b/i,
  ]
    .map((pattern) => pattern.exec(migration)?.index ?? Number.POSITIVE_INFINITY);
  const firstMutation = Math.min(...firstMutationCandidates);
  const preflightEnd = migration.search(/\$preflight\$\s*;/i);

  assert.match(
    migration,
    /^(?:\s*--[^\r\n]*(?:\r?\n|$))*\s*(?:begin\s*;\s*)?do\s+\$preflight\$/i,
  );
  assert.ok(preflightEnd > 0, "migration must have a named preflight block");
  assert.ok(
    firstMutation > preflightEnd,
    "all preflight checks must finish before the first mutation",
  );

  for (const catalogToken of [
    "user_security_settings",
    "pg_attribute",
    "pg_constraint",
    "pg_index",
    "pg_trigger",
    "pg_policy",
    "pg_proc",
    "pg_language",
    "aclexplode",
    "relrowsecurity",
    "relforcerowsecurity",
    "relpersistence",
    "column_position",
    "column_acl",
    "attacl",
    "convalidated",
    "indisvalid",
    "indisready",
    "prosecdef",
    "proconfig",
    "proacl",
  ]) {
    assert.match(
      migration,
      new RegExp(escapeRegExp(catalogToken), "i"),
      `missing pre/postflight catalog pin for ${catalogToken}`,
    );
  }

  for (const name of [
    "get_fund_password_status_tx",
    "set_fund_password_tx",
    "verify_fund_password_tx",
    "change_fund_password_tx",
    "reset_user_fund_password_tx",
  ]) {
    const definition = functionDefinition(migration, name);
    assert.match(definition, /returns\s+jsonb/i);
    assert.match(definition, /language\s+plpgsql/i);
    assert.match(definition, /security\s+definer/i);
    assert.match(
      definition,
      /set\s+search_path\s+(?:=|to)\s*'?pg_catalog'?\s*,\s*'?public'?/i,
    );
    assert.doesNotMatch(definition, /set\s+search_path[^;\n]*extensions/i);
  }

  assert.match(migration, /\^\[0-9\]\{4\}\$/);
  assert.match(migration, /extensions\.crypt\s*\(/i);
  assert.match(migration, /extensions\.gen_salt\s*\(/i);
  assert.match(
    migration,
    /revoke\s+all\s+on\s+function[\s\S]+?from\s+public\s*,\s*anon\s*,\s*authenticated/i,
  );
  assert.match(
    migration,
    /grant\s+execute\s+on\s+function[\s\S]+?to\s+service_role/i,
  );
  assert.doesNotMatch(migration, /with\s+grant\s+option/i);
});

test("generated database types expose the authoritative Fund PIN table and functions", () => {
  assert.match(databaseTypes, /user_security_settings:\s*\{/);
  for (const column of [
    "user_id",
    "fund_password_hash",
    "fund_password_set_at",
    "fund_password_updated_at",
    "fund_password_failed_attempts",
    "fund_password_locked_until",
    "created_at",
    "updated_at",
  ]) {
    assert.match(databaseTypes, new RegExp(`\\b${column}\\b`));
  }
  assert.match(
    databaseTypes,
    /get_fund_password_status_tx:\s*\{[\s\S]*?p_user_id:\s*string[\s\S]*?Returns:\s*Json/,
  );
  assert.match(
    databaseTypes,
    /set_fund_password_tx:\s*\{[\s\S]*?p_user_id:\s*string[\s\S]*?p_fund_password:\s*string[\s\S]*?Returns:\s*Json/,
  );
  assert.match(
    databaseTypes,
    /verify_fund_password_tx:\s*\{[\s\S]*?p_user_id:\s*string[\s\S]*?p_fund_password:\s*string[\s\S]*?Returns:\s*Json/,
  );
  assert.match(
    databaseTypes,
    /change_fund_password_tx:\s*\{[\s\S]*?p_user_id:\s*string[\s\S]*?p_current_fund_password:\s*string[\s\S]*?p_new_fund_password:\s*string[\s\S]*?Returns:\s*Json/,
  );
  assert.match(
    databaseTypes,
    /reset_user_fund_password_tx:\s*\{[\s\S]*?p_admin_user_id:\s*string[\s\S]*?p_target_user_id:\s*string[\s\S]*?p_reason:\s*string[\s\S]*?Returns:\s*Json/,
  );
});

test("ETB and USDT callers remain server-owned and the migration adds no logging", () => {
  assert.match(
    securityServer,
    /const userId = await getAuthenticatedUserId\(data\.accessToken\)/,
  );
  assert.match(
    securityServer,
    /\.rpc\(\s*"get_fund_password_status_tx",\s*\{\s*p_user_id:\s*userId\s*\}/,
  );
  assert.match(securityServer, /"set_fund_password_tx"[\s\S]*?p_user_id:\s*userId/);
  assert.match(securityServer, /"change_fund_password_tx"[\s\S]*?p_user_id:\s*userId/);
  assert.match(
    etbWithdrawalServer,
    /verifyFundPasswordForUser\(authUser\.id,\s*data\.fundPassword\)/,
  );
  assert.match(
    usdtWithdrawalFunction,
    /\.rpc\(\s*"verify_fund_password_tx"[\s\S]*?p_user_id:\s*authData\.user\.id/,
  );
  assert.match(usdtWithdrawalFunction, /p_fund_password:\s*body\.fund_password/);
  assert.doesNotMatch(migration, /\braise\s+(?:notice|warning|log|info|debug)\b/i);
  assert.doesNotMatch(migration, /\b(?:password|pin|token|financial)[^\r\n]*\braise\b/i);
});

test("native PostgreSQL enforces exact preflight, service-only ACLs, and Fund PIN behavior", {
  timeout: 360_000,
}, async (t) => {
  const connectionString = disposablePostgresUrl(t);
  if (!connectionString) return;

  const client = new Client({
    connectionString,
    application_name: "qhash-fund-pin-security-baseline",
  });
  await client.connect();
  t.after(async () => {
    await Promise.allSettled([client.query("rollback"), client.end()]);
  });

  const driftFixtures = [
    {
      name: "function owner",
      sql: "alter function public.get_fund_password_status_tx(uuid) owner to fund_pin_drift_owner",
    },
    {
      name: "function source",
      sql: `
        create or replace function public.get_fund_password_status_tx(p_user_id uuid)
        returns jsonb language plpgsql security definer
        set search_path to 'public', 'extensions'
        as $function$ begin return '{}'::jsonb; end; $function$
      `,
    },
    {
      name: "signature",
      sql: `
        create function public.get_fund_password_status_tx(p_user_id text)
        returns jsonb language sql as $function$ select '{}'::jsonb $function$
      `,
    },
    {
      name: "return type",
      sql: `
        drop function public.get_fund_password_status_tx(uuid);
        create function public.get_fund_password_status_tx(p_user_id uuid)
        returns text language sql security definer
        set search_path to 'public', 'extensions'
        as $function$ select '{}'::text $function$
      `,
    },
    {
      name: "security mode",
      sql: "alter function public.get_fund_password_status_tx(uuid) security invoker",
    },
    {
      name: "search path",
      sql: "alter function public.get_fund_password_status_tx(uuid) set search_path to public",
    },
    {
      name: "missing service role grant",
      sql: "revoke execute on function public.get_fund_password_status_tx(uuid) from service_role",
    },
    {
      name: "public grant",
      sql: "grant execute on function public.get_fund_password_status_tx(uuid) to public",
    },
    {
      name: "missing authenticated grant",
      sql: "revoke execute on function public.get_fund_password_status_tx(uuid) from authenticated",
    },
    {
      name: "unexpected grantee",
      sql: "grant execute on function public.get_fund_password_status_tx(uuid) to fund_pin_unexpected_grantee",
    },
    {
      name: "grant option",
      sql: "grant execute on function public.get_fund_password_status_tx(uuid) to service_role with grant option",
    },
    {
      name: "trigger",
      sql: `
        create function public.fund_pin_drift_trigger()
        returns trigger language plpgsql as $function$ begin return new; end $function$;
        create trigger fund_pin_drift_trigger
        before update on public.user_security_settings
        for each row execute function public.fund_pin_drift_trigger()
      `,
    },
    {
      name: "constraint",
      sql: `
        alter table public.user_security_settings
          drop constraint user_security_settings_fund_password_failed_attempts_check;
        alter table public.user_security_settings
          add constraint user_security_settings_fund_password_failed_attempts_check
          check (fund_password_failed_attempts between 0 and 5)
      `,
    },
    {
      name: "index",
      sql: `
        create index fund_pin_drift_index
        on public.user_security_settings (fund_password_updated_at)
      `,
    },
    {
      name: "RLS",
      sql: "alter table public.user_security_settings disable row level security",
    },
    {
      name: "table grant",
      sql: "grant select on public.user_security_settings to authenticated",
    },
    {
      name: "column grant",
      sql: "grant select (fund_password_hash) on public.user_security_settings to authenticated",
    },
  ];

  for (const fixture of driftFixtures) {
    await t.test(`fails before mutation on ${fixture.name} drift`, async () => {
      await createLivePreMigrationCatalog(client);
      await client.query(fixture.sql);
      const before = await catalogAndDataFingerprint(client);

      await assert.rejects(
        applyMigration(client),
        /unexpected|drift|catalog|Fund PIN|fund password/i,
      );

      assert.deepEqual(
        await catalogAndDataFingerprint(client),
        before,
        `failed ${fixture.name} preflight must preserve the original catalog and rows`,
      );
    });
  }

  await t.test("exact legitimate catalog applies without changing existing rows", async () => {
    await createLivePreMigrationCatalog(client);
    const beforeRows = (await client.query(`
      select to_jsonb(s) as row
      from public.user_security_settings s
      order by user_id
    `)).rows;
    const resetSourceBefore = (await client.query(`
      select p.prosrc
      from pg_proc p
      where p.oid =
        'public.reset_user_fund_password_tx(uuid,uuid,text)'::regprocedure
    `)).rows[0].prosrc;

    await applyMigration(client);

    assert.deepEqual(
      (await client.query(`
        select to_jsonb(s) as row
        from public.user_security_settings s
        order by user_id
      `)).rows,
      beforeRows,
    );
    assert.equal(
      (await client.query(`
        select p.prosrc
        from pg_proc p
        where p.oid =
          'public.reset_user_fund_password_tx(uuid,uuid,text)'::regprocedure
      `)).rows[0].prosrc,
      resetSourceBefore,
    );

    const securityRows = await functionSecurityRows(client);
    assert.equal(securityRows.length, 5);
    for (const row of securityRows) {
      assert.equal(row.owner, "postgres");
      assert.equal(row.language, "plpgsql");
      assert.equal(row.result, "jsonb");
      assert.equal(row.security_definer, true);
      assert.deepEqual(row.config, ["search_path=pg_catalog, public"]);
      assert.deepEqual(row.acl, [
        {
          grantee: "postgres",
          grantor: "postgres",
          privilege: "EXECUTE",
          grantable: false,
        },
        {
          grantee: "service_role",
          grantor: "postgres",
          privilege: "EXECUTE",
          grantable: false,
        },
      ]);
      for (const role of ["anon", "authenticated"]) {
        assert.equal(
          (await client.query(
            "select has_function_privilege($1, $2, 'EXECUTE') as allowed",
            [role, `public.${row.identity}`],
          )).rows[0].allowed,
          false,
        );
      }
      assert.equal(
        (await client.query(
          "select has_function_privilege('service_role', $1, 'EXECUTE') as allowed",
          [`public.${row.identity}`],
        )).rows[0].allowed,
        true,
      );
    }
  });

  await t.test("four-digit set, status, verify, change, lock, and reset behavior is preserved", async () => {
    await createLivePreMigrationCatalog(client);
    await applyMigration(client);
    await client.query(
      "delete from public.user_security_settings where user_id in ($1::uuid,$2::uuid)",
      [USER_ID, USER_2_ID],
    );

    assert.deepEqual(
      (await client.query(
        "select public.get_fund_password_status_tx($1::uuid) as result",
        [USER_ID],
      )).rows[0].result,
      {
        success: true,
        has_fund_password: false,
        locked_until: null,
        failed_attempts: 0,
      },
    );

    for (const invalidPin of [null, "", "123", "12345", "12a4", " 1234"]) {
      const result = (await client.query(
        "select public.set_fund_password_tx($1::uuid,$2::text) as result",
        [USER_ID, invalidPin],
      )).rows[0].result;
      assert.equal(result.success, false);
      assert.equal(result.code, "invalid_fund_password");
    }

    const set = (await client.query(
      "select public.set_fund_password_tx($1::uuid,'1234') as result",
      [USER_ID],
    )).rows[0].result;
    assert.equal(set.success, true);
    const stored = (await client.query(
      `select fund_password_hash,
              fund_password_hash = '1234' as plaintext
         from public.user_security_settings
        where user_id = $1::uuid`,
      [USER_ID],
    )).rows[0];
    assert.equal(stored.plaintext, false);
    assert.match(stored.fund_password_hash, /^\$2[aby]\$/);

    const duplicateSet = (await client.query(
      "select public.set_fund_password_tx($1::uuid,'4321') as result",
      [USER_ID],
    )).rows[0].result;
    assert.equal(duplicateSet.success, false);
    assert.equal(duplicateSet.code, "already_set");

    const wrong = (await client.query(
      "select public.verify_fund_password_tx($1::uuid,'9999') as result",
      [USER_ID],
    )).rows[0].result;
    assert.equal(wrong.success, false);
    assert.equal(wrong.code, "incorrect_fund_password");
    assert.equal(wrong.failed_attempts, 1);

    const correct = (await client.query(
      "select public.verify_fund_password_tx($1::uuid,'1234') as result",
      [USER_ID],
    )).rows[0].result;
    assert.equal(correct.success, true);
    assert.equal(
      (await client.query(
        `select fund_password_failed_attempts
           from public.user_security_settings
          where user_id = $1::uuid`,
        [USER_ID],
      )).rows[0].fund_password_failed_attempts,
      0,
    );

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = (await client.query(
        "select public.verify_fund_password_tx($1::uuid,'9999') as result",
        [USER_ID],
      )).rows[0].result;
      assert.equal(result.success, false);
      assert.equal(
        result.code,
        attempt === 5 ? "fund_password_locked" : "incorrect_fund_password",
      );
    }
    const locked = (await client.query(
      "select public.verify_fund_password_tx($1::uuid,'1234') as result",
      [USER_ID],
    )).rows[0].result;
    assert.equal(locked.code, "fund_password_locked");

    await client.query(`
      update public.user_security_settings
      set fund_password_locked_until = null,
          fund_password_failed_attempts = 0
      where user_id = $1::uuid
    `, [USER_ID]);

    for (const invalidNewPin of [null, "123", "12a4", "12345"]) {
      const result = (await client.query(
        `select public.change_fund_password_tx(
          $1::uuid, '1234', $2::text
        ) as result`,
        [USER_ID, invalidNewPin],
      )).rows[0].result;
      assert.equal(result.success, false);
      assert.equal(result.code, "invalid_new_fund_password");
    }
    const changed = (await client.query(
      "select public.change_fund_password_tx($1::uuid,'1234','4321') as result",
      [USER_ID],
    )).rows[0].result;
    assert.equal(changed.success, true);
    assert.equal(
      (await client.query(
        "select public.verify_fund_password_tx($1::uuid,'4321') as result",
        [USER_ID],
      )).rows[0].result.success,
      true,
    );

    const reset = (await client.query(
      `select public.reset_user_fund_password_tx(
        $1::uuid, $2::uuid, 'Owner requested reset'
      ) as result`,
      [ADMIN_ID, USER_ID],
    )).rows[0].result;
    assert.equal(reset.success, true);
    assert.equal(reset.code, "fund_password_reset");
    assert.equal(reset.old_had_fund_password, true);
    assert.equal(
      (await client.query(
        "select count(*)::integer as count from public.user_security_settings where user_id=$1",
        [USER_ID],
      )).rows[0].count,
      0,
    );
    assert.equal(
      (await client.query(
        `select count(*)::integer as count
           from public.admin_security_reset_audit
          where target_user_id=$1::uuid and action='fund_password_reset'`,
        [USER_ID],
      )).rows[0].count,
      1,
    );
  });
});

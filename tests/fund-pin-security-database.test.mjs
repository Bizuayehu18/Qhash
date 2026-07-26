import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
const FUND_PIN_RI_TRIGGERS = [
  {
    side: "parent",
    action: "DELETE",
    functionName: "RI_FKey_cascade_del",
  },
  {
    side: "parent",
    action: "UPDATE",
    functionName: "RI_FKey_noaction_upd",
  },
  {
    side: "child",
    action: "INSERT",
    functionName: "RI_FKey_check_ins",
  },
  {
    side: "child",
    action: "UPDATE",
    functionName: "RI_FKey_check_upd",
  },
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

function setFundPinRiTriggerStateSql(
  { side, functionName },
  { command },
) {
  return `
    do $set_fund_pin_ri_trigger_state$
    declare
      v_relation_schema text;
      v_relation_name text;
      v_trigger_name text;
    begin
      select
        event_schema.nspname,
        event_relation.relname,
        trigger_row.tgname
      into strict
        v_relation_schema,
        v_relation_name,
        v_trigger_name
      from pg_constraint constraint_row
      join pg_trigger trigger_row
        on trigger_row.tgconstraint = constraint_row.oid
      join pg_class event_relation
        on event_relation.oid = trigger_row.tgrelid
      join pg_namespace event_schema
        on event_schema.oid = event_relation.relnamespace
      join pg_proc function_row
        on function_row.oid = trigger_row.tgfoid
      join pg_namespace function_schema
        on function_schema.oid = function_row.pronamespace
      where constraint_row.conrelid =
          'public.user_security_settings'::regclass
        and constraint_row.conname =
          'user_security_settings_user_id_fkey'
        and case
          when trigger_row.tgrelid = constraint_row.conrelid
            then 'child'
          when trigger_row.tgrelid = constraint_row.confrelid
            then 'parent'
          else 'other'
        end = '${side}'
        and function_schema.nspname = 'pg_catalog'
        and function_row.proname = '${functionName}';

      execute format(
        'alter table %I.%I ${command} trigger %I',
        v_relation_schema,
        v_relation_name,
        v_trigger_name
      );
    end
    $set_fund_pin_ri_trigger_state$;
  `;
}

const FUND_PIN_TRIGGER_STATES = [
  { label: "disabled", command: "disable" },
  { label: "replica", command: "enable replica" },
  { label: "always", command: "enable always" },
];
const PREFLIGHT_ERRORS = {
  tableIdentity:
    "unexpected Fund PIN settings table identity, owner, or RLS state",
  columns: "unexpected Fund PIN settings column catalog",
  constraints: "unexpected Fund PIN settings constraint catalog",
  referencedKey:
    "unexpected Fund PIN settings referenced key and index catalog",
  indexes: "unexpected Fund PIN settings index catalog",
  triggers: "unexpected Fund PIN settings trigger catalog",
  tableAcl: "unexpected Fund PIN settings table ACL catalog",
  functionIdentity: "unexpected Fund PIN function identity catalog",
  functions: "unexpected Fund PIN function catalog",
};

async function installMigrationMutationSentinel(client) {
  await client.query(`
    create function public.fund_pin_migration_mutation_sentinel()
    returns event_trigger
    language plpgsql
    as $sentinel$
    begin
      raise exception 'mutation_reached';
    end
    $sentinel$;

    create event trigger fund_pin_migration_mutation_sentinel
    on ddl_command_start
    when tag in (
      'CREATE FUNCTION',
      'ALTER FUNCTION',
      'DROP FUNCTION',
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'CREATE INDEX',
      'ALTER INDEX',
      'DROP INDEX',
      'CREATE TRIGGER',
      'DROP TRIGGER',
      'GRANT',
      'REVOKE',
      'COMMENT'
    )
    execute function public.fund_pin_migration_mutation_sentinel();
  `);
}

async function removeMigrationMutationSentinel(client) {
  await client.query(`
    drop event trigger if exists fund_pin_migration_mutation_sentinel;
    drop function if exists public.fund_pin_migration_mutation_sentinel();
  `);
}

function rebindFundPinFkToAlternateIndexSql({ includeColumn = false } = {}) {
  const includedColumn = includeColumn
    ? `
      alter table auth.users
        add column fund_pin_drift_marker text not null default 'marker';
      create unique index fund_pin_users_id_alt_unique
        on auth.users (id) include (fund_pin_drift_marker);
    `
    : `
      create unique index fund_pin_users_id_alt_unique
        on auth.users (id);
    `;

  return `
    ${includedColumn}
    alter table public.user_security_settings
      drop constraint user_security_settings_user_id_fkey;
    alter table auth.users
      drop constraint users_pkey cascade;
    alter table public.user_security_settings
      add constraint user_security_settings_user_id_fkey
      foreign key (user_id)
      references auth.users(id)
      on delete cascade;
    alter table auth.users
      add constraint users_pkey primary key (id);
    alter table public.profiles
      add constraint profiles_id_fkey
      foreign key (id)
      references auth.users(id)
      on delete cascade;
  `;
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
  const fingerprint = (await client.query(`
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
      'internal_fk_triggers', (
        select coalesce(jsonb_agg(
          jsonb_build_array(
            constraint_schema.nspname,
            constraint_row.conname,
            child_schema.nspname,
            child_relation.relname,
            parent_schema.nspname,
            parent_relation.relname,
            event_schema.nspname,
            event_relation.relname,
            opposite_schema.nspname,
            opposite_relation.relname,
            trigger_row.tgname,
            trigger_row.tgtype,
            trigger_row.tgisinternal,
            trigger_row.tgenabled,
            trigger_row.tgdeferrable,
            trigger_row.tginitdeferred,
            function_schema.nspname,
            function_row.proname,
            pg_get_function_identity_arguments(function_row.oid),
            pg_get_function_result(function_row.oid),
            function_language.lanname,
            trigger_row.tgconstrindid = constraint_row.conindid
          )
          order by
            event_schema.nspname collate "C",
            event_relation.relname collate "C",
            function_row.proname collate "C",
            trigger_row.tgname collate "C"
        ), '[]'::jsonb)
        from pg_constraint constraint_row
        join pg_namespace constraint_schema
          on constraint_schema.oid = constraint_row.connamespace
        join pg_class child_relation
          on child_relation.oid = constraint_row.conrelid
        join pg_namespace child_schema
          on child_schema.oid = child_relation.relnamespace
        join pg_class parent_relation
          on parent_relation.oid = constraint_row.confrelid
        join pg_namespace parent_schema
          on parent_schema.oid = parent_relation.relnamespace
        join pg_trigger trigger_row
          on trigger_row.tgconstraint = constraint_row.oid
        join pg_class event_relation
          on event_relation.oid = trigger_row.tgrelid
        join pg_namespace event_schema
          on event_schema.oid = event_relation.relnamespace
        left join pg_class opposite_relation
          on opposite_relation.oid = trigger_row.tgconstrrelid
        left join pg_namespace opposite_schema
          on opposite_schema.oid = opposite_relation.relnamespace
        join pg_proc function_row
          on function_row.oid = trigger_row.tgfoid
        join pg_namespace function_schema
          on function_schema.oid = function_row.pronamespace
        join pg_language function_language
          on function_language.oid = function_row.prolang
        where constraint_row.contype = 'f'
          and (
            constraint_row.conrelid =
              'public.user_security_settings'::regclass
            or constraint_row.confrelid =
              'public.user_security_settings'::regclass
          )
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

  return {
    rowCount: fingerprint.rows.length,
    resetAuditCount: fingerprint.reset_audit.length,
    digest: createHash("sha256")
      .update(JSON.stringify(fingerprint))
      .digest("hex"),
  };
}

async function fundPinRowFingerprint(client) {
  return (await client.query(`
    select
      count(*)::integer as row_count,
      md5(coalesce(
        jsonb_agg(to_jsonb(settings_row) order by settings_row.user_id),
        '[]'::jsonb
      )::text) as row_digest
    from public.user_security_settings settings_row
  `)).rows[0];
}

async function fundPinReferencedKeySemantics(client) {
  return (await client.query(`
    select
      child_schema.nspname as child_schema,
      child_relation.relname as child_relation,
      array(
        select child_attribute.attname::text
        from unnest(constraint_row.conkey)
          with ordinality as child_key(attnum, position)
        join pg_attribute child_attribute
          on child_attribute.attrelid = constraint_row.conrelid
         and child_attribute.attnum = child_key.attnum
         and not child_attribute.attisdropped
        order by child_key.position
      ) as child_key_columns,
      parent_schema.nspname as parent_schema,
      parent_relation.relname as parent_relation,
      array(
        select parent_attribute.attname::text
        from unnest(constraint_row.confkey)
          with ordinality as parent_key(attnum, position)
        join pg_attribute parent_attribute
          on parent_attribute.attrelid = constraint_row.confrelid
         and parent_attribute.attnum = parent_key.attnum
         and not parent_attribute.attisdropped
        order by parent_key.position
      ) as parent_key_columns,
      constraint_row.conindid <> 0 as referenced_index_nonzero,
      referenced_index.indrelid = constraint_row.confrelid
        as index_relation_matches_parent,
      referenced_index_schema.nspname as index_schema,
      referenced_index_method.amname as index_method,
      referenced_index.indisprimary as index_primary,
      referenced_index.indisunique as index_unique,
      referenced_index.indimmediate as index_immediate,
      referenced_index.indisvalid as index_valid,
      referenced_index.indisready as index_ready,
      referenced_index.indislive as index_live,
      referenced_index.indisexclusion as index_exclusion,
      referenced_index.indnkeyatts::integer as index_key_count,
      referenced_index.indnatts::integer as index_attribute_count,
      referenced_index.indexprs is null as index_has_no_expressions,
      referenced_index.indpred is null as index_is_not_partial,
      array(
        select index_attribute.attname::text
        from unnest(referenced_index.indkey::smallint[])
          with ordinality as index_key(attnum, position)
        join pg_attribute index_attribute
          on index_attribute.attrelid = referenced_index.indrelid
         and index_attribute.attnum = index_key.attnum
         and not index_attribute.attisdropped
        where index_key.position <= referenced_index.indnkeyatts
        order by index_key.position
      ) as index_key_columns,
      primary_constraint.convalidated as primary_validated,
      primary_constraint.condeferrable as primary_deferrable,
      primary_constraint.condeferred as primary_initially_deferred,
      primary_constraint.conindid = constraint_row.conindid
        as primary_index_matches_fk,
      array(
        select primary_attribute.attname::text
        from unnest(primary_constraint.conkey)
          with ordinality as primary_key(attnum, position)
        join pg_attribute primary_attribute
          on primary_attribute.attrelid = primary_constraint.conrelid
         and primary_attribute.attnum = primary_key.attnum
         and not primary_attribute.attisdropped
        order by primary_key.position
      ) as primary_key_columns,
      (
        select count(*)::integer
        from pg_trigger trigger_row
        where trigger_row.tgconstraint = constraint_row.oid
          and trigger_row.tgconstrindid = constraint_row.conindid
          and trigger_row.tgconstrindid <> 0
      ) as matching_trigger_indexes
    from pg_constraint constraint_row
    join pg_class child_relation
      on child_relation.oid = constraint_row.conrelid
    join pg_namespace child_schema
      on child_schema.oid = child_relation.relnamespace
    join pg_class parent_relation
      on parent_relation.oid = constraint_row.confrelid
    join pg_namespace parent_schema
      on parent_schema.oid = parent_relation.relnamespace
    join pg_index referenced_index
      on referenced_index.indexrelid = constraint_row.conindid
    join pg_class referenced_index_relation
      on referenced_index_relation.oid = referenced_index.indexrelid
    join pg_namespace referenced_index_schema
      on referenced_index_schema.oid =
        referenced_index_relation.relnamespace
    join pg_am referenced_index_method
      on referenced_index_method.oid = referenced_index_relation.relam
    left join pg_constraint primary_constraint
      on primary_constraint.contype = 'p'
     and primary_constraint.conrelid = constraint_row.confrelid
     and primary_constraint.conindid = constraint_row.conindid
    where constraint_row.conrelid =
        'public.user_security_settings'::regclass
      and constraint_row.conname =
        'user_security_settings_user_id_fkey'
      and constraint_row.contype = 'f'
  `)).rows[0];
}

function assertExactFundPinReferencedKeySemantics(row) {
  assert.deepEqual(row, {
    child_schema: "public",
    child_relation: "user_security_settings",
    child_key_columns: ["user_id"],
    parent_schema: "auth",
    parent_relation: "users",
    parent_key_columns: ["id"],
    referenced_index_nonzero: true,
    index_relation_matches_parent: true,
    index_schema: "auth",
    index_method: "btree",
    index_primary: true,
    index_unique: true,
    index_immediate: true,
    index_valid: true,
    index_ready: true,
    index_live: true,
    index_exclusion: false,
    index_key_count: 1,
    index_attribute_count: 1,
    index_has_no_expressions: true,
    index_is_not_partial: true,
    index_key_columns: ["id"],
    primary_validated: true,
    primary_deferrable: false,
    primary_initially_deferred: false,
    primary_index_matches_fk: true,
    primary_key_columns: ["id"],
    matching_trigger_indexes: 4,
  });
}

async function fundPinRiTriggerSemantics(client) {
  return (await client.query(`
    select
      constraint_schema.nspname as constraint_schema,
      constraint_row.conname as constraint_name,
      constraint_row.convalidated as constraint_validated,
      constraint_row.confmatchtype::text as match_type,
      constraint_row.confupdtype::text as update_action,
      constraint_row.confdeltype::text as delete_action,
      constraint_row.condeferrable as constraint_deferrable,
      constraint_row.condeferred as constraint_initially_deferred,
      child_schema.nspname as child_schema,
      child_relation.relname as child_relation,
      parent_schema.nspname as parent_schema,
      parent_relation.relname as parent_relation,
      case
        when trigger_row.tgrelid = constraint_row.conrelid
          then 'child'
        when trigger_row.tgrelid = constraint_row.confrelid
          then 'parent'
        else 'other'
      end as trigger_side,
      event_schema.nspname as event_schema,
      event_relation.relname as event_relation,
      opposite_schema.nspname as opposite_schema,
      opposite_relation.relname as opposite_relation,
      trigger_row.tgtype::integer as trigger_type,
      case
        when (trigger_row.tgtype::integer & 64) <> 0 then 'INSTEAD OF'
        when (trigger_row.tgtype::integer & 2) <> 0 then 'BEFORE'
        else 'AFTER'
      end as trigger_timing,
      case
        when (trigger_row.tgtype::integer & 4) <> 0 then 'INSERT'
        when (trigger_row.tgtype::integer & 8) <> 0 then 'DELETE'
        when (trigger_row.tgtype::integer & 16) <> 0 then 'UPDATE'
        when (trigger_row.tgtype::integer & 32) <> 0 then 'TRUNCATE'
        else 'UNKNOWN'
      end as trigger_action,
      case
        when (trigger_row.tgtype::integer & 1) <> 0 then 'ROW'
        else 'STATEMENT'
      end as trigger_level,
      function_schema.nspname as function_schema,
      function_row.proname as function_name,
      pg_get_function_identity_arguments(function_row.oid)
        as function_identity_arguments,
      pg_get_function_result(function_row.oid) as function_result,
      function_language.lanname as function_language,
      trigger_row.tgisinternal as is_internal,
      trigger_row.tgenabled::text as enabled_state,
      trigger_row.tgdeferrable as trigger_deferrable,
      trigger_row.tginitdeferred as trigger_initially_deferred,
      trigger_row.tgconstrindid = constraint_row.conindid
        as referenced_index_matches
    from pg_constraint constraint_row
    join pg_namespace constraint_schema
      on constraint_schema.oid = constraint_row.connamespace
    join pg_class child_relation
      on child_relation.oid = constraint_row.conrelid
    join pg_namespace child_schema
      on child_schema.oid = child_relation.relnamespace
    join pg_class parent_relation
      on parent_relation.oid = constraint_row.confrelid
    join pg_namespace parent_schema
      on parent_schema.oid = parent_relation.relnamespace
    join pg_trigger trigger_row
      on trigger_row.tgconstraint = constraint_row.oid
    join pg_class event_relation
      on event_relation.oid = trigger_row.tgrelid
    join pg_namespace event_schema
      on event_schema.oid = event_relation.relnamespace
    left join pg_class opposite_relation
      on opposite_relation.oid = trigger_row.tgconstrrelid
    left join pg_namespace opposite_schema
      on opposite_schema.oid = opposite_relation.relnamespace
    join pg_proc function_row
      on function_row.oid = trigger_row.tgfoid
    join pg_namespace function_schema
      on function_schema.oid = function_row.pronamespace
    join pg_language function_language
      on function_language.oid = function_row.prolang
    where constraint_row.contype = 'f'
      and (
        constraint_row.conrelid =
          'public.user_security_settings'::regclass
        or constraint_row.confrelid =
          'public.user_security_settings'::regclass
      )
    order by 13, 20, 23
  `)).rows;
}

function assertExactFundPinRiTriggerSemantics(rows) {
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.equal(row.constraint_schema, "public");
    assert.equal(
      row.constraint_name,
      "user_security_settings_user_id_fkey",
    );
    assert.equal(row.constraint_validated, true);
    assert.equal(row.match_type, "s");
    assert.equal(row.update_action, "a");
    assert.equal(row.delete_action, "c");
    assert.equal(row.constraint_deferrable, false);
    assert.equal(row.constraint_initially_deferred, false);
    assert.equal(row.child_schema, "public");
    assert.equal(row.child_relation, "user_security_settings");
    assert.equal(row.parent_schema, "auth");
    assert.equal(row.parent_relation, "users");
    assert.equal(row.trigger_timing, "AFTER");
    assert.equal(row.trigger_level, "ROW");
    assert.equal(row.function_schema, "pg_catalog");
    assert.equal(row.function_identity_arguments, "");
    assert.equal(row.function_result, "trigger");
    assert.equal(row.function_language, "internal");
    assert.equal(row.is_internal, true);
    assert.equal(row.enabled_state, "O");
    assert.equal(row.trigger_deferrable, false);
    assert.equal(row.trigger_initially_deferred, false);
    assert.equal(row.referenced_index_matches, true);
  }

  assert.deepEqual(
    rows.map((row) => ({
      side: row.trigger_side,
      action: row.trigger_action,
      type: row.trigger_type,
      event: `${row.event_schema}.${row.event_relation}`,
      opposite: `${row.opposite_schema}.${row.opposite_relation}`,
      functionName: row.function_name,
    })),
    [
      {
        side: "child",
        action: "INSERT",
        type: 5,
        event: "public.user_security_settings",
        opposite: "auth.users",
        functionName: "RI_FKey_check_ins",
      },
      {
        side: "child",
        action: "UPDATE",
        type: 17,
        event: "public.user_security_settings",
        opposite: "auth.users",
        functionName: "RI_FKey_check_upd",
      },
      {
        side: "parent",
        action: "DELETE",
        type: 9,
        event: "auth.users",
        opposite: "public.user_security_settings",
        functionName: "RI_FKey_cascade_del",
      },
      {
        side: "parent",
        action: "UPDATE",
        type: 17,
        event: "auth.users",
        opposite: "public.user_security_settings",
        functionName: "RI_FKey_noaction_upd",
      },
    ],
  );
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
    "tgconstraint",
    "tgconstrrelid",
    "tgconstrindid",
    "tgtype",
    "tgenabled",
    "tgisinternal",
    "tgdeferrable",
    "tginitdeferred",
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
  for (const riFunction of FUND_PIN_RI_TRIGGERS.map(
    ({ functionName }) => functionName,
  )) {
    assert.equal(
      (migration.match(new RegExp(escapeRegExp(riFunction), "g")) ?? [])
        .length,
      2,
      `${riFunction} must be pinned once in preflight and once in postflight`,
    );
  }
  for (const referencedKeyToken of [
    "constraint_row.conkey",
    "constraint_row.confkey",
    "constraint_row.conindid <> 0",
    "referenced_index.indrelid = constraint_row.confrelid",
    "referenced_index.indisprimary is true",
    "referenced_index.indisunique is true",
    "referenced_index.indimmediate is true",
    "referenced_index.indisvalid is true",
    "referenced_index.indisready is true",
    "referenced_index.indislive is true",
    "referenced_index.indnkeyatts = 1",
    "referenced_index.indnatts = 1",
    "referenced_index.indexprs is null",
    "referenced_index.indpred is null",
    "primary_constraint.conindid = constraint_row.conindid",
    "trigger_row.tgconstrindid = 0",
  ]) {
    assert.equal(
      (migration.match(new RegExp(escapeRegExp(referencedKeyToken), "g")) ?? [])
        .length,
      2,
      `${referencedKeyToken} must be pinned in preflight and postflight`,
    );
  }
  assert.equal(
    (migration.match(/except\s+all/gi) ?? []).length,
    4,
    "both trigger gates must use symmetric multiset comparison",
  );
  assert.doesNotMatch(
    migration,
    /pg_get_triggerdef|trigger_row\.tgname|RI_ConstraintTrigger/i,
    "the migration trigger fingerprint must not depend on generated names",
  );
  assert.doesNotMatch(
    migration,
    /alter\s+table[\s\S]*?enable\s+trigger/i,
    "the migration must reject trigger drift rather than repairing it",
  );
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
    await Promise.allSettled([
      client.query("rollback"),
      removeMigrationMutationSentinel(client),
    ]);
    await client.end();
  });

  const driftFixtures = [
    {
      name: "function owner",
      sql: "alter function public.get_fund_password_status_tx(uuid) owner to fund_pin_drift_owner",
      expectedError: PREFLIGHT_ERRORS.functions,
    },
    {
      name: "function source",
      sql: `
        create or replace function public.get_fund_password_status_tx(p_user_id uuid)
        returns jsonb language plpgsql security definer
        set search_path to 'public', 'extensions'
        as $function$ begin return '{}'::jsonb; end; $function$
      `,
      expectedError: PREFLIGHT_ERRORS.functions,
    },
    {
      name: "signature",
      sql: `
        create function public.get_fund_password_status_tx(p_user_id text)
        returns jsonb language sql as $function$ select '{}'::jsonb $function$
      `,
      expectedError: PREFLIGHT_ERRORS.functionIdentity,
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
      expectedError: PREFLIGHT_ERRORS.functions,
    },
    {
      name: "security mode",
      sql: "alter function public.get_fund_password_status_tx(uuid) security invoker",
      expectedError: PREFLIGHT_ERRORS.functions,
    },
    {
      name: "search path",
      sql: "alter function public.get_fund_password_status_tx(uuid) set search_path to public",
      expectedError: PREFLIGHT_ERRORS.functions,
    },
    {
      name: "missing service role grant",
      sql: "revoke execute on function public.get_fund_password_status_tx(uuid) from service_role",
      expectedError: PREFLIGHT_ERRORS.functions,
    },
    {
      name: "public grant",
      sql: "grant execute on function public.get_fund_password_status_tx(uuid) to public",
      expectedError: PREFLIGHT_ERRORS.functions,
    },
    {
      name: "missing authenticated grant",
      sql: "revoke execute on function public.get_fund_password_status_tx(uuid) from authenticated",
      expectedError: PREFLIGHT_ERRORS.functions,
    },
    {
      name: "unexpected grantee",
      sql: "grant execute on function public.get_fund_password_status_tx(uuid) to fund_pin_unexpected_grantee",
      expectedError: PREFLIGHT_ERRORS.functions,
    },
    {
      name: "grant option",
      sql: "grant execute on function public.get_fund_password_status_tx(uuid) to service_role with grant option",
      expectedError: PREFLIGHT_ERRORS.functions,
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
      expectedError: PREFLIGHT_ERRORS.triggers,
    },
    ...FUND_PIN_TRIGGER_STATES.flatMap((state) =>
      FUND_PIN_RI_TRIGGERS.map((trigger) => ({
        name:
          `${trigger.side} ${trigger.action} internal FK trigger ${state.label}`,
        sql: setFundPinRiTriggerStateSql(trigger, state),
        expectedError: PREFLIGHT_ERRORS.triggers,
      }))
    ),
    ...FUND_PIN_TRIGGER_STATES.map((state) => ({
      name: `all four internal FK triggers ${state.label}`,
      sql: FUND_PIN_RI_TRIGGERS
        .map((trigger) => setFundPinRiTriggerStateSql(trigger, state))
        .join("\n"),
      expectedError: PREFLIGHT_ERRORS.triggers,
    })),
    {
      name: "missing internal FK trigger relationship",
      sql: `
        alter table public.user_security_settings
          drop constraint user_security_settings_user_id_fkey
      `,
      expectedError: PREFLIGHT_ERRORS.constraints,
    },
    {
      name: "duplicate internal FK trigger relationship",
      sql: `
        alter table public.user_security_settings
          add constraint user_security_settings_user_id_fkey_duplicate
          foreign key (user_id) references auth.users(id) on delete cascade
      `,
      expectedError: PREFLIGHT_ERRORS.constraints,
    },
    {
      name: "internal FK parent relationship",
      sql: `
        create table auth.fund_pin_drift_users (
          id uuid primary key
        );
        insert into auth.fund_pin_drift_users (id)
          select id from auth.users;
        alter table public.user_security_settings
          drop constraint user_security_settings_user_id_fkey;
        alter table public.user_security_settings
          add constraint user_security_settings_user_id_fkey
          foreign key (user_id)
          references auth.fund_pin_drift_users(id)
          on delete cascade
      `,
      expectedError: PREFLIGHT_ERRORS.constraints,
    },
    {
      name: "internal FK alternate child key columns",
      sql: `
        alter table auth.users
          add column fund_pin_drift_counter integer not null default 0;
        alter table auth.users
          add constraint users_id_counter_key
          unique (id, fund_pin_drift_counter);
        alter table public.user_security_settings
          drop constraint user_security_settings_user_id_fkey;
        alter table public.user_security_settings
          add constraint user_security_settings_user_id_fkey
          foreign key (user_id, fund_password_failed_attempts)
          references auth.users(id, fund_pin_drift_counter)
          on delete cascade
      `,
      expectedError: PREFLIGHT_ERRORS.constraints,
    },
    {
      name: "internal FK alternate parent key column",
      sql: `
        alter table auth.users
          add column fund_pin_drift_id uuid;
        update auth.users set fund_pin_drift_id = id;
        alter table auth.users
          alter column fund_pin_drift_id set not null;
        alter table auth.users
          add constraint users_fund_pin_drift_id_key
          unique (fund_pin_drift_id);
        alter table public.user_security_settings
          drop constraint user_security_settings_user_id_fkey;
        alter table public.user_security_settings
          add constraint user_security_settings_user_id_fkey
          foreign key (user_id)
          references auth.users(fund_pin_drift_id)
          on delete cascade
      `,
      expectedError: PREFLIGHT_ERRORS.constraints,
    },
    {
      name: "identical FK rebound to alternate unique non-primary index",
      sql: rebindFundPinFkToAlternateIndexSql(),
      expectedError: PREFLIGHT_ERRORS.referencedKey,
      verify: async (fixtureClient) => {
        const semantics =
          await fundPinReferencedKeySemantics(fixtureClient);
        assert.equal(semantics.index_primary, false);
        assert.equal(semantics.index_unique, true);
        assert.equal(semantics.index_key_count, 1);
        assert.deepEqual(semantics.index_key_columns, ["id"]);
        assert.equal(semantics.matching_trigger_indexes, 4);
      },
    },
    {
      name: "referenced index with an included column",
      sql: rebindFundPinFkToAlternateIndexSql({ includeColumn: true }),
      expectedError: PREFLIGHT_ERRORS.referencedKey,
      verify: async (fixtureClient) => {
        const semantics =
          await fundPinReferencedKeySemantics(fixtureClient);
        assert.equal(semantics.index_primary, false);
        assert.equal(semantics.index_unique, true);
        assert.equal(semantics.index_key_count, 1);
        assert.equal(semantics.index_attribute_count, 2);
        assert.equal(semantics.matching_trigger_indexes, 4);
      },
    },
    {
      name: "NOT VALID internal FK",
      sql: `
        alter table public.user_security_settings
          drop constraint user_security_settings_user_id_fkey;
        alter table public.user_security_settings
          add constraint user_security_settings_user_id_fkey
          foreign key (user_id)
          references auth.users(id)
          on delete cascade
          not valid
      `,
      expectedError: PREFLIGHT_ERRORS.constraints,
    },
    {
      name: "DEFERRABLE internal FK",
      sql: `
        alter table public.user_security_settings
          drop constraint user_security_settings_user_id_fkey;
        alter table public.user_security_settings
          add constraint user_security_settings_user_id_fkey
          foreign key (user_id)
          references auth.users(id)
          on delete cascade
          deferrable initially immediate
      `,
      expectedError: PREFLIGHT_ERRORS.constraints,
    },
    {
      name: "DEFERRABLE INITIALLY DEFERRED internal FK",
      sql: `
        alter table public.user_security_settings
          drop constraint user_security_settings_user_id_fkey;
        alter table public.user_security_settings
          add constraint user_security_settings_user_id_fkey
          foreign key (user_id)
          references auth.users(id)
          on delete cascade
          deferrable initially deferred
      `,
      expectedError: PREFLIGHT_ERRORS.constraints,
    },
    {
      name: "internal FK RI action function",
      sql: `
        alter table public.user_security_settings
          drop constraint user_security_settings_user_id_fkey;
        alter table public.user_security_settings
          add constraint user_security_settings_user_id_fkey
          foreign key (user_id)
          references auth.users(id)
          on delete restrict
      `,
      expectedError: PREFLIGHT_ERRORS.constraints,
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
      expectedError: PREFLIGHT_ERRORS.constraints,
    },
    {
      name: "index",
      sql: `
        create index fund_pin_drift_index
        on public.user_security_settings (fund_password_updated_at)
      `,
      expectedError: PREFLIGHT_ERRORS.indexes,
    },
    {
      name: "RLS",
      sql: "alter table public.user_security_settings disable row level security",
      expectedError: PREFLIGHT_ERRORS.tableIdentity,
    },
    {
      name: "table grant",
      sql: "grant select on public.user_security_settings to authenticated",
      expectedError: PREFLIGHT_ERRORS.tableAcl,
    },
    {
      name: "column grant",
      sql: "grant select (fund_password_hash) on public.user_security_settings to authenticated",
      expectedError: PREFLIGHT_ERRORS.columns,
    },
  ];

  await t.test("mutation sentinel detects attempted migration DDL", async () => {
    await createLivePreMigrationCatalog(client);
    await installMigrationMutationSentinel(client);
    try {
      await assert.rejects(
        client.query(`
          create function public.fund_pin_sentinel_probe()
          returns void
          language plpgsql
          as $probe$ begin null; end $probe$
        `),
        (error) => {
          assert.equal(error.code, "P0001");
          assert.equal(error.message, "mutation_reached");
          return true;
        },
      );
      assert.equal(
        (await client.query(
          "select to_regprocedure('public.fund_pin_sentinel_probe()') is null as absent",
        )).rows[0].absent,
        true,
      );
    } finally {
      await removeMigrationMutationSentinel(client);
    }
  });

  for (const fixture of driftFixtures) {
    await t.test(`fails before mutation on ${fixture.name} drift`, async () => {
      await createLivePreMigrationCatalog(client);
      await client.query(fixture.sql);
      await fixture.verify?.(client);
      const before = await catalogAndDataFingerprint(client);

      let migrationError;
      await installMigrationMutationSentinel(client);
      try {
        await applyMigration(client);
      } catch (error) {
        migrationError = error;
      } finally {
        await removeMigrationMutationSentinel(client);
      }

      assert.ok(migrationError, `${fixture.name} drift must be rejected`);
      assert.equal(migrationError.code, "P0001");
      assert.notEqual(
        migrationError.message,
        "mutation_reached",
        `${fixture.name} drift reached the first migration mutation`,
      );
      assert.equal(migrationError.message, fixture.expectedError);

      assert.deepEqual(
        await catalogAndDataFingerprint(client),
        before,
        `failed ${fixture.name} preflight must preserve the original catalog and rows`,
      );
    });
  }

  await t.test("exact legitimate catalog applies without changing existing rows", async () => {
    await createLivePreMigrationCatalog(client);
    assertExactFundPinRiTriggerSemantics(
      await fundPinRiTriggerSemantics(client),
    );
    assertExactFundPinReferencedKeySemantics(
      await fundPinReferencedKeySemantics(client),
    );
    const beforeRows = await fundPinRowFingerprint(client);
    const resetSourceBefore = (await client.query(`
      select p.prosrc
      from pg_proc p
      where p.oid =
        'public.reset_user_fund_password_tx(uuid,uuid,text)'::regprocedure
    `)).rows[0].prosrc;

    await applyMigration(client);
    assertExactFundPinRiTriggerSemantics(
      await fundPinRiTriggerSemantics(client),
    );
    assertExactFundPinReferencedKeySemantics(
      await fundPinReferencedKeySemantics(client),
    );

    assert.deepEqual(
      await fundPinRowFingerprint(client),
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
      `select fund_password_hash = '1234' as plaintext,
              fund_password_hash ~ '^\\$2[aby]\\$' as bcrypt_format
         from public.user_security_settings
        where user_id = $1::uuid`,
      [USER_ID],
    )).rows[0];
    assert.equal(stored.plaintext, false);
    assert.equal(stored.bcrypt_format, true);

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

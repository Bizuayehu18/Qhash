import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const migrationPath =
  "supabase/migrations/20260727210000_harden_legacy_deposit_approval_rpc/migration.sql";
const migration = await readFile(new URL(migrationPath, root), "utf8");

const FUNCTION_IDENTITY =
  "approve_deposit_tx(uuid,uuid,text,text,numeric)";
const FUNCTION_REGPROCEDURE = `public.${FUNCTION_IDENTITY}`;
const EXPECTED_SOURCE_MD5 = "34836ec867a8cd81a8e14d3cd55646ce";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APPROVE_DEPOSIT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const REJECT_DEPOSIT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

// Exact live prosrc captured read-only before this hardening migration.
// The migration deliberately preserves this financial implementation byte for
// byte after normalizing CRLF to LF; only proconfig and ACLs may change.
const LIVE_APPROVE_DEPOSIT_SOURCE = String.raw`
DECLARE
  v_deposit        RECORD;
  v_admin          RECORD;
  v_final_amount   NUMERIC;
  v_balance_before NUMERIC;
  v_balance_after  NUMERIC;
  v_new_status     deposit_status;
  v_tx_id          UUID;
  v_step           TEXT := 'init';
BEGIN
  v_step := 'admin_auth';

  SELECT id, is_admin, is_frozen
    INTO v_admin
    FROM profiles
   WHERE id = p_admin_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_not_found',
      'message', 'Admin profile not found.', 'step', v_step);
  END IF;

  IF NOT v_admin.is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_admin',
      'message', 'User is not an admin.', 'step', v_step);
  END IF;

  IF v_admin.is_frozen THEN
    RETURN jsonb_build_object('success', false, 'error', 'admin_frozen',
      'message', 'Admin account is frozen.', 'step', v_step);
  END IF;

  v_step := 'validate_action';

  IF p_action NOT IN ('approve', 'reject') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_action',
      'message', 'Action must be approve or reject.', 'step', v_step);
  END IF;

  v_new_status := CASE
    WHEN p_action = 'approve' THEN 'approved'::deposit_status
    ELSE 'rejected'::deposit_status
  END;

  v_step := 'deposit_fetch';

  SELECT *
    INTO v_deposit
    FROM deposits
   WHERE id = p_deposit_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'deposit_not_found',
      'message', 'Deposit record not found.', 'step', v_step);
  END IF;

  v_step := 'pending_check';

  IF v_deposit.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_reviewed',
      'message', format('Deposit already %s.', v_deposit.status), 'step', v_step);
  END IF;

  v_step := 'amount_resolve';

  IF p_action = 'approve' THEN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'invalid_amount',
        'message', 'Verified receipt amount (p_amount) is required and must be positive for approval.',
        'step', v_step);
    END IF;

    v_final_amount := p_amount;
  END IF;

  v_step := 'deposit_status_update';

  UPDATE deposits
     SET status      = v_new_status,
         amount      = CASE WHEN p_action = 'approve' THEN v_final_amount ELSE amount END,
         admin_note  = p_admin_note,
         reviewed_at = now(),
         updated_at  = now()
   WHERE id = p_deposit_id;

  IF p_action = 'approve' THEN
    v_step := 'wallet_lookup';

    SELECT balance
      INTO v_balance_before
      FROM wallets
     WHERE user_id = v_deposit.user_id
     FOR UPDATE;

    IF NOT FOUND THEN
      v_step := 'wallet_create';

      INSERT INTO wallets (user_id, balance)
      VALUES (v_deposit.user_id, v_final_amount);

      v_balance_before := 0;
      v_balance_after  := v_final_amount;
    ELSE
      v_step := 'wallet_update';

      v_balance_after := v_balance_before + v_final_amount;

      UPDATE wallets
         SET balance    = v_balance_after,
             updated_at = now()
       WHERE user_id = v_deposit.user_id;
    END IF;

    v_step := 'transaction_insert';

    INSERT INTO transactions (
      user_id,
      type,
      amount,
      status,
      balance_before,
      balance_after,
      description,
      reference_id
    )
    VALUES (
      v_deposit.user_id,
      'deposit',
      v_final_amount,
      'completed',
      v_balance_before,
      v_balance_after,
      'Deposit via ' || v_deposit.transaction_reference,
      v_deposit.id
    )
    RETURNING id INTO v_tx_id;

    v_step := 'done';

    RETURN jsonb_build_object(
      'success', true,
      'status', 'approved',
      'deposit_id', v_deposit.id,
      'user_id', v_deposit.user_id,
      'amount', v_final_amount,
      'balance_before', v_balance_before,
      'balance_after', v_balance_after,
      'transaction_id', v_tx_id
    );

  ELSE
    v_step := 'done';

    RETURN jsonb_build_object(
      'success', true,
      'status', 'rejected',
      'deposit_id', v_deposit.id,
      'user_id', v_deposit.user_id
    );
  END IF;

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', 'internal_error',
    'message', 'Internal error during deposit review.',
    'step', v_step,
    'pg_error', SQLERRM,
    'pg_code', SQLSTATE
  );
END;
`;

const OLD_ACL = [
  {
    grantee: "PUBLIC",
    grantor: "postgres",
    privilege: "EXECUTE",
    grantable: false,
  },
  {
    grantee: "anon",
    grantor: "postgres",
    privilege: "EXECUTE",
    grantable: false,
  },
  {
    grantee: "authenticated",
    grantor: "postgres",
    privilege: "EXECUTE",
    grantable: false,
  },
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
];

const HARDENED_ACL = [
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
];

const PREFLIGHT_ERRORS = {
  identity: "unexpected legacy deposit approval function identity",
  catalog: "unexpected legacy deposit approval function catalog",
  privileges: "unexpected legacy deposit approval function privileges",
  schema: "unexpected public schema create privilege",
  inheritance: "unexpected client role inheritance",
};

function md5(value) {
  return createHash("md5").update(value).digest("hex");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function disposablePostgresUrl(t) {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) {
    t.skip(
      "TEST_DATABASE_URL is required for the native deposit approval RPC security fixture",
    );
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
      "TEST_DATABASE_URL must target an explicitly disposable local qhash_test_* database",
    );
  }

  return raw;
}

async function applyMigration(client, sql = migration) {
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
        create role anon nologin;
      end if;
      if pg_catalog.to_regrole('authenticated') is null then
        create role authenticated nologin;
      end if;
      if pg_catalog.to_regrole('service_role') is null then
        create role service_role nologin;
      end if;
      if pg_catalog.to_regrole('deposit_rpc_drift_owner') is null then
        create role deposit_rpc_drift_owner nologin;
      end if;
      if pg_catalog.to_regrole('deposit_rpc_unexpected_grantee') is null then
        create role deposit_rpc_unexpected_grantee nologin;
      end if;
      if pg_catalog.to_regrole('deposit_rpc_public_probe') is null then
        create role deposit_rpc_public_probe nologin;
      end if;
      if pg_catalog.to_regrole('deposit_rpc_intermediary') is null then
        create role deposit_rpc_intermediary nologin;
      end if;
    end
    $roles$;
  `);
}

async function createLivePreMigrationCatalog(client) {
  await client.query("reset role");
  await ensureFixtureRoles(client);
  await client.query(
    "revoke service_role, postgres from anon, authenticated",
  );
  await client.query(
    "revoke deposit_rpc_intermediary from anon, authenticated",
  );
  await client.query(
    "revoke service_role, postgres from deposit_rpc_intermediary",
  );
  await client.query("set role postgres");
  await client.query("drop schema if exists public cascade");
  await client.query("create schema public authorization postgres");
  await client.query(`
    grant usage on schema public
      to anon, authenticated, service_role, deposit_rpc_public_probe;
    revoke create on schema public
      from public, anon, authenticated, service_role;

    create type public.deposit_status as enum (
      'pending',
      'approved',
      'rejected'
    );
    create type public.transaction_type as enum (
      'deposit',
      'withdrawal',
      'plan_purchase',
      'earning',
      'referral_bonus'
    );
    create type public.transaction_status as enum (
      'pending',
      'completed',
      'failed'
    );

    create table public.profiles (
      id uuid primary key,
      username text not null unique,
      phone text not null unique,
      is_admin boolean not null default false,
      is_frozen boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.deposits (
      id uuid primary key,
      user_id uuid not null references public.profiles(id),
      amount numeric not null,
      status public.deposit_status not null default 'pending',
      transaction_reference text not null,
      admin_note text,
      reviewed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.wallets (
      user_id uuid primary key references public.profiles(id),
      balance numeric not null default 0,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.transactions (
      id uuid primary key default pg_catalog.gen_random_uuid(),
      user_id uuid not null references public.profiles(id),
      type public.transaction_type not null,
      amount numeric not null,
      status public.transaction_status not null,
      balance_before numeric not null,
      balance_after numeric not null,
      description text,
      reference_id uuid,
      created_at timestamptz not null default now()
    );

    insert into public.profiles (
      id,
      username,
      phone,
      is_admin,
      is_frozen,
      created_at,
      updated_at
    )
    values
      (
        '${USER_ID}',
        'deposit-user',
        '+251900000001',
        false,
        false,
        '2026-07-27T00:00:00Z',
        '2026-07-27T00:00:00Z'
      ),
      (
        '${OTHER_USER_ID}',
        'ordinary-user',
        '+251900000002',
        false,
        false,
        '2026-07-27T00:00:00Z',
        '2026-07-27T00:00:00Z'
      ),
      (
        '${ADMIN_ID}',
        'deposit-admin',
        '+251900000003',
        true,
        false,
        '2026-07-27T00:00:00Z',
        '2026-07-27T00:00:00Z'
      );

    insert into public.wallets (
      user_id,
      balance,
      created_at,
      updated_at
    )
    values (
      '${USER_ID}',
      100,
      '2026-07-27T00:00:00Z',
      '2026-07-27T00:00:00Z'
    );

    insert into public.deposits (
      id,
      user_id,
      amount,
      status,
      transaction_reference,
      created_at,
      updated_at
    )
    values
      (
        '${APPROVE_DEPOSIT_ID}',
        '${USER_ID}',
        999,
        'pending',
        'CBE-APPROVE-FIXTURE',
        '2026-07-27T00:00:00Z',
        '2026-07-27T00:00:00Z'
      ),
      (
        '${REJECT_DEPOSIT_ID}',
        '${USER_ID}',
        77,
        'pending',
        'TELEBIRR-REJECT-FIXTURE',
        '2026-07-27T00:01:00Z',
        '2026-07-27T00:01:00Z'
      );
  `);

  await client.query(`
    create function public.approve_deposit_tx(
      p_deposit_id uuid,
      p_admin_id uuid,
      p_action text,
      p_admin_note text default null,
      p_amount numeric default null
    )
    returns jsonb
    language plpgsql
    security definer
    as $function$${LIVE_APPROVE_DEPOSIT_SOURCE}$function$;

    alter function public.approve_deposit_tx(
      uuid,
      uuid,
      text,
      text,
      numeric
    ) owner to postgres;

    revoke all on function public.approve_deposit_tx(
      uuid,
      uuid,
      text,
      text,
      numeric
    ) from public, anon, authenticated, service_role, postgres;

    grant execute on function public.approve_deposit_tx(
      uuid,
      uuid,
      text,
      text,
      numeric
    ) to public, anon, authenticated, postgres, service_role;
  `);
  await client.query("reset role");
}

async function functionCatalog(client) {
  const result = await client.query(`
    select
      procedure_row.oid::text as oid,
      pg_catalog.pg_get_userbyid(procedure_row.proowner) as owner,
      language_row.lanname as language,
      procedure_row.prokind as kind,
      procedure_row.pronargs as argument_count,
      procedure_row.pronargdefaults as default_count,
      procedure_row.proretset as returns_set,
      procedure_row.proleakproof as leakproof,
      procedure_row.procost as cost,
      procedure_row.prorows as rows,
      procedure_row.prosupport::oid::text as support,
      procedure_row.prosecdef as security_definer,
      procedure_row.provolatile as volatility,
      procedure_row.proisstrict as strict,
      procedure_row.proparallel as parallel,
      procedure_row.proconfig as config,
      pg_catalog.pg_get_function_identity_arguments(procedure_row.oid)
        as identity_arguments,
      pg_catalog.pg_get_function_arguments(procedure_row.oid)
        as arguments_with_defaults,
      pg_catalog.pg_get_function_result(procedure_row.oid) as result_type,
      procedure_row.prosrc as source,
      pg_catalog.md5(
        pg_catalog.replace(procedure_row.prosrc, E'\\r\\n', E'\\n')
      ) as normalized_source_md5,
      coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'grantee',
              case
                when acl_row.grantee = 0 then 'PUBLIC'
                else pg_catalog.pg_get_userbyid(acl_row.grantee)
              end,
              'grantor',
              pg_catalog.pg_get_userbyid(acl_row.grantor),
              'privilege',
              acl_row.privilege_type,
              'grantable',
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
              pg_catalog.convert_to(acl_row.privilege_type, 'UTF8'),
              acl_row.is_grantable
          )
          from pg_catalog.aclexplode(procedure_row.proacl) acl_row
        ),
        '[]'::jsonb
      ) as acl,
      pg_catalog.has_function_privilege(
        'anon',
        procedure_row.oid,
        'EXECUTE'
      ) as anon_can_execute,
      pg_catalog.has_function_privilege(
        'authenticated',
        procedure_row.oid,
        'EXECUTE'
      ) as authenticated_can_execute,
      pg_catalog.has_function_privilege(
        'service_role',
        procedure_row.oid,
        'EXECUTE'
      ) as service_role_can_execute,
      pg_catalog.has_function_privilege(
        'deposit_rpc_public_probe',
        procedure_row.oid,
        'EXECUTE'
      ) as public_probe_can_execute
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_language language_row
      on language_row.oid = procedure_row.prolang
    where procedure_row.oid = $1::regprocedure
  `, [FUNCTION_REGPROCEDURE]);

  assert.equal(result.rows.length, 1);
  return result.rows[0];
}

async function namedFunctionCount(client) {
  return Number((await client.query(`
    select pg_catalog.count(*)::integer as count
    from pg_catalog.pg_proc procedure_row
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = procedure_row.pronamespace
    where namespace_row.nspname = 'public'
      and procedure_row.proname = 'approve_deposit_tx'
  `)).rows[0].count);
}

async function financialFingerprint(client) {
  const result = await client.query(`
    select pg_catalog.jsonb_build_object(
      'profiles',
      (
        select coalesce(
          pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_value) order by row_value.id),
          '[]'::jsonb
        )
        from public.profiles row_value
      ),
      'deposits',
      (
        select coalesce(
          pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_value) order by row_value.id),
          '[]'::jsonb
        )
        from public.deposits row_value
      ),
      'wallets',
      (
        select coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.to_jsonb(row_value)
            order by row_value.user_id
          ),
          '[]'::jsonb
        )
        from public.wallets row_value
      ),
      'transactions',
      (
        select coalesce(
          pg_catalog.jsonb_agg(pg_catalog.to_jsonb(row_value) order by row_value.id),
          '[]'::jsonb
        )
        from public.transactions row_value
      )
    )::text as fingerprint
  `);

  return sha256(result.rows[0].fingerprint);
}

async function catalogAndFinancialFingerprint(client) {
  const schemaPrivileges = (await client.query(`
    select pg_catalog.jsonb_build_object(
      'anon_create',
        pg_catalog.has_schema_privilege('anon', 'public', 'CREATE'),
      'authenticated_create',
        pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE'),
      'service_role_create',
        pg_catalog.has_schema_privilege('service_role', 'public', 'CREATE')
    ) as fingerprint
  `)).rows[0].fingerprint;

  return {
    namedFunctionCount: await namedFunctionCount(client),
    function: await functionCatalog(client),
    schemaPrivileges,
    financial: await financialFingerprint(client),
  };
}

async function installMigrationMutationSentinel(client) {
  await client.query(`
    create function public.deposit_rpc_migration_mutation_sentinel()
    returns event_trigger
    language plpgsql
    as $sentinel$
    begin
      raise exception 'mutation_reached';
    end
    $sentinel$;

    create event trigger deposit_rpc_migration_mutation_sentinel
    on ddl_command_start
    when tag in (
      'CREATE FUNCTION',
      'ALTER FUNCTION',
      'DROP FUNCTION',
      'GRANT',
      'REVOKE',
      'COMMENT'
    )
    execute function public.deposit_rpc_migration_mutation_sentinel();
  `);
}

async function removeMigrationMutationSentinel(client) {
  await client.query(`
    drop event trigger if exists deposit_rpc_migration_mutation_sentinel;
    drop function if exists public.deposit_rpc_migration_mutation_sentinel();
  `);
}

async function assertRoleCannotExecute(client, role) {
  await client.query(`set role ${role}`);
  let denied;
  try {
    await client.query(
      `select public.approve_deposit_tx(
        $1::uuid,
        $2::uuid,
        'approve',
        null,
        1
      )`,
      [APPROVE_DEPOSIT_ID, ADMIN_ID],
    );
  } catch (error) {
    denied = error;
  } finally {
    await client.query("reset role");
  }

  assert.ok(denied, `${role} must not execute the hardened function`);
  assert.equal(denied.code, "42501");
}

test("deposit approval hardening is a transaction-runner-compatible catalog-only migration", () => {
  assert.equal(
    md5(LIVE_APPROVE_DEPOSIT_SOURCE.replaceAll("\r\n", "\n")),
    EXPECTED_SOURCE_MD5,
    "the native fixture must reproduce the exact live normalized prosrc",
  );
  assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
  assert.doesNotMatch(
    migration,
    /\b(?:create\s+(?:or\s+replace\s+)?function|drop\s+function)\b/i,
  );
  assert.doesNotMatch(
    migration,
    /\b(?:insert\s+into|update|delete\s+from|truncate)\s+public\.(?:deposits|wallets|transactions)\b/i,
  );
  assert.match(
    migration,
    /alter\s+function\s+public\.approve_deposit_tx[\s\S]*?set\s+search_path\s+to\s+pg_catalog,\s*public,\s*pg_temp/i,
  );
  assert.match(
    migration,
    /revoke\s+all\s+on\s+function[\s\S]*?from\s+public,\s*anon,\s*authenticated,\s*service_role,\s*postgres/i,
  );
  assert.match(
    migration,
    /grant\s+execute\s+on\s+function[\s\S]*?to\s+postgres,\s*service_role/i,
  );

  const preflightEnd = migration.indexOf("$preflight$;", 1);
  const firstMutation = migration.search(/\balter\s+function\b/i);
  assert.ok(preflightEnd > 0);
  assert.ok(firstMutation > preflightEnd);
  assert.match(migration.slice(0, preflightEnd), /aclexplode\(v_function\.proacl\)/i);
  assert.match(
    migration.slice(0, preflightEnd),
    new RegExp(EXPECTED_SOURCE_MD5, "i"),
  );
});

test("native PostgreSQL rejects drift before mutation and preserves behavior after hardening", {
  timeout: 360_000,
}, async (t) => {
  const connectionString = disposablePostgresUrl(t);
  if (!connectionString) return;

  const { default: pg } = await import("pg");
  const { Client } = pg;
  const client = new Client({
    connectionString,
    application_name: "qhash-deposit-approval-rpc-security",
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
      sql:
        `alter function ${FUNCTION_REGPROCEDURE} owner to deposit_rpc_drift_owner`,
      expectedError: PREFLIGHT_ERRORS.catalog,
    },
    {
      name: "function source",
      sql: `
        create or replace function public.approve_deposit_tx(
          p_deposit_id uuid,
          p_admin_id uuid,
          p_action text,
          p_admin_note text default null,
          p_amount numeric default null
        )
        returns jsonb
        language plpgsql
        security definer
        as $drift$
        begin
          return '{}'::jsonb;
        end
        $drift$
      `,
      expectedError: PREFLIGHT_ERRORS.catalog,
    },
    {
      name: "extra overload",
      sql: `
        create function public.approve_deposit_tx(p_deposit_id uuid)
        returns jsonb
        language sql
        as $drift$ select '{}'::jsonb $drift$
      `,
      expectedError: PREFLIGHT_ERRORS.identity,
    },
    {
      name: "security invoker",
      sql: `alter function ${FUNCTION_REGPROCEDURE} security invoker`,
      expectedError: PREFLIGHT_ERRORS.catalog,
    },
    {
      name: "argument defaults",
      sql: `
        create or replace function public.approve_deposit_tx(
          p_deposit_id uuid,
          p_admin_id uuid,
          p_action text,
          p_admin_note text default 'drift'::text,
          p_amount numeric default 1::numeric
        )
        returns jsonb
        language plpgsql
        security definer
        as $function$${LIVE_APPROVE_DEPOSIT_SOURCE}$function$
      `,
      expectedError: PREFLIGHT_ERRORS.catalog,
    },
    {
      name: "execution cost",
      sql: `alter function ${FUNCTION_REGPROCEDURE} cost 42`,
      expectedError: PREFLIGHT_ERRORS.catalog,
    },
    {
      name: "leakproof mode",
      sql: `alter function ${FUNCTION_REGPROCEDURE} leakproof`,
      expectedError: PREFLIGHT_ERRORS.catalog,
    },
    {
      name: "stable volatility",
      sql: `alter function ${FUNCTION_REGPROCEDURE} stable`,
      expectedError: PREFLIGHT_ERRORS.catalog,
    },
    {
      name: "strictness",
      sql: `alter function ${FUNCTION_REGPROCEDURE} strict`,
      expectedError: PREFLIGHT_ERRORS.catalog,
    },
    {
      name: "parallel safety",
      sql: `alter function ${FUNCTION_REGPROCEDURE} parallel safe`,
      expectedError: PREFLIGHT_ERRORS.catalog,
    },
    {
      name: "pre-existing search path",
      sql:
        `alter function ${FUNCTION_REGPROCEDURE} set search_path to pg_catalog, public`,
      expectedError: PREFLIGHT_ERRORS.catalog,
    },
    {
      name: "missing PUBLIC grant",
      sql: `revoke execute on function ${FUNCTION_REGPROCEDURE} from public`,
      expectedError: PREFLIGHT_ERRORS.privileges,
    },
    {
      name: "missing anon grant",
      sql: `revoke execute on function ${FUNCTION_REGPROCEDURE} from anon`,
      expectedError: PREFLIGHT_ERRORS.privileges,
    },
    {
      name: "missing authenticated grant",
      sql:
        `revoke execute on function ${FUNCTION_REGPROCEDURE} from authenticated`,
      expectedError: PREFLIGHT_ERRORS.privileges,
    },
    {
      name: "missing service-role grant",
      sql:
        `revoke execute on function ${FUNCTION_REGPROCEDURE} from service_role`,
      expectedError: PREFLIGHT_ERRORS.privileges,
    },
    {
      name: "unexpected grantee",
      sql:
        `grant execute on function ${FUNCTION_REGPROCEDURE} to deposit_rpc_unexpected_grantee`,
      expectedError: PREFLIGHT_ERRORS.privileges,
    },
    {
      name: "service-role grant option",
      sql:
        `grant execute on function ${FUNCTION_REGPROCEDURE} to service_role with grant option`,
      expectedError: PREFLIGHT_ERRORS.privileges,
    },
    {
      name: "client schema CREATE privilege",
      sql: "grant create on schema public to authenticated",
      expectedError: PREFLIGHT_ERRORS.schema,
    },
    {
      name: "authenticated inherits service role",
      sql: "grant service_role to authenticated",
      expectedError: PREFLIGHT_ERRORS.inheritance,
    },
    {
      name: "anonymous inherits service role",
      sql: "grant service_role to anon",
      expectedError: PREFLIGHT_ERRORS.inheritance,
    },
    {
      name: "authenticated transitively inherits service role",
      sql: `
        grant service_role to deposit_rpc_intermediary;
        grant deposit_rpc_intermediary to authenticated
      `,
      expectedError: PREFLIGHT_ERRORS.inheritance,
    },
    {
      name: "anonymous transitively inherits function owner",
      sql: `
        grant postgres to deposit_rpc_intermediary;
        grant deposit_rpc_intermediary to anon
      `,
      expectedError: PREFLIGHT_ERRORS.schema,
    },
    {
      name: "authenticated inherits function owner",
      sql: "grant postgres to authenticated",
      expectedError: PREFLIGHT_ERRORS.schema,
    },
  ];

  await t.test("mutation sentinel detects the first catalog mutation", async () => {
    await createLivePreMigrationCatalog(client);
    await installMigrationMutationSentinel(client);
    let sentinelError;
    try {
      await client.query(
        `alter function ${FUNCTION_REGPROCEDURE} set search_path to pg_catalog, public`,
      );
    } catch (error) {
      sentinelError = error;
    } finally {
      await removeMigrationMutationSentinel(client);
    }
    assert.ok(sentinelError);
    assert.equal(sentinelError.code, "P0001");
    assert.equal(sentinelError.message, "mutation_reached");
  });

  for (const fixture of driftFixtures) {
    await t.test(`fails before mutation on ${fixture.name} drift`, async () => {
      await createLivePreMigrationCatalog(client);
      await client.query(fixture.sql);
      const before = await catalogAndFinancialFingerprint(client);

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
        await catalogAndFinancialFingerprint(client),
        before,
        `failed ${fixture.name} preflight must preserve catalog and financial rows`,
      );
    });
  }

  await t.test("exact live catalog hardens only search path and ACLs", async () => {
    await createLivePreMigrationCatalog(client);
    const beforeCatalog = await functionCatalog(client);
    const beforeFinancial = await financialFingerprint(client);

    assert.equal(await namedFunctionCount(client), 1);
    assert.equal(beforeCatalog.owner, "postgres");
    assert.equal(beforeCatalog.language, "plpgsql");
    assert.equal(beforeCatalog.kind, "f");
    assert.equal(beforeCatalog.argument_count, 5);
    assert.equal(beforeCatalog.default_count, 2);
    assert.equal(beforeCatalog.returns_set, false);
    assert.equal(beforeCatalog.leakproof, false);
    assert.equal(beforeCatalog.cost, 100);
    assert.equal(beforeCatalog.rows, 0);
    assert.equal(beforeCatalog.support, "0");
    assert.equal(beforeCatalog.security_definer, true);
    assert.equal(beforeCatalog.volatility, "v");
    assert.equal(beforeCatalog.strict, false);
    assert.equal(beforeCatalog.parallel, "u");
    assert.equal(beforeCatalog.config, null);
    assert.equal(
      beforeCatalog.identity_arguments,
      "p_deposit_id uuid, p_admin_id uuid, p_action text, p_admin_note text, p_amount numeric",
    );
    assert.equal(
      beforeCatalog.arguments_with_defaults,
      "p_deposit_id uuid, p_admin_id uuid, p_action text, p_admin_note text DEFAULT NULL::text, p_amount numeric DEFAULT NULL::numeric",
    );
    assert.equal(beforeCatalog.result_type, "jsonb");
    assert.equal(beforeCatalog.source, LIVE_APPROVE_DEPOSIT_SOURCE);
    assert.equal(beforeCatalog.normalized_source_md5, EXPECTED_SOURCE_MD5);
    assert.deepEqual(beforeCatalog.acl, OLD_ACL);
    assert.equal(beforeCatalog.anon_can_execute, true);
    assert.equal(beforeCatalog.authenticated_can_execute, true);
    assert.equal(beforeCatalog.service_role_can_execute, true);
    assert.equal(beforeCatalog.public_probe_can_execute, true);

    await applyMigration(client);

    const afterCatalog = await functionCatalog(client);
    assert.equal(await namedFunctionCount(client), 1);
    assert.equal(afterCatalog.oid, beforeCatalog.oid);
    assert.equal(afterCatalog.source, beforeCatalog.source);
    assert.equal(afterCatalog.normalized_source_md5, EXPECTED_SOURCE_MD5);
    assert.equal(afterCatalog.owner, beforeCatalog.owner);
    assert.equal(afterCatalog.language, beforeCatalog.language);
    assert.equal(afterCatalog.kind, beforeCatalog.kind);
    assert.equal(afterCatalog.argument_count, beforeCatalog.argument_count);
    assert.equal(afterCatalog.default_count, beforeCatalog.default_count);
    assert.equal(afterCatalog.returns_set, beforeCatalog.returns_set);
    assert.equal(afterCatalog.leakproof, beforeCatalog.leakproof);
    assert.equal(afterCatalog.cost, beforeCatalog.cost);
    assert.equal(afterCatalog.rows, beforeCatalog.rows);
    assert.equal(afterCatalog.support, beforeCatalog.support);
    assert.equal(afterCatalog.security_definer, true);
    assert.equal(afterCatalog.volatility, beforeCatalog.volatility);
    assert.equal(afterCatalog.strict, beforeCatalog.strict);
    assert.equal(afterCatalog.parallel, beforeCatalog.parallel);
    assert.equal(
      afterCatalog.identity_arguments,
      beforeCatalog.identity_arguments,
    );
    assert.equal(
      afterCatalog.arguments_with_defaults,
      beforeCatalog.arguments_with_defaults,
    );
    assert.equal(afterCatalog.result_type, beforeCatalog.result_type);
    assert.deepEqual(
      afterCatalog.config,
      ["search_path=pg_catalog, public, pg_temp"],
    );
    assert.deepEqual(afterCatalog.acl, HARDENED_ACL);
    assert.equal(afterCatalog.anon_can_execute, false);
    assert.equal(afterCatalog.authenticated_can_execute, false);
    assert.equal(afterCatalog.service_role_can_execute, true);
    assert.equal(afterCatalog.public_probe_can_execute, false);
    assert.equal(await financialFingerprint(client), beforeFinancial);
  });

  await t.test("anon and authenticated cannot invoke the hardened RPC", async () => {
    await createLivePreMigrationCatalog(client);
    await applyMigration(client);
    const before = await financialFingerprint(client);

    await assertRoleCannotExecute(client, "anon");
    await assertRoleCannotExecute(client, "authenticated");
    await assertRoleCannotExecute(client, "deposit_rpc_public_probe");

    assert.equal(await financialFingerprint(client), before);
  });

  await t.test("service-role approval and rejection behavior remains compatible", async () => {
    await createLivePreMigrationCatalog(client);
    await applyMigration(client);
    await client.query("set role service_role");
    try {
      const notAdmin = (await client.query(
        `select public.approve_deposit_tx(
          $1::uuid,
          $2::uuid,
          'approve',
          null,
          12.34
        ) as result`,
        [APPROVE_DEPOSIT_ID, OTHER_USER_ID],
      )).rows[0].result;
      assert.equal(notAdmin.success, false);
      assert.equal(notAdmin.error, "not_admin");

      const approved = (await client.query(
        `select public.approve_deposit_tx(
          $1::uuid,
          $2::uuid,
          'approve',
          'receipt verified',
          12.34
        ) as result`,
        [APPROVE_DEPOSIT_ID, ADMIN_ID],
      )).rows[0].result;
      assert.equal(approved.success, true);
      assert.equal(approved.status, "approved");
      assert.equal(Number(approved.amount), 12.34);
      assert.equal(Number(approved.balance_before), 100);
      assert.equal(Number(approved.balance_after), 112.34);

      const replay = (await client.query(
        `select public.approve_deposit_tx(
          $1::uuid,
          $2::uuid,
          'approve',
          'receipt verified',
          12.34
        ) as result`,
        [APPROVE_DEPOSIT_ID, ADMIN_ID],
      )).rows[0].result;
      assert.equal(replay.success, false);
      assert.equal(replay.error, "already_reviewed");

      const rejected = (await client.query(
        `select public.approve_deposit_tx(
          $1::uuid,
          $2::uuid,
          'reject',
          'receipt mismatch',
          null
        ) as result`,
        [REJECT_DEPOSIT_ID, ADMIN_ID],
      )).rows[0].result;
      assert.equal(rejected.success, true);
      assert.equal(rejected.status, "rejected");
    } finally {
      await client.query("reset role");
    }

    const wallet = (await client.query(
      "select balance::text from public.wallets where user_id = $1::uuid",
      [USER_ID],
    )).rows[0];
    assert.equal(wallet.balance, "112.34");

    const deposits = (await client.query(`
      select id::text, status::text, amount::text, admin_note
      from public.deposits
      order by id
    `)).rows;
    assert.deepEqual(deposits, [
      {
        id: APPROVE_DEPOSIT_ID,
        status: "approved",
        amount: "12.34",
        admin_note: "receipt verified",
      },
      {
        id: REJECT_DEPOSIT_ID,
        status: "rejected",
        amount: "77",
        admin_note: "receipt mismatch",
      },
    ]);

    const transactions = (await client.query(`
      select
        user_id::text,
        type::text,
        amount::text,
        status::text,
        balance_before::text,
        balance_after::text,
        description,
        reference_id::text
      from public.transactions
      order by created_at, id
    `)).rows;
    assert.deepEqual(transactions, [
      {
        user_id: USER_ID,
        type: "deposit",
        amount: "12.34",
        status: "completed",
        balance_before: "100",
        balance_after: "112.34",
        description: "Deposit via CBE-APPROVE-FIXTURE",
        reference_id: APPROVE_DEPOSIT_ID,
      },
    ]);
  });
});

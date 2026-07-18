import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const repositoryRoot = new URL("../", import.meta.url);
const retirementMigrationPath =
  "supabase/migrations/20260718120000_native_crypto_database_retirement/migration.sql";

const historicalMigrationIds = [
  "20260710120000_crypto_deposit_foundation/migration.sql",
  "20260716160000_bsc_confirmation_writer/migration.sql",
  "20260716185000_crypto_manual_crediting_uuid_preflight/migration.sql",
  "20260716190000_crypto_manual_crediting/migration.sql",
  "20260717030000_crypto_user_id_uuid_repair/migration.sql",
  "20260717130000_crypto_reference_id_uuid_repair/migration.sql",
  "20260717150000_crypto_schema_reconciliation/migration.sql",
  "20260717170000_bsc_user_deposit_exposure/migration.sql",
  "20260717221500_bsc_address_rotation/migration.sql",
];

const retirementMigration = await readFile(
  new URL(retirementMigrationPath, repositoryRoot),
  "utf8",
);
const historicalMigrations = await Promise.all(
  historicalMigrationIds.map((id) =>
    readFile(new URL(`supabase/migrations/${id}`, repositoryRoot), "utf8"),
  ),
);

const USER_AND_ADMIN_ID = "bd44f308-7d49-4878-bee5-d5ea78969a9c";
const OLD_ADDRESS_ID = "9cf3da8f-e857-44e7-8f2e-22974bbb1785";
const TREASURY_ADDRESS_ID = "f7956929-852e-45e2-9a5c-830ae2b71b15";
const DEPOSIT_ID = "fcd260e7-970b-44a1-9089-d5a37a88d93d";
const TRANSACTION_ID = "536fe882-dcbc-4b14-9a6d-89ce691425be";
const OLD_ADDRESS = "0x1fe20b3b2fa149d667610031df6ddbf8105b7616";
const TREASURY_ADDRESS = "0xbe19677ee642cfe21fff5899b258f5010651c33e";
const TX_HASH = "0x766ec571a07beddc9b57f8436b05d1cbee7d1cfcac54c8c1003e9b53ddc9320b";
const FROM_ADDRESS = "0x8894e0a0c962cb723c1976a4421c95949be2d4e3";

async function applySqlInTransaction(db, sql) {
  await db.exec("begin");
  try {
    await db.exec(sql);
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
}

async function createCoreFixture(db) {
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
    create type public.transaction_status as enum ('completed', 'pending', 'failed');

    create table public.profiles (
      id uuid primary key,
      is_admin boolean not null default false,
      is_frozen boolean not null default false
    );

    create table public.wallets (
      user_id uuid primary key references public.profiles(id),
      balance numeric(18, 2) not null default 0,
      updated_at timestamptz not null default now()
    );

    create table public.transactions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.profiles(id),
      type public.transaction_type not null,
      amount numeric(18, 2) not null,
      status public.transaction_status not null default 'pending',
      balance_before numeric(18, 2),
      balance_after numeric(18, 2),
      description text,
      reference_id uuid,
      metadata jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create table public.app_settings (
      key text primary key,
      value text not null,
      updated_at timestamptz not null default now()
    );

    create table public._qhash_migrations (
      id text primary key,
      checksum text not null,
      applied_at timestamptz not null default now(),
      deploy_context text,
      commit_ref text
    );
  `);

  for (const migration of historicalMigrations) {
    await applySqlInTransaction(db, migration);
  }
}

async function markHistoricalMigrationsAsSingleCommitReplay(db) {
  for (const [index, id] of historicalMigrationIds.entries()) {
    const checksum = createHash("sha256")
      .update(historicalMigrations[index])
      .digest("hex");
    await db.query(
      `insert into public._qhash_migrations (
         id, checksum, applied_at, deploy_context, commit_ref
       ) values ($1, $2, '2020-01-01T00:00:00Z', 'production', 'greenfield-test-replay')`,
      [id, checksum],
    );
  }
}

async function seedKnownProductionEvidence(db) {
  await db.query(
    `insert into public.profiles (id, is_admin, is_frozen)
     values ($1::uuid, true, false)`,
    [USER_AND_ADMIN_ID],
  );
  await db.query(
    `insert into public.wallets (user_id, balance)
     values ($1::uuid, 16804.40)`,
    [USER_AND_ADMIN_ID],
  );
  await db.query(
    `insert into public.transactions (
       id, user_id, type, amount, status, balance_before, balance_after,
       description, reference_id, metadata, created_at
     ) values (
       $1::uuid, $2::uuid, 'deposit', 1898.10, 'completed', 14703.80, 16601.90,
       'Deposit credited', $3::uuid, '{}'::jsonb, '2026-07-17T14:09:57.701646Z'
     )`,
    [TRANSACTION_ID, USER_AND_ADMIN_ID, DEPOSIT_ID],
  );
  await db.query(
    `insert into public.crypto_deposit_addresses (
       id, user_id, network, asset, address, derivation_index,
       activation_status, status, created_at, updated_at
     ) values
       (
         $1::uuid, $3::uuid, 'BSC', 'USDT', $4, null,
         'not_required', 'disabled',
         '2026-07-16T22:41:12.604919Z', '2026-07-17T23:34:35.503055Z'
       ),
       (
         $2::uuid, $3::uuid, 'BSC', 'USDT', $5, null,
         'not_required', 'active',
         '2026-07-17T23:34:35.503055Z', '2026-07-17T23:34:35.503055Z'
       )`,
    [
      OLD_ADDRESS_ID,
      TREASURY_ADDRESS_ID,
      USER_AND_ADMIN_ID,
      OLD_ADDRESS,
      TREASURY_ADDRESS,
    ],
  );
  await db.query(
    `insert into public.crypto_deposits (
       id, user_id, address_id, network, asset, tx_hash, event_index,
       from_address, to_address, amount_raw, amount_usdt, block_number,
       confirmations, status, exchange_rate_etb, credited_amount_etb,
       credited_transaction_id, credited_by_admin_id, detected_at,
       confirmed_at, credited_at, swept_at, created_at, updated_at
     ) values (
       $1::uuid, $2::uuid, $3::uuid, 'BSC', 'USDT', $4, 115,
       $5, $6, 9990000000000000000, 9.990000, 110407808,
       121052, 'credited', 190.000000, 1898.10,
       $7::uuid, $2::uuid, '2026-07-16T23:02:14.552539Z',
       '2026-07-16T23:19:26.712314Z', '2026-07-17T14:09:57.701646Z', null,
       '2026-07-16T23:02:14.552539Z', '2026-07-17T14:09:57.701646Z'
     )`,
    [
      DEPOSIT_ID,
      USER_AND_ADMIN_ID,
      OLD_ADDRESS_ID,
      TX_HASH,
      FROM_ADDRESS,
      OLD_ADDRESS,
      TRANSACTION_ID,
    ],
  );

  await db.exec(`
    update public.app_settings
    set value = case key
      when 'usdt_etb_rate' then '190'
      when 'crypto_tron_min_usdt' then '10'
      when 'crypto_bsc_min_usdt' then '5'
      when 'crypto_auto_credit_enabled' then 'false'
      when 'crypto_bsc_user_deposits_enabled' then 'false'
      else value
    end
    where key in (
      'usdt_etb_rate',
      'crypto_tron_min_usdt',
      'crypto_bsc_min_usdt',
      'crypto_auto_credit_enabled',
      'crypto_bsc_user_deposits_enabled'
    );

    delete from public.crypto_watcher_state;

    insert into public.crypto_watcher_state (network, last_scanned_block, updated_at)
    values
      ('BSC', 110698538, '2026-07-18T11:23:06.179878Z'),
      ('TRON', 0, '2026-07-10T10:52:56.951011Z');
  `);
}

async function assertRuntimeObjectsRemoved(db) {
  const objects = await db.query(`
    select
      to_regclass('public.crypto_sweep_jobs') is null as sweep_jobs_absent,
      to_regclass('public.crypto_watcher_state') is null as watcher_state_absent,
      to_regprocedure(
        'public.apply_bsc_crypto_deposit_confirmation(uuid,text,uuid,text,integer,text,text,text,text,bigint,integer,integer,integer)'
      ) is null as confirmation_rpc_absent,
      to_regprocedure(
        'public.credit_confirmed_bsc_crypto_deposit(uuid,uuid,text,uuid,text,integer,text,text,text,text,bigint,integer,integer,text,text)'
      ) is null as credit_rpc_absent,
      to_regprocedure(
        'public.rotate_bsc_crypto_deposit_address(uuid,uuid,uuid,text,text)'
      ) is null as rotation_rpc_absent,
      to_regprocedure(
        'public.normalize_crypto_deposit_address_activation_status()'
      ) is null as normalizer_absent,
      to_regprocedure('public.set_crypto_updated_at()') is null as timestamp_helper_absent,
      to_regprocedure(
        'public.reject_retired_native_crypto_evidence_mutation()'
      ) is not null as blocker_present,
      to_regclass('public.idx_transactions_reference') is not null as reference_index_preserved
  `);
  assert.deepEqual(objects.rows, [
    {
      sweep_jobs_absent: true,
      watcher_state_absent: true,
      confirmation_rpc_absent: true,
      credit_rpc_absent: true,
      rotation_rpc_absent: true,
      normalizer_absent: true,
      timestamp_helper_absent: true,
      blocker_present: true,
      reference_index_preserved: true,
    },
  ]);

  const settings = await db.query(`
    select key
    from public.app_settings
    where key in (
      'crypto_auto_credit_enabled',
      'crypto_bsc_user_deposits_enabled',
      'crypto_bsc_min_usdt',
      'crypto_tron_min_usdt',
      'usdt_etb_rate'
    )
  `);
  assert.deepEqual(settings.rows, []);
}

async function assertArchivesAreReadOnly(db) {
  const security = await db.query(`
    select
      table_info.relname as table_name,
      table_info.relrowsecurity as rls_enabled,
      has_table_privilege('service_role', table_info.oid, 'SELECT') as service_select,
      has_table_privilege('service_role', table_info.oid, 'INSERT') as service_insert,
      has_table_privilege('service_role', table_info.oid, 'UPDATE') as service_update,
      has_table_privilege('service_role', table_info.oid, 'DELETE') as service_delete,
      has_table_privilege('service_role', table_info.oid, 'TRUNCATE') as service_truncate,
      has_table_privilege('anon', table_info.oid, 'SELECT') as anon_select,
      has_table_privilege('authenticated', table_info.oid, 'SELECT') as authenticated_select,
      exists (
        select 1
        from aclexplode(
          coalesce(table_info.relacl, acldefault('r', table_info.relowner))
        ) as public_acl
        where public_acl.grantee = 0
          and public_acl.privilege_type = 'SELECT'
      ) as public_select,
      (
        select count(*)::integer
        from pg_policy as policy_info
        where policy_info.polrelid = table_info.oid
      ) as policy_count,
      (
        select count(*)::integer
        from pg_trigger as trigger_info
        where trigger_info.tgrelid = table_info.oid
          and not trigger_info.tgisinternal
          and trigger_info.tgenabled = 'O'
      ) as blocker_count,
      obj_description(table_info.oid, 'pg_class') as table_comment
    from pg_class as table_info
    join pg_namespace as namespace_info
      on namespace_info.oid = table_info.relnamespace
    where namespace_info.nspname = 'public'
      and table_info.relname in ('crypto_deposit_addresses', 'crypto_deposits')
    order by table_info.relname
  `);

  assert.equal(security.rows.length, 2);
  for (const row of security.rows) {
    assert.equal(row.rls_enabled, true, `${row.table_name} must keep RLS enabled`);
    assert.equal(row.service_select, true, `${row.table_name} must remain auditable`);
    assert.equal(row.service_insert, false, `${row.table_name} insert must be revoked`);
    assert.equal(row.service_update, false, `${row.table_name} update must be revoked`);
    assert.equal(row.service_delete, false, `${row.table_name} delete must be revoked`);
    assert.equal(row.service_truncate, false, `${row.table_name} truncate must be revoked`);
    assert.equal(row.anon_select, false, `${row.table_name} must stay hidden from anon`);
    assert.equal(
      row.authenticated_select,
      false,
      `${row.table_name} must stay hidden from authenticated users`,
    );
    assert.equal(row.public_select, false, `${row.table_name} must stay hidden from PUBLIC`);
    assert.equal(row.policy_count, 0, `${row.table_name} must not gain an RLS policy`);
    assert.equal(row.blocker_count, 1, `${row.table_name} must have one mutation blocker`);
    assert.match(row.table_comment, /retired native crypto.*evidence.*immutable/i);
  }

  const functionPrivileges = await db.query(`
    select
      has_function_privilege(
        'service_role',
        'public.reject_retired_native_crypto_evidence_mutation()',
        'EXECUTE'
      ) as service_execute,
      has_function_privilege(
        'anon',
        'public.reject_retired_native_crypto_evidence_mutation()',
        'EXECUTE'
      ) as anon_execute,
      has_function_privilege(
        'authenticated',
        'public.reject_retired_native_crypto_evidence_mutation()',
        'EXECUTE'
      ) as authenticated_execute,
      exists (
        select 1
        from pg_proc as function_info
        cross join lateral aclexplode(
          coalesce(function_info.proacl, acldefault('f', function_info.proowner))
        ) as public_acl
        where function_info.oid =
          'public.reject_retired_native_crypto_evidence_mutation()'::regprocedure
          and public_acl.grantee = 0
          and public_acl.privilege_type = 'EXECUTE'
      ) as public_execute
  `);
  assert.deepEqual(functionPrivileges.rows, [
    {
      service_execute: false,
      anon_execute: false,
      authenticated_execute: false,
      public_execute: false,
    },
  ]);

  await assert.rejects(
    db.exec("update public.crypto_deposits set status = status where false"),
    /retired native crypto evidence is immutable/i,
  );
  await assert.rejects(
    db.exec("delete from public.crypto_deposit_addresses where false"),
    /retired native crypto evidence is immutable/i,
  );
  await assert.rejects(
    db.exec("truncate table public.crypto_deposits"),
    /retired native crypto evidence is immutable/i,
  );
}

test("retires an empty foundation after a checksum-verified single-commit replay", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createCoreFixture(db);
  await markHistoricalMigrationsAsSingleCommitReplay(db);
  await applySqlInTransaction(db, retirementMigration);

  const archives = await db.query(`
    select
      (select count(*)::integer from public.crypto_deposit_addresses) as address_count,
      (select count(*)::integer from public.crypto_deposits) as deposit_count
  `);
  assert.deepEqual(archives.rows, [{ address_count: 0, deposit_count: 0 }]);
  await assertRuntimeObjectsRemoved(db);
  await assertArchivesAreReadOnly(db);
});

test("preserves the exact credited production evidence while disabling its active address", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createCoreFixture(db);
  await seedKnownProductionEvidence(db);
  await applySqlInTransaction(db, retirementMigration);

  const evidence = await db.query(`
    select
      deposit.id::text as deposit_id,
      deposit.address_id::text as address_id,
      deposit.status,
      deposit.amount_usdt::text,
      deposit.exchange_rate_etb::text,
      deposit.credited_amount_etb::text,
      deposit.credited_transaction_id::text as credited_transaction_id,
      deposit.credited_by_admin_id::text as credited_by_admin_id,
      deposit.swept_at,
      transaction_info.status::text as transaction_status,
      transaction_info.amount::text as transaction_amount,
      transaction_info.balance_before::text,
      transaction_info.balance_after::text,
      transaction_info.metadata -> 'native_crypto_decommission' ->> 'version'
        as archive_version,
      transaction_info.metadata -> 'native_crypto_decommission' ->> 'custody_status'
        as custody_status,
      transaction_info.metadata -> 'native_crypto_decommission' ->> 'deposit_id'
        as archived_deposit_id,
      transaction_info.metadata -> 'native_crypto_decommission' ->> 'deposit_address'
        as archived_deposit_address,
      transaction_info.metadata -> 'native_crypto_decommission' ->> 'disabled_treasury_address'
        as archived_treasury_address,
      transaction_info.metadata -> 'native_crypto_decommission' ->> 'chain_tx_hash'
        as archived_chain_tx_hash,
      transaction_info.metadata -> 'native_crypto_decommission' ->> 'amount_usdt'
        as archived_amount_usdt,
      transaction_info.metadata -> 'native_crypto_decommission' ->> 'credited_amount_etb'
        as archived_credited_amount_etb,
      transaction_info.metadata -> 'native_crypto_decommission' ->> 'bsc_watcher_last_scanned_block'
        as archived_bsc_watcher_block,
      transaction_info.metadata -> 'native_crypto_decommission' ->> 'bsc_watcher_last_updated_at'
        as archived_bsc_watcher_updated_at,
      transaction_info.metadata -> 'native_crypto_decommission' ->> 'tron_watcher_last_scanned_block'
        as archived_tron_watcher_block,
      transaction_info.metadata -> 'native_crypto_decommission' ->> 'tron_watcher_last_updated_at'
        as archived_tron_watcher_updated_at,
      transaction_info.metadata -> 'native_crypto_decommission' ? 'archived_at'
        as archive_timestamp_present,
      (
        select count(*)::integer
        from jsonb_object_keys(transaction_info.metadata)
      ) as metadata_top_level_key_count,
      wallet.balance::text as current_wallet_balance,
      (
        select count(*)::integer
        from public.transactions as reference_count
        where reference_count.reference_id = deposit.id
      ) as reference_count
    from public.crypto_deposits as deposit
    join public.transactions as transaction_info
      on transaction_info.id = deposit.credited_transaction_id
    join public.wallets as wallet
      on wallet.user_id = deposit.user_id
    where deposit.id = '${DEPOSIT_ID}'::uuid
  `);
  assert.deepEqual(evidence.rows, [
    {
      deposit_id: DEPOSIT_ID,
      address_id: OLD_ADDRESS_ID,
      status: "credited",
      amount_usdt: "9.990000",
      exchange_rate_etb: "190.000000",
      credited_amount_etb: "1898.10",
      credited_transaction_id: TRANSACTION_ID,
      credited_by_admin_id: USER_AND_ADMIN_ID,
      swept_at: null,
      transaction_status: "completed",
      transaction_amount: "1898.10",
      balance_before: "14703.80",
      balance_after: "16601.90",
      archive_version: "1",
      custody_status: "unswept_external_asset_pending",
      archived_deposit_id: DEPOSIT_ID,
      archived_deposit_address: OLD_ADDRESS,
      archived_treasury_address: TREASURY_ADDRESS,
      archived_chain_tx_hash: TX_HASH,
      archived_amount_usdt: "9.99",
      archived_credited_amount_etb: "1898.10",
      archived_bsc_watcher_block: "110698538",
      archived_bsc_watcher_updated_at: "2026-07-18T11:23:06.179878Z",
      archived_tron_watcher_block: "0",
      archived_tron_watcher_updated_at: "2026-07-10T10:52:56.951011Z",
      archive_timestamp_present: true,
      metadata_top_level_key_count: 1,
      current_wallet_balance: "16804.40",
      reference_count: 1,
    },
  ]);

  const archivedMetadata = await db.query(`
    select metadata -> 'native_crypto_decommission' as snapshot
    from public.transactions
    where id = '${TRANSACTION_ID}'::uuid
  `);
  assert.equal(archivedMetadata.rows.length, 1);
  const { archived_at: archivedAt, ...stableSnapshot } =
    archivedMetadata.rows[0].snapshot;
  assert.ok(Number.isFinite(Date.parse(archivedAt)), "archive timestamp must be valid");
  assert.deepEqual(stableSnapshot, {
    version: 1,
    custody_status: "unswept_external_asset_pending",
    network: "BSC",
    asset: "USDT",
    deposit_id: DEPOSIT_ID,
    ledger_transaction_id: TRANSACTION_ID,
    deposit_address_id: OLD_ADDRESS_ID,
    deposit_address: OLD_ADDRESS,
    deposit_address_created_at: "2026-07-16T22:41:12.604919Z",
    deposit_address_disabled_at: "2026-07-17T23:34:35.503055Z",
    disabled_treasury_address_id: TREASURY_ADDRESS_ID,
    disabled_treasury_address: TREASURY_ADDRESS,
    treasury_address_assigned_at: "2026-07-17T23:34:35.503055Z",
    chain_tx_hash: TX_HASH,
    event_index: 115,
    deposit_block_number: 110407808,
    amount_usdt: "9.99",
    exchange_rate_etb: "190",
    credited_amount_etb: "1898.10",
    deposit_detected_at: "2026-07-16T23:02:14.552539Z",
    deposit_confirmed_at: "2026-07-16T23:19:26.712314Z",
    deposit_credited_at: "2026-07-17T14:09:57.701646Z",
    bsc_watcher_last_scanned_block: 110698538,
    bsc_watcher_last_updated_at: "2026-07-18T11:23:06.179878Z",
    tron_watcher_last_scanned_block: 0,
    tron_watcher_last_updated_at: "2026-07-10T10:52:56.951011Z",
  });

  const addresses = await db.query(`
    select id::text, address, status
    from public.crypto_deposit_addresses
    order by created_at, id
  `);
  assert.deepEqual(addresses.rows, [
    { id: OLD_ADDRESS_ID, address: OLD_ADDRESS, status: "disabled" },
    { id: TREASURY_ADDRESS_ID, address: TREASURY_ADDRESS, status: "disabled" },
  ]);

  await assertRuntimeObjectsRemoved(db);
  await assertArchivesAreReadOnly(db);
});

test("fails closed when the sweep queue contains an unexpected record", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createCoreFixture(db);
  await seedKnownProductionEvidence(db);
  await db.exec(`
    insert into public.crypto_sweep_jobs (
      crypto_deposit_id, network, from_address, to_treasury_address,
      amount_usdt, status
    ) values (
      '${DEPOSIT_ID}'::uuid, 'BSC', '${OLD_ADDRESS}', '${TREASURY_ADDRESS}',
      9.990000, 'queued'
    );
  `);

  await assert.rejects(
    applySqlInTransaction(db, retirementMigration),
    /native crypto sweep queue is not empty/i,
  );

  const untouched = await db.query(`
    select
      to_regclass('public.crypto_sweep_jobs') is not null as sweep_table_present,
      to_regclass('public.crypto_watcher_state') is not null as watcher_table_present,
      to_regprocedure(
        'public.credit_confirmed_bsc_crypto_deposit(uuid,uuid,text,uuid,text,integer,text,text,text,text,bigint,integer,integer,text,text)'
      ) is not null as credit_rpc_present,
      (select count(*)::integer from public.crypto_sweep_jobs) as sweep_count,
      (
        select status
        from public.crypto_deposit_addresses
        where id = '${TREASURY_ADDRESS_ID}'::uuid
      ) as treasury_status,
      (
        select count(*)::integer
        from public.app_settings
        where key in (
          'crypto_auto_credit_enabled',
          'crypto_bsc_user_deposits_enabled',
          'crypto_bsc_min_usdt',
          'crypto_tron_min_usdt',
          'usdt_etb_rate'
        )
      ) as setting_count
  `);
  assert.deepEqual(untouched.rows, [
    {
      sweep_table_present: true,
      watcher_table_present: true,
      credit_rpc_present: true,
      sweep_count: 1,
      treasury_status: "active",
      setting_count: 5,
    },
  ]);
});

test("fails closed when an unexpected crypto evidence row exists", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createCoreFixture(db);
  await seedKnownProductionEvidence(db);
  await db.query(
    `insert into public.crypto_deposit_addresses (
       user_id, network, asset, address, activation_status, status
     ) values ($1::uuid, 'BSC', 'USDT', $2, 'not_required', 'disabled')`,
    [USER_AND_ADMIN_ID, "0x3333333333333333333333333333333333333333"],
  );

  await assert.rejects(
    applySqlInTransaction(db, retirementMigration),
    /unexpected native crypto evidence row counts/i,
  );

  const untouched = await db.query(`
    select
      count(*)::integer as address_count,
      count(*) filter (where status = 'active')::integer as active_count
    from public.crypto_deposit_addresses
  `);
  assert.deepEqual(untouched.rows, [{ address_count: 3, active_count: 1 }]);
});

test("fails closed when an unknown role can mutate crypto evidence", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createCoreFixture(db);
  await seedKnownProductionEvidence(db);
  await db.exec(`
    create role unexpected_crypto_writer;
    grant update on table public.crypto_deposits to unexpected_crypto_writer;
  `);

  await assert.rejects(
    applySqlInTransaction(db, retirementMigration),
    /unexpected native crypto table grantee exists/i,
  );

  const untouched = await db.query(`
    select
      has_table_privilege(
        'unexpected_crypto_writer',
        'public.crypto_deposits',
        'UPDATE'
      ) as unexpected_write_grant_preserved,
      to_regclass('public.crypto_watcher_state') is not null
        as watcher_table_present,
      (
        select status
        from public.crypto_deposit_addresses
        where id = '${TREASURY_ADDRESS_ID}'::uuid
      ) as treasury_status
  `);
  assert.deepEqual(untouched.rows, [
    {
      unexpected_write_grant_preserved: true,
      watcher_table_present: true,
      treasury_status: "active",
    },
  ]);
});

test("database types retain evidence tables and remove retired runtime objects", async () => {
  const databaseTypes = await readFile(
    new URL("src/lib/database.types.ts", repositoryRoot),
    "utf8",
  );

  assert.match(databaseTypes, /\bcrypto_deposit_addresses:\s*\{/);
  assert.match(databaseTypes, /\bcrypto_deposits:\s*\{/);
  assert.match(databaseTypes, /export type CryptoDepositAddress\b/);
  assert.match(databaseTypes, /export type CryptoDeposit\b/);

  for (const retiredName of [
    "crypto_sweep_jobs",
    "crypto_watcher_state",
    "apply_bsc_crypto_deposit_confirmation",
    "credit_confirmed_bsc_crypto_deposit",
    "rotate_bsc_crypto_deposit_address",
    "CryptoSweepJob",
    "CryptoWatcherState",
  ]) {
    assert.doesNotMatch(databaseTypes, new RegExp(`\\b${retiredName}\\b`));
  }
});

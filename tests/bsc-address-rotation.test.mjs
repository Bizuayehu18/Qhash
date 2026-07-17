import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260717221500_bsc_address_rotation/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const ADMIN_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";
const OLD_ADDRESS_ID = "00000000-0000-4000-8000-000000000010";
const OLD_ADDRESS = "0x1111111111111111111111111111111111111111";
const NEW_ADDRESS = "0x2222222222222222222222222222222222222222";

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

async function createFixture(db, { exposureEnabled = false, watcherFresh = true, depositStatus = "credited" } = {}) {
  await db.exec(`
    create table public.profiles (
      id uuid primary key,
      is_admin boolean not null default false,
      is_frozen boolean not null default false
    );

    create table public.app_settings (
      key text primary key,
      value text not null
    );

    create table public.crypto_watcher_state (
      network text primary key,
      last_scanned_block bigint not null default 0,
      updated_at timestamptz not null default now()
    );

    create table public.crypto_deposit_addresses (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references public.profiles(id),
      network text not null,
      asset text not null default 'USDT',
      address text not null,
      derivation_index bigint,
      activation_status text not null default 'not_required',
      status text not null default 'active',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint crypto_deposit_addresses_user_network_asset_key
        unique (user_id, network, asset)
    );

    create unique index crypto_deposit_addresses_network_asset_address_key
      on public.crypto_deposit_addresses (network, asset, lower(address));

    create table public.crypto_deposits (
      id uuid primary key default gen_random_uuid(),
      address_id uuid references public.crypto_deposit_addresses(id),
      status text not null
    );

    insert into public.profiles (id, is_admin, is_frozen) values
      ('${ADMIN_ID}', true, false),
      ('${USER_ID}', false, false);

    insert into public.app_settings (key, value)
    values ('crypto_bsc_user_deposits_enabled', '${exposureEnabled ? "true" : "false"}');

    insert into public.crypto_watcher_state (network, last_scanned_block, updated_at)
    values ('BSC', 123, ${watcherFresh ? "now()" : "now() - interval '20 minutes'"});

    insert into public.crypto_deposit_addresses (
      id, user_id, network, asset, address, activation_status, status
    ) values (
      '${OLD_ADDRESS_ID}', '${USER_ID}', 'BSC', 'USDT', '${OLD_ADDRESS}', 'not_required', 'active'
    );

    insert into public.crypto_deposits (address_id, status)
    values ('${OLD_ADDRESS_ID}', '${depositStatus}');
  `);
}

async function rotate(db, newAddress = NEW_ADDRESS) {
  const result = await db.query(`
    select public.rotate_bsc_crypto_deposit_address(
      '${USER_ID}'::uuid,
      '${ADMIN_ID}'::uuid,
      '${OLD_ADDRESS_ID}'::uuid,
      '${OLD_ADDRESS}',
      '${newAddress}'
    ) as result
  `);
  return result.rows[0].result;
}

test("replaces the broad uniqueness constraint with one-active-address uniqueness", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createFixture(db);
  await applyMigration(db);
  await applyMigration(db);

  const result = await db.query(`
    select
      to_regclass('public.crypto_deposit_addresses_active_user_network_asset_key') is not null as active_index_exists,
      exists (
        select 1
        from pg_constraint
        where conrelid = 'public.crypto_deposit_addresses'::regclass
          and conname = 'crypto_deposit_addresses_user_network_asset_key'
      ) as old_constraint_exists
  `);

  assert.deepEqual(result.rows, [{ active_index_exists: true, old_constraint_exists: false }]);
});

test("atomically preserves the historical row and activates the replacement", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createFixture(db);
  await applyMigration(db);

  const result = await rotate(db);
  assert.equal(result.success, true);
  assert.equal(result.code, "rotated");
  assert.equal(result.previous_address_id, OLD_ADDRESS_ID);
  assert.equal(result.new_address, NEW_ADDRESS);

  const addresses = await db.query(`
    select id::text, address, status
    from public.crypto_deposit_addresses
    where user_id = '${USER_ID}'::uuid
    order by created_at, address
  `);
  assert.equal(addresses.rows.length, 2);
  assert.deepEqual(
    addresses.rows.map((row) => ({ address: row.address, status: row.status })),
    [
      { address: OLD_ADDRESS, status: "disabled" },
      { address: NEW_ADDRESS, status: "active" },
    ],
  );

  const deposit = await db.query(`select address_id::text from public.crypto_deposits`);
  assert.deepEqual(deposit.rows, [{ address_id: OLD_ADDRESS_ID }]);
});

test("refuses rotation while BSC user exposure is enabled", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createFixture(db, { exposureEnabled: true });
  await applyMigration(db);

  const result = await rotate(db);
  assert.deepEqual(result, { success: false, code: "exposure_must_be_disabled" });

  const current = await db.query(`select address, status from public.crypto_deposit_addresses`);
  assert.deepEqual(current.rows, [{ address: OLD_ADDRESS, status: "active" }]);
});

test("refuses rotation when the watcher is stale or a deposit is unsettled", async (t) => {
  const staleDb = new PGlite();
  t.after(() => staleDb.close());
  await createFixture(staleDb, { watcherFresh: false });
  await applyMigration(staleDb);
  assert.deepEqual(await rotate(staleDb), { success: false, code: "watcher_stale" });

  const unsettledDb = new PGlite();
  t.after(() => unsettledDb.close());
  await createFixture(unsettledDb, { depositStatus: "confirmed" });
  await applyMigration(unsettledDb);
  assert.deepEqual(await rotate(unsettledDb), { success: false, code: "unsettled_deposits" });
});

test("rolls back the disable when the replacement address conflicts", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createFixture(db);
  await applyMigration(db);
  await db.exec(`
    insert into public.crypto_deposit_addresses (
      user_id, network, asset, address, activation_status, status
    ) values (
      '${ADMIN_ID}', 'BSC', 'USDT', '${NEW_ADDRESS}', 'not_required', 'disabled'
    );
  `);

  assert.deepEqual(await rotate(db), { success: false, code: "address_conflict" });

  const current = await db.query(`
    select address, status
    from public.crypto_deposit_addresses
    where id = '${OLD_ADDRESS_ID}'::uuid
  `);
  assert.deepEqual(current.rows, [{ address: OLD_ADDRESS, status: "active" }]);
});

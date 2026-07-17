import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { isUserCryptoDepositNetworkEnabled } from "../src/lib/crypto-deposit-availability.ts";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260717170000_bsc_user_deposit_exposure/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

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
    create table public.app_settings (
      key text primary key,
      value text not null,
      updated_at timestamptz not null default now()
    );
  `);
}

test("adds the BSC user-deposit setting disabled by default", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createFixture(db);
  await applyMigration(db);

  const result = await db.query(`
    select value
    from public.app_settings
    where key = 'crypto_bsc_user_deposits_enabled'
  `);
  assert.deepEqual(result.rows, [{ value: "false" }]);
});

test("is idempotent and preserves an explicit admin choice", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createFixture(db);
  await db.exec(`
    insert into public.app_settings (key, value)
    values ('crypto_bsc_user_deposits_enabled', 'true');
  `);

  await applyMigration(db);
  await applyMigration(db);

  const result = await db.query(`
    select value
    from public.app_settings
    where key = 'crypto_bsc_user_deposits_enabled'
  `);
  assert.deepEqual(result.rows, [{ value: "true" }]);
});

for (const invalidValue of ["yes", " TRUE ", "FALSE"]) {
  test(`fails closed for non-canonical boolean value ${JSON.stringify(invalidValue)}`, async (t) => {
    const db = new PGlite();
    t.after(() => db.close());

    await createFixture(db);
    await db.query(
      `insert into public.app_settings (key, value) values ($1, $2)`,
      ["crypto_bsc_user_deposits_enabled", invalidValue],
    );

    await assert.rejects(
      applyMigration(db),
      /crypto_bsc_user_deposits_enabled has an invalid value/,
    );
  });
}

test("enables only BSC and never enables TRON through the BSC switch", () => {
  assert.equal(isUserCryptoDepositNetworkEnabled("BSC", false), false);
  assert.equal(isUserCryptoDepositNetworkEnabled("BSC", true), true);
  assert.equal(isUserCryptoDepositNetworkEnabled("TRON", false), false);
  assert.equal(isUserCryptoDepositNetworkEnabled("TRON", true), false);
});

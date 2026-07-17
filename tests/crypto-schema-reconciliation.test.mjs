import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260717150000_crypto_schema_reconciliation/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

const applyMigration = async (db) => {
  await db.exec("begin");
  try {
    await db.exec(migration);
    await db.exec("commit");
  } catch (error) {
    await db.exec("rollback");
    throw error;
  }
};

const createFixture = async (db, { addConstraint = true } = {}) => {
  await db.exec(`
    create table public.transactions (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null,
      reference_id uuid
    );

    create table public.crypto_deposits (
      id uuid primary key default gen_random_uuid(),
      status text not null,
      credited_transaction_id uuid,
      credited_by_admin_id uuid
    );
  `);

  if (addConstraint) {
    await db.exec(`
      alter table public.crypto_deposits
        add constraint crypto_deposits_credit_audit_fields_check
        check (
          status <> 'credited'
          or (credited_transaction_id is not null and credited_by_admin_id is not null)
        ) not valid;
    `);
  }
};

test("validates the crypto audit constraint and restores the reference lookup index", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createFixture(db);
  await db.exec(`
    insert into public.crypto_deposits (
      status,
      credited_transaction_id,
      credited_by_admin_id
    ) values
      ('confirmed', null, null),
      ('credited', gen_random_uuid(), gen_random_uuid());
  `);

  await applyMigration(db);
  await applyMigration(db);

  const constraint = await db.query(`
    select convalidated
    from pg_constraint
    where conname = 'crypto_deposits_credit_audit_fields_check'
      and conrelid = 'public.crypto_deposits'::regclass
  `);
  assert.deepEqual(constraint.rows, [{ convalidated: true }]);

  const index = await db.query(`
    select
      index_info.indisunique,
      index_info.indisvalid,
      index_info.indisready,
      pg_get_expr(index_info.indpred, index_info.indrelid) as predicate,
      array(
        select attribute_info.attname
        from unnest(index_info.indkey) with ordinality as index_key(attnum, position)
        join pg_attribute as attribute_info
          on attribute_info.attrelid = index_info.indrelid
         and attribute_info.attnum = index_key.attnum
        order by index_key.position
      ) as columns
    from pg_class as index_class
    join pg_namespace as index_namespace
      on index_namespace.oid = index_class.relnamespace
    join pg_index as index_info
      on index_info.indexrelid = index_class.oid
    where index_namespace.nspname = 'public'
      and index_class.relname = 'idx_transactions_reference'
  `);
  assert.equal(index.rows.length, 1);
  assert.equal(index.rows[0].indisunique, false);
  assert.equal(index.rows[0].indisvalid, true);
  assert.equal(index.rows[0].indisready, true);
  assert.deepEqual(index.rows[0].columns, ["reference_id"]);
  assert.match(index.rows[0].predicate, /reference_id IS NOT NULL/i);
});

test("accepts the correct historical reference index without replacing it", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createFixture(db);
  await db.exec(`
    create index idx_transactions_reference
      on public.transactions (reference_id)
      where reference_id is not null;
  `);

  const before = await db.query(`
    select index_class.oid::text as oid
    from pg_class as index_class
    join pg_namespace as index_namespace
      on index_namespace.oid = index_class.relnamespace
    where index_namespace.nspname = 'public'
      and index_class.relname = 'idx_transactions_reference'
  `);

  await applyMigration(db);

  const after = await db.query(`
    select index_class.oid::text as oid
    from pg_class as index_class
    join pg_namespace as index_namespace
      on index_namespace.oid = index_class.relnamespace
    where index_namespace.nspname = 'public'
      and index_class.relname = 'idx_transactions_reference'
  `);
  assert.deepEqual(after.rows, before.rows);
});

test("fails closed when the historical index name has a different definition", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createFixture(db);
  await db.exec(`
    create index idx_transactions_reference
      on public.transactions (user_id);
  `);

  await assert.rejects(
    applyMigration(db),
    /idx_transactions_reference has an unexpected definition/,
  );

  const constraint = await db.query(`
    select convalidated
    from pg_constraint
    where conname = 'crypto_deposits_credit_audit_fields_check'
      and conrelid = 'public.crypto_deposits'::regclass
  `);
  assert.deepEqual(constraint.rows, [{ convalidated: false }]);
});

test("refuses to validate a historical credited row without audit metadata", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await createFixture(db, { addConstraint: false });
  await db.exec(`
    insert into public.crypto_deposits (
      status,
      credited_transaction_id,
      credited_by_admin_id
    ) values ('credited', null, null);

    alter table public.crypto_deposits
      add constraint crypto_deposits_credit_audit_fields_check
      check (
        status <> 'credited'
        or (credited_transaction_id is not null and credited_by_admin_id is not null)
      ) not valid;
  `);

  await assert.rejects(
    applyMigration(db),
    /crypto_deposits_credit_audit_fields_check/,
  );

  const state = await db.query(`
    select
      (select convalidated
       from pg_constraint
       where conname = 'crypto_deposits_credit_audit_fields_check'
         and conrelid = 'public.crypto_deposits'::regclass) as convalidated,
      to_regclass('public.idx_transactions_reference') is not null as index_created
  `);
  assert.deepEqual(state.rows, [{ convalidated: false, index_created: false }]);
});

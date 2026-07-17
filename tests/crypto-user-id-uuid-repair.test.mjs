import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = async (name) => readFile(
  new URL(`../supabase/migrations/${name}/migration.sql`, import.meta.url),
  "utf8",
);

const USER_ID = "bd44f308-0000-4000-8000-000078969a9c";
const ADMIN_ID = "aa11aa11-0000-4000-8000-000000000001";
const ADDRESS_ID = "9cf3da8f-0000-4000-8000-00004bbb1785";
const DEPOSIT_ID = "fcd260e7-970b-44a1-9089-d5a37a88d93d";
const SECOND_DEPOSIT_ID = "fcd260e7-970b-44a1-9089-d5a37a88d93e";
const TX_HASH = `0x${"76".repeat(32)}`;
const SECOND_TX_HASH = `0x${"77".repeat(32)}`;
const FROM_ADDRESS = `0x${"89".repeat(20)}`;
const TO_ADDRESS = `0x${"1f".repeat(20)}`;
const AMOUNT_RAW = "9990000000000000000";

const creditParams = [
  DEPOSIT_ID,
  ADMIN_ID,
  USER_ID,
  ADDRESS_ID,
  TX_HASH,
  115,
  FROM_ADDRESS,
  TO_ADDRESS,
  AMOUNT_RAW,
  "9.990000",
  110407808,
  2354,
  2356,
  "190.000000",
  "1898.10",
];

const callCredit = (db) => db.query(
  `select public.credit_confirmed_bsc_crypto_deposit(
    $1::uuid, $2::uuid, $3::text, $4::uuid, $5::text,
    $6::integer, $7::text, $8::text, $9::text, $10::text,
    $11::bigint, $12::integer, $13::integer, $14::text, $15::text
  ) as result`,
  creditParams,
);

test("refuses to convert an orphaned crypto user ID", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await db.exec(`
    create table public.profiles (id uuid primary key);
    create table public.crypto_deposit_addresses (
      id uuid primary key default gen_random_uuid(),
      user_id text not null
    );
    create table public.crypto_deposits (
      id uuid primary key default gen_random_uuid(),
      user_id text not null,
      address_id uuid references public.crypto_deposit_addresses(id)
    );
    insert into public.crypto_deposit_addresses (user_id)
    values ('00000000-0000-4000-8000-000000000099');
  `);

  await assert.rejects(
    db.exec(await migration("20260717030000_crypto_user_id_uuid_repair")),
    /crypto_deposit_addresses\.user_id contains an unknown profile ID/,
  );

  const columnType = await db.query(`
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'crypto_deposit_addresses'
      and column_name = 'user_id'
  `);
  assert.equal(columnType.rows[0].data_type, "text");
});

test("repairs crypto user IDs and credits a confirmed BSC deposit exactly once", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());

  await db.exec(`
    create type public.transaction_type as enum (
      'deposit', 'withdrawal', 'plan_purchase', 'earning', 'admin_adjustment'
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
  `);

  for (const name of [
    "20260710120000_crypto_deposit_foundation",
    "20260716160000_bsc_confirmation_writer",
    "20260716185000_crypto_manual_crediting_uuid_preflight",
    "20260716190000_crypto_manual_crediting",
  ]) {
    await db.exec(await migration(name));
  }

  await db.query(
    `insert into public.profiles (id, is_admin, is_frozen)
     values ($1::uuid, false, false), ($2::uuid, true, false)`,
    [USER_ID, ADMIN_ID],
  );
  await db.query(
    "insert into public.wallets (user_id, balance) values ($1::uuid, 0)",
    [USER_ID],
  );
  await db.query(
    "update public.app_settings set value = '190' where key = 'usdt_etb_rate'",
  );
  await db.query(
    `insert into public.crypto_deposit_addresses (
      id, user_id, network, asset, address, activation_status, status
    ) values ($1::uuid, $2::text, 'BSC', 'USDT', $3::text, 'not_required', 'active')`,
    [ADDRESS_ID, USER_ID, TO_ADDRESS],
  );
  await db.query(
    `insert into public.crypto_deposits (
      id, user_id, address_id, network, asset, tx_hash, event_index,
      from_address, to_address, amount_raw, amount_usdt, block_number,
      confirmations, status, confirmed_at
    ) values (
      $1::uuid, $2::text, $3::uuid, 'BSC', 'USDT', $4::text, 115,
      $5::text, $6::text, $7::numeric, 9.990000, 110407808,
      2354, 'confirmed', now()
    )`,
    [DEPOSIT_ID, USER_ID, ADDRESS_ID, TX_HASH, FROM_ADDRESS, TO_ADDRESS, AMOUNT_RAW],
  );

  await assert.rejects(
    callCredit(db),
    /(operator does not exist: uuid = text|column "user_id" is of type uuid but expression is of type text)/,
    "the pre-repair function should reproduce the production UUID/text failure",
  );

  const beforeRepair = await db.query(`
    select
      (select balance::text from public.wallets where user_id = '${USER_ID}'::uuid) as balance,
      (select count(*)::integer from public.transactions) as transaction_count,
      (select status from public.crypto_deposits where id = '${DEPOSIT_ID}'::uuid) as status
  `);
  assert.deepEqual(beforeRepair.rows[0], {
    balance: "0.00",
    transaction_count: 0,
    status: "confirmed",
  });

  await db.exec(await migration("20260717030000_crypto_user_id_uuid_repair"));

  const columnTypes = await db.query(`
    select table_name, data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('crypto_deposit_addresses', 'crypto_deposits')
      and column_name = 'user_id'
    order by table_name
  `);
  assert.deepEqual(columnTypes.rows, [
    { table_name: "crypto_deposit_addresses", data_type: "uuid" },
    { table_name: "crypto_deposits", data_type: "uuid" },
  ]);

  const foreignKeys = await db.query(`
    select conname
    from pg_constraint
    where conname in (
      'crypto_deposit_addresses_user_id_fkey',
      'crypto_deposits_user_id_fkey'
    )
    order by conname
  `);
  assert.deepEqual(foreignKeys.rows, [
    { conname: "crypto_deposit_addresses_user_id_fkey" },
    { conname: "crypto_deposits_user_id_fkey" },
  ]);

  await assert.rejects(
    callCredit(db),
    /operator does not exist: uuid = text/,
    "the user-ID repair alone should reproduce the remaining production ledger-reference mismatch",
  );

  const beforeReferenceRepair = await db.query(`
    select
      (select balance::text from public.wallets where user_id = '${USER_ID}'::uuid) as balance,
      (select count(*)::integer from public.transactions) as transaction_count,
      (select status from public.crypto_deposits where id = '${DEPOSIT_ID}'::uuid) as status
  `);
  assert.deepEqual(beforeReferenceRepair.rows[0], {
    balance: "0.00",
    transaction_count: 0,
    status: "confirmed",
  });

  await db.exec(await migration("20260717130000_crypto_reference_id_uuid_repair"));

  await db.query(
    `insert into public.crypto_deposits (
      id, user_id, address_id, network, asset, tx_hash, event_index,
      from_address, to_address, amount_raw, amount_usdt, block_number,
      confirmations, status
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'BSC', 'USDT', $4::text, 116,
      $5::text, $6::text, $7::numeric, 9.990000, 110407809,
      0, 'detected'
    )`,
    [SECOND_DEPOSIT_ID, USER_ID, ADDRESS_ID, SECOND_TX_HASH, FROM_ADDRESS, TO_ADDRESS, AMOUNT_RAW],
  );
  const confirmation = await db.query(
    `select public.apply_bsc_crypto_deposit_confirmation(
      $1::uuid, $2::text, $3::uuid, $4::text, 116,
      $5::text, $6::text, $7::text, '9.990000', 110407809,
      0, 20, 20
    ) as result`,
    [SECOND_DEPOSIT_ID, USER_ID, ADDRESS_ID, SECOND_TX_HASH, FROM_ADDRESS, TO_ADDRESS, AMOUNT_RAW],
  );
  assert.equal(confirmation.rows[0].result.success, true);
  assert.equal(confirmation.rows[0].result.code, "confirmed");

  const credited = await callCredit(db);
  assert.equal(credited.rows[0].result.success, true);
  assert.equal(credited.rows[0].result.code, "credited");
  assert.equal(credited.rows[0].result.credited_amount_etb, "1898.10");
  assert.equal(credited.rows[0].result.balance_before, "0.00");
  assert.equal(credited.rows[0].result.balance_after, "1898.10");

  const retried = await callCredit(db);
  assert.equal(retried.rows[0].result.success, true);
  assert.equal(retried.rows[0].result.code, "already_credited");
  assert.equal(retried.rows[0].result.transaction_id, credited.rows[0].result.transaction_id);

  const finalState = await db.query(`
    select
      wallet.balance::text,
      deposit.status,
      deposit.exchange_rate_etb::text,
      deposit.credited_amount_etb::text,
      deposit.credited_by_admin_id::text,
      deposit.credited_transaction_id::text,
      (select count(*)::integer from public.transactions) as transaction_count
    from public.crypto_deposits as deposit
    join public.wallets as wallet on wallet.user_id = deposit.user_id
    where deposit.id = '${DEPOSIT_ID}'::uuid
  `);
  assert.deepEqual(finalState.rows[0], {
    balance: "1898.10",
    status: "credited",
    exchange_rate_etb: "190.000000",
    credited_amount_etb: "1898.10",
    credited_by_admin_id: ADMIN_ID,
    credited_transaction_id: credited.rows[0].result.transaction_id,
    transaction_count: 1,
  });

  await assert.rejects(
    db.query(
      `insert into public.crypto_deposit_addresses (
        user_id, network, asset, address, activation_status, status
      ) values ($1::uuid, 'BSC', 'USDT', $2::text, 'not_required', 'active')`,
      ["00000000-0000-4000-8000-000000000099", `0x${"2f".repeat(20)}`],
    ),
    /foreign key constraint/,
  );
});

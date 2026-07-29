import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_DEPOSIT_STATUS_CATALOG,
  EXPECTED_GUARD_SOURCE_MD5,
  EXPECTED_INHERITED_MD5,
  EXPECTED_POLICY_DEPENDENCY_MD5,
  OTHER_USER_ID,
  PAUSED_ERROR,
  PAYMENT_METHOD_ID,
  PREFLIGHT_ERROR,
  USER_ID,
  applyMigration,
  bounded,
  createLiveBaseline,
  inheritedDependencyCatalog,
  internalTriggerDriftCases,
  disposablePostgresUrl,
  guardCatalog,
  insertDeposit,
  installMutationSentinel,
  migration,
  operationalState,
  removeMutationSentinel,
  serverSource,
  waitForBlocker,
} from "./helpers/fiat-deposit-global-pause-fixture.mjs";

test("fiat deposit pause repair is runner-compatible and checks availability before provider work", () => {
  assert.doesNotMatch(migration, /^\s*(?:begin|commit|rollback)\s*;/im);
  assert.match(migration, new RegExp(EXPECTED_INHERITED_MD5, "g"));
  assert.equal(
    migration.match(new RegExp(EXPECTED_INHERITED_MD5, "g"))?.length,
    2,
  );
  assert.equal(
    migration.match(new RegExp(EXPECTED_POLICY_DEPENDENCY_MD5, "g"))
      ?.length,
    2,
  );
  assert.equal(
    migration.match(/\bpolicy_dependency_function_rows\s+as\s*\(/gi)
      ?.length,
    2,
  );
  assert.equal(
    migration.match(/\bpolicy_dependency_binding_rows\s+as\s*\(/gi)
      ?.length,
    2,
  );
  assert.equal(
    migration.match(/\bdeposit_status_enum\s+as\s*\(/gi)?.length,
    2,
  );
  for (const label of EXPECTED_DEPOSIT_STATUS_CATALOG.at(-1)) {
    assert.match(migration, new RegExp(`"${label[0]}"`, "g"));
  }
  assert.match(migration, new RegExp(EXPECTED_GUARD_SOURCE_MD5, "i"));
  assert.equal(
    migration.match(/\binternal_trigger_rows\s+as\s*\(/gi)?.length,
    2,
  );

  const appSettingsLock = migration.search(
    /lock\s+table\s+public\.app_settings\s+in\s+access\s+exclusive\s+mode/i,
  );
  const depositsLock = migration.search(
    /lock\s+table\s+public\.deposits\s+in\s+access\s+exclusive\s+mode/i,
  );
  const preflight = migration.indexOf("do $preflight$");
  const firstMutation = migration.search(
    /\bcreate\s+function\s+public\.enforce_fiat_deposits_open/i,
  );
  assert.ok(appSettingsLock >= 0 && appSettingsLock < preflight);
  assert.ok(depositsLock >= 0 && depositsLock < preflight);
  assert.ok(preflight >= 0 && preflight < firstMutation);
  assert.match(
    migration.slice(0, firstMutation),
    /trigger_row\.tgisinternal[\s\S]*?trigger_row\.tgenabled/i,
  );

  const submitStart = serverSource.indexOf("export const submitDepositFn");
  const submitEnd = serverSource.indexOf(
    "export const getUserDepositsFn",
    submitStart,
  );
  const submitSource = serverSource.slice(submitStart, submitEnd);
  const authCheck = submitSource.indexOf("admin.auth.getUser");
  const profileCheck = submitSource.indexOf('.from("profiles")');
  const pauseCheck = submitSource.indexOf(
    "requireFiatDepositAdmission(admin)",
  );
  const startLog = submitSource.indexOf('log("deposit_submit_started"');
  const methodLookup = submitSource.indexOf('.from("payment_methods")');
  const depositInsert = submitSource.indexOf('.from("deposits")\n      .insert');
  assert.ok(submitStart >= 0 && submitEnd > submitStart);
  assert.ok(authCheck >= 0 && authCheck < profileCheck);
  assert.ok(profileCheck < pauseCheck);
  assert.ok(pauseCheck < startLog);
  assert.ok(startLog < methodLookup);
  assert.ok(methodLookup < depositInsert);
  assert.doesNotMatch(serverSource, /\.from\("app_settings"\)/);
});

test("native PostgreSQL enforces the shared fiat pause and exact live catalog", {
  timeout: 240_000,
}, async (t) => {
  const connectionString = disposablePostgresUrl(t);
  if (!connectionString) return;

  const { default: pg } = await import("pg");
  const { Client } = pg;
  const client = new Client({
    connectionString,
    application_name: "qhash-fiat-deposit-pause",
  });
  await client.connect();
  t.after(async () => {
    await removeMutationSentinel(client).catch(() => {});
    await client.query("rollback").catch(() => {});
    await client.end();
  });

  await t.test("valid live-shaped catalog migrates with a restricted guard", async () => {
    await createLiveBaseline(client);
    const inheritedCatalog = await inheritedDependencyCatalog(client);
    assert.deepEqual(
      inheritedCatalog.deposit_status,
      EXPECTED_DEPOSIT_STATUS_CATALOG,
    );
    assert.deepEqual(inheritedCatalog.bindings, [
      ["deposits_insert_own", "n", "auth", "uid", ""],
      ["deposits_select_admin", "n", "public", "is_admin", ""],
      ["deposits_select_own", "n", "auth", "uid", ""],
      ["deposits_update_admin", "n", "public", "is_admin", ""],
    ]);
    assert.deepEqual(
      inheritedCatalog.functions.map((row) => [
        row[0],
        row[1],
        row[2],
        row[3],
        row[13],
        row[17],
        row[21],
        row[22],
        row[24],
      ]),
      [
        [
          "auth",
          "uid",
          "supabase_auth_admin",
          "sql",
          false,
          null,
          "uuid",
          "cdef18c69c4f4cbbced2eaf81e628b49",
          [
            ["PUBLIC", "supabase_auth_admin", "EXECUTE", false],
            ["dashboard_user", "supabase_auth_admin", "EXECUTE", false],
            [
              "supabase_auth_admin",
              "supabase_auth_admin",
              "EXECUTE",
              false,
            ],
          ],
        ],
        [
          "public",
          "is_admin",
          "postgres",
          "plpgsql",
          true,
          null,
          "boolean",
          "6fcf8577055da6cc6ab48cf9ebb61954",
          [
            ["PUBLIC", "postgres", "EXECUTE", false],
            ["anon", "postgres", "EXECUTE", false],
            ["authenticated", "postgres", "EXECUTE", false],
            ["postgres", "postgres", "EXECUTE", false],
            ["service_role", "postgres", "EXECUTE", false],
          ],
        ],
      ],
    );
    await applyMigration(client);

    const catalog = await guardCatalog(client);
    assert.deepEqual(catalog, {
      owner: "postgres",
      language: "plpgsql",
      security_definer: true,
      volatility: "v",
      strict: false,
      parallel: "u",
      config: ["search_path=pg_catalog, public"],
      identity_arguments: "",
      result_type: "trigger",
      source_md5: EXPECTED_GUARD_SOURCE_MD5,
      acl: [["postgres", "postgres", "EXECUTE", false]],
      anon_execute: false,
      authenticated_execute: false,
      service_role_execute: false,
      postgres_execute: true,
    });

    const trigger = (await client.query(`
      select
        trigger_row.tgenabled,
        trigger_row.tgtype,
        trigger_row.tgisinternal,
        function_row.oid::regprocedure::text as function_identity
      from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_proc function_row
        on function_row.oid = trigger_row.tgfoid
      where trigger_row.tgrelid = 'public.deposits'::regclass
        and trigger_row.tgname = 'trg_deposits_require_open'
    `)).rows;
    assert.deepEqual(trigger, [{
      tgenabled: "O",
      tgtype: 7,
      tgisinternal: false,
      function_identity: "enforce_fiat_deposits_open()",
    }]);
  });

  await t.test("unpaused service-role and authenticated inserts succeed", async () => {
    await createLiveBaseline(client);
    await applyMigration(client);
    await insertDeposit(client, {
      role: "service_role",
      reference: "FT-UNPAUSED-SERVICE",
    });
    await insertDeposit(client, {
      role: "authenticated",
      userId: OTHER_USER_ID,
      reference: "D-UNPAUSED-AUTHENTICATED",
      amount: "3000.00",
    });
    assert.deepEqual(
      (await client.query(`
        select transaction_reference, user_id::text
        from public.deposits
        order by transaction_reference
      `)).rows,
      [
        {
          transaction_reference: "D-UNPAUSED-AUTHENTICATED",
          user_id: OTHER_USER_ID,
        },
        {
          transaction_reference: "FT-UNPAUSED-SERVICE",
          user_id: USER_ID,
        },
      ],
    );
  });

  for (const fixture of [
    {
      name: "paused",
      prepare: async () => createLiveBaseline(client, "true"),
    },
    {
      name: "missing setting",
      prepare: async () => {
        await createLiveBaseline(client);
        await applyMigration(client);
        await client.query(
          "delete from public.app_settings where key = 'deposits_paused'",
        );
      },
      alreadyMigrated: true,
    },
    {
      name: "malformed setting",
      prepare: async () => {
        await createLiveBaseline(client);
        await applyMigration(client);
        await client.query(`
          update public.app_settings
          set value = 'FALSE'
          where key = 'deposits_paused'
        `);
      },
      alreadyMigrated: true,
    },
  ]) {
    await t.test(`${fixture.name} fails closed without financial mutation`, async () => {
      await fixture.prepare();
      if (!fixture.alreadyMigrated) await applyMigration(client);
      const before = await operationalState(client);
      await assert.rejects(
        insertDeposit(client, {
          reference: `FT-${fixture.name.toUpperCase().replaceAll(" ", "-")}`,
        }),
        (error) => error?.code === "P0001" && PAUSED_ERROR.test(error.message),
      );
      const after = await operationalState(client);
      assert.equal(after.deposits, before.deposits);
      assert.equal(after.verification_logs, before.verification_logs);
      assert.equal(after.guard_exists, true);
      assert.equal(after.pause_trigger_exists, true);
    });
  }

  await t.test(
    "missing or malformed deposits_paused rejects before any migration DDL",
    async (configurationTest) => {
      for (const fixture of [
        {
          name: "missing setting",
          mutate: `
            delete from public.app_settings
            where key = 'deposits_paused'
          `,
        },
        {
          name: "malformed setting",
          mutate: `
            update public.app_settings
            set value = 'FALSE'
            where key = 'deposits_paused'
          `,
        },
      ]) {
        await configurationTest.test(fixture.name, async () => {
          await createLiveBaseline(client);
          await client.query(fixture.mutate);
          const before = await operationalState(client);
          await installMutationSentinel(client);
          await assert.rejects(applyMigration(client), (error) => {
            assert.match(
              error.message,
              /unexpected deposits_paused configuration/,
            );
            assert.doesNotMatch(
              error.message,
              /fiat_pause_mutation_reached/,
            );
            return true;
          });
          const after = await operationalState(client);
          assert.deepEqual(after, before);
          assert.equal(after.guard_exists, false);
          assert.equal(after.pause_trigger_exists, false);
          await removeMutationSentinel(client);
        });
      }
    },
  );

  await t.test("catalog drift rejects before any migration DDL", async (driftTest) => {
    await createLiveBaseline(client);
    await installMutationSentinel(client);
    await assert.rejects(
      client.query(`
        create function public.fiat_pause_sentinel_probe()
        returns integer language sql as 'select 1'
      `),
      /fiat_pause_mutation_reached/,
    );
    assert.equal(
      (await client.query(
        "select to_regprocedure('public.fiat_pause_sentinel_probe()') is null as absent",
      )).rows[0].absent,
      true,
    );
    await removeMutationSentinel(client);

    const driftCases = [
      {
        name: "is_admin implementation",
        mutate: `
          create or replace function public.is_admin()
          returns boolean
          language plpgsql
          security definer
          stable
          as $admin$
          begin
            return true;
          end;
          $admin$
        `,
      },
      {
        name: "auth uid implementation",
        mutate: `
          create or replace function auth.uid()
          returns uuid
          language sql
          stable
          as $uid$
            select null::uuid
          $uid$
        `,
      },
      {
        name: "is_admin security mode",
        mutate: "alter function public.is_admin() security invoker",
      },
      {
        name: "is_admin owner",
        mutate: "alter function public.is_admin() owner to service_role",
      },
      {
        name: "auth uid security mode",
        mutate: "alter function auth.uid() security definer",
      },
      {
        name: "is_admin search path",
        mutate: `
          alter function public.is_admin()
          set search_path = pg_catalog, public
        `,
      },
      {
        name: "is_admin ACL grant option",
        mutate: `
          grant execute on function public.is_admin()
          to authenticated with grant option
        `,
      },
      {
        name: "auth uid ACL",
        mutate: `
          set role supabase_auth_admin;
          grant execute on function auth.uid()
          to anon with grant option;
          reset role;
          set role postgres
        `,
      },
      {
        name: "unexpected is_admin overload",
        mutate: `
          create function public.is_admin(check_admin boolean)
          returns boolean
          language sql
          stable
          as $admin$
            select check_admin
          $admin$
        `,
      },
      {
        name: "deposit status extra label",
        mutate: `
          alter type public.deposit_status
          add value 'quarantined' after 'pending'
        `,
      },
      {
        name: "deposit status label identity",
        mutate: `
          alter type public.deposit_status
          rename value 'rejected' to 'denied'
        `,
      },
      {
        name: "deposit status owner",
        mutate: "alter type public.deposit_status owner to service_role",
      },
      {
        name: "deposit status ACL",
        mutate: `
          grant usage on type public.deposit_status
          to authenticated with grant option
        `,
      },
      {
        name: "deposit status default ACL representation",
        mutate: "revoke usage on type public.deposit_status from public",
      },
      {
        name: "deposits ACL grant option",
        mutate: `
          grant select on table public.deposits
          to authenticated with grant option
        `,
      },
      {
        name: "deposit policy",
        mutate: `
          alter policy deposits_insert_own on public.deposits
          with check (true)
        `,
      },
      {
        name: "authored trigger disabled",
        mutate: `
          alter table public.deposits
          disable trigger trg_deposits_updated_at
        `,
      },
      {
        name: "same-name authored trigger on app_settings",
        mutate: `
          create trigger trg_deposits_require_open
          before update on public.app_settings
          for each row
          execute function public.update_updated_at_column()
        `,
      },
      {
        name: "unexpected index",
        mutate: `
          create index idx_deposits_amount_drift
          on public.deposits(amount)
        `,
      },
      ...internalTriggerDriftCases(client),
      {
        name: "referenced index rebound from profiles primary key",
        mutate: async () => {
          await client.query(`
            alter table public.profiles
              add constraint profiles_id_alt_key unique (id);
            alter table public.deposits
              drop constraint deposits_user_id_fkey;
            alter table public.profiles
              drop constraint profiles_pkey;
            alter table public.deposits
              add constraint deposits_user_id_fkey
              foreign key (user_id)
              references public.profiles(id)
              on delete cascade;
            alter table public.profiles
              add constraint profiles_pkey primary key (id)
          `);
          const referencedIndex = (await client.query(`
            select
              index_class.relname as index_name,
              index_row.indisprimary
            from pg_catalog.pg_constraint constraint_row
            join pg_catalog.pg_class index_class
              on index_class.oid = constraint_row.conindid
            join pg_catalog.pg_index index_row
              on index_row.indexrelid = constraint_row.conindid
            where constraint_row.conrelid = 'public.deposits'::regclass
              and constraint_row.conname = 'deposits_user_id_fkey'
          `)).rows[0];
          assert.deepEqual(referencedIndex, {
            index_name: "profiles_id_alt_key",
            indisprimary: false,
          });
        },
      },
      {
        name: "public schema owner",
        mutate: "alter schema public owner to postgres",
      },
      {
        name: "public schema ACL grant option",
        mutate: `
          grant usage on schema public
          to authenticated with grant option
        `,
      },
    ];

    for (const drift of driftCases) {
      await driftTest.test(drift.name, async () => {
        await createLiveBaseline(client);
        if (typeof drift.mutate === "function") {
          await drift.mutate();
        } else {
          await client.query(drift.mutate);
        }
        const before = await operationalState(client);
        const catalogBefore = await inheritedDependencyCatalog(client);
        await installMutationSentinel(client);
        await assert.rejects(applyMigration(client), (error) => {
          assert.match(error.message, PREFLIGHT_ERROR);
          assert.doesNotMatch(error.message, /fiat_pause_mutation_reached/);
          return true;
        });
        const after = await operationalState(client);
        const catalogAfter = await inheritedDependencyCatalog(client);
        assert.deepEqual(after, before);
        assert.deepEqual(catalogAfter, catalogBefore);
        assert.equal(after.guard_exists, false);
        assert.equal(after.pause_trigger_exists, false);
        await removeMutationSentinel(client);
      });
    }
  });
});

test("native PostgreSQL serializes pause changes against fiat deposit admission", {
  timeout: 90_000,
}, async (t) => {
  const connectionString = disposablePostgresUrl(t);
  if (!connectionString) return;

  const { default: pg } = await import("pg");
  const { Client } = pg;
  const observer = new Client({
    connectionString,
    application_name: "qhash-fiat-pause-observer",
  });
  const pauseClient = new Client({
    connectionString,
    application_name: "qhash-fiat-pause-writer",
  });
  const insertClient = new Client({
    connectionString,
    application_name: "qhash-fiat-pause-insert",
  });
  await Promise.all([
    observer.connect(),
    pauseClient.connect(),
    insertClient.connect(),
  ]);
  t.after(async () => {
    await Promise.allSettled([
      observer.query("rollback"),
      pauseClient.query("rollback"),
      insertClient.query("rollback"),
    ]);
    await Promise.allSettled([
      observer.end(),
      pauseClient.end(),
      insertClient.end(),
    ]);
  });

  const [observerPid, pausePid, insertPid] = await Promise.all(
    [observer, pauseClient, insertClient].map(async (client) => (
      await client.query("select pg_backend_pid()::integer as pid")
    ).rows[0].pid),
  );
  assert.equal(new Set([observerPid, pausePid, insertPid]).size, 3);

  await t.test("pause-first makes the waiting insert fail closed", async () => {
    await createLiveBaseline(observer);
    await applyMigration(observer);

    await pauseClient.query("begin");
    await pauseClient.query("set local role service_role");
    await pauseClient.query(`
      update public.app_settings
      set value = 'true'
      where key = 'deposits_paused'
    `);

    await insertClient.query("begin");
    await insertClient.query("set local role service_role");
    const insertPromise = insertClient.query(
      `insert into public.deposits (
         user_id,
         payment_method_id,
         amount,
         transaction_reference
       ) values ($1::uuid, $2::uuid, 2000, 'FT-PAUSE-FIRST')`,
      [USER_ID, PAYMENT_METHOD_ID],
    );
    await waitForBlocker(observer, insertPid, pausePid);
    assert.equal(
      (await observer.query(
        "select count(*)::integer as count from public.deposits",
      )).rows[0].count,
      0,
    );

    await pauseClient.query("commit");
    await assert.rejects(
      bounded(insertPromise, 4_000, "pause-first insert"),
      PAUSED_ERROR,
    );
    await insertClient.query("rollback");
    assert.deepEqual(await operationalState(observer), {
      deposits: 0,
      verification_logs: 0,
      pause_value: "true",
      guard_exists: true,
      pause_trigger_exists: true,
    });
  });

  await t.test("insert-first admits the row before the pause commits", async () => {
    await createLiveBaseline(observer);
    await applyMigration(observer);

    await insertClient.query("begin");
    await insertClient.query("set local role service_role");
    await insertClient.query(
      `insert into public.deposits (
         user_id,
         payment_method_id,
         amount,
         transaction_reference
       ) values ($1::uuid, $2::uuid, 2000, 'D-INSERT-FIRST')`,
      [USER_ID, PAYMENT_METHOD_ID],
    );

    await pauseClient.query("begin");
    await pauseClient.query("set local role service_role");
    const pausePromise = pauseClient.query(`
      update public.app_settings
      set value = 'true'
      where key = 'deposits_paused'
    `);
    await waitForBlocker(observer, pausePid, insertPid);
    assert.equal(
      (await observer.query(
        "select count(*)::integer as count from public.deposits",
      )).rows[0].count,
      0,
      "the uncommitted insert must remain invisible",
    );

    await insertClient.query("commit");
    await bounded(pausePromise, 4_000, "insert-first pause");
    await pauseClient.query("commit");
    assert.deepEqual(await operationalState(observer), {
      deposits: 1,
      verification_logs: 0,
      pause_value: "true",
      guard_exists: true,
      pause_trigger_exists: true,
    });
  });

  await t.test("negative control allows a paused insert without the trigger", async () => {
    await createLiveBaseline(observer, "true");
    await insertDeposit(observer, {
      reference: "FT-NEGATIVE-CONTROL",
    });
    assert.equal(
      (await observer.query(
        "select count(*)::integer as count from public.deposits",
      )).rows[0].count,
      1,
    );
  });

  await t.test("several unpaused inserts remain concurrent", async () => {
    await createLiveBaseline(observer);
    await applyMigration(observer);
    const workers = await Promise.all(
      Array.from({ length: 4 }, async (_, index) => {
        const worker = new Client({
          connectionString,
          application_name: `qhash-fiat-unpaused-${index}`,
        });
        await worker.connect();
        return worker;
      }),
    );
    t.after(async () => {
      await Promise.allSettled(workers.map((worker) => worker.end()));
    });
    const workerPids = await Promise.all(
      workers.map(async (worker) => (
        await worker.query("select pg_backend_pid()::integer as pid")
      ).rows[0].pid),
    );
    assert.equal(new Set(workerPids).size, workers.length);

    await bounded(
      Promise.all(
        workers.map((worker, index) => insertDeposit(worker, {
          role: index % 2 === 0 ? "service_role" : "authenticated",
          userId: index % 2 === 0 ? USER_ID : OTHER_USER_ID,
          reference: `FT-CONCURRENT-${index}`,
        })),
      ),
      8_000,
      "concurrent unpaused inserts",
    );
    assert.equal(
      (await observer.query(
        "select count(*)::integer as count from public.deposits",
      )).rows[0].count,
      workers.length,
    );
  });
});

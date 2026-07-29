import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { tsImport } from "tsx/esm/api";

const repositoryRoot = new URL("../", import.meta.url);
const {
  GLOBAL_DEPOSIT_PAUSE_SETTING_KEY,
  GLOBAL_DEPOSIT_PAUSE_SETTING_LIMIT,
  parseGlobalDepositAdmission,
} = await tsImport(
  "../src/domains/deposits/domain/deposit-admission-policy.ts",
  import.meta.url,
);
const { readGlobalDepositAdmission } = await tsImport(
  "../src/domains/deposits/server.ts",
  import.meta.url,
);

function createSettingsClient(result, { throwDuringRead = false } = {}) {
  const calls = [];
  const query = {
    select(columns) {
      calls.push(["select", columns]);
      return this;
    },
    eq(column, value) {
      calls.push(["eq", column, value]);
      return this;
    },
    limit(value) {
      calls.push(["limit", value]);
      if (throwDuringRead) throw new Error("private database failure");
      return Promise.resolve(result);
    },
  };

  return {
    calls,
    client: {
      from(table) {
        calls.push(["from", table]);
        return query;
      },
    },
  };
}

test("global deposit admission strictly decodes the one canonical setting row", () => {
  assert.deepEqual(
    parseGlobalDepositAdmission([
      { key: GLOBAL_DEPOSIT_PAUSE_SETTING_KEY, value: "false" },
    ]),
    { status: "open" },
  );
  assert.deepEqual(
    parseGlobalDepositAdmission([
      { key: GLOBAL_DEPOSIT_PAUSE_SETTING_KEY, value: "true" },
    ]),
    { status: "paused" },
  );

  for (const rows of [
    undefined,
    null,
    false,
    "false",
    {},
    [],
    [null],
    [[]],
    ["false"],
    [{ key: "withdrawals_paused", value: "false" }],
    [{ key: GLOBAL_DEPOSIT_PAUSE_SETTING_KEY, value: false }],
    [{ key: GLOBAL_DEPOSIT_PAUSE_SETTING_KEY, value: "FALSE" }],
    [{ key: GLOBAL_DEPOSIT_PAUSE_SETTING_KEY, value: null }],
    [
      { key: GLOBAL_DEPOSIT_PAUSE_SETTING_KEY, value: "false" },
      { key: GLOBAL_DEPOSIT_PAUSE_SETTING_KEY, value: "false" },
    ],
  ]) {
    assert.deepEqual(
      parseGlobalDepositAdmission(rows),
      { status: "unavailable", reason: "invalid_configuration" },
    );
  }
});

test("the shared server reader owns the exact Supabase query and fails closed", async () => {
  const open = createSettingsClient({
    data: [{ key: GLOBAL_DEPOSIT_PAUSE_SETTING_KEY, value: "false" }],
    error: null,
  });
  assert.deepEqual(
    await readGlobalDepositAdmission(open.client),
    { status: "open" },
  );
  assert.deepEqual(open.calls, [
    ["from", "app_settings"],
    ["select", "key, value"],
    ["eq", "key", GLOBAL_DEPOSIT_PAUSE_SETTING_KEY],
    ["limit", GLOBAL_DEPOSIT_PAUSE_SETTING_LIMIT],
  ]);

  const readError = createSettingsClient({
    data: [{ key: GLOBAL_DEPOSIT_PAUSE_SETTING_KEY, value: "false" }],
    error: { code: "42501", message: "private database failure" },
  });
  assert.deepEqual(
    await readGlobalDepositAdmission(readError.client),
    { status: "unavailable", reason: "read_failed" },
  );

  const thrown = createSettingsClient(null, { throwDuringRead: true });
  assert.deepEqual(
    await readGlobalDepositAdmission(thrown.client),
    { status: "unavailable", reason: "read_failed" },
  );
});

test("fiat and crypto adapters consume one shared provider-neutral boundary", async () => {
  const [sharedReader, fiatAdapter, cryptoAdapter] = await Promise.all([
    readFile(
      new URL(
        "src/domains/deposits/server/read-global-deposit-admission.ts",
        repositoryRoot,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "src/domains/fiat-deposits/server/require-fiat-deposit-admission.ts",
        repositoryRoot,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "netlify/functions/nowpayments-usdt-deposit-session.mts",
        repositoryRoot,
      ),
      "utf8",
    ),
  ]);

  assert.match(sharedReader, /\.from\("app_settings"\)/);
  assert.match(
    sharedReader,
    /\.eq\("key", GLOBAL_DEPOSIT_PAUSE_SETTING_KEY\)/,
  );
  assert.match(
    sharedReader,
    /\.limit\(GLOBAL_DEPOSIT_PAUSE_SETTING_LIMIT\)/,
  );
  assert.match(
    fiatAdapter,
    /from "\.\.\/\.\.\/deposits\/server\.ts"/,
  );
  assert.match(fiatAdapter, /readGlobalDepositAdmission\(admin\)/);
  assert.match(fiatAdapter, /Global deposit pause is enabled/);
  assert.match(
    fiatAdapter,
    /Deposit availability configuration is unavailable/,
  );
  assert.match(
    fiatAdapter,
    /Deposit availability configuration is malformed/,
  );
  assert.match(
    cryptoAdapter,
    /from "\.\.\/\.\.\/src\/domains\/deposits\/server\.ts"/,
  );
  assert.match(cryptoAdapter, /readGlobalDepositAdmission\(admin\)/);
  assert.doesNotMatch(fiatAdapter, /\.from\("app_settings"\)/);
  assert.doesNotMatch(cryptoAdapter, /\.from\("app_settings"\)/);
  assert.doesNotMatch(fiatAdapter, /NOWPAYMENTS|CBE|TeleBirr/);
  assert.doesNotMatch(sharedReader, /NOWPAYMENTS|CBE|TeleBirr|throwSafe|Netlify/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isParseableTimestampString } from "../src/shared/validation/parseable-timestamp.ts";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

function legacyTimestampPredicate(value) {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

test("shared timestamp validation preserves the established JavaScript Date boundary", () => {
  const corpus = [
    "2026-08-02T12:34:56.000Z",
    "2026-08-02T15:34:56+03:00",
    "2026-08-02",
    "August 2, 2026",
    " 2026-08-02 ",
    "0",
    "",
    "not-a-timestamp",
    "2026-13-01",
    null,
    undefined,
    0,
    new Date("2026-08-02T12:34:56.000Z"),
    {},
    [],
  ];

  for (const value of corpus) {
    assert.equal(isParseableTimestampString(value), legacyTimestampPredicate(value));
  }
});

test("shared timestamp validation remains parseability-only", async () => {
  assert.equal(isParseableTimestampString("2026-08-02T12:34:56.000Z"), true);
  assert.equal(isParseableTimestampString("2026-08-02"), true);
  assert.equal(isParseableTimestampString("August 2, 2026"), true);
  assert.equal(isParseableTimestampString("not-a-timestamp"), false);
  assert.equal(isParseableTimestampString(new Date()), false);

  const helper = await readRepositoryFile("src/shared/validation/parseable-timestamp.ts");
  assert.doesNotMatch(helper, /\.trim\s*\(/);
  assert.doesNotMatch(helper, /\.toISOString\s*\(/);
  assert.doesNotMatch(helper, /Date\.parse\s*\(/);
  assert.match(helper, /not an ISO 8601 or RFC 3339 validator/);
});

test("all six equivalent transport readers import the shared predicate", async () => {
  const consumerPaths = [
    "netlify/functions/nowpayments-usdt-deposit-overview.mts",
    "netlify/functions/nowpayments-usdt-withdrawal-admin.mts",
    "netlify/functions/nowpayments-usdt-withdrawal-overview.mts",
    "src/domains/crypto-deposits/ui/nowpayments-deposit-ui.ts",
    "src/domains/withdrawals/application/admin-usdt-withdrawal-browser-service.ts",
    "src/lib/nowpayments-withdrawal-ui.ts",
  ];

  for (const source of await Promise.all(consumerPaths.map(readRepositoryFile))) {
    assert.match(source, /shared\/validation\/parseable-timestamp\.ts/);
    assert.match(source, /isParseableTimestampString/);
    assert.doesNotMatch(source, /function isTimestamp\s*\(/);
    assert.doesNotMatch(
      source,
      /typeof value === "string" && Number\.isFinite\(new Date\(value\)\.getTime\(\)\)/,
    );
  }
});

test("normalization, policy, and provider receipt timestamps remain domain-owned", async () => {
  const distinctConsumers = [
    "netlify/functions/lib/nowpayments-client.mts",
    "src/lib/withdrawal-policy.ts",
    "src/lib/server/cbe-verify.ts",
    "src/lib/server/telebirr-verify.ts",
  ];

  for (const source of await Promise.all(distinctConsumers.map(readRepositoryFile))) {
    assert.doesNotMatch(source, /shared\/validation\/parseable-timestamp/);
  }

  const providerClient = await readRepositoryFile("netlify/functions/lib/nowpayments-client.mts");
  assert.match(providerClient, /\.toISOString\(\)/);
  const withdrawalPolicy = await readRepositoryFile("src/lib/withdrawal-policy.ts");
  assert.match(withdrawalPolicy, /ISO_TIMESTAMP_PATTERN/);
});

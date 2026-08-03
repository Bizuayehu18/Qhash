import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isUuidV1ToV5,
  isUuidV4,
} from "../src/shared/identifiers/uuid.ts";
import { createWithdrawalAttemptKeyManager } from "../src/lib/nowpayments-withdrawal-ui.ts";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

test("shared UUID validation accepts canonical versions 1 through 5", () => {
  const values = [
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "6ba7b811-9dad-21d1-90b4-00c04fd430c8",
    "6ba7b812-9dad-31d1-a0b4-00c04fd430c8",
    "550e8400-e29b-41d4-b716-446655440000",
    "6ba7b814-9dad-51d1-80b4-00c04fd430c8",
  ];

  for (const value of values) assert.equal(isUuidV1ToV5(value), true);
  assert.equal(isUuidV1ToV5("550E8400-E29B-41D4-A716-446655440000"), true);
});

test("shared UUID v4 validation accepts every RFC variant and both cases", () => {
  for (const variant of ["8", "9", "a", "b"]) {
    assert.equal(isUuidV4(`550e8400-e29b-41d4-${variant}716-446655440000`), true);
  }
  assert.equal(isUuidV4("550E8400-E29B-41D4-A716-446655440000"), true);
  assert.equal(isUuidV4("6ba7b810-9dad-11d1-80b4-00c04fd430c8"), false);
  assert.equal(isUuidV4("6ba7b814-9dad-51d1-80b4-00c04fd430c8"), false);
});

test("shared UUID predicates reject noncanonical or unsupported values", () => {
  const invalidValues = [
    "00000000-0000-0000-0000-000000000000",
    "550e8400-e29b-01d4-a716-446655440000",
    "550e8400-e29b-61d4-a716-446655440000",
    "550e8400-e29b-71d4-a716-446655440000",
    "550e8400-e29b-81d4-a716-446655440000",
    "550e8400-e29b-41d4-7716-446655440000",
    "550e8400-e29b-41d4-c716-446655440000",
    " 550e8400-e29b-41d4-a716-446655440000",
    "550e8400-e29b-41d4-a716-446655440000 ",
    "{550e8400-e29b-41d4-a716-446655440000}",
    "550e8400e29b41d4a716446655440000",
    "",
    null,
    undefined,
    42,
    {},
  ];

  for (const value of invalidValues) {
    assert.equal(isUuidV1ToV5(value), false);
    assert.equal(isUuidV4(value), false);
  }
});

test("the shared predicate validates without normalizing caller values", async () => {
  const helper = await readRepositoryFile("src/shared/identifiers/uuid.ts");
  assert.doesNotMatch(helper, /\.trim\s*\(/);
  assert.doesNotMatch(helper, /\.toLowerCase\s*\(/);
  assert.doesNotMatch(helper, /String\s*\(/);

  const uppercase = "550E8400-E29B-41D4-A716-446655440000";
  const manager = createWithdrawalAttemptKeyManager(() => uppercase);
  assert.equal(
    manager.keyFor("2", "0x642a320988ad78841db63ee1803db3803755ebc8", "1234"),
    uppercase.toLowerCase(),
  );
});

test("the seven case-insensitive consumers import the platform predicate", async () => {
  const consumers = [
    "netlify/functions/lib/nowpayments-client.mts",
    "netlify/functions/nowpayments-usdt-deposit-overview.mts",
    "netlify/functions/nowpayments-usdt-deposit-session.mts",
    "netlify/functions/nowpayments-usdt-reconcile-payment.mts",
    "netlify/functions/nowpayments-usdt-withdrawal-request.mts",
    "src/lib/nowpayments-withdrawal-ui.ts",
    "src/lib/server/admin-security-resets.ts",
  ];

  for (const source of await Promise.all(consumers.map(readRepositoryFile))) {
    assert.match(source, /shared\/identifiers\/uuid\.ts/);
    assert.match(source, /isUuidV(?:1ToV5|4)/);
    assert.doesNotMatch(source, /const (?:UUID|UUID_V4|REQUEST_ID|QHASH_ORDER_ID)_PATTERN/);
  }
});

test("lowercase-only financial validators remain domain-owned", async () => {
  const lowercaseOnlyConsumers = [
    "netlify/functions/nowpayments-usdt-withdrawal-admin.mts",
    "netlify/functions/nowpayments-usdt-withdrawal-overview.mts",
    "src/domains/withdrawals/application/admin-usdt-withdrawal-action-lifecycle.ts",
    "src/domains/withdrawals/application/admin-usdt-withdrawal-browser-service.ts",
  ];

  for (const source of await Promise.all(lowercaseOnlyConsumers.map(readRepositoryFile))) {
    assert.doesNotMatch(source, /shared\/identifiers\/uuid/);
    const genericPattern = source.match(
      /const (?:UUID|UUID_V4)_PATTERN\s*=\s*([\s\S]*?);/,
    );
    assert.ok(genericPattern);
    assert.doesNotMatch(genericPattern[1], /\/i\s*$/);
  }
});

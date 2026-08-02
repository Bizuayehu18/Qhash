import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isNonNullNonArrayObject } from "../src/shared/validation/non-null-non-array-object.ts";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

function legacyExplicitPredicate(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function legacyBooleanPredicate(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

class ExampleInstance {}

test("shared loose-object validation preserves both established predicates", () => {
  const corpus = [
    {},
    Object.create(null),
    new Date("2026-08-02T12:34:56.000Z"),
    new Map(),
    new Set(),
    /qhash/,
    new Number(1),
    new String("qhash"),
    new Boolean(false),
    new ExampleInstance(),
    [],
    [1],
    null,
    undefined,
    false,
    true,
    0,
    1,
    Number.NaN,
    "",
    "qhash",
    Symbol("qhash"),
    () => {},
  ];

  for (const value of corpus) {
    const expected = legacyExplicitPredicate(value);
    assert.equal(legacyBooleanPredicate(value), expected);
    assert.equal(isNonNullNonArrayObject(value), expected);
  }
});

test("the shared helper remains deliberately permissive and non-normalizing", async () => {
  assert.equal(isNonNullNonArrayObject(new Date()), true);
  assert.equal(isNonNullNonArrayObject(new Map()), true);
  assert.equal(isNonNullNonArrayObject(new ExampleInstance()), true);
  assert.equal(isNonNullNonArrayObject(Object.create(null)), true);
  assert.equal(isNonNullNonArrayObject([]), false);
  assert.equal(isNonNullNonArrayObject(null), false);

  const helper = await readRepositoryFile(
    "src/shared/validation/non-null-non-array-object.ts",
  );
  assert.match(helper, /not plain-object or schema/);
  assert.doesNotMatch(helper, /Object\.getPrototypeOf/);
  assert.doesNotMatch(helper, /Object\.keys/);
  assert.doesNotMatch(helper, /JSON\.(?:parse|stringify)/);
  assert.doesNotMatch(helper, /String\s*\(/);
});

test("all seven equivalent production consumers import the shared predicate", async () => {
  const consumers = [
    "netlify/functions/nowpayments-usdt-deposit-overview.mts",
    "netlify/functions/nowpayments-usdt-deposit-session.mts",
    "netlify/functions/nowpayments-usdt-withdrawal-admin.mts",
    "src/domains/crypto-deposits/ui/nowpayments-deposit-ui.ts",
    "src/domains/deposits/domain/deposit-admission-policy.ts",
    "src/lib/nowpayments-withdrawal-admin-ui.ts",
    "src/lib/nowpayments-withdrawal-ui.ts",
  ];

  for (const source of await Promise.all(consumers.map(readRepositoryFile))) {
    assert.match(source, /shared\/validation\/non-null-non-array-object\.ts/);
    assert.match(source, /isNonNullNonArrayObject/);
    assert.doesNotMatch(source, /function (?:isRecord|isObject)\s*\(/);
    assert.doesNotMatch(
      source,
      /typeof value === "object" && !Array\.isArray\(value\)/,
    );
  }
});

test("stricter and parse-coupled object boundaries remain domain-owned", async () => {
  const strictSanitizer = await readRepositoryFile(
    "src/lib/server/deposit-verification-audit.ts",
  );
  assert.match(strictSanitizer, /function isPlainObject\s*\(/);
  assert.match(strictSanitizer, /Object\.getPrototypeOf/);
  assert.doesNotMatch(strictSanitizer, /non-null-non-array-object/);

  const ipnCanonicalizer = await readRepositoryFile(
    "netlify/functions/lib/nowpayments-ipn.mts",
  );
  assert.match(ipnCanonicalizer, /function sortLikeNowpayments\s*\(/);
  assert.doesNotMatch(ipnCanonicalizer, /non-null-non-array-object/);

  const separatelyCharacterizedConsumers = [
    "netlify/functions/lib/nowpayments-client.mts",
    "netlify/functions/lib/nowpayments-settlement.mts",
    "netlify/functions/nowpayments-usdt-reconcile-payment.mts",
    "netlify/functions/nowpayments-usdt-withdrawal-overview.mts",
    "netlify/functions/nowpayments-usdt-withdrawal-request.mts",
  ];

  for (const source of await Promise.all(
    separatelyCharacterizedConsumers.map(readRepositoryFile),
  )) {
    assert.doesNotMatch(source, /non-null-non-array-object/);
  }
});

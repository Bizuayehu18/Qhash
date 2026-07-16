import assert from "node:assert/strict";
import test from "node:test";
import { planCryptoTargetUserLookups } from "../src/lib/server/crypto-target-user-lookups.ts";

test("treats an @-prefixed value as a username without querying the UUID column", () => {
  assert.deepEqual(planCryptoTargetUserLookups("@abebe"), [
    { column: "username", value: "abebe" },
  ]);
});

test("normalizes a plain username to the stored lowercase form", () => {
  assert.deepEqual(planCryptoTargetUserLookups("Abebe_01"), [
    { column: "username", value: "abebe_01" },
  ]);
});

test("queries only the UUID column for a valid profile ID", () => {
  assert.deepEqual(planCryptoTargetUserLookups("550E8400-E29B-41D4-A716-446655440000"), [
    { column: "id", value: "550e8400-e29b-41d4-a716-446655440000" },
  ]);
});

test("normalizes supported Ethiopian phone formats", () => {
  assert.deepEqual(planCryptoTargetUserLookups("0912 345 678"), [
    { column: "phone", value: "+251912345678" },
  ]);

  assert.deepEqual(planCryptoTargetUserLookups("+251712345678"), [
    { column: "phone", value: "+251712345678" },
  ]);
});

test("returns no unsafe database lookup for an invalid reference", () => {
  assert.deepEqual(planCryptoTargetUserLookups("@!!"), []);
});

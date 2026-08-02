import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAuthenticatedRequestIdentity,
  createAuthenticatedScopedRequestKey,
  createLatestAuthenticatedRequestGuard,
  createLatestAuthenticatedScopedRequestGuard,
  createRequestRetryPolicy,
  isSameAuthenticatedRequestIdentity,
  isSameAuthenticatedScopedRequestKey,
} from "../src/shared/requests/authenticated-request-lifecycle.ts";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

test("authenticated identities require and compare the exact user and token generation", () => {
  const original = createAuthenticatedRequestIdentity("user-a", "token-a");
  const same = createAuthenticatedRequestIdentity("user-a", "token-a");
  const refreshedToken = createAuthenticatedRequestIdentity("user-a", "token-b");
  const replacementUser = createAuthenticatedRequestIdentity("user-b", "token-a");

  assert.ok(original);
  assert.ok(same);
  assert.ok(refreshedToken);
  assert.ok(replacementUser);
  assert.equal(createAuthenticatedRequestIdentity(null, "token-a"), null);
  assert.equal(createAuthenticatedRequestIdentity("user-a", null), null);
  assert.equal(createAuthenticatedRequestIdentity("", "token-a"), null);
  assert.equal(createAuthenticatedRequestIdentity("user-a", ""), null);
  assert.equal(isSameAuthenticatedRequestIdentity(original, same), true);
  assert.equal(isSameAuthenticatedRequestIdentity(original, refreshedToken), false);
  assert.equal(isSameAuthenticatedRequestIdentity(original, replacementUser), false);
  assert.equal(isSameAuthenticatedRequestIdentity(original, null), false);
  assert.equal(isSameAuthenticatedRequestIdentity(null, null), false);
});

test("latest authenticated request guards invalidate older and replaced generations", () => {
  const guard = createLatestAuthenticatedRequestGuard();
  const original = createAuthenticatedRequestIdentity("user-a", "token-a");
  const same = createAuthenticatedRequestIdentity("user-a", "token-a");
  const replacement = createAuthenticatedRequestIdentity("user-b", "token-b");
  assert.ok(original);
  assert.ok(same);
  assert.ok(replacement);

  const older = guard.begin(original);
  const newer = guard.begin(same);
  assert.equal(older.isCurrent(original), false);
  assert.equal(newer.isCurrent(same), true);
  assert.equal(newer.isCurrent(replacement), false);

  guard.invalidate();
  assert.equal(newer.isCurrent(same), false);
});

test("scoped request guards bind user, token, and scope", () => {
  const all = createAuthenticatedScopedRequestKey("user-a", "token-a", "all");
  const same = createAuthenticatedScopedRequestKey("user-a", "token-a", "all");
  const deposits = createAuthenticatedScopedRequestKey("user-a", "token-a", "deposit");
  const refreshed = createAuthenticatedScopedRequestKey("user-a", "token-b", "all");
  assert.ok(all);
  assert.ok(same);
  assert.ok(deposits);
  assert.ok(refreshed);

  assert.equal(isSameAuthenticatedScopedRequestKey(all, same), true);
  assert.equal(isSameAuthenticatedScopedRequestKey(all, deposits), false);
  assert.equal(isSameAuthenticatedScopedRequestKey(all, refreshed), false);

  const guard = createLatestAuthenticatedScopedRequestGuard();
  const older = guard.begin(all);
  const newer = guard.begin(same);
  assert.equal(older.isCurrent(all), false);
  assert.equal(newer.isCurrent(same), true);
  assert.equal(newer.isCurrent(deposits), false);
  guard.invalidate();
  assert.equal(newer.isCurrent(same), false);
});

test("retry admission preserves its bounded budget across coalesced loads", () => {
  const policy = createRequestRetryPolicy(2);

  assert.equal(policy.reserveRetry(), true);
  assert.equal(policy.admitLoad({ coalescesWithActiveFlight: true }), false);
  assert.equal(policy.reserveRetry(), true);
  assert.equal(policy.reserveRetry(), false);

  assert.equal(policy.admitLoad({
    coalescesWithActiveFlight: false,
    resetRetryCount: true,
  }), true);
  assert.equal(policy.reserveRetry(), true);
  policy.reset();
  assert.equal(policy.reserveRetry(), true);
});

test("domain lifecycle paths are compatibility adapters over the shared primitive", async () => {
  const adapters = await Promise.all([
    readRepositoryFile("src/domains/accounts/application/authenticated-request-lifecycle.ts"),
    readRepositoryFile("src/domains/plans/application/plans-auth-lifecycle.ts"),
    readRepositoryFile("src/domains/referrals/application/referrals-auth-lifecycle.ts"),
    readRepositoryFile("src/domains/notifications/application/notifications-auth-lifecycle.ts"),
    readRepositoryFile("src/domains/fiat-withdrawals/ui/fiat-withdrawal-auth-lifecycle.ts"),
  ]);

  for (const adapter of adapters) {
    assert.match(adapter, /shared\/requests\/authenticated-request-lifecycle\.ts/);
  }

  assert.match(adapters[0], /type AccountsRequestLoadAdmission/);
  assert.match(adapters[0], /resetRetryCount: boolean/);
  assert.match(adapters[0], /createSharedRequestRetryPolicy/);
  assert.match(adapters[1], /createPlansPurchaseFlightGuard/);
  assert.match(adapters[1], /reconcilePlansPurchaseFlight/);
  assert.match(adapters[4], /fiatWithdrawalAuthIdentityMatches/);
  assert.doesNotMatch(adapters[0], /let generation/);
  assert.doesNotMatch(adapters[2], /let retryCount/);
  assert.doesNotMatch(adapters[3], /let retryCount/);
});

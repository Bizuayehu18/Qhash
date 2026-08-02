import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAdminOverviewAuthIdentity,
  createAdminOverviewRetryPolicy,
  createLatestAdminOverviewRequestGuard,
  isSameAdminOverviewAuthIdentity,
} from "../src/domains/admin/application/admin-overview-auth-lifecycle.ts";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

test("admin overview identity binds the exact user and access-token generation", () => {
  const original = createAdminOverviewAuthIdentity("admin-a", "token-a");
  const same = createAdminOverviewAuthIdentity("admin-a", "token-a");
  const refreshedToken = createAdminOverviewAuthIdentity("admin-a", "token-b");
  const replacementAdmin = createAdminOverviewAuthIdentity("admin-b", "token-a");

  assert.ok(original);
  assert.ok(same);
  assert.ok(refreshedToken);
  assert.ok(replacementAdmin);
  assert.equal(createAdminOverviewAuthIdentity(null, "token-a"), null);
  assert.equal(createAdminOverviewAuthIdentity("admin-a", null), null);
  assert.equal(isSameAdminOverviewAuthIdentity(original, same), true);
  assert.equal(isSameAdminOverviewAuthIdentity(original, refreshedToken), false);
  assert.equal(isSameAdminOverviewAuthIdentity(original, replacementAdmin), false);
  assert.equal(isSameAdminOverviewAuthIdentity(original, null), false);
});

test("late overview success and failure cannot cross administrator generations", async () => {
  const successGuard = createLatestAdminOverviewRequestGuard();
  const failureGuard = createLatestAdminOverviewRequestGuard();
  const adminA = createAdminOverviewAuthIdentity("admin-a", "token-a");
  const adminB = createAdminOverviewAuthIdentity("admin-b", "token-b");
  assert.ok(adminA);
  assert.ok(adminB);

  let currentIdentity = adminA;
  let visibleStats = null;
  let scheduledRetries = 0;
  const oldSuccess = deferred();
  const oldFailure = deferred();
  const oldSuccessTicket = successGuard.begin(adminA);
  const oldFailureTicket = failureGuard.begin(adminA);
  const oldSuccessCommit = oldSuccess.promise.then((stats) => {
    if (oldSuccessTicket.isCurrent(currentIdentity)) visibleStats = stats;
  });
  const oldFailureCommit = oldFailure.promise.catch(() => {
    if (oldFailureTicket.isCurrent(currentIdentity)) scheduledRetries += 1;
  });

  currentIdentity = adminB;
  successGuard.invalidate();
  failureGuard.invalidate();
  const replacement = deferred();
  const replacementTicket = successGuard.begin(adminB);
  const replacementCommit = replacement.promise.then((stats) => {
    if (replacementTicket.isCurrent(currentIdentity)) visibleStats = stats;
  });

  replacement.resolve({ totalUsers: 2 });
  await replacementCommit;
  oldSuccess.resolve({ totalUsers: 99 });
  oldFailure.reject(new Error("stale failure"));
  await Promise.all([oldSuccessCommit, oldFailureCommit]);

  assert.deepEqual(visibleStats, { totalUsers: 2 });
  assert.equal(scheduledRetries, 0);
  assert.equal(oldSuccessTicket.isCurrent(currentIdentity), false);
  assert.equal(oldFailureTicket.isCurrent(currentIdentity), false);
  assert.equal(replacementTicket.isCurrent(currentIdentity), true);
});

test("admin overview invalidation and retry admission are bounded", () => {
  const identity = createAdminOverviewAuthIdentity("admin-a", "token-a");
  assert.ok(identity);
  const guard = createLatestAdminOverviewRequestGuard();
  const request = guard.begin(identity);
  assert.equal(request.isCurrent(identity), true);
  guard.invalidate();
  assert.equal(request.isCurrent(identity), false);

  const retryPolicy = createAdminOverviewRetryPolicy(2);
  assert.equal(retryPolicy.reserveRetry(), true);
  assert.equal(retryPolicy.admitLoad({
    coalescesWithActiveFlight: true,
    resetRetryCount: true,
  }), false);
  assert.equal(retryPolicy.reserveRetry(), true);
  assert.equal(retryPolicy.reserveRetry(), false);
  assert.equal(retryPolicy.admitLoad({
    coalescesWithActiveFlight: false,
    resetRetryCount: true,
  }), true);
  assert.equal(retryPolicy.reserveRetry(), true);
});

test("admin overview controller preserves timing, refresh, and stale-result guards", async () => {
  const controller = await readRepositoryFile(
    "src/domains/admin/ui/useAdminOverview.ts",
  );

  assert.match(controller, /ADMIN_OVERVIEW_LOAD_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(controller, /ADMIN_OVERVIEW_AUTO_RETRY_DELAY_MS\s*=\s*1_500/);
  assert.match(controller, /ADMIN_OVERVIEW_MAX_AUTO_RETRIES\s*=\s*2/);
  assert.match(controller, /Admin overview request timed out\./);
  assert.match(controller, /document\.addEventListener\("visibilitychange"/);
  assert.match(controller, /window\.addEventListener\("online"/);
  assert.doesNotMatch(controller, /setInterval/);

  assert.match(controller, /createAdminOverviewAuthIdentity\(userId, accessToken\)/);
  assert.match(controller, /activeLoadRef/);
  assert.match(
    controller,
    /isSameAdminOverviewAuthIdentity\(activeLoad\.identity, requestIdentity\)/,
  );
  assert.match(controller, /return activeLoad\.promise/);
  assert.match(controller, /forceNewFlight/);
  assert.match(controller, /Symbol\("admin-overview-load-flight"\)/);
  assert.match(controller, /activeLoadRef\.current\?\.token === flightToken/);
  assert.ok(
    [...controller.matchAll(/request\.isCurrent\(identityRef\.current\)/g)].length >= 2,
    "success and failure publication must be generation gated",
  );
  assert.match(controller, /requestGuardRef\.current\.invalidate\(\)/);
  assert.match(controller, /activeLoadRef\.current = null/);
  assert.match(controller, /setSnapshot\(null\)/);
  assert.match(controller, /isSameAdminOverviewAuthIdentity\(snapshot\.identity, identity\)/);
});

test("admin overview preserves its exact visible read-only presentation", async () => {
  const [panel, amount] = await Promise.all([
    readRepositoryFile("src/domains/admin/ui/AdminOverviewPanel.tsx"),
    readRepositoryFile("src/domains/admin/ui/AdminEtbAmount.tsx"),
  ]);

  for (const copy of [
    "Total Users",
    "Active Plans",
    "Pending Deposits",
    "Revenue",
    "Recent Users",
    "Pending Withdrawals",
    "No users yet.",
    "No pending requests.",
    "Frozen",
    "Admin",
    "User",
  ]) {
    assert.match(panel, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(panel, /stats\?\.totalUsers/);
  assert.match(panel, /stats\?\.activeInvestments/);
  assert.match(panel, /stats\?\.pendingDeposits/);
  assert.match(panel, /stats\?\.totalRevenue/);
  assert.match(panel, /\[1, 2, 3\]/);
  assert.match(panel, /skeleton h-12 rounded-xl/);
  assert.match(panel, /skeleton h-16 rounded-xl/);
  assert.match(panel, /@\{recentUser\.username\}/);
  assert.match(panel, /recentUser\.phone/);
  assert.match(panel, /recentUser\.is_frozen[\s\S]*recentUser\.is_admin/);
  assert.match(panel, /pendingWithdrawalRecords\.map/);
  assert.match(panel, /toLocaleDateString\("en-US", \{/);
  assert.match(panel, /month: "short"/);
  assert.match(panel, /day: "numeric"/);
  assert.doesNotMatch(panel, /pendingWithdrawals\b/);
  assert.doesNotMatch(panel, /Button|Retry|toast|setInterval/);

  assert.match(amount, /Number\(value \|\| 0\)\.toLocaleString\("en-US"/);
  assert.match(amount, /minimumFractionDigits: 2/);
  assert.match(amount, /maximumFractionDigits: 2/);
  assert.match(amount, /<CurrencyUnit \/>/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAdminFiatWithdrawalAuthIdentity,
  createAdminFiatWithdrawalCatalogKey,
  createAdminFiatWithdrawalRetryPolicy,
  createAdminFiatWithdrawalReviewFlights,
  createAdminFiatWithdrawalScopedValue,
  createLatestAdminFiatWithdrawalCatalogGuard,
  createLatestAdminFiatWithdrawalReviewGuard,
  isSameAdminFiatWithdrawalAuthIdentity,
  isSameAdminFiatWithdrawalCatalogKey,
  readAdminFiatWithdrawalScopedValue,
} from "../src/domains/fiat-withdrawals/application/admin-fiat-withdrawal-operations-auth-lifecycle.ts";
import {
  ADMIN_FIAT_WITHDRAWAL_FILTERS,
  ADMIN_FIAT_WITHDRAWAL_METHOD_LABELS,
  ADMIN_FIAT_WITHDRAWAL_STATUS,
} from "../src/domains/fiat-withdrawals/ui/admin/admin-fiat-withdrawal-operations-presentation.ts";

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

test("admin fiat-withdrawal identities and catalog keys bind exact auth and filter generations", () => {
  const identity = createAdminFiatWithdrawalAuthIdentity("admin-a", "token-a");
  const sameIdentity = createAdminFiatWithdrawalAuthIdentity("admin-a", "token-a");
  const refreshedToken = createAdminFiatWithdrawalAuthIdentity("admin-a", "token-b");
  const replacementAdmin = createAdminFiatWithdrawalAuthIdentity("admin-b", "token-a");

  assert.deepEqual(identity, { accessToken: "token-a", userId: "admin-a" });
  assert.ok(sameIdentity);
  assert.ok(refreshedToken);
  assert.ok(replacementAdmin);
  assert.equal(createAdminFiatWithdrawalAuthIdentity(null, "token-a"), null);
  assert.equal(createAdminFiatWithdrawalAuthIdentity("admin-a", null), null);
  assert.equal(isSameAdminFiatWithdrawalAuthIdentity(identity, sameIdentity), true);
  assert.equal(isSameAdminFiatWithdrawalAuthIdentity(identity, refreshedToken), false);
  assert.equal(isSameAdminFiatWithdrawalAuthIdentity(identity, replacementAdmin), false);
  assert.equal(isSameAdminFiatWithdrawalAuthIdentity(identity, null), false);

  const all = createAdminFiatWithdrawalCatalogKey("admin-a", "token-a", "all");
  const sameAll = createAdminFiatWithdrawalCatalogKey("admin-a", "token-a", "all");
  const pending = createAdminFiatWithdrawalCatalogKey(
    "admin-a",
    "token-a",
    "pending",
  );
  const refreshedAll = createAdminFiatWithdrawalCatalogKey(
    "admin-a",
    "token-b",
    "all",
  );

  assert.ok(all);
  assert.ok(sameAll);
  assert.ok(pending);
  assert.ok(refreshedAll);
  assert.equal(createAdminFiatWithdrawalCatalogKey(null, "token-a", "all"), null);
  assert.equal(createAdminFiatWithdrawalCatalogKey("admin-a", null, "all"), null);
  assert.equal(isSameAdminFiatWithdrawalCatalogKey(all, sameAll), true);
  assert.equal(isSameAdminFiatWithdrawalCatalogKey(all, pending), false);
  assert.equal(isSameAdminFiatWithdrawalCatalogKey(all, refreshedAll), false);
  assert.equal(isSameAdminFiatWithdrawalCatalogKey(all, null), false);

  const editor = createAdminFiatWithdrawalScopedValue(identity, {
    withdrawalId: "withdrawal-a",
  });
  assert.deepEqual(readAdminFiatWithdrawalScopedValue(editor, sameIdentity), {
    withdrawalId: "withdrawal-a",
  });
  assert.equal(readAdminFiatWithdrawalScopedValue(editor, refreshedToken), null);
  assert.equal(readAdminFiatWithdrawalScopedValue(editor, replacementAdmin), null);
});

test("latest catalog and review guards reject stale success, failure, cleanup, and finalizer effects", async () => {
  const catalogGuard = createLatestAdminFiatWithdrawalCatalogGuard();
  const reviewGuard = createLatestAdminFiatWithdrawalReviewGuard();
  const all = createAdminFiatWithdrawalCatalogKey("admin-a", "token-a", "all");
  const pending = createAdminFiatWithdrawalCatalogKey(
    "admin-a",
    "token-a",
    "pending",
  );
  const adminA = createAdminFiatWithdrawalAuthIdentity("admin-a", "token-a");
  const adminB = createAdminFiatWithdrawalAuthIdentity("admin-b", "token-b");
  assert.ok(all);
  assert.ok(pending);
  assert.ok(adminA);
  assert.ok(adminB);

  let currentCatalogKey = all;
  let publishedRows = [];
  let retryCount = 0;
  let catalogFinalizers = 0;
  const staleCatalog = deferred();
  const staleCatalogTicket = catalogGuard.begin(all);
  const staleCatalogEffect = staleCatalog.promise.then(
    (rows) => {
      if (staleCatalogTicket.isCurrent(currentCatalogKey)) publishedRows = rows;
    },
    () => {
      if (staleCatalogTicket.isCurrent(currentCatalogKey)) retryCount += 1;
    },
  ).finally(() => {
    if (staleCatalogTicket.isCurrent(currentCatalogKey)) catalogFinalizers += 1;
  });

  currentCatalogKey = pending;
  catalogGuard.invalidate();
  const currentCatalogTicket = catalogGuard.begin(pending);
  staleCatalog.resolve([{ id: "stale" }]);
  await staleCatalogEffect;
  assert.deepEqual(publishedRows, []);
  assert.equal(retryCount, 0);
  assert.equal(catalogFinalizers, 0);
  assert.equal(staleCatalogTicket.isCurrent(currentCatalogKey), false);
  assert.equal(currentCatalogTicket.isCurrent(currentCatalogKey), true);

  let currentIdentity = adminA;
  let accepted = 0;
  let failures = 0;
  let reviewFinalizers = 0;
  const staleReview = deferred();
  const staleReviewTicket = reviewGuard.begin(adminA);
  const staleReviewEffect = staleReview.promise.then(
    () => {
      if (staleReviewTicket.isCurrent(currentIdentity)) accepted += 1;
    },
    () => {
      if (staleReviewTicket.isCurrent(currentIdentity)) failures += 1;
    },
  ).finally(() => {
    if (staleReviewTicket.isCurrent(currentIdentity)) reviewFinalizers += 1;
  });

  currentIdentity = adminB;
  reviewGuard.invalidate();
  const currentReviewTicket = reviewGuard.begin(adminB);
  staleReview.reject(new Error("stale review"));
  await staleReviewEffect;
  assert.equal(accepted, 0);
  assert.equal(failures, 0);
  assert.equal(reviewFinalizers, 0);
  assert.equal(staleReviewTicket.isCurrent(currentIdentity), false);
  assert.equal(currentReviewTicket.isCurrent(currentIdentity), true);
});

test("post-review forced refresh supersedes an overlapping stale same-key catalog flight", async () => {
  const guard = createLatestAdminFiatWithdrawalCatalogGuard();
  const key = createAdminFiatWithdrawalCatalogKey(
    "admin-a",
    "token-b",
    "pending",
  );
  assert.ok(key);

  const staleLoad = deferred();
  const freshLoad = deferred();
  let publishedRows = [];
  const staleTicket = guard.begin(key);
  const staleEffect = staleLoad.promise.then((rows) => {
    if (staleTicket.isCurrent(key)) publishedRows = rows;
  });

  const freshTicket = guard.begin(key);
  const freshEffect = freshLoad.promise.then((rows) => {
    if (freshTicket.isCurrent(key)) publishedRows = rows;
  });

  freshLoad.resolve([{ id: "completed" }]);
  await freshEffect;
  staleLoad.resolve([{ id: "pending" }]);
  await staleEffect;

  assert.equal(staleTicket.isCurrent(key), false);
  assert.equal(freshTicket.isCurrent(key), true);
  assert.deepEqual(publishedRows, [{ id: "completed" }]);
});

test("catalog retry admission is bounded and coalesced loads do not spend retries", () => {
  const retryPolicy = createAdminFiatWithdrawalRetryPolicy(2);

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
  retryPolicy.reset();
  assert.equal(retryPolicy.reserveRetry(), true);
});

test("review flights coalesce exact commands, reject same-withdrawal conflicts, and expose a durable idle barrier", async () => {
  const flights = createAdminFiatWithdrawalReviewFlights();
  const identity = createAdminFiatWithdrawalAuthIdentity("admin-a", "token-a");
  assert.ok(identity);
  const approve = deferred();
  const reject = deferred();
  let approveCalls = 0;
  let rejectCalls = 0;

  const approveKey = {
    fingerprint: "withdrawal-a:approve:paid",
    identity,
    withdrawalId: "withdrawal-a",
  };
  const firstApprove = flights.run(approveKey, async () => {
    approveCalls += 1;
    return approve.promise;
  });
  const duplicateApprove = flights.run(approveKey, async () => {
    approveCalls += 1;
    return "duplicate";
  });
  const conflictingReject = flights.run({
    fingerprint: "withdrawal-a:reject:refund",
    identity,
    withdrawalId: "withdrawal-a",
  }, async () => "conflict");
  const independentReject = flights.run({
    fingerprint: "withdrawal-b:reject:refund",
    identity,
    withdrawalId: "withdrawal-b",
  }, async () => {
    rejectCalls += 1;
    return reject.promise;
  });

  assert.equal(firstApprove, duplicateApprove);
  assert.equal(conflictingReject, null);
  assert.ok(independentReject);
  await Promise.resolve();
  assert.equal(approveCalls, 1);
  assert.equal(rejectCalls, 1);

  let idle = false;
  const idlePromise = flights.whenIdle().then(() => {
    idle = true;
  });
  approve.resolve("approved");
  assert.equal(await firstApprove, "approved");
  await Promise.resolve();
  assert.equal(idle, false);
  reject.resolve("rejected");
  assert.equal(await independentReject, "rejected");
  await idlePromise;
  assert.equal(idle, true);

  const afterIdle = await flights.run(approveKey, async () => {
    approveCalls += 1;
    return "new-flight";
  });
  assert.equal(afterIdle, "new-flight");
  assert.equal(approveCalls, 2);
});

test("review idle barriers are scoped to the exact authentication generation", async () => {
  const flights = createAdminFiatWithdrawalReviewFlights();
  const oldIdentity = createAdminFiatWithdrawalAuthIdentity("admin-a", "token-a");
  const newIdentity = createAdminFiatWithdrawalAuthIdentity("admin-a", "token-b");
  assert.ok(oldIdentity);
  assert.ok(newIdentity);
  const oldReview = deferred();

  const oldFlight = flights.run({
    fingerprint: "withdrawal-a:approve",
    identity: oldIdentity,
    withdrawalId: "withdrawal-a",
  }, async () => oldReview.promise);
  assert.ok(oldFlight);

  await flights.whenIdle(newIdentity);
  let globalIdle = false;
  const globalBarrier = flights.whenIdle().then(() => {
    globalIdle = true;
  });
  await Promise.resolve();
  assert.equal(globalIdle, false);

  oldReview.resolve("approved");
  await oldFlight;
  await globalBarrier;
  assert.equal(globalIdle, true);
});

test("review user barriers span token rotation without blocking another administrator", async () => {
  const flights = createAdminFiatWithdrawalReviewFlights();
  const adminA = createAdminFiatWithdrawalAuthIdentity("admin-a", "token-a");
  assert.ok(adminA);
  const review = deferred();
  const flight = flights.run({
    fingerprint: "withdrawal-a:reject",
    identity: adminA,
    withdrawalId: "withdrawal-a",
  }, async () => review.promise);
  assert.ok(flight);

  let adminAIdle = false;
  const adminABarrier = flights.whenUserIdle("admin-a").then(() => {
    adminAIdle = true;
  });
  await flights.whenUserIdle("admin-b");
  await Promise.resolve();
  assert.equal(adminAIdle, false);

  review.resolve("rejected");
  await flight;
  await adminABarrier;
  assert.equal(adminAIdle, true);
});

test("fiat-withdrawal presentation preserves established filters, method labels, and statuses", () => {
  assert.deepEqual(ADMIN_FIAT_WITHDRAWAL_FILTERS, [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ]);
  assert.deepEqual(ADMIN_FIAT_WITHDRAWAL_METHOD_LABELS, {
    cbe: "CBE",
    telebirr: "TeleBirr",
  });
  assert.deepEqual(ADMIN_FIAT_WITHDRAWAL_STATUS, {
    approved: { label: "Approved", variant: "success" },
    pending: { label: "Pending", variant: "warning" },
    rejected: { label: "Rejected", variant: "danger" },
  });
});

test("browser service owns only the exact direct server-function catalog and review contracts", async () => {
  const service = await readRepositoryFile(
    "src/domains/fiat-withdrawals/application/admin-fiat-withdrawal-operations-browser-service.ts",
  );

  assert.match(
    service,
    /import \{[\s\S]*approveWithdrawalFn,[\s\S]*getAdminWithdrawalsFn,[\s\S]*rejectWithdrawalFn,[\s\S]*\} from "@\/lib\/server\/withdrawals\.js";/,
  );
  assert.match(
    service,
    /return getAdminWithdrawalsFn\(\{[\s\S]*data: \{[\s\S]*accessToken,[\s\S]*statusFilter,[\s\S]*\},[\s\S]*\}\);/,
  );
  assert.match(
    service,
    /const request = input\.action === "approve"[\s\S]*\? approveWithdrawalFn[\s\S]*: rejectWithdrawalFn;/,
  );
  assert.match(
    service,
    /return request\(\{[\s\S]*data: \{[\s\S]*accessToken,[\s\S]*withdrawalId: input\.withdrawalId,[\s\S]*adminNote: input\.adminNote,[\s\S]*\},[\s\S]*\}\);/,
  );
  assert.doesNotMatch(service, /userId|user_id|supabase|service.role|getSession|fetch\(/i);
});

test("catalog waits for accepted reviews and retains timeout, coalescing, retry, visibility, and stale-publication guards", async () => {
  const catalog = await readRepositoryFile(
    "src/domains/fiat-withdrawals/ui/admin/useAdminFiatWithdrawalCatalog.ts",
  );

  assert.match(catalog, /ADMIN_FIAT_WITHDRAWAL_LOAD_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(catalog, /ADMIN_FIAT_WITHDRAWAL_REVIEW_WAIT_TIMEOUT_MS\s*=\s*2_000/);
  assert.match(catalog, /ADMIN_FIAT_WITHDRAWAL_RETRY_DELAY_MS\s*=\s*1_500/);
  assert.match(catalog, /ADMIN_FIAT_WITHDRAWAL_MAX_AUTO_RETRIES\s*=\s*2/);
  assert.match(catalog, /Admin withdrawals request timed out\./);
  assert.match(
    catalog,
    /createAdminFiatWithdrawalCatalogKey\([\s\S]*userId,[\s\S]*accessToken,[\s\S]*statusFilter/,
  );
  assert.match(catalog, /activeLoadRef/);
  assert.match(
    catalog,
    /isSameAdminFiatWithdrawalCatalogKey\(activeLoad\.key, expectedKey\)/,
  );
  assert.match(catalog, /return activeLoad\.promise/);
  assert.match(catalog, /forceNewFlight/);
  assert.match(catalog, /Symbol\("admin-fiat-withdrawal-catalog-flight"\)/);
  assert.match(catalog, /activeLoadRef\.current\?\.token === flightToken/);
  assert.match(
    catalog,
    /adminFiatWithdrawalGlobalReviewFlights[\s\S]*?\.whenUserIdle\(expectedKey\.identity\.userId\)[\s\S]*?ADMIN_FIAT_WITHDRAWAL_REVIEW_WAIT_TIMEOUT_MS[\s\S]*?reviewBarrierSettled = false[\s\S]*?reviewBarrier\.then\(\(\) => \{[\s\S]*?loadRef\.current\(\{[\s\S]*?forceNewFlight: true,[\s\S]*?resetRetryCount: true,[\s\S]*?\}\)[\s\S]*?const withdrawals = await withTimeout\([\s\S]*?loadAdminFiatWithdrawals\(/,
  );
  assert.ok(
    [...catalog.matchAll(/request\.isCurrent\(requestKeyRef\.current\)/g)].length >= 3,
    "wait, success, and failure publication must be generation guarded",
  );
  assert.match(catalog, /requestGuardRef\.current\.invalidate\(\)/);
  assert.match(catalog, /setSnapshot\(null\)/);
  assert.match(
    catalog,
    /isSameAdminFiatWithdrawalCatalogKey\(snapshot\.key, requestKey\)/,
  );
  assert.match(catalog, /document\.addEventListener\("visibilitychange"/);
  assert.match(catalog, /window\.addEventListener\("online"/);
  assert.doesNotMatch(catalog, /setInterval|AbortController/);
});

test("review commands use the captured token while visible effects and busy state remain auth-generation guarded", async () => {
  const review = await readRepositoryFile(
    "src/domains/fiat-withdrawals/ui/admin/useAdminFiatWithdrawalReview.ts",
  );

  assert.match(review, /createAdminFiatWithdrawalAuthIdentity\(userId, accessToken\)/);
  assert.match(review, /createReviewFingerprint\(input/);
  assert.match(
    review,
    /input\.withdrawalId,[\s\S]*input\.action,[\s\S]*input\.adminNote/,
  );
  assert.match(review, /activeReview\.fingerprint === fingerprint/);
  assert.match(review, /return activeReview\.promise/);
  assert.match(review, /if \(activeReview\)[\s\S]*return Promise\.resolve\(false\)/);
  assert.match(review, /adminFiatWithdrawalGlobalReviewFlights\.run\(/);
  assert.match(
    review,
    /reviewAdminFiatWithdrawal\(expectedIdentity\.accessToken, input\)/,
  );
  assert.doesNotMatch(review, /AbortController|abort\(|signal:|getSession/);
  assert.ok(
    [...review.matchAll(/request\.isCurrent\(identityRef\.current\)/g)].length >= 3,
    "success, failure, and busy-state finalization must be generation guarded",
  );
  assert.match(review, /setBusyState\(createAdminFiatWithdrawalScopedValue\(/);
  assert.match(
    review,
    /readAdminFiatWithdrawalScopedValue\([\s\S]*busyState,[\s\S]*identity,[\s\S]*\)/,
  );
  assert.match(review, /"Withdrawal approved\."/);
  assert.match(review, /"Withdrawal rejected and refunded\."/);
  assert.match(review, /onAcceptedRef\.current\(\)/);
  assert.match(review, /getSafeErrorMessage\(error, "ADMIN"\)\.message/);
});

test("operations stores only a withdrawal id, re-derives the selected row, and preserves confirmations", async () => {
  const operations = await readRepositoryFile(
    "src/domains/fiat-withdrawals/ui/admin/useAdminFiatWithdrawalOperations.ts",
  );

  assert.match(
    operations,
    /type AdminFiatWithdrawalEditor = Readonly<\{[\s\S]*adminNote: string;[\s\S]*withdrawalId: string;[\s\S]*\}>/,
  );
  assert.match(
    operations,
    /catalog\.withdrawals\.find\([\s\S]*withdrawal\.id === editor\.withdrawalId,[\s\S]*\) \?\? null/,
  );
  assert.match(operations, /withdrawalId: withdrawal\.id/);
  assert.doesNotMatch(
    operations,
    /selectedWithdrawal:\s*withdrawal|withdrawal:\s*withdrawal/,
  );
  assert.match(operations, /setEditorState\(null\);[\s\S]*\}, \[identity\]\)/);
  assert.match(
    operations,
    /catalog\.withdrawalsLoaded && editor && !selectedWithdrawal/,
  );
  assert.match(
    operations,
    /clearEditor\(\);[\s\S]*setStatusFilterState\(filter\)/,
  );
  assert.match(operations, /adminNote: editor\.adminNote\.trim\(\) \|\| null/);
  assert.match(operations, /Approve this withdrawal request\?/);
  assert.match(
    operations,
    /Reject this withdrawal request and refund the full amount to the user wallet\?/,
  );
  assert.match(
    operations,
    /clearEditor\(\);[\s\S]*refreshWithdrawals\(\{[\s\S]*forceNewFlight: true,[\s\S]*resetRetryCount: true/,
  );
});

test("panel, list, detail, amount, and status badge preserve the established fiat-withdrawal presentation", async () => {
  const [panel, list, detail, amount, statusBadge] = await Promise.all([
    readRepositoryFile(
      "src/domains/fiat-withdrawals/ui/admin/AdminFiatWithdrawalOperationsPanel.tsx",
    ),
    readRepositoryFile(
      "src/domains/fiat-withdrawals/ui/admin/AdminFiatWithdrawalList.tsx",
    ),
    readRepositoryFile(
      "src/domains/fiat-withdrawals/ui/admin/AdminFiatWithdrawalDetail.tsx",
    ),
    readRepositoryFile(
      "src/domains/fiat-withdrawals/ui/admin/AdminFiatWithdrawalAmount.tsx",
    ),
    readRepositoryFile(
      "src/domains/fiat-withdrawals/ui/admin/AdminFiatWithdrawalStatusBadge.tsx",
    ),
  ]);

  assert.match(panel, /useAdminFiatWithdrawalOperations\(userId, accessToken\)/);
  assert.match(panel, /ADMIN_FIAT_WITHDRAWAL_FILTERS\.map/);
  assert.match(
    panel,
    /filter\.key === "pending" \? controller\.pendingCount : 0/,
  );
  assert.match(
    panel,
    /navigator\.clipboard\.writeText\(value\)\.then\(\(\) => toast\.success\("Copied!"\)\)/,
  );
  assert.match(panel, /controller\.selectedWithdrawal &&/);
  assert.match(panel, /onReview=\{controller\.submitReview\}/);

  assert.match(list, /\[1, 2, 3\]\.map/);
  assert.match(list, /skeleton h-16 rounded-xl/);
  assert.match(list, /No withdrawals found\./);
  assert.match(list, /@\{withdrawal\.username\}/);
  assert.match(list, /withdrawal\.status === "pending"/);
  assert.match(
    list,
    /ADMIN_FIAT_WITHDRAWAL_METHOD_LABELS\[withdrawal\.method\][\s\S]*\?\? withdrawal\.method/,
  );
  assert.match(list, /withdrawal\.account_name/);
  assert.match(list, /withdrawal\.account_last4/);
  assert.match(list, /AdminFiatWithdrawalAmount value=\{withdrawal\.amount\}/);
  assert.match(list, /AdminFiatWithdrawalStatusBadge status=\{withdrawal\.status\}/);

  for (const copy of [
    "Withdrawal Details",
    "User",
    "Phone",
    "Amount",
    "Net payout",
    "Fee",
    "Method",
    "Account Name",
    "Status",
    "Account Number",
    "Requested",
    "Reviewed",
    "Review Note (optional)",
    "Approve",
    "Reject",
  ]) {
    assert.match(
      detail,
      new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(detail, /withdrawal\.status === "pending"/);
  assert.match(detail, /onCopy\(withdrawal\.account_number\)/);
  assert.match(detail, /formatDateTime\(withdrawal\.created_at\)/);
  assert.match(detail, /formatDateTime\(withdrawal\.reviewed_at\)/);
  assert.match(detail, /withdrawal\.admin_note && withdrawal\.status !== "pending"/);
  assert.match(detail, /onReview\("approve"\)/);
  assert.match(detail, /onReview\("reject"\)/);

  assert.match(amount, /Number\(value \|\| 0\)\.toLocaleString\("en-US"/);
  assert.match(amount, /minimumFractionDigits: 2/);
  assert.match(amount, /maximumFractionDigits: 2/);
  assert.match(amount, /<CurrencyUnit \/>/);

  assert.match(statusBadge, /ADMIN_FIAT_WITHDRAWAL_STATUS\[status\]/);
  assert.match(
    statusBadge,
    /\{[\s\S]*label: status,[\s\S]*variant: "default" as const,[\s\S]*\}/,
  );
  assert.match(statusBadge, /<Badge variant=\{presentation\.variant\}>/);
});

test("admin route delegates fiat withdrawals through the client-safe domain facade", async () => {
  const [route, publicSurface] = await Promise.all([
    readRepositoryFile("src/routes/_app/admin.tsx"),
    readRepositoryFile("src/domains/fiat-withdrawals/public.ts"),
  ]);

  assert.match(
    route,
    /import \{ AdminFiatWithdrawalOperationsPanel \} from "@\/domains\/fiat-withdrawals\/public\.js";/,
  );
  assert.match(route, /activeTab === "withdrawals"/);
  assert.match(route, /<AdminFiatWithdrawalOperationsPanel/);
  assert.match(route, /accessToken=\{session\?\.access_token \?\? null\}/);
  assert.match(route, /userId=\{user\?\.id\}/);
  assert.doesNotMatch(
    route,
    /function WithdrawalsTab|function WithdrawalDetailPanel|type AdminWithdrawal\b|getAdminWithdrawalsFn|approveWithdrawalFn|rejectWithdrawalFn|WithdrawalStatusBadge/,
  );

  assert.match(
    publicSurface,
    /export \{ AdminFiatWithdrawalOperationsPanel \} from "\.\/ui\/admin\/AdminFiatWithdrawalOperationsPanel\.js";/,
  );
  assert.doesNotMatch(publicSurface, /export \*/);
  assert.doesNotMatch(
    publicSurface,
    /lib\/server|netlify\/functions|supabase-admin|service.role|createClient|\.from\(|\.rpc\(|fetch\(/i,
  );
});

test("admin withdrawal server contract keeps independent authorization, latest-100 filtering, enrichment, and exact RPC arguments", async () => {
  const server = await readRepositoryFile("src/lib/server/withdrawals.ts");
  const start = server.indexOf("async function requireActiveAdmin");
  assert.ok(start >= 0);
  const source = server.slice(start);

  assert.match(source, /admin\.auth\.getUser\(accessToken\)/);
  assert.match(
    source,
    /\.from\("profiles"\)[\s\S]*\.select\("id, is_admin, is_frozen"\)[\s\S]*\.eq\("id", authUser\.id\)[\s\S]*\.single\(\)/,
  );
  assert.match(
    source,
    /profile\.is_admin !== true \|\| profile\.is_frozen === true/,
  );
  assert.doesNotMatch(source, /data\.userId|data\.user_id/);

  assert.match(source, /export const getAdminWithdrawalsFn = createServerFn\(\{ method: "POST" \}\)/);
  assert.match(source, /await requireActiveAdmin\(data\.accessToken\)/);
  assert.match(
    source,
    /\.from\("withdrawals"\)[\s\S]*\.order\("created_at", \{ ascending: false \}\)[\s\S]*\.limit\(100\)/,
  );
  assert.match(source, /data\.statusFilter && data\.statusFilter !== "all"/);
  assert.match(source, /query = query\.eq\("status", data\.statusFilter\)/);
  assert.match(
    source,
    /\.from\("profiles"\)[\s\S]*\.select\("id, username, phone"\)[\s\S]*\.in\("id", userIds\)/,
  );
  assert.match(source, /username: profile\?\.username \?\? "Unknown"/);
  assert.match(source, /phone: profile\?\.phone \?\? ""/);
  assert.match(source, /account_number: row\.account_number \?\? ""/);
  assert.match(source, /account_last4: maskLast4\(row\.account_number\)/);

  assert.match(source, /export const approveWithdrawalFn = createServerFn\(\{ method: "POST" \}\)/);
  assert.match(source, /export const rejectWithdrawalFn = createServerFn\(\{ method: "POST" \}\)/);
  assert.ok(
    [...source.matchAll(/const adminId = await requireActiveAdmin\(data\.accessToken\)/g)].length >= 2,
  );
  assert.match(
    source,
    /"approve_withdrawal_tx",[\s\S]*p_admin_id: adminId,[\s\S]*p_withdrawal_id: data\.withdrawalId,[\s\S]*p_admin_note: data\.adminNote/,
  );
  assert.match(
    source,
    /"reject_withdrawal_tx",[\s\S]*p_admin_id: adminId,[\s\S]*p_withdrawal_id: data\.withdrawalId,[\s\S]*p_admin_note: data\.adminNote/,
  );
});

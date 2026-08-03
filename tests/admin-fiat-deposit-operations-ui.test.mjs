import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAdminFiatDepositAuthIdentity,
  createAdminFiatDepositCatalogKey,
  createAdminFiatDepositRetryPolicy,
  createAdminFiatDepositReviewFlights,
  createAdminFiatDepositScopedValue,
  createLatestAdminFiatDepositCatalogGuard,
  createLatestAdminFiatDepositReviewGuard,
  isSameAdminFiatDepositAuthIdentity,
  isSameAdminFiatDepositCatalogKey,
  readAdminFiatDepositScopedValue,
} from "../src/domains/fiat-deposits/application/admin-fiat-deposit-operations-auth-lifecycle.ts";
import {
  ADMIN_FIAT_DEPOSIT_FILTERS,
  ADMIN_FIAT_DEPOSIT_METHOD_LABELS,
  ADMIN_FIAT_DEPOSIT_STATUS,
  parseAdminFiatDepositVerifiedAmount,
  requiresManualFiatDepositReview,
} from "../src/domains/fiat-deposits/ui/admin/admin-fiat-deposit-operations-presentation.ts";

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

test("admin fiat-deposit identities and catalog keys bind exact auth and filter generations", () => {
  const identity = createAdminFiatDepositAuthIdentity("admin-a", "token-a");
  const sameIdentity = createAdminFiatDepositAuthIdentity("admin-a", "token-a");
  const refreshedToken = createAdminFiatDepositAuthIdentity("admin-a", "token-b");
  const replacementAdmin = createAdminFiatDepositAuthIdentity("admin-b", "token-a");

  assert.deepEqual(identity, { accessToken: "token-a", userId: "admin-a" });
  assert.ok(sameIdentity);
  assert.ok(refreshedToken);
  assert.ok(replacementAdmin);
  assert.equal(createAdminFiatDepositAuthIdentity(null, "token-a"), null);
  assert.equal(createAdminFiatDepositAuthIdentity("admin-a", null), null);
  assert.equal(isSameAdminFiatDepositAuthIdentity(identity, sameIdentity), true);
  assert.equal(isSameAdminFiatDepositAuthIdentity(identity, refreshedToken), false);
  assert.equal(isSameAdminFiatDepositAuthIdentity(identity, replacementAdmin), false);
  assert.equal(isSameAdminFiatDepositAuthIdentity(identity, null), false);

  const all = createAdminFiatDepositCatalogKey("admin-a", "token-a", "all");
  const sameAll = createAdminFiatDepositCatalogKey("admin-a", "token-a", "all");
  const pending = createAdminFiatDepositCatalogKey(
    "admin-a",
    "token-a",
    "pending",
  );
  const refreshedAll = createAdminFiatDepositCatalogKey(
    "admin-a",
    "token-b",
    "all",
  );

  assert.ok(all);
  assert.ok(sameAll);
  assert.ok(pending);
  assert.ok(refreshedAll);
  assert.equal(createAdminFiatDepositCatalogKey(null, "token-a", "all"), null);
  assert.equal(createAdminFiatDepositCatalogKey("admin-a", null, "all"), null);
  assert.equal(isSameAdminFiatDepositCatalogKey(all, sameAll), true);
  assert.equal(isSameAdminFiatDepositCatalogKey(all, pending), false);
  assert.equal(isSameAdminFiatDepositCatalogKey(all, refreshedAll), false);
  assert.equal(isSameAdminFiatDepositCatalogKey(all, null), false);

  const editor = createAdminFiatDepositScopedValue(identity, {
    depositId: "deposit-a",
  });
  assert.deepEqual(readAdminFiatDepositScopedValue(editor, sameIdentity), {
    depositId: "deposit-a",
  });
  assert.equal(readAdminFiatDepositScopedValue(editor, refreshedToken), null);
  assert.equal(readAdminFiatDepositScopedValue(editor, replacementAdmin), null);
});

test("latest catalog and review guards reject stale success, failure, and finalizer effects", async () => {
  const catalogGuard = createLatestAdminFiatDepositCatalogGuard();
  const reviewGuard = createLatestAdminFiatDepositReviewGuard();
  const all = createAdminFiatDepositCatalogKey("admin-a", "token-a", "all");
  const pending = createAdminFiatDepositCatalogKey(
    "admin-a",
    "token-a",
    "pending",
  );
  const adminA = createAdminFiatDepositAuthIdentity("admin-a", "token-a");
  const adminB = createAdminFiatDepositAuthIdentity("admin-b", "token-b");
  assert.ok(all);
  assert.ok(pending);
  assert.ok(adminA);
  assert.ok(adminB);

  let currentCatalogKey = all;
  let visibleRows = [];
  let retryCount = 0;
  let catalogFinalizers = 0;
  const oldCatalog = deferred();
  const oldCatalogTicket = catalogGuard.begin(all);
  const oldCatalogEffect = oldCatalog.promise.then(
    (rows) => {
      if (oldCatalogTicket.isCurrent(currentCatalogKey)) visibleRows = rows;
    },
    () => {
      if (oldCatalogTicket.isCurrent(currentCatalogKey)) retryCount += 1;
    },
  ).finally(() => {
    if (oldCatalogTicket.isCurrent(currentCatalogKey)) catalogFinalizers += 1;
  });

  currentCatalogKey = pending;
  catalogGuard.invalidate();
  const currentCatalogTicket = catalogGuard.begin(pending);
  assert.equal(oldCatalogTicket.isCurrent(currentCatalogKey), false);
  assert.equal(currentCatalogTicket.isCurrent(currentCatalogKey), true);
  oldCatalog.resolve([{ id: "stale" }]);
  await oldCatalogEffect;
  assert.deepEqual(visibleRows, []);
  assert.equal(retryCount, 0);
  assert.equal(catalogFinalizers, 0);

  let currentIdentity = adminA;
  let notices = 0;
  let accepted = 0;
  let reviewFinalizers = 0;
  const oldReview = deferred();
  const oldReviewTicket = reviewGuard.begin(adminA);
  const oldReviewEffect = oldReview.promise.then(
    () => {
      if (oldReviewTicket.isCurrent(currentIdentity)) accepted += 1;
    },
    () => {
      if (oldReviewTicket.isCurrent(currentIdentity)) notices += 1;
    },
  ).finally(() => {
    if (oldReviewTicket.isCurrent(currentIdentity)) reviewFinalizers += 1;
  });

  currentIdentity = adminB;
  reviewGuard.invalidate();
  const currentReviewTicket = reviewGuard.begin(adminB);
  oldReview.reject(new Error("stale review"));
  await oldReviewEffect;
  assert.equal(accepted, 0);
  assert.equal(notices, 0);
  assert.equal(reviewFinalizers, 0);
  assert.equal(oldReviewTicket.isCurrent(currentIdentity), false);
  assert.equal(currentReviewTicket.isCurrent(currentIdentity), true);
});

test("catalog retry admission is bounded and coalesced loads do not spend retries", () => {
  const retryPolicy = createAdminFiatDepositRetryPolicy(2);

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

test("global review flights coalesce exact commands and whenIdle awaits every accepted command", async () => {
  const flights = createAdminFiatDepositReviewFlights();
  const identity = createAdminFiatDepositAuthIdentity("admin-a", "token-a");
  assert.ok(identity);
  const approve = deferred();
  const reject = deferred();
  let approveCalls = 0;
  let rejectCalls = 0;

  const approveKey = {
    fingerprint: "deposit-a:approve:100",
    identity,
  };
  const firstApprove = flights.run(approveKey, async () => {
    approveCalls += 1;
    return approve.promise;
  });
  const duplicateApprove = flights.run(approveKey, async () => {
    approveCalls += 1;
    return "duplicate";
  });
  const independentReject = flights.run({
    fingerprint: "deposit-b:reject",
    identity,
  }, async () => {
    rejectCalls += 1;
    return reject.promise;
  });

  assert.equal(firstApprove, duplicateApprove);
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

  await Promise.resolve();
  const afterIdle = await flights.run(approveKey, async () => {
    approveCalls += 1;
    return "new-flight";
  });
  assert.equal(afterIdle, "new-flight");
  assert.equal(approveCalls, 2);
});

test("fiat-deposit operations presentation preserves filters, labels, and verified-amount parsing", () => {
  assert.deepEqual(ADMIN_FIAT_DEPOSIT_FILTERS, [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ]);
  assert.deepEqual(ADMIN_FIAT_DEPOSIT_METHOD_LABELS, {
    cbe: "CBE",
    telebirr: "TeleBirr",
  });
  assert.deepEqual(ADMIN_FIAT_DEPOSIT_STATUS, {
    approved: { label: "Approved", variant: "success" },
    pending: { label: "Pending", variant: "warning" },
    rejected: { label: "Rejected", variant: "danger" },
  });

  assert.equal(parseAdminFiatDepositVerifiedAmount("100"), 100);
  assert.equal(parseAdminFiatDepositVerifiedAmount("100.25"), 100.25);
  assert.equal(parseAdminFiatDepositVerifiedAmount("0.01"), 0.01);
  for (const invalid of ["", "0", "-1", "NaN", "Infinity", "text"]) {
    assert.equal(parseAdminFiatDepositVerifiedAmount(invalid), null, invalid);
  }
  assert.equal(requiresManualFiatDepositReview("Verifier review: mismatch"), true);
  assert.equal(requiresManualFiatDepositReview("verifier review: mismatch"), false);
  assert.equal(requiresManualFiatDepositReview("Approved normally"), false);
  assert.equal(requiresManualFiatDepositReview(null), false);
});

test("browser service owns only the exact catalog and review HTTP contracts", async () => {
  const service = await readRepositoryFile(
    "src/domains/fiat-deposits/application/admin-fiat-deposit-operations-browser-service.ts",
  );

  assert.match(service, /import \{ getAdminDepositsFn \} from "@\/lib\/server\/deposits\.js";/);
  assert.match(service, /return getAdminDepositsFn\(\{[\s\S]*data: \{[\s\S]*accessToken,[\s\S]*statusFilter,[\s\S]*\},[\s\S]*\}\);/);
  assert.doesNotMatch(service, /userId|user_id|supabase|service.role/i);

  assert.match(service, /request\("\/api\/admin\/approve-deposit", \{/);
  assert.match(service, /method: "POST"/);
  assert.match(service, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(service, /"Content-Type": "application\/json"/);
  assert.match(service, /body: JSON\.stringify\(\{[\s\S]*depositId: input\.depositId,[\s\S]*action: input\.action,[\s\S]*adminNote: input\.adminNote,/);
  assert.match(
    service,
    /input\.action === "approve"[\s\S]*\{ verifiedAmount: input\.verifiedAmount \}[\s\S]*: \{\}/,
  );
  assert.doesNotMatch(
    service,
    /body: JSON\.stringify\(\{[\s\S]*verifiedAmount: input\.verifiedAmount,[\s\S]*\}\)/,
  );
  assert.match(service, /const result = await response\.json\(\)/);
  assert.match(service, /!response\.ok \|\| result\.success !== true/);
  assert.match(service, /result\.message \|\| "Failed to review deposit\."/);
  assert.doesNotMatch(service, /AbortController|abort\(|signal:/);
});

test("catalog waits for durable reviews and keeps timeout, coalescing, and stale-publication guards", async () => {
  const catalog = await readRepositoryFile(
    "src/domains/fiat-deposits/ui/admin/useAdminFiatDepositCatalog.ts",
  );

  assert.match(catalog, /ADMIN_FIAT_DEPOSIT_LOAD_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(catalog, /ADMIN_FIAT_DEPOSIT_RETRY_DELAY_MS\s*=\s*1_500/);
  assert.match(catalog, /ADMIN_FIAT_DEPOSIT_MAX_AUTO_RETRIES\s*=\s*2/);
  assert.match(catalog, /Admin deposits request timed out\./);
  assert.match(catalog, /createAdminFiatDepositCatalogKey\([\s\S]*userId,[\s\S]*accessToken,[\s\S]*statusFilter/);
  assert.match(catalog, /activeLoadRef/);
  assert.match(catalog, /isSameAdminFiatDepositCatalogKey\(activeLoad\.key, expectedKey\)/);
  assert.match(catalog, /return activeLoad\.promise/);
  assert.match(catalog, /forceNewFlight/);
  assert.match(catalog, /Symbol\("admin-fiat-deposit-catalog-flight"\)/);
  assert.match(catalog, /activeLoadRef\.current\?\.token === flightToken/);

  const waitIndex = catalog.indexOf("adminFiatDepositGlobalReviewFlights.whenIdle()");
  const loadIndex = catalog.indexOf("loadAdminFiatDeposits(", waitIndex);
  assert.ok(waitIndex >= 0, "catalog must wait for accepted review commands");
  assert.ok(loadIndex > waitIndex, "catalog read must start after reviews become idle");
  assert.ok(
    [...catalog.matchAll(/request\.isCurrent\(requestKeyRef\.current\)/g)].length >= 3,
    "wait, success, and failure publication must be generation guarded",
  );
  assert.match(catalog, /requestGuardRef\.current\.invalidate\(\)/);
  assert.match(catalog, /setSnapshot\(null\)/);
  assert.match(catalog, /isSameAdminFiatDepositCatalogKey\(snapshot\.key, requestKey\)/);
  assert.match(catalog, /document\.addEventListener\("visibilitychange"/);
  assert.match(catalog, /window\.addEventListener\("online"/);
  assert.doesNotMatch(catalog, /setInterval|AbortController/);
});

test("review commands remain durable while every visible effect is auth-generation guarded", async () => {
  const review = await readRepositoryFile(
    "src/domains/fiat-deposits/ui/admin/useAdminFiatDepositReview.ts",
  );

  assert.match(review, /createAdminFiatDepositAuthIdentity\(userId, accessToken\)/);
  assert.match(review, /createReviewFingerprint\(input/);
  assert.match(review, /input\.depositId,[\s\S]*input\.action,[\s\S]*input\.adminNote,[\s\S]*input\.verifiedAmount \?\? null/);
  assert.match(review, /activeReview\.fingerprint === fingerprint/);
  assert.match(review, /return activeReview\.promise/);
  assert.match(review, /if \(activeReview\)[\s\S]*return Promise\.resolve\(false\)/);
  assert.match(review, /adminFiatDepositGlobalReviewFlights\.run\(/);
  assert.match(review, /reviewAdminFiatDeposit\([\s\S]*expectedIdentity\.accessToken,[\s\S]*input/);
  assert.doesNotMatch(review, /AbortController|abort\(|signal:|getSession/);
  assert.ok(
    [...review.matchAll(/request\.isCurrent\(identityRef\.current\)/g)].length >= 3,
    "success, failure, and busy-state finalization must be generation guarded",
  );
  assert.match(review, /setBusyState\(createAdminFiatDepositScopedValue\(/);
  assert.match(review, /readAdminFiatDepositScopedValue\(busyState, identity\)/);
  assert.match(review, /Deposit \$\{input\.action === "approve" \? "approved" : "rejected"\}\./);
  assert.match(review, /onAcceptedRef\.current\(\)/);
  assert.match(review, /getSafeErrorMessage\(error, "ADMIN"\)\.message/);
});

test("operations stores only a deposit id and always derives the selected row from the latest catalog", async () => {
  const operations = await readRepositoryFile(
    "src/domains/fiat-deposits/ui/admin/useAdminFiatDepositOperations.ts",
  );

  assert.match(operations, /type AdminFiatDepositEditor = Readonly<\{[\s\S]*adminNote: string;[\s\S]*approvalAmount: string;[\s\S]*depositId: string;[\s\S]*\}>/);
  assert.match(
    operations,
    /catalog\.deposits\.find\(\(deposit\) => deposit\.id === editor\.depositId\) \?\? null/,
  );
  assert.match(operations, /depositId: deposit\.id/);
  assert.doesNotMatch(operations, /selectedDeposit:\s*deposit|deposit:\s*deposit/);
  assert.match(operations, /setEditorState\(null\);[\s\S]*\}, \[identity\]\)/);
  assert.match(operations, /catalog\.depositsLoaded && editor && !selectedDeposit/);
  assert.match(operations, /clearEditor\(\);[\s\S]*setStatusFilterState\(filter\)/);
  assert.match(operations, /parseAdminFiatDepositVerifiedAmount\(editor\.approvalAmount\)/);
  assert.match(operations, /Enter the verified receipt amount before approving\./);
  assert.match(operations, /adminNote: editor\.adminNote \|\| null/);
  assert.match(
    operations,
    /input\.action|action === "approve" \? \{ verifiedAmount: verifiedAmount! \} : \{\}/,
  );
  assert.match(operations, /clearEditor\(\);[\s\S]*catalog\.refreshDeposits\(\{[\s\S]*forceNewFlight: true,[\s\S]*resetRetryCount: true/);
});

test("panel, list, and detail preserve the established deposit review presentation", async () => {
  const [panel, list, detail, amount] = await Promise.all([
    readRepositoryFile(
      "src/domains/fiat-deposits/ui/admin/AdminFiatDepositOperationsPanel.tsx",
    ),
    readRepositoryFile(
      "src/domains/fiat-deposits/ui/admin/AdminFiatDepositList.tsx",
    ),
    readRepositoryFile(
      "src/domains/fiat-deposits/ui/admin/AdminFiatDepositDetail.tsx",
    ),
    readRepositoryFile(
      "src/domains/fiat-deposits/ui/admin/AdminFiatDepositAmount.tsx",
    ),
  ]);

  assert.match(panel, /useAdminFiatDepositOperations\(userId, accessToken\)/);
  assert.match(panel, /ADMIN_FIAT_DEPOSIT_FILTERS\.map/);
  assert.match(panel, /filter\.key === "pending" \? controller\.pendingCount : 0/);
  assert.match(panel, /navigator\.clipboard\.writeText\(value\)\.then\(\(\) => toast\.success\("Copied!"\)\)/);
  assert.match(panel, /controller\.selectedDeposit &&/);
  assert.match(panel, /onReview=\{controller\.submitReview\}/);

  assert.match(list, /\[1, 2, 3\]\.map/);
  assert.match(list, /skeleton h-14 rounded-xl/);
  assert.match(list, /No deposits found\./);
  assert.match(list, /@\{deposit\.username\}/);
  assert.match(list, /deposit\.status === "pending"/);
  assert.match(list, /Verifier Review/);
  assert.match(list, /ADMIN_FIAT_DEPOSIT_METHOD_LABELS\[deposit\.method_type\][\s\S]*\?\? deposit\.method_type/);
  assert.match(list, /formatDateTime\(deposit\.created_at\)/);
  assert.match(list, /deposit\.amount > 0[\s\S]*AdminFiatDepositAmount/);
  assert.match(list, /status\?\.label \?\? deposit\.status/);

  for (const copy of [
    "Deposit Details",
    "User",
    "Phone",
    "Amount",
    "Method",
    "Account",
    "Status",
    "Transaction ID",
    "Manual Review Required",
    "Open Receipt",
    "Verified Amount (ETB)",
    "Verification Note (optional)",
    "Approve",
    "Reject",
  ]) {
    assert.match(detail, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(detail, /onCopy\(deposit\.transaction_reference\)/);
  assert.match(detail, /target="_blank"/);
  assert.match(detail, /rel="noopener noreferrer"/);
  assert.match(detail, /deposit\.status === "pending"/);
  assert.match(detail, /min="100"/);
  assert.match(detail, /step="0\.01"/);
  assert.match(detail, /User entered:/);
  assert.match(detail, /User did not specify amount/);

  assert.match(amount, /Number\(value \|\| 0\)\.toLocaleString\("en-US"/);
  assert.match(amount, /minimumFractionDigits: 2/);
  assert.match(amount, /maximumFractionDigits: 2/);
  assert.match(amount, /<CurrencyUnit \/>/);
});

test("admin route delegates deposits through the client-safe fiat-deposits facade", async () => {
  const [route, publicSurface] = await Promise.all([
    readRepositoryFile("src/routes/_app/admin.tsx"),
    readRepositoryFile("src/domains/fiat-deposits/public.ts"),
  ]);

  assert.match(
    route,
    /AdminFiatDepositOperationsPanel,[\s\S]*from "@\/domains\/fiat-deposits\/public\.js"/,
  );
  assert.match(route, /activeTab === "deposits"/);
  assert.match(route, /<AdminFiatDepositOperationsPanel/);
  assert.match(route, /accessToken=\{session\?\.access_token \?\? null\}/);
  assert.match(route, /userId=\{user\?\.id\}/);
  assert.doesNotMatch(
    route,
    /function DepositsTab|function DepositDetailPanel|type AdminDeposit\b|getAdminDepositsFn|\/api\/admin\/approve-deposit/,
  );

  assert.match(
    publicSurface,
    /export \{ AdminFiatDepositOperationsPanel \} from "\.\/ui\/admin\/AdminFiatDepositOperationsPanel\.js";/,
  );
  assert.doesNotMatch(publicSurface, /export \*/);
  assert.doesNotMatch(
    publicSurface,
    /lib\/server|netlify\/functions|supabase-admin|service.role|createClient|\.from\(|\.rpc\(|fetch\(/i,
  );
});

test("admin deposit list server retains independent authorization, filtering, latest-100, and enrichment", async () => {
  const server = await readRepositoryFile("src/lib/server/deposits.ts");
  const start = server.indexOf("export const getAdminDepositsFn");
  assert.ok(start >= 0);
  const source = server.slice(start);

  assert.match(source, /createServerFn\(\{ method: "POST" \}\)/);
  assert.match(source, /typeof accessToken !== "string" \|\| !accessToken/);
  assert.match(source, /admin\.auth\.getUser\(data\.accessToken\)/);
  assert.match(source, /\.from\("profiles"\)[\s\S]*\.select\("is_admin, is_frozen"\)[\s\S]*\.eq\("id", authUser\.id\)[\s\S]*\.single\(\)/);
  assert.match(source, /profile\.is_admin !== true \|\| profile\.is_frozen === true/);
  assert.doesNotMatch(source, /data\.userId|data\.user_id/);
  assert.match(source, /\.from\("deposits"\)[\s\S]*\.select\("\*"\)[\s\S]*\.order\("created_at", \{ ascending: false \}\)[\s\S]*\.limit\(100\)/);
  assert.match(source, /data\.statusFilter && data\.statusFilter !== "all"/);
  assert.match(source, /query\.eq\("status", data\.statusFilter/);
  assert.match(source, /\.from\("profiles"\)[\s\S]*\.select\("id, username, phone"\)[\s\S]*\.in\("id", userIds\)/);
  assert.match(source, /\.from\("payment_methods"\)[\s\S]*\.select\("id, type, account_name, account_number, account_last_8"\)[\s\S]*\.in\("id", methodIds\)/);
  assert.match(source, /generateReceiptUrl\([\s\S]*method\.type,[\s\S]*d\.transaction_reference,[\s\S]*method\.account_last_8/);
  assert.match(source, /username: prof\?\.username \?\? "Unknown"/);
  assert.match(source, /phone: prof\?\.phone \?\? ""/);
  assert.match(source, /method_type: method\?\.type \?\? "unknown"/);
  assert.match(source, /method_account: method\?\.account_name \?\? "Unknown"/);
  assert.match(source, /method_number: method\?\.account_number \?\? ""/);
});

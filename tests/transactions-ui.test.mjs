import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  TRANSACTION_HISTORY_FILTERS,
} from "../src/domains/accounts/domain/transaction-history.ts";
import {
  createAuthenticatedScopedRequestKey,
  createLatestAuthenticatedScopedRequestGuard,
  createRequestRetryPolicy,
  isSameAuthenticatedScopedRequestKey,
} from "../src/domains/accounts/application/authenticated-request-lifecycle.ts";

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

test("transaction filters preserve the complete visible and server filter contract", () => {
  assert.deepEqual(TRANSACTION_HISTORY_FILTERS, [
    { key: "all", label: "All" },
    { key: "deposit", label: "Deposits" },
    { key: "withdrawal", label: "Withdrawals" },
    { key: "earning", label: "Earnings" },
    { key: "referral_bonus", label: "Referrals" },
    { key: "plan_purchase", label: "Investments" },
  ]);
});

test("transaction request keys bind exact user, token, and filter generations", () => {
  const all = createAuthenticatedScopedRequestKey("user-a", "token-a", "all");
  const same = createAuthenticatedScopedRequestKey("user-a", "token-a", "all");
  const refreshedToken = createAuthenticatedScopedRequestKey("user-a", "token-b", "all");
  const replacementUser = createAuthenticatedScopedRequestKey("user-b", "token-a", "all");
  const differentFilter = createAuthenticatedScopedRequestKey("user-a", "token-a", "deposit");

  assert.ok(all);
  assert.ok(same);
  assert.ok(refreshedToken);
  assert.ok(replacementUser);
  assert.ok(differentFilter);
  assert.equal(createAuthenticatedScopedRequestKey(null, "token-a", "all"), null);
  assert.equal(createAuthenticatedScopedRequestKey("user-a", null, "all"), null);
  assert.equal(isSameAuthenticatedScopedRequestKey(all, same), true);
  assert.equal(isSameAuthenticatedScopedRequestKey(all, refreshedToken), false);
  assert.equal(isSameAuthenticatedScopedRequestKey(all, replacementUser), false);
  assert.equal(isSameAuthenticatedScopedRequestKey(all, differentFilter), false);
  assert.equal(isSameAuthenticatedScopedRequestKey(all, null), false);

  const guard = createLatestAuthenticatedScopedRequestGuard();
  const older = guard.begin(all);
  const newer = guard.begin(same);
  assert.equal(older.isCurrent(all), false);
  assert.equal(newer.isCurrent(same), true);
  guard.invalidate();
  assert.equal(newer.isCurrent(same), false);
});

test("late transaction success and failure cannot cross auth or filter generations", async () => {
  const successGuard = createLatestAuthenticatedScopedRequestGuard();
  const failureGuard = createLatestAuthenticatedScopedRequestGuard();
  const userAAll = createAuthenticatedScopedRequestKey("user-a", "token-a", "all");
  const userBDeposits = createAuthenticatedScopedRequestKey("user-b", "token-b", "deposit");
  assert.ok(userAAll);
  assert.ok(userBDeposits);

  let currentKey = userAAll;
  let visibleRows = [];
  let scheduledRetries = 0;
  const oldSuccess = deferred();
  const oldFailure = deferred();
  const oldSuccessTicket = successGuard.begin(userAAll);
  const oldFailureTicket = failureGuard.begin(userAAll);
  const oldSuccessCommit = oldSuccess.promise.then((rows) => {
    if (oldSuccessTicket.isCurrent(currentKey)) visibleRows = rows;
  });
  const oldFailureCommit = oldFailure.promise.catch(() => {
    if (oldFailureTicket.isCurrent(currentKey)) scheduledRetries += 1;
  });

  currentKey = userBDeposits;
  successGuard.invalidate();
  failureGuard.invalidate();
  visibleRows = [];
  const replacement = deferred();
  const replacementTicket = successGuard.begin(userBDeposits);
  const replacementCommit = replacement.promise.then((rows) => {
    if (replacementTicket.isCurrent(currentKey)) visibleRows = rows;
  });

  replacement.resolve([{ id: "transaction-b" }]);
  await replacementCommit;
  oldSuccess.resolve([{ id: "transaction-a" }]);
  oldFailure.reject(new Error("stale failure"));
  await Promise.all([oldSuccessCommit, oldFailureCommit]);

  assert.deepEqual(visibleRows, [{ id: "transaction-b" }]);
  assert.equal(scheduledRetries, 0);
  assert.equal(oldSuccessTicket.isCurrent(currentKey), false);
  assert.equal(oldFailureTicket.isCurrent(currentKey), false);
  assert.equal(replacementTicket.isCurrent(currentKey), true);
});

test("sign-out and token refresh invalidate the previous transaction generation", () => {
  const guard = createLatestAuthenticatedScopedRequestGuard();
  const original = createAuthenticatedScopedRequestKey("user-a", "token-a", "all");
  const refreshed = createAuthenticatedScopedRequestKey("user-a", "token-b", "all");
  assert.ok(original);
  assert.ok(refreshed);

  const originalTicket = guard.begin(original);
  assert.equal(originalTicket.isCurrent(original), true);

  guard.invalidate();
  assert.equal(originalTicket.isCurrent(null), false);
  assert.equal(originalTicket.isCurrent(refreshed), false);

  const refreshedTicket = guard.begin(refreshed);
  assert.equal(originalTicket.isCurrent(refreshed), false);
  assert.equal(refreshedTicket.isCurrent(refreshed), true);
});

test("a filter replacement wins while the older same-user request is unresolved", async () => {
  const guard = createLatestAuthenticatedScopedRequestGuard();
  const all = createAuthenticatedScopedRequestKey("user-a", "token-a", "all");
  const deposits = createAuthenticatedScopedRequestKey("user-a", "token-a", "deposit");
  assert.ok(all);
  assert.ok(deposits);

  let currentKey = all;
  let visibleRows = [];
  const allResult = deferred();
  const allTicket = guard.begin(all);
  const allCommit = allResult.promise.then((rows) => {
    if (allTicket.isCurrent(currentKey)) visibleRows = rows;
  });

  currentKey = deposits;
  const depositResult = deferred();
  const depositTicket = guard.begin(deposits);
  const depositCommit = depositResult.promise.then((rows) => {
    if (depositTicket.isCurrent(currentKey)) visibleRows = rows;
  });
  depositResult.resolve([{ id: "deposit" }]);
  await depositCommit;
  allResult.resolve([{ id: "older-all" }]);
  await allCommit;

  assert.deepEqual(visibleRows, [{ id: "deposit" }]);
  assert.equal(allTicket.isCurrent(currentKey), false);
  assert.equal(depositTicket.isCurrent(currentKey), true);
});

test("retry policy does not let coalesced refreshes reset an active budget", () => {
  const retryPolicy = createRequestRetryPolicy(2);

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

test("a scheduled retry is admitted only for its captured request key", () => {
  const scheduledKey = createAuthenticatedScopedRequestKey("user-a", "token-a", "all");
  const refreshedToken = createAuthenticatedScopedRequestKey("user-a", "token-b", "all");
  const changedFilter = createAuthenticatedScopedRequestKey("user-a", "token-a", "withdrawal");
  assert.ok(scheduledKey);
  assert.ok(refreshedToken);
  assert.ok(changedFilter);

  assert.equal(isSameAuthenticatedScopedRequestKey(scheduledKey, scheduledKey), true);
  assert.equal(isSameAuthenticatedScopedRequestKey(refreshedToken, scheduledKey), false);
  assert.equal(isSameAuthenticatedScopedRequestKey(changedFilter, scheduledKey), false);
  assert.equal(isSameAuthenticatedScopedRequestKey(null, scheduledKey), false);
});

test("transactions UI preserves presentation and authenticated lifecycle contracts", async () => {
  const [page, tabs, list, controller] = await Promise.all([
    readRepositoryFile("src/domains/accounts/ui/transactions/TransactionsPage.tsx"),
    readRepositoryFile("src/domains/accounts/ui/transactions/TransactionFilterTabs.tsx"),
    readRepositoryFile("src/domains/accounts/ui/transactions/TransactionHistoryList.tsx"),
    readRepositoryFile("src/domains/accounts/ui/transactions/useTransactionHistory.ts"),
  ]);
  const visibleUi = `${page}\n${tabs}\n${list}`;

  for (const copy of [
    "Transactions",
    "records",
    "No transactions found",
    "Done",
    "Pending",
    "Failed",
  ]) {
    assert.match(visibleUi, new RegExp(copy));
  }
  assert.match(list, /\[1, 2, 3, 4, 5\]/);
  assert.match(list, /AmountText value=\{signedAmount\} showSign size="sm"/);
  assert.match(list, /TxIcon/);
  assert.match(list, /txTitle/);
  assert.match(list, /txSubtitle/);
  assert.match(list, /isOutgoingTx/);
  assert.match(list, /formatDateTime/);

  assert.match(controller, /createAuthenticatedScopedRequestKey/);
  assert.match(controller, /createLatestAuthenticatedScopedRequestGuard/);
  assert.match(controller, /requestGuardRef\.current\.invalidate\(\)/);
  assert.ok(
    [...controller.matchAll(/request\.isCurrent\(keyRef\.current\)/g)].length >= 2,
    "success and failure paths must be exact-key gated",
  );
  assert.match(controller, /setSnapshot\(null\)/);
  assert.match(controller, /activeFlightRef\.current = null/);
  assert.match(controller, /Symbol\("transaction-history-flight"\)/);
  assert.match(controller, /activeFlightRef\.current\?\.token === flightToken/);
  assert.match(controller, /isSameAuthenticatedScopedRequestKey\(snapshot\.key, requestKey\)/);
  assert.match(controller, /TRANSACTIONS_LOAD_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(controller, /AUTO_RETRY_DELAY_MS\s*=\s*1_500/);
  assert.match(controller, /MAX_AUTO_RETRIES\s*=\s*2/);
  assert.match(
    controller,
    /useEffect\(\(\) => \{[\s\S]*document\.addEventListener\("visibilitychange"/,
  );
  assert.match(
    controller,
    /useEffect\(\(\) => \{[\s\S]*window\.addEventListener\("online"/,
  );
  assert.match(controller, /if \(!key \|\| !isSameAuthenticatedScopedRequestKey/);
});

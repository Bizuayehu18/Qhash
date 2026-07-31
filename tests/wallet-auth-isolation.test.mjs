import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAuthenticatedRequestIdentity,
  createLatestAuthenticatedRequestGuard,
} from "../src/domains/accounts/application/authenticated-request-lifecycle.ts";
import { createWalletRequestGuard } from "../src/store/wallet-request-guard.ts";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("wallet request ownership rejects a late result after an A-to-B auth switch", async () => {
  const guard = createWalletRequestGuard();
  let currentUserId = "user-a";
  let visibleBalance = null;
  guard.activateUser(currentUserId);

  const userAResult = deferred();
  const userATicket = guard.begin(currentUserId);
  const userACommit = userAResult.promise.then((balance) => {
    if (userATicket.isCurrent(currentUserId)) visibleBalance = balance;
  });

  currentUserId = "user-b";
  guard.activateUser(currentUserId);
  const userBResult = deferred();
  const userBTicket = guard.begin(currentUserId);
  const userBCommit = userBResult.promise.then((balance) => {
    if (userBTicket.isCurrent(currentUserId)) visibleBalance = balance;
  });

  userBResult.resolve(22);
  await userBCommit;
  userAResult.resolve(11);
  await userACommit;

  assert.equal(userATicket.isCurrent(currentUserId), false);
  assert.equal(userBTicket.isCurrent(currentUserId), true);
  assert.equal(visibleBalance, 22);
});

test("wallet reset and a newer same-user request invalidate older tickets", () => {
  const guard = createWalletRequestGuard();
  guard.activateUser("user-a");
  const first = guard.begin("user-a");
  const second = guard.begin("user-a");

  assert.equal(first.isCurrent("user-a"), false);
  assert.equal(second.isCurrent("user-a"), true);

  guard.invalidate();
  assert.equal(second.isCurrent("user-a"), false);
});

test("dashboard requests and visible data stay inside one exact auth generation", async () => {
  const guard = createLatestAuthenticatedRequestGuard();
  const userA = createAuthenticatedRequestIdentity("user-a", "token-a");
  const userB = createAuthenticatedRequestIdentity("user-b", "token-b");
  assert.ok(userA);
  assert.ok(userB);

  let currentIdentity = userA;
  let visibleDashboard = null;
  const userAResult = deferred();
  const userATicket = guard.begin(userA);
  const userACommit = userAResult.promise.then((dashboard) => {
    if (userATicket.isCurrent(currentIdentity)) visibleDashboard = dashboard;
  });

  currentIdentity = userB;
  guard.invalidate();
  visibleDashboard = null;
  const userBResult = deferred();
  const userBTicket = guard.begin(userB);
  const userBCommit = userBResult.promise.then((dashboard) => {
    if (userBTicket.isCurrent(currentIdentity)) visibleDashboard = dashboard;
  });

  userBResult.resolve({ balance: 22, owner: "user-b" });
  await userBCommit;
  userAResult.resolve({ balance: 11, owner: "user-a" });
  await userACommit;

  assert.equal(userATicket.isCurrent(currentIdentity), false);
  assert.equal(userBTicket.isCurrent(currentIdentity), true);
  assert.deepEqual(visibleDashboard, { balance: 22, owner: "user-b" });
});

test("shared wallet store keys cache, in-flight work, and writes to the active user", async () => {
  const [store, sync, dashboard, dashboardBridge, dashboardRemote, plans, profile, fiatRemoteState] = await Promise.all([
    readRepositoryFile("src/store/walletStore.ts"),
    readRepositoryFile("src/hooks/useWalletSync.ts"),
    readRepositoryFile("src/routes/_app/dashboard.tsx"),
    readRepositoryFile("src/domains/accounts/application/dashboard-browser-service.ts"),
    readRepositoryFile("src/domains/accounts/ui/useDashboardRemoteState.ts"),
    readRepositoryFile("src/routes/_app/plans.tsx"),
    readRepositoryFile("src/routes/_app/profile.tsx"),
    readRepositoryFile(
      "src/domains/fiat-withdrawals/ui/useFiatWithdrawalRemoteState.ts",
    ),
  ]);

  assert.match(store, /activeUserId: string \| null/);
  assert.match(store, /_inFlightUserId: string \| null/);
  assert.match(store, /state\.activeUserId !== userId/);
  assert.match(store, /state\._inFlight && state\._inFlightUserId === userId/);
  assert.match(store, /session\.user\.id !== userId/);
  assert.match(store, /setBalanceForUser: \(userId: string, balance: number\)/);
  assert.match(store, /walletRequestGuard\.invalidate\(\)/);
  assert.match(store, /if \(isCurrentRequest\(\)\)/);
  assert.match(sync, /startPolling\(user\.id\)/);

  for (const consumer of [plans, profile, fiatRemoteState]) {
    assert.match(consumer, /activeUserId === user\?\.id \? .*\.balance : null/s);
  }
  assert.match(dashboardRemote, /activeUserId === userId \? state\.balance : null/s);
  assert.match(dashboard, /useDashboardRemoteState/);
  assert.doesNotMatch(dashboard, /data\?\.wallet\.balance|walletBalance/);
  assert.match(dashboardBridge, /loadDashboardFn/);
  assert.match(dashboardBridge, /getPlansFn/);
  assert.doesNotMatch(dashboardRemote, /@\/lib\/server\//);
  assert.match(dashboardRemote, /createLatestAuthenticatedRequestGuard/);
  assert.match(dashboardRemote, /request\.isCurrent\(identityRef\.current\)/);
  assert.match(dashboardRemote, /setSnapshot\(null\)/);
  assert.match(dashboardRemote, /setWalletBalance\(identity\.userId/);
  assert.match(plans, /setBalanceForUser/);
  assert.doesNotMatch(`${store}\n${dashboardRemote}\n${plans}`, /\bsetBalance\s*:/);
});

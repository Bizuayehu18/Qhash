import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createLatestPlansRequestGuard,
  createPlansAuthIdentity,
  createPlansPurchaseFlightGuard,
  isSamePlansAuthIdentity,
  reconcilePlansPurchaseFlight,
} from "../src/domains/plans/application/plans-auth-lifecycle.ts";
import {
  getPlanCardSummary,
  getPlanEligibilityRows,
  getPlanLockReason,
} from "../src/domains/plans/domain/plan-eligibility.ts";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

test("plans UI is decomposed while preserving the existing contract presentation", async () => {
  const [
    page,
    controller,
    card,
    eligibility,
    details,
    domainRules,
  ] = await Promise.all([
    readRepositoryFile("src/domains/plans/ui/PlansPage.tsx"),
    readRepositoryFile("src/domains/plans/ui/usePlansCatalog.ts"),
    readRepositoryFile("src/domains/plans/ui/PlanCard.tsx"),
    readRepositoryFile("src/domains/plans/ui/PlanEligibilityProgress.tsx"),
    readRepositoryFile("src/domains/plans/ui/PlanDetailsDialog.tsx"),
    readRepositoryFile("src/domains/plans/domain/plan-eligibility.ts"),
  ]);
  const ui = `${page}\n${card}\n${eligibility}\n${details}\n${domainRules}`;

  assert.match(page, /usePlansCatalog/);
  assert.match(page, /<PlanCard/);
  assert.match(page, /<PlanDetailsDialog/);
  assert.doesNotMatch(page, /@\/lib\/server\//);
  assert.doesNotMatch(controller, /@\/lib\/server\//);

  for (const label of [
    "Mining Contracts",
    "QHash Contract Plans",
    "Fixed-duration mining contracts with purchase-time eligibility.",
    "Popular",
    "Open",
    "Locked",
    "Purchase",
    "Details",
    "Invest",
    "Daily",
    "Total",
    "Direct referrals",
    "Level 2 referrals",
    "Level 3 referrals",
    "Active limit reached",
    "No referral requirement",
    "Your Wallet",
    "Checking Wallet",
    "Insufficient balance. Deposit funds to continue.",
    "Confirm Purchase",
  ]) {
    assert.match(ui, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(ui, /CurrencyUnit/);
  assert.match(ui, /to="\/deposit"/);
  assert.match(ui, /daily_earning \* .*duration_days/s);
  assert.match(ui, /activePlanCount/);
  assert.match(ui, /maxActivePerUser/);
});

test("plans eligibility rules preserve referral and limit precedence", () => {
  const basePlan = {
    eligibility: {
      activeLevel1Referrals: 0,
      activeLevel2Referrals: 0,
      activeLevel3Referrals: 0,
      activePlanCount: 0,
      isEligible: true,
      limitReached: false,
      maxActivePerUser: 1,
      referralRequirementMet: true,
      requiredLevel1Referrals: 0,
      requiredLevel2Referrals: 0,
      requiredLevel3Referrals: 0,
    },
  };

  assert.deepEqual(getPlanEligibilityRows(basePlan), []);
  assert.equal(getPlanCardSummary(basePlan), "No referral requirement");

  const missingDirectReferrals = {
    ...basePlan,
    eligibility: {
      ...basePlan.eligibility,
      isEligible: false,
      referralRequirementMet: false,
      requiredLevel1Referrals: 2,
    },
  };
  assert.deepEqual(getPlanEligibilityRows(missingDirectReferrals), [{
    current: 0,
    label: "Direct referrals",
    required: 2,
  }]);
  assert.equal(
    getPlanLockReason(missingDirectReferrals),
    "Requires 2 more active direct referrals.",
  );

  const limitReached = {
    ...missingDirectReferrals,
    eligibility: {
      ...missingDirectReferrals.eligibility,
      activePlanCount: 1,
      limitReached: true,
    },
  };
  assert.equal(getPlanLockReason(limitReached), "Active limit reached (1/1).");
});

test("plans request identity includes the exact user and access-token generation", () => {
  const identity = createPlansAuthIdentity("user-a", "token-a");
  const sameIdentity = createPlansAuthIdentity("user-a", "token-a");
  const refreshedToken = createPlansAuthIdentity("user-a", "token-b");
  const replacementUser = createPlansAuthIdentity("user-b", "token-a");

  assert.ok(identity);
  assert.ok(sameIdentity);
  assert.ok(refreshedToken);
  assert.ok(replacementUser);
  assert.equal(createPlansAuthIdentity(null, "token-a"), null);
  assert.equal(createPlansAuthIdentity("user-a", null), null);
  assert.equal(isSamePlansAuthIdentity(identity, sameIdentity), true);
  assert.equal(isSamePlansAuthIdentity(identity, refreshedToken), false);
  assert.equal(isSamePlansAuthIdentity(identity, replacementUser), false);
  assert.equal(isSamePlansAuthIdentity(identity, null), false);

  const guard = createLatestPlansRequestGuard();
  const older = guard.begin(identity);
  const newer = guard.begin(sameIdentity);
  assert.equal(older.isCurrent(identity), false);
  assert.equal(newer.isCurrent(sameIdentity), true);
  guard.invalidate();
  assert.equal(newer.isCurrent(sameIdentity), false);
});

test("late catalog success and failure cannot cross an authentication generation", async () => {
  const successGuard = createLatestPlansRequestGuard();
  const failureGuard = createLatestPlansRequestGuard();
  const userA = createPlansAuthIdentity("user-a", "token-a");
  const userB = createPlansAuthIdentity("user-b", "token-b");
  assert.ok(userA);
  assert.ok(userB);

  let currentIdentity = userA;
  let visiblePlans = [];
  let scheduledRetries = 0;

  const oldSuccess = deferred();
  const oldSuccessTicket = successGuard.begin(userA);
  const oldSuccessCommit = oldSuccess.promise.then((plans) => {
    if (oldSuccessTicket.isCurrent(currentIdentity)) visiblePlans = plans;
  });

  const oldFailure = deferred();
  const oldFailureTicket = failureGuard.begin(userA);
  const oldFailureCommit = oldFailure.promise.catch(() => {
    if (oldFailureTicket.isCurrent(currentIdentity)) scheduledRetries += 1;
  });

  currentIdentity = userB;
  successGuard.invalidate();
  failureGuard.invalidate();
  visiblePlans = [];
  const currentResult = deferred();
  const currentTicket = successGuard.begin(userB);
  const currentCommit = currentResult.promise.then((plans) => {
    if (currentTicket.isCurrent(currentIdentity)) visiblePlans = plans;
  });

  currentResult.resolve([{ id: "plan-b" }]);
  await currentCommit;
  oldSuccess.resolve([{ id: "plan-a" }]);
  oldFailure.reject(new Error("stale failure"));
  await Promise.all([oldSuccessCommit, oldFailureCommit]);

  assert.equal(oldSuccessTicket.isCurrent(currentIdentity), false);
  assert.equal(oldFailureTicket.isCurrent(currentIdentity), false);
  assert.equal(currentTicket.isCurrent(currentIdentity), true);
  assert.deepEqual(visiblePlans, [{ id: "plan-b" }]);
  assert.equal(scheduledRetries, 0);
});

test("late purchase completion cannot update a replacement user's wallet or UI", async () => {
  const guard = createLatestPlansRequestGuard();
  const userA = createPlansAuthIdentity("user-a", "token-a");
  const userB = createPlansAuthIdentity("user-b", "token-b");
  assert.ok(userA);
  assert.ok(userB);

  let currentIdentity = userA;
  let walletWrite = null;
  let notice = null;
  let selectedPlan = "plan-a";
  let purchasing = true;

  const purchase = deferred();
  const ticket = guard.begin(userA);
  const commit = purchase.promise.then((result) => {
    if (!ticket.isCurrent(currentIdentity)) return;
    walletWrite = { balance: result.newBalance, userId: userA.userId };
    notice = "activated";
    selectedPlan = null;
    purchasing = false;
  });

  currentIdentity = userB;
  guard.invalidate();
  selectedPlan = null;
  purchasing = false;
  purchase.resolve({ newBalance: 42 });
  await commit;

  assert.equal(ticket.isCurrent(currentIdentity), false);
  assert.equal(walletWrite, null);
  assert.equal(notice, null);
  assert.equal(selectedPlan, null);
  assert.equal(purchasing, false);
});

test("same-user token refresh stays locked through forced post-settlement reconciliation", async () => {
  const flightGuard = createPlansPurchaseFlightGuard();
  const userWithTokenA = createPlansAuthIdentity("user-a", "token-a");
  const userWithTokenB = createPlansAuthIdentity("user-a", "token-b");
  assert.ok(userWithTokenA);
  assert.ok(userWithTokenB);

  let serviceInvocations = 0;
  const firstCommand = deferred();
  const firstFlight = flightGuard.begin(userWithTokenA.userId);
  assert.ok(firstFlight);
  serviceInvocations += 1;

  assert.equal(flightGuard.isActiveFor(userWithTokenB.userId), true);
  const duplicateFlight = flightGuard.begin(userWithTokenB.userId);
  if (duplicateFlight) serviceInvocations += 1;
  assert.equal(duplicateFlight, null);
  assert.equal(serviceInvocations, 1);

  let currentIdentity = userWithTokenB;
  const priorTokenBCatalog = deferred();
  const freshWallet = deferred();
  const freshCatalog = deferred();
  const refreshStarted = deferred();
  let forcedWalletReads = 0;
  let postSettlementCatalogReads = 0;

  firstCommand.resolve({ newBalance: 42 });
  await firstCommand.promise;

  const reconciliation = reconcilePlansPurchaseFlight({
    getCurrentIdentity: () => currentIdentity,
    isMounted: () => true,
    refreshCatalog: (identity) => {
      assert.equal(identity.accessToken, "token-b");
      postSettlementCatalogReads += 1;
      if (forcedWalletReads === 1) refreshStarted.resolve();
      return freshCatalog.promise;
    },
    refreshWallet: (identity) => {
      assert.equal(identity.accessToken, "token-b");
      forcedWalletReads += 1;
      if (postSettlementCatalogReads === 1) refreshStarted.resolve();
      return freshWallet.promise;
    },
    userId: userWithTokenA.userId,
    waitBeforeRetry: () => Promise.reject(new Error("unexpected reconciliation retry")),
    waitForPriorCatalog: async (userId) => {
      assert.equal(userId, userWithTokenB.userId);
      await priorTokenBCatalog.promise;
    },
  }).finally(() => {
    assert.equal(firstFlight.settle(), true);
  });

  assert.equal(flightGuard.isActiveFor(userWithTokenB.userId), true);
  assert.equal(flightGuard.begin(userWithTokenB.userId), null);
  assert.equal(forcedWalletReads, 0);
  assert.equal(postSettlementCatalogReads, 0);

  priorTokenBCatalog.resolve(true);
  await refreshStarted.promise;
  assert.equal(forcedWalletReads, 1);
  assert.equal(postSettlementCatalogReads, 1);
  assert.equal(flightGuard.isActiveFor(userWithTokenB.userId), true);
  assert.equal(flightGuard.begin(userWithTokenB.userId), null);

  freshWallet.resolve(true);
  await Promise.resolve();
  assert.equal(flightGuard.isActiveFor(userWithTokenB.userId), true);
  freshCatalog.resolve(true);
  assert.equal(await reconciliation, "reconciled");
  assert.equal(flightGuard.isActiveFor(userWithTokenB.userId), false);

  const nextFlight = flightGuard.begin(userWithTokenB.userId);
  assert.ok(nextFlight);
  serviceInvocations += 1;
  assert.equal(serviceInvocations, 2);
  assert.equal(nextFlight.settle(), true);
});

test("plans controller invalidates auth-bound work and preserves wallet ownership", async () => {
  const controller = await readRepositoryFile(
    "src/domains/plans/ui/usePlansCatalog.ts",
  );

  assert.match(controller, /createPlansAuthIdentity/);
  assert.match(controller, /createLatestPlansRequestGuard/);
  assert.match(
    controller,
    /catalogGuardRef = useRef\(createLatestPlansRequestGuard\(\)\)/,
  );
  assert.match(
    controller,
    /purchaseGuardRef = useRef\(createLatestPlansRequestGuard\(\)\)/,
  );
  assert.match(controller, /createPlansPurchaseFlightGuard/);
  assert.match(controller, /purchaseFlightGuardRef\.current\.isActiveFor\(userId\)/);
  assert.match(controller, /purchaseFlightGuardRef\.current\.begin\(identity\.userId\)/);
  assert.match(controller, /catalogGuardRef\.current\.invalidate\(\)/);
  assert.match(controller, /purchaseGuardRef\.current\.invalidate\(\)/);
  assert.ok(
    [...controller.matchAll(/request\.isCurrent\(identityRef\.current\)/g)].length >= 4,
    "catalog and purchase success and failure paths must be identity-gated",
  );
  assert.match(controller, /setSnapshot\(null\)/);
  assert.match(controller, /setSelection\(null\)/);
  assert.doesNotMatch(controller, /setPurchaseIdentity\(null\)/);
  assert.match(controller, /const commandPromise = Promise\.resolve\(\)\.then/);
  assert.match(controller, /purchasePlan\(selectedPlan\.id, identity\.accessToken\)/);
  assert.match(controller, /reconcilePlansPurchaseFlight/);
  assert.match(controller, /forceNewFlight: true/);
  assert.match(controller, /\{ force: true \}/);
  assert.match(controller, /await priorFlight\.promise/);
  assert.match(controller, /flight\.settle\(\)/);
  assert.match(controller, /const flightToken = Symbol\("plans-catalog-flight"\)/);
  assert.match(
    controller,
    /catalogFlightRef\.current\?\.token === flightToken/,
  );
  assert.match(controller, /isSamePlansAuthIdentity\(snapshot\.identity, identity\)/);
  assert.match(controller, /isSamePlansAuthIdentity\(selection\.identity, identity\)/);
  assert.match(controller, /rows\.find\(\(plan\) => plan\.id === current\.plan\.id\)/);
  assert.match(controller, /activeUserId === userId \? state\.balance : null/s);
  assert.match(controller, /setBalanceForUser/);
  assert.match(controller, /setWalletBalance\(identity\.userId, result\.newBalance\)/);
  assert.doesNotMatch(controller, /\bsetBalance\s*:/);
  assert.match(controller, /PLAN_LOAD_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(controller, /PURCHASE_TIMEOUT_MS\s*=\s*15_000/);
  assert.match(controller, /AUTO_RETRY_DELAY_MS\s*=\s*1_500/);
  assert.match(controller, /MAX_AUTO_RETRIES\s*=\s*2/);
  assert.match(controller, /visibilitychange/);
  assert.match(controller, /window\.addEventListener\("online"/);
});

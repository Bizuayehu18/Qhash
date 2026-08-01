import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createLatestReferralsRequestGuard,
  createReferralsAuthIdentity,
  createReferralsRetryPolicy,
  isSameReferralsAuthIdentity,
} from "../src/domains/referrals/application/referrals-auth-lifecycle.ts";
import {
  REFERRAL_TEAM_FILTERS,
  REFERRAL_TEAM_PREVIEW_LIMIT,
  filterReferralMembersByLevel,
  getReferralFilterCount,
  getReferralLevelCounts,
} from "../src/domains/referrals/domain/referral-team.ts";

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

test("referrals UI is decomposed while preserving the visible legacy contract", async () => {
  const [page, linkCard, stats, team, rewards, controller, domain] = await Promise.all([
    readRepositoryFile("src/domains/referrals/ui/ReferralsPage.tsx"),
    readRepositoryFile("src/domains/referrals/ui/ReferralLinkCard.tsx"),
    readRepositoryFile("src/domains/referrals/ui/ReferralStatsTiles.tsx"),
    readRepositoryFile("src/domains/referrals/ui/ReferralTeamCard.tsx"),
    readRepositoryFile("src/domains/referrals/ui/ReferralRewardsCard.tsx"),
    readRepositoryFile("src/domains/referrals/ui/useReferralData.ts"),
    readRepositoryFile("src/domains/referrals/domain/referral-team.ts"),
  ]);
  const ui = `${page}\n${linkCard}\n${stats}\n${team}\n${rewards}\n${domain}`;

  assert.match(page, /useReferralData/);
  assert.match(page, /<ReferralLinkCard/);
  assert.match(page, /<ReferralStatsTiles/);
  assert.match(page, /<ReferralTeamCard/);
  assert.match(page, /<ReferralRewardsColumn/);
  assert.doesNotMatch(page, /@\/lib\/server\//);
  assert.doesNotMatch(controller, /@\/lib\/server\//);

  for (const label of [
    "Affiliate Program",
    "Team",
    "Invite friends, grow your mining team, and earn rewards automatically.",
    "Your Referral Link",
    "Share your link to grow your team.",
    "Copy referral link",
    "Code:",
    "Copied",
    "Today's",
    "Total",
    "Active",
    "Referral income",
    "My Team",
    "Filter team members by level.",
    "No team members yet",
    "No members in this level",
    "How Team Rewards Work",
    "Plan Purchase Reward",
    "Daily Mining Reward",
    "Direct referrals",
    "Level 2 team",
    "Level 3 team",
    "Reward History",
  ]) {
    assert.match(ui, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(linkCard, /\/register\?ref=\$\{username\}/);
  assert.match(rewards, /to="\/transactions"/);
  assert.match(rewards, /L1 5%, L2 3%, and L3 2%/);
  assert.match(stats, /CurrencyUnit/);
  assert.equal(REFERRAL_TEAM_PREVIEW_LIMIT, 6);
  assert.deepEqual(REFERRAL_TEAM_FILTERS, [
    { label: "All", value: "all" },
    { label: "L1", value: 1 },
    { label: "L2", value: 2 },
    { label: "L3", value: 3 },
  ]);
});

test("referral team filtering and level counts preserve their existing rules", () => {
  const members = [
    { id: "one", name: "one", level: 1, joinedAt: "2026-01-01", isActive: true },
    { id: "two", name: "two", level: 2, joinedAt: "2026-01-02", isActive: false },
    { id: "three", name: "three", level: 3, joinedAt: "2026-01-03", isActive: true },
    { id: "unknown", name: null, level: 4, joinedAt: "invalid", isActive: false },
  ];
  const counts = getReferralLevelCounts(members);

  assert.deepEqual(counts, { all: 4, 1: 1, 2: 1, 3: 1 });
  assert.equal(getReferralFilterCount(counts, "all"), 4);
  assert.equal(getReferralFilterCount(counts, 2), 1);
  assert.equal(filterReferralMembersByLevel(members, "all"), members);
  assert.deepEqual(
    filterReferralMembersByLevel(members, 3).map((member) => member.id),
    ["three"],
  );
});

test("referrals request identity includes the exact user and access-token generation", () => {
  const identity = createReferralsAuthIdentity("user-a", "token-a");
  const sameIdentity = createReferralsAuthIdentity("user-a", "token-a");
  const refreshedToken = createReferralsAuthIdentity("user-a", "token-b");
  const replacementUser = createReferralsAuthIdentity("user-b", "token-a");

  assert.ok(identity);
  assert.ok(sameIdentity);
  assert.ok(refreshedToken);
  assert.ok(replacementUser);
  assert.equal(createReferralsAuthIdentity(null, "token-a"), null);
  assert.equal(createReferralsAuthIdentity("user-a", null), null);
  assert.equal(isSameReferralsAuthIdentity(identity, sameIdentity), true);
  assert.equal(isSameReferralsAuthIdentity(identity, refreshedToken), false);
  assert.equal(isSameReferralsAuthIdentity(identity, replacementUser), false);
  assert.equal(isSameReferralsAuthIdentity(identity, null), false);

  const guard = createLatestReferralsRequestGuard();
  const older = guard.begin(identity);
  const newer = guard.begin(sameIdentity);
  assert.equal(older.isCurrent(identity), false);
  assert.equal(newer.isCurrent(sameIdentity), true);
  guard.invalidate();
  assert.equal(newer.isCurrent(sameIdentity), false);
});

test("late referral success and failure cannot cross an authentication generation", async () => {
  const successGuard = createLatestReferralsRequestGuard();
  const failureGuard = createLatestReferralsRequestGuard();
  const userA = createReferralsAuthIdentity("user-a", "token-a");
  const userB = createReferralsAuthIdentity("user-b", "token-b");
  assert.ok(userA);
  assert.ok(userB);

  let currentIdentity = userA;
  let visibleTeam = [];
  let scheduledRetries = 0;
  const oldSuccess = deferred();
  const oldFailure = deferred();
  const oldSuccessTicket = successGuard.begin(userA);
  const oldFailureTicket = failureGuard.begin(userA);
  const oldSuccessCommit = oldSuccess.promise.then((team) => {
    if (oldSuccessTicket.isCurrent(currentIdentity)) visibleTeam = team;
  });
  const oldFailureCommit = oldFailure.promise.catch(() => {
    if (oldFailureTicket.isCurrent(currentIdentity)) scheduledRetries += 1;
  });

  currentIdentity = userB;
  successGuard.invalidate();
  failureGuard.invalidate();
  visibleTeam = [];
  const currentResult = deferred();
  const currentTicket = successGuard.begin(userB);
  const currentCommit = currentResult.promise.then((team) => {
    if (currentTicket.isCurrent(currentIdentity)) visibleTeam = team;
  });

  currentResult.resolve([{ id: "member-b" }]);
  await currentCommit;
  oldSuccess.resolve([{ id: "member-a" }]);
  oldFailure.reject(new Error("stale failure"));
  await Promise.all([oldSuccessCommit, oldFailureCommit]);

  assert.equal(oldSuccessTicket.isCurrent(currentIdentity), false);
  assert.equal(oldFailureTicket.isCurrent(currentIdentity), false);
  assert.equal(currentTicket.isCurrent(currentIdentity), true);
  assert.deepEqual(visibleTeam, [{ id: "member-b" }]);
  assert.equal(scheduledRetries, 0);
});

test("a coalesced refresh cannot reset the active retry budget", () => {
  const retryPolicy = createReferralsRetryPolicy(2);

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

test("referrals controller invalidates identity-bound work and permits replacement flights", async () => {
  const [controller, linkCard] = await Promise.all([
    readRepositoryFile("src/domains/referrals/ui/useReferralData.ts"),
    readRepositoryFile("src/domains/referrals/ui/ReferralLinkCard.tsx"),
  ]);

  assert.match(controller, /createReferralsAuthIdentity/);
  assert.match(controller, /createLatestReferralsRequestGuard/);
  assert.match(
    controller,
    /requestGuardRef = useRef\(createLatestReferralsRequestGuard\(\)\)/,
  );
  assert.ok(
    [...controller.matchAll(/request\.isCurrent\(identityRef\.current\)/g)].length >= 2,
    "success and failure paths must be identity-gated",
  );
  assert.match(controller, /setSnapshot\(null\)/);
  assert.match(controller, /activeFlightRef\.current = null/);
  assert.match(controller, /const flightToken = Symbol\("referrals-stats-flight"\)/);
  assert.match(controller, /activeFlightRef\.current\?\.token === flightToken/);
  assert.match(
    controller,
    /isSameReferralsAuthIdentity\(\s*snapshot\.identity,\s*identity,?\s*\)/,
  );
  assert.match(controller, /profile\?\.id === identity\.userId/);
  assert.match(controller, /REFERRAL_LOAD_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(controller, /AUTO_RETRY_DELAY_MS\s*=\s*1_500/);
  assert.match(controller, /MAX_AUTO_RETRIES\s*=\s*2/);
  assert.match(controller, /visibilitychange/);
  assert.match(controller, /window\.addEventListener\("online"/);
  assert.match(controller, /forceNewFlight: true/);

  assert.match(linkCard, /copyGenerationRef/);
  assert.match(linkCard, /copyGenerationRef\.current !== copyGeneration/);
  assert.match(linkCard, /\.catch\(\(\) =>/);
});

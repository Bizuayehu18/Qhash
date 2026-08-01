import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createLatestSupportDestinationRequestGuard,
  runLatestSupportDestinationRequest,
} from "../src/domains/support/application/support-destination-request-guard.ts";
import {
  formatDashboardAmount,
  getCompletedDashboardInvestments,
  getDashboardPlanTiming,
  getRecentDashboardTransactions,
} from "../src/domains/accounts/ui/dashboard/dashboard-format.ts";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

test("dashboard amount formatting preserves the legacy two-decimal ETB contract", () => {
  assert.equal(formatDashboardAmount(0), "0.00");
  assert.equal(formatDashboardAmount(1234.5), "1,234.50");
  assert.equal(formatDashboardAmount(-8), "-8.00");
});

test("dashboard plan timing preserves clamping, rounding, and days remaining", () => {
  const day = 24 * 60 * 60 * 1000;
  const start = Date.parse("2026-08-01T00:00:00.000Z");
  const end = start + (10 * day);

  assert.deepEqual(getDashboardPlanTiming({
    endDate: new Date(end).toISOString(),
    nowMs: start + (4.51 * day),
    startDate: new Date(start).toISOString(),
  }), {
    clampedProgress: 45.1,
    daysRemaining: 6,
    roundedProgress: 45,
  });
  assert.deepEqual(getDashboardPlanTiming({
    endDate: new Date(end).toISOString(),
    nowMs: start - day,
    startDate: new Date(start).toISOString(),
  }), {
    clampedProgress: 0,
    daysRemaining: 11,
    roundedProgress: 0,
  });
  assert.deepEqual(getDashboardPlanTiming({
    endDate: new Date(end).toISOString(),
    nowMs: end + day,
    startDate: new Date(start).toISOString(),
  }), {
    clampedProgress: 100,
    daysRemaining: 0,
    roundedProgress: 100,
  });
});

test("dashboard activity previews retain five transactions and three completed plans", () => {
  const transactions = Array.from({ length: 7 }, (_, index) => ({ id: `tx-${index}` }));
  const investments = Array.from({ length: 5 }, (_, index) => ({ id: `plan-${index}` }));

  assert.deepEqual(getRecentDashboardTransactions(transactions), transactions.slice(0, 5));
  assert.deepEqual(getCompletedDashboardInvestments(investments), investments.slice(0, 3));
});

test("support destination requests publish only from the latest live generation", () => {
  const guard = createLatestSupportDestinationRequestGuard();
  const older = guard.begin();
  const newer = guard.begin();

  assert.equal(older.isCurrent(), false);
  assert.equal(newer.isCurrent(), true);

  guard.invalidate();
  assert.equal(newer.isCurrent(), false);
});

test("a background refresh prevents an older support click from returning a stale destination", async () => {
  const guard = createLatestSupportDestinationRequestGuard();
  const published = [];
  let resolveClick;
  let resolveRefresh;
  const clickLoad = new Promise((resolve) => {
    resolveClick = resolve;
  });
  const refreshLoad = new Promise((resolve) => {
    resolveRefresh = resolve;
  });
  const requestOptions = {
    guard,
    isMounted: () => true,
    publish: (url) => published.push(url),
  };

  const clickRequest = runLatestSupportDestinationRequest({
    ...requestOptions,
    load: () => clickLoad,
  });
  const refreshRequest = runLatestSupportDestinationRequest({
    ...requestOptions,
    load: () => refreshLoad,
  });

  resolveClick("https://t.me/obsolete-support");
  assert.equal(await clickRequest, null);
  assert.deepEqual(published, []);

  resolveRefresh("https://t.me/current-support");
  assert.equal(await refreshRequest, "https://t.me/current-support");
  assert.deepEqual(published, ["https://t.me/current-support"]);
});

test("dashboard UI preserves presentation, navigation, and support lifecycle contracts", async () => {
  const [page, summary, plans, transactions, supportHook, supportBridge] = await Promise.all([
    readRepositoryFile("src/domains/accounts/ui/dashboard/DashboardPage.tsx"),
    readRepositoryFile("src/domains/accounts/ui/dashboard/DashboardAccountSummary.tsx"),
    readRepositoryFile("src/domains/accounts/ui/dashboard/DashboardPlanSections.tsx"),
    readRepositoryFile("src/domains/accounts/ui/dashboard/DashboardRecentTransactions.tsx"),
    readRepositoryFile("src/domains/support/ui/useSupportDestination.ts"),
    readRepositoryFile("src/domains/support/application/support-settings-browser-service.ts"),
  ]);
  const visibleUi = `${page}\n${summary}\n${plans}\n${transactions}`;

  for (const copy of [
    "Account Overview",
    "Dashboard",
    "Welcome back",
    "Total Balance",
    "Deposit",
    "Withdraw",
    "Buy Plan",
    "Today's",
    "All Time",
    "Refer & Earn",
    "Support",
    "Active Plans",
    "No active mining plans",
    "Recent Transactions",
    "No transactions yet",
    "Completed Plans",
  ]) {
    assert.match(visibleUi, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  for (const destination of ["/deposit", "/withdraw", "/plans", "/referrals", "/transactions"]) {
    assert.match(visibleUi, new RegExp(destination.replaceAll("/", "\\/")));
  }
  assert.match(visibleUi, /CurrencyUnit/);
  assert.match(visibleUi, /AmountText/);
  assert.match(visibleUi, /TxIcon/);
  assert.match(visibleUi, /txTitle/);
  assert.match(visibleUi, /txSubtitle/);
  assert.match(visibleUi, /isOutgoingTx/);
  assert.match(visibleUi, /formatDateTime/);
  assert.match(visibleUi, /Mining Plan/);
  assert.match(visibleUi, /useDashboardRemoteState/);
  assert.match(visibleUi, /useSupportDestination/);

  assert.match(supportBridge, /getSupportSettingsFn/);
  assert.match(supportBridge, /export (?:async )?function loadSupportDestination/);
  assert.match(supportHook, /SUPPORT_SETTINGS_LOAD_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(supportHook, /withTimeout/);
  assert.match(supportHook, /document\.addEventListener\("visibilitychange"/);
  assert.match(supportHook, /window\.addEventListener\("online"/);
  assert.match(supportHook, /window\.location\.assign\(supportUrl\)/);
  assert.match(supportHook, /window\.location\.assign\("\/support"\)/);
  assert.match(supportHook, /requestGuardRef/);
  assert.match(supportHook, /runLatestSupportDestinationRequest/);
  assert.match(supportHook, /mountedRef/);
  assert.match(supportHook, /Opening\.\.\./);
});

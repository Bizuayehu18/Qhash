import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { formatDateTime } from "../src/shared/formatting/date-time.ts";

const repositoryRoot = new URL("../", import.meta.url);
const formatterModule = new URL("../src/shared/formatting/date-time.ts", import.meta.url);
const expectedOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

function formatInTimeZone(timeZone, value) {
  const program = [
    `const { formatDateTime } = await import(${JSON.stringify(formatterModule.href)});`,
    `process.stdout.write(formatDateTime(${JSON.stringify(value)}));`,
  ].join("\n");

  return execFileSync(process.execPath, ["--input-type=module", "--eval", program], {
    encoding: "utf8",
    env: { ...process.env, TZ: timeZone },
  });
}

test("shared date-time formatting preserves the established en-US contract", () => {
  const isoValue = "2026-08-02T12:34:56.000Z";
  const dateValue = new Date("2026-01-03T04:05:06.000Z");

  assert.equal(
    formatDateTime(isoValue),
    new Date(isoValue).toLocaleString("en-US", expectedOptions),
  );
  assert.equal(
    formatDateTime(dateValue),
    new Date(dateValue).toLocaleString("en-US", expectedOptions),
  );
  assert.equal(
    formatDateTime("not-a-date"),
    new Date("not-a-date").toLocaleString("en-US", expectedOptions),
  );
});

test("shared date-time formatting follows the device timezone instead of forcing UTC", () => {
  const boundaryValue = "2026-01-01T22:30:00.000Z";

  assert.equal(formatInTimeZone("UTC", boundaryValue), "Jan 1, 10:30 PM");
  assert.equal(formatInTimeZone("Africa/Nairobi", boundaryValue), "Jan 2, 1:30 AM");
});

test("the legacy format path remains a compatibility bridge", async () => {
  const legacyBridge = await readRepositoryFile("src/lib/format.ts");

  assert.match(legacyBridge, /export \{ formatDateTime \} from "\.\.\/shared\/formatting\/date-time\.ts"/);
  assert.doesNotMatch(legacyBridge, /toLocaleString/);
});

test("current consumers import the shared primitive directly", async () => {
  const consumerPaths = [
    "src/components/admin/NowpaymentsUsdtWithdrawalAdmin.tsx",
    "src/domains/accounts/ui/dashboard/DashboardRecentTransactions.tsx",
    "src/domains/accounts/ui/transactions/TransactionHistoryList.tsx",
    "src/domains/crypto-deposits/ui/UsdtBep20AddressCard.tsx",
    "src/domains/crypto-deposits/ui/UsdtBep20DepositHistory.tsx",
    "src/domains/fiat-deposits/ui/FiatDepositHistory.tsx",
    "src/domains/fiat-withdrawals/ui/admin/AdminFiatWithdrawalDetail.tsx",
    "src/domains/fiat-withdrawals/ui/FiatWithdrawalHistory.tsx",
    "src/domains/notifications/ui/NotificationList.tsx",
    "src/domains/withdrawals/ui/UsdtBep20WithdrawalHistory.tsx",
  ];
  const consumers = await Promise.all(consumerPaths.map(readRepositoryFile));

  for (const consumer of consumers) {
    assert.match(consumer, /@\/shared\/formatting\/date-time\.js/);
    assert.doesNotMatch(consumer, /@\/lib\/format\.js/);
  }
});

test("domain-specific date presentation remains outside the shared primitive", async () => {
  const earningsAdmin = await readRepositoryFile("src/routes/_app/admin-earnings.tsx");

  assert.match(earningsAdmin, /function formatDateTime\(value: string \| null \| undefined\)/);
  assert.match(earningsAdmin, /hour: "2-digit"/);
});

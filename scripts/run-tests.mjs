import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const allTests = [
  "bsc-address-rotation.test.mjs",
  "bsc-user-deposit-exposure.test.mjs",
  "crypto-schema-reconciliation.test.mjs",
  "crypto-user-id-uuid-repair.test.mjs",
  "deposit-approval-rpc-security.test.mjs",
  "fund-pin-security-database.test.mjs",
  "native-crypto-database-retirement.test.mjs",
  "native-crypto-runtime-decommission.test.mjs",
  "nowpayments-usdt-active-deposit-session.test.mjs",
  "nowpayments-usdt-bep20-foundation.test.mjs",
  "nowpayments-usdt-deposit-ui.test.mjs",
  "nowpayments-usdt-ipn-settlement.test.mjs",
  "nowpayments-usdt-manual-withdrawal-database.test.mjs",
  "nowpayments-usdt-withdrawal-admin.test.mjs",
  "nowpayments-usdt-withdrawal-user.test.mjs",
  "unified-cross-rail-withdrawal-database.test.mjs",
];

const handlerTests = [
  "nowpayments-usdt-active-deposit-session.test.mjs",
  "nowpayments-usdt-deposit-ui.test.mjs",
  "nowpayments-usdt-ipn-settlement.test.mjs",
  "nowpayments-usdt-withdrawal-admin.test.mjs",
  "nowpayments-usdt-withdrawal-user.test.mjs",
];

const nativeTests = [
  "deposit-approval-rpc-security.test.mjs",
  "fund-pin-security-database.test.mjs",
  "nowpayments-usdt-ipn-settlement.test.mjs",
  "nowpayments-usdt-manual-withdrawal-database.test.mjs",
  "unified-cross-rail-withdrawal-database.test.mjs",
];

const discoveredTests = fs
  .readdirSync(path.join(process.cwd(), "tests"))
  .filter((file) => file.endsWith(".test.mjs"))
  .sort();
const manifestTests = [...allTests].sort();
if (JSON.stringify(discoveredTests) !== JSON.stringify(manifestTests)) {
  console.error(
    "The explicit test manifest is stale. Classify every tests/*.test.mjs file in scripts/run-tests.mjs.",
  );
  console.error(`Discovered: ${discoveredTests.join(", ")}`);
  console.error(`Manifest: ${manifestTests.join(", ")}`);
  process.exit(2);
}

const mode = process.argv[2];
if (!["portable", "handlers", "native"].includes(mode)) {
  console.error("Usage: node scripts/run-tests.mjs <portable|handlers|native>");
  process.exit(2);
}

const env = { ...process.env };
let selectedTests;

if (mode === "native") {
  const databaseUrl = env.TEST_DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "TEST_DATABASE_URL is required for native tests and must name a disposable qhash_test_* database.",
    );
    process.exit(2);
  }

  const parsedUrl = new URL(databaseUrl);
  const databaseName = parsedUrl.pathname.replace(/^\//, "");
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!databaseName.startsWith("qhash_test_") || !localHosts.has(parsedUrl.hostname)) {
    console.error(
      "Native tests refuse non-local or non-qhash_test_* PostgreSQL databases.",
    );
    process.exit(2);
  }
  selectedTests = nativeTests;
} else {
  delete env.TEST_DATABASE_URL;
  selectedTests = mode === "handlers" ? handlerTests : allTests;
}

const testPaths = selectedTests.map((file) =>
  path.join(process.cwd(), "tests", file),
);
console.log(`Running ${mode} test manifest (${testPaths.length} files).`);

const testArguments = ["--test", "--test-reporter=spec"];
if (mode === "native") {
  testArguments.push("--test-concurrency=1");
}
testArguments.push(...testPaths);

const result = spawnSync(
  process.execPath,
  testArguments,
  {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);

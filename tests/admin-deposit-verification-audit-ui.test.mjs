import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createDepositVerificationAuditRequestKey,
  createDepositVerificationAuditRetryPolicy,
  createLatestDepositVerificationAuditRequestGuard,
  isSameDepositVerificationAuditRequestKey,
} from "../src/domains/fiat-deposits/application/deposit-verification-audit-auth-lifecycle.ts";
import {
  DEPOSIT_VERIFICATION_AUDIT_ACTION_VARIANTS,
  DEPOSIT_VERIFICATION_AUDIT_METHOD_LABELS,
  DEPOSIT_VERIFICATION_AUDIT_PAYMENT_TYPES,
  formatDepositVerificationAuditEntityId,
  formatDepositVerificationAuditEtb,
  formatDepositVerificationAuditPaymentType,
} from "../src/domains/fiat-deposits/ui/admin/deposit-verification-audit-presentation.ts";

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

test("verification audit requests bind the exact admin, token, and filter", () => {
  const original = createDepositVerificationAuditRequestKey(
    "admin-a",
    "token-a",
    "all",
  );
  const same = createDepositVerificationAuditRequestKey(
    "admin-a",
    "token-a",
    "all",
  );
  const refreshedToken = createDepositVerificationAuditRequestKey(
    "admin-a",
    "token-b",
    "all",
  );
  const replacementAdmin = createDepositVerificationAuditRequestKey(
    "admin-b",
    "token-a",
    "all",
  );
  const replacementFilter = createDepositVerificationAuditRequestKey(
    "admin-a",
    "token-a",
    "cbe",
  );

  assert.ok(original);
  assert.ok(same);
  assert.ok(refreshedToken);
  assert.ok(replacementAdmin);
  assert.ok(replacementFilter);
  assert.equal(
    createDepositVerificationAuditRequestKey(null, "token-a", "all"),
    null,
  );
  assert.equal(
    createDepositVerificationAuditRequestKey("admin-a", null, "all"),
    null,
  );
  assert.equal(isSameDepositVerificationAuditRequestKey(original, same), true);
  assert.equal(
    isSameDepositVerificationAuditRequestKey(original, refreshedToken),
    false,
  );
  assert.equal(
    isSameDepositVerificationAuditRequestKey(original, replacementAdmin),
    false,
  );
  assert.equal(
    isSameDepositVerificationAuditRequestKey(original, replacementFilter),
    false,
  );
  assert.equal(isSameDepositVerificationAuditRequestKey(original, null), false);
});

test("late audit success and failure cannot cross admin or filter generations", async () => {
  const successGuard = createLatestDepositVerificationAuditRequestGuard();
  const failureGuard = createLatestDepositVerificationAuditRequestGuard();
  const all = createDepositVerificationAuditRequestKey(
    "admin-a",
    "token-a",
    "all",
  );
  const cbe = createDepositVerificationAuditRequestKey(
    "admin-a",
    "token-a",
    "cbe",
  );
  assert.ok(all);
  assert.ok(cbe);

  let currentKey = all;
  let visibleLogs = null;
  let scheduledRetries = 0;
  const oldSuccess = deferred();
  const oldFailure = deferred();
  const oldSuccessTicket = successGuard.begin(all);
  const oldFailureTicket = failureGuard.begin(all);
  const oldSuccessCommit = oldSuccess.promise.then((rows) => {
    if (oldSuccessTicket.isCurrent(currentKey)) visibleLogs = rows;
  });
  const oldFailureCommit = oldFailure.promise.catch(() => {
    if (oldFailureTicket.isCurrent(currentKey)) scheduledRetries += 1;
  });

  currentKey = cbe;
  successGuard.invalidate();
  failureGuard.invalidate();
  const replacement = deferred();
  const replacementTicket = successGuard.begin(cbe);
  const replacementCommit = replacement.promise.then((rows) => {
    if (replacementTicket.isCurrent(currentKey)) visibleLogs = rows;
  });

  replacement.resolve([{ id: "cbe-log" }]);
  await replacementCommit;
  oldSuccess.resolve([{ id: "all-log" }]);
  oldFailure.reject(new Error("stale failure"));
  await Promise.all([oldSuccessCommit, oldFailureCommit]);

  assert.deepEqual(visibleLogs, [{ id: "cbe-log" }]);
  assert.equal(scheduledRetries, 0);
  assert.equal(oldSuccessTicket.isCurrent(currentKey), false);
  assert.equal(oldFailureTicket.isCurrent(currentKey), false);
  assert.equal(replacementTicket.isCurrent(currentKey), true);
});

test("verification audit invalidation and retry admission are bounded", () => {
  const key = createDepositVerificationAuditRequestKey(
    "admin-a",
    "token-a",
    "telebirr",
  );
  assert.ok(key);
  const guard = createLatestDepositVerificationAuditRequestGuard();
  const request = guard.begin(key);
  assert.equal(request.isCurrent(key), true);
  guard.invalidate();
  assert.equal(request.isCurrent(key), false);

  const retryPolicy = createDepositVerificationAuditRetryPolicy(2);
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

test("verification audit browser service preserves the exact read-only query", async () => {
  const service = await readRepositoryFile(
    "src/domains/fiat-deposits/application/deposit-verification-audit-browser-service.ts",
  );

  assert.match(
    service,
    /import \{ getDepositVerificationLogsFn \} from "@\/lib\/server\/deposit-audit-logs\.js";/,
  );
  assert.match(service, /DEPOSIT_VERIFICATION_AUDIT_LIMIT = 100/);
  assert.match(service, /paymentType === "all" \? undefined : paymentType/);
  assert.match(service, /limit: DEPOSIT_VERIFICATION_AUDIT_LIMIT/);
  assert.match(service, /getDepositVerificationLogsFn\(\{/);
  assert.doesNotMatch(
    service,
    /userId|user_id|fetch\(|supabase|\.from\(|\.rpc\(|insert|update|delete/i,
  );
});

test("verification audit server keeps active-admin authorization and safe columns", async () => {
  const server = await readRepositoryFile(
    "src/lib/server/deposit-audit-logs.ts",
  );
  const columns = server.match(/const SAFE_COLUMNS =\s*\n\s*"([^"]+)";/)?.[1];
  assert.ok(columns);
  assert.deepEqual(columns.split(", "), [
    "id",
    "created_at",
    "payment_type",
    "event",
    "action",
    "reason_code",
    "reason_message_safe",
    "amount",
    "tx_ref_last4",
    "receiver_matched",
    "freshness_decision",
    "age_minutes",
    "source",
    "actor_type",
    "deposit_id",
    "user_id",
    "metadata",
  ]);
  for (const forbidden of [
    "receipt_text",
    "receipt_url",
    "transaction_reference",
    "receiver_name",
    "account_name",
  ]) {
    assert.equal(columns.includes(forbidden), false);
  }

  assert.match(server, /admin\.auth\.getUser\(data\.accessToken\)/);
  assert.match(server, /\.select\("is_admin, is_frozen"\)/);
  assert.match(server, /\.eq\("id", authUser\.id\)/);
  assert.match(server, /profile\.is_admin !== true/);
  assert.match(server, /profile\.is_frozen === true/);
  assert.match(server, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(server, /\.limit\(data\.limit\)/);
  assert.match(server, /query = query\.eq\("payment_type", data\.paymentType\)/);
  assert.doesNotMatch(server, /data\.userId|data\.user_id/);
  assert.doesNotMatch(server, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
});

test("verification audit controller preserves timing, refresh, and stale guards", async () => {
  const controller = await readRepositoryFile(
    "src/domains/fiat-deposits/ui/admin/useDepositVerificationAudit.ts",
  );

  assert.match(controller, /DEPOSIT_VERIFICATION_AUDIT_TIMEOUT_MS = 10_000/);
  assert.match(controller, /DEPOSIT_VERIFICATION_AUDIT_RETRY_DELAY_MS = 1_500/);
  assert.match(
    controller,
    /DEPOSIT_VERIFICATION_AUDIT_MAX_AUTO_RETRIES = 2/,
  );
  assert.match(controller, /Admin audit logs request timed out\./);
  assert.match(controller, /document\.addEventListener\("visibilitychange"/);
  assert.match(controller, /window\.addEventListener\("online"/);
  assert.doesNotMatch(controller, /setInterval/);

  assert.match(controller, /createDepositVerificationAuditRequestKey\(/);
  assert.match(controller, /activeLoadRef/);
  assert.match(
    controller,
    /isSameDepositVerificationAuditRequestKey\(activeLoad\.key, expectedKey\)/,
  );
  assert.match(controller, /return activeLoad\.promise/);
  assert.match(controller, /forceNewFlight/);
  assert.match(controller, /Symbol\("deposit-verification-audit-flight"\)/);
  assert.match(controller, /activeLoadRef\.current\?\.token === flightToken/);
  assert.ok(
    [...controller.matchAll(/request\.isCurrent\(requestKeyRef\.current\)/g)]
      .length >= 2,
    "success and failure publication must be generation gated",
  );
  assert.match(controller, /requestGuardRef\.current\.invalidate\(\)/);
  assert.match(controller, /setSnapshot\(null\)/);
  assert.match(
    controller,
    /isSameDepositVerificationAuditRequestKey\(snapshot\.key, requestKey\)/,
  );
});

test("verification audit preserves its exact read-only presentation", async () => {
  const [panel, publicSurface] = await Promise.all([
    readRepositoryFile(
      "src/domains/fiat-deposits/ui/admin/DepositVerificationAuditPanel.tsx",
    ),
    readRepositoryFile("src/domains/fiat-deposits/public.ts"),
  ]);

  assert.deepEqual(DEPOSIT_VERIFICATION_AUDIT_PAYMENT_TYPES, [
    "all",
    "cbe",
    "telebirr",
  ]);
  assert.deepEqual(DEPOSIT_VERIFICATION_AUDIT_METHOD_LABELS, {
    cbe: "CBE",
    telebirr: "TeleBirr",
  });
  assert.deepEqual(DEPOSIT_VERIFICATION_AUDIT_ACTION_VARIANTS, {
    approve: "success",
    reject: "danger",
    manual_review: "warning",
    skipped: "default",
    error: "danger",
  });
  assert.equal(formatDepositVerificationAuditEntityId(null), "—");
  assert.equal(formatDepositVerificationAuditEntityId("12345678"), "12345678");
  assert.equal(
    formatDepositVerificationAuditEntityId("123456789"),
    "12345678",
  );
  assert.equal(formatDepositVerificationAuditPaymentType(null), "—");
  assert.equal(formatDepositVerificationAuditPaymentType("cbe"), "CBE");
  assert.equal(
    formatDepositVerificationAuditPaymentType("future-rail"),
    "future-rail",
  );
  assert.equal(formatDepositVerificationAuditEtb(1234.5), "1,234.50");

  for (const copy of [
    "Read-only verification audit trail",
    "No audit logs found.",
    "All",
    "Source",
    "Actor",
    "Receiver Matched",
    "Freshness",
    "Age (min)",
    "Reason Code",
    "Deposit",
    "User",
    "Metadata",
  ]) {
    assert.match(panel, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(panel, /<CurrencyUnit \/>/);
  assert.match(panel, /\*\*\*\*\{logRow\.tx_ref_last4\}/);
  assert.match(panel, /formatDateTime\(logRow\.created_at\)/);
  assert.match(panel, /JSON\.stringify\(logRow\.metadata, null, 2\)/);
  assert.match(panel, /setExpandedId\(null\)/);
  assert.doesNotMatch(
    panel,
    /fetch\(|supabase|lib\/server|\.from\(|\.rpc\(|Approve|Reject|toast/i,
  );
  assert.match(
    publicSurface,
    /export \{ DepositVerificationAuditPanel \} from "\.\/ui\/admin\/DepositVerificationAuditPanel\.js";/,
  );
  assert.doesNotMatch(publicSurface, /export \*/);
});

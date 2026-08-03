import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAdminPaymentMethodsAuthIdentity,
  createAdminPaymentMethodsMutationFlights,
  createAdminPaymentMethodsRequestKey,
  createAdminPaymentMethodsRetryPolicy,
  createAdminPaymentMethodsScopedValue,
  createLatestAdminPaymentMethodsCatalogGuard,
  createLatestAdminPaymentMethodsRequestGuard,
  isSameAdminPaymentMethodsAuthIdentity,
  isSameAdminPaymentMethodsRequestKey,
  readAdminPaymentMethodsScopedValue,
} from "../src/domains/fiat-deposits/application/admin-payment-methods-auth-lifecycle.ts";
import {
  ADMIN_PAYMENT_METHOD_ARCHIVE_FILTERS,
  ADMIN_PAYMENT_METHOD_LABELS,
  ADMIN_PAYMENT_METHOD_TYPES,
} from "../src/domains/fiat-deposits/ui/admin/admin-payment-methods-presentation.ts";

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

test("admin payment-method requests bind the exact administrator, token, and archive filter", () => {
  const visible = createAdminPaymentMethodsRequestKey(
    "admin-a",
    "token-a",
    "visible",
  );
  const same = createAdminPaymentMethodsRequestKey(
    "admin-a",
    "token-a",
    "visible",
  );
  const refreshedToken = createAdminPaymentMethodsRequestKey(
    "admin-a",
    "token-b",
    "visible",
  );
  const replacementAdmin = createAdminPaymentMethodsRequestKey(
    "admin-b",
    "token-a",
    "visible",
  );
  const archived = createAdminPaymentMethodsRequestKey(
    "admin-a",
    "token-a",
    "archived",
  );

  assert.ok(visible);
  assert.ok(same);
  assert.ok(refreshedToken);
  assert.ok(replacementAdmin);
  assert.ok(archived);
  assert.equal(
    createAdminPaymentMethodsRequestKey(null, "token-a", "visible"),
    null,
  );
  assert.equal(
    createAdminPaymentMethodsRequestKey("admin-a", null, "visible"),
    null,
  );
  assert.equal(isSameAdminPaymentMethodsRequestKey(visible, same), true);
  assert.equal(
    isSameAdminPaymentMethodsRequestKey(visible, refreshedToken),
    false,
  );
  assert.equal(
    isSameAdminPaymentMethodsRequestKey(visible, replacementAdmin),
    false,
  );
  assert.equal(isSameAdminPaymentMethodsRequestKey(visible, archived), false);
  assert.equal(isSameAdminPaymentMethodsRequestKey(visible, null), false);
});

test("late catalog success and failure cannot cross token or filter generations", async () => {
  const successGuard = createLatestAdminPaymentMethodsCatalogGuard();
  const failureGuard = createLatestAdminPaymentMethodsCatalogGuard();
  const visible = createAdminPaymentMethodsRequestKey(
    "admin-a",
    "token-a",
    "visible",
  );
  const archived = createAdminPaymentMethodsRequestKey(
    "admin-a",
    "token-b",
    "archived",
  );
  assert.ok(visible);
  assert.ok(archived);

  let currentKey = visible;
  let visibleRows = null;
  let scheduledRetries = 0;
  const oldSuccess = deferred();
  const oldFailure = deferred();
  const oldSuccessTicket = successGuard.begin(visible);
  const oldFailureTicket = failureGuard.begin(visible);
  const oldSuccessCommit = oldSuccess.promise.then((rows) => {
    if (oldSuccessTicket.isCurrent(currentKey)) visibleRows = rows;
  });
  const oldFailureCommit = oldFailure.promise.catch(() => {
    if (oldFailureTicket.isCurrent(currentKey)) scheduledRetries += 1;
  });

  currentKey = archived;
  successGuard.invalidate();
  failureGuard.invalidate();
  const replacement = deferred();
  const replacementTicket = successGuard.begin(archived);
  const replacementCommit = replacement.promise.then((rows) => {
    if (replacementTicket.isCurrent(currentKey)) visibleRows = rows;
  });

  replacement.resolve([{ id: "archived-row" }]);
  await replacementCommit;
  oldSuccess.resolve([{ id: "visible-row" }]);
  oldFailure.reject(new Error("stale failure"));
  await Promise.all([oldSuccessCommit, oldFailureCommit]);

  assert.deepEqual(visibleRows, [{ id: "archived-row" }]);
  assert.equal(scheduledRetries, 0);
  assert.equal(oldSuccessTicket.isCurrent(currentKey), false);
  assert.equal(oldFailureTicket.isCurrent(currentKey), false);
  assert.equal(replacementTicket.isCurrent(currentKey), true);
});

test("payment-method mutation guards and visible state are auth-generation scoped", () => {
  const adminA = createAdminPaymentMethodsAuthIdentity("admin-a", "token-a");
  const refreshed = createAdminPaymentMethodsAuthIdentity("admin-a", "token-b");
  const adminB = createAdminPaymentMethodsAuthIdentity("admin-b", "token-a");
  assert.ok(adminA);
  assert.ok(refreshed);
  assert.ok(adminB);
  assert.equal(createAdminPaymentMethodsAuthIdentity(null, "token-a"), null);
  assert.equal(createAdminPaymentMethodsAuthIdentity("admin-a", null), null);
  assert.equal(isSameAdminPaymentMethodsAuthIdentity(adminA, adminA), true);
  assert.equal(isSameAdminPaymentMethodsAuthIdentity(adminA, refreshed), false);
  assert.equal(isSameAdminPaymentMethodsAuthIdentity(adminA, adminB), false);

  const busy = createAdminPaymentMethodsScopedValue(adminA, "method-a");
  assert.equal(readAdminPaymentMethodsScopedValue(busy, adminA), "method-a");
  assert.equal(readAdminPaymentMethodsScopedValue(busy, refreshed), null);
  assert.equal(readAdminPaymentMethodsScopedValue(busy, adminB), null);

  const guard = createLatestAdminPaymentMethodsRequestGuard();
  const request = guard.begin(adminA);
  assert.equal(request.isCurrent(adminA), true);
  assert.equal(request.isCurrent(refreshed), false);
  guard.invalidate();
  assert.equal(request.isCurrent(adminA), false);
});

test("payment-method retry admission is bounded without spending retries on coalesced loads", () => {
  const retryPolicy = createAdminPaymentMethodsRetryPolicy(2);

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

test("exact duplicate mutations coalesce and catalog reads can await all accepted flights", async () => {
  const flights = createAdminPaymentMethodsMutationFlights();
  const adminA = createAdminPaymentMethodsAuthIdentity("admin-a", "token-a");
  const adminB = createAdminPaymentMethodsAuthIdentity("admin-b", "token-b");
  assert.ok(adminA);
  assert.ok(adminB);

  const firstGate = deferred();
  const replacementGate = deferred();
  let calls = 0;
  const firstKey = {
    identity: adminA,
    fingerprint: JSON.stringify(["archive", "method-a", true]),
  };
  const first = flights.run(firstKey, async () => {
    calls += 1;
    return firstGate.promise;
  });
  const duplicate = flights.run(firstKey, async () => {
    calls += 1;
    return "duplicate";
  });
  assert.equal(first, duplicate);
  await Promise.resolve();
  assert.equal(calls, 1);

  const replacement = flights.run({
    identity: adminB,
    fingerprint: firstKey.fingerprint,
  }, async () => {
    calls += 1;
    return replacementGate.promise;
  });
  await Promise.resolve();
  assert.equal(calls, 2);

  let idle = false;
  const idlePromise = flights.whenIdle().then(() => {
    idle = true;
  });
  firstGate.resolve("first");
  assert.equal(await first, "first");
  await Promise.resolve();
  assert.equal(idle, false);
  replacementGate.resolve("replacement");
  assert.equal(await replacement, "replacement");
  await idlePromise;
  assert.equal(idle, true);
  assert.equal(calls, 2);
});

test("an older successful row mutation still reloads after a newer row action fails", async () => {
  const flights = createAdminPaymentMethodsMutationFlights();
  const guard = createLatestAdminPaymentMethodsRequestGuard();
  const identity = createAdminPaymentMethodsAuthIdentity(
    "admin-a",
    "token-a",
  );
  assert.ok(identity);

  const olderServer = deferred();
  const newerServer = deferred();
  let currentIdentity = identity;
  let busyRow = null;
  let catalogReloads = 0;
  const notices = [];

  const runRowAction = async (methodId, serverResult) => {
    const requestIdentity = currentIdentity;
    assert.ok(requestIdentity);
    const mutationSucceeded = await flights.run(
      {
        identity: requestIdentity,
        fingerprint: JSON.stringify(["toggle", methodId, true]),
      },
      async () => {
        const request = guard.begin(requestIdentity);
        busyRow = methodId;
        try {
          await serverResult.promise;
          if (request.isCurrent(currentIdentity)) {
            notices.push(`success:${methodId}`);
          }
          // Durable server success is independent of whether this action still
          // owns the transient toast/busy presentation generation.
          return true;
        } catch {
          if (request.isCurrent(currentIdentity)) {
            notices.push(`failure:${methodId}`);
          }
          return false;
        } finally {
          if (request.isCurrent(currentIdentity)) busyRow = null;
        }
      },
    );
    if (
      mutationSucceeded
      && isSameAdminPaymentMethodsAuthIdentity(
        currentIdentity,
        requestIdentity,
      )
    ) {
      catalogReloads += 1;
    }
    return mutationSucceeded;
  };

  const olderAction = runRowAction("method-a", olderServer);
  await Promise.resolve();
  assert.equal(busyRow, "method-a");
  const newerAction = runRowAction("method-b", newerServer);
  await Promise.resolve();
  assert.equal(busyRow, "method-b");

  newerServer.reject(new Error("newer action failed"));
  assert.equal(await newerAction, false);
  assert.deepEqual(notices, ["failure:method-b"]);
  assert.equal(busyRow, null);
  assert.equal(catalogReloads, 0);

  olderServer.resolve("mutated");
  assert.equal(await olderAction, true);
  assert.deepEqual(
    notices,
    ["failure:method-b"],
    "the stale older success must not publish a toast",
  );
  assert.equal(
    busyRow,
    null,
    "the stale older finalizer must not replace current busy state",
  );
  assert.equal(
    catalogReloads,
    1,
    "the current catalog must reconcile the durable older mutation",
  );
});

test("payment-method browser service owns only the established server-function payloads", async () => {
  const service = await readRepositoryFile(
    "src/domains/fiat-deposits/application/admin-payment-methods-browser-service.ts",
  );

  for (const serverFunction of [
    "archivePaymentMethodFn",
    "createPaymentMethodFn",
    "getPaymentMethodsFn",
    "updatePaymentMethodFn",
  ]) {
    assert.match(service, new RegExp(serverFunction));
  }
  assert.match(
    service,
    /getPaymentMethodsFn\(\{\s*data: \{\s*activeOnly: false,\s*accessToken,\s*archiveFilter,\s*\},\s*\}\)/s,
  );
  assert.match(
    service,
    /createPaymentMethodFn\(\{\s*data: \{\s*accessToken,\s*type: input\.type,\s*accountName: input\.accountName,\s*accountNumber: input\.accountNumber,\s*instructions: input\.instructions,\s*\},\s*\}\)/s,
  );
  assert.match(
    service,
    /updatePaymentMethodFn\(\{\s*data: \{\s*accessToken,\s*methodId: input\.methodId,\s*accountName: input\.accountName,\s*accountNumber: input\.accountNumber,\s*instructions: input\.instructions,\s*\},\s*\}\)/s,
  );
  assert.match(
    service,
    /updatePaymentMethodFn\(\{\s*data: \{ accessToken, methodId, isActive \},\s*\}\)/s,
  );
  assert.match(
    service,
    /archivePaymentMethodFn\(\{\s*data: \{ accessToken, methodId, archived \},\s*\}\)/s,
  );
  assert.doesNotMatch(
    service,
    /supabase|createClient|auth\.getSession|fetch\(|\.from\(|\.rpc\(/i,
  );
});

test("payment-method catalog preserves timing, refresh, coalescing, and stale guards", async () => {
  const controller = await readRepositoryFile(
    "src/domains/fiat-deposits/ui/admin/useAdminPaymentMethodsCatalog.ts",
  );

  assert.match(controller, /ADMIN_PAYMENT_METHODS_TIMEOUT_MS = 10_000/);
  assert.match(controller, /ADMIN_PAYMENT_METHODS_RETRY_DELAY_MS = 1_500/);
  assert.match(controller, /ADMIN_PAYMENT_METHODS_MAX_AUTO_RETRIES = 2/);
  assert.match(controller, /Admin payment methods request timed out\./);
  assert.match(controller, /createAdminPaymentMethodsRequestKey\(/);
  assert.match(controller, /adminPaymentMethodsGlobalMutationFlights\.whenIdle\(\)/);
  assert.match(controller, /return activeLoad\.promise/);
  assert.match(controller, /forceNewFlight/);
  assert.match(controller, /Symbol\("admin-payment-methods-catalog-flight"\)/);
  assert.match(controller, /activeLoadRef\.current\?\.token === flightToken/);
  assert.ok(
    [...controller.matchAll(/request\.isCurrent\(requestKeyRef\.current\)/g)]
      .length >= 3,
    "pre-read, success, and failure publication must be generation gated",
  );
  assert.match(controller, /requestGuardRef\.current\.invalidate\(\)/);
  assert.match(controller, /setSnapshot\(null\)/);
  assert.match(controller, /document\.addEventListener\("visibilitychange"/);
  assert.match(controller, /window\.addEventListener\("online"/);
  assert.match(
    controller,
    /isSameAdminPaymentMethodsRequestKey\(snapshot\.key, requestKey\)/,
  );
  assert.doesNotMatch(controller, /setInterval|auth\.getSession|supabase/);
});

test("payment-method mutations preserve exact generation guards, dedupe, and restore visibility", async () => {
  const [editorActions, rowActions, controller] = await Promise.all([
    readRepositoryFile(
      "src/domains/fiat-deposits/ui/admin/useAdminPaymentMethodEditorActions.ts",
    ),
    readRepositoryFile(
      "src/domains/fiat-deposits/ui/admin/useAdminPaymentMethodRowActions.ts",
    ),
    readRepositoryFile(
      "src/domains/fiat-deposits/ui/admin/useAdminPaymentMethods.ts",
    ),
  ]);

  for (const source of [editorActions, rowActions]) {
    assert.match(source, /adminPaymentMethodsGlobalMutationFlights\.run\(/);
    assert.match(source, /request\.isCurrent\(identityRef\.current\)/);
    assert.match(source, /readAdminPaymentMethodsScopedValue\(/);
    assert.doesNotMatch(source, /auth\.getSession|supabase|setInterval/);
  }
  assert.ok(
    [...editorActions.matchAll(/request\.isCurrent\(identityRef\.current\)/g)]
      .length >= 6,
    "create and edit success, failure, and finalizer publication must be gated",
  );
  assert.ok(
    [...rowActions.matchAll(/request\.isCurrent\(identityRef\.current\)/g)]
      .length >= 6,
    "toggle and archive success, failure, and finalizer publication must be gated",
  );
  assert.match(editorActions, /JSON\.stringify\(\["create", input\]\)/);
  assert.match(editorActions, /JSON\.stringify\(\["edit", input\]\)/);
  assert.match(rowActions, /JSON\.stringify\(\["toggle", method\.id, nextActive\]\)/);
  assert.match(rowActions, /JSON\.stringify\(\["archive", method\.id, archived\]\)/);
  assert.doesNotMatch(
    rowActions,
    /await setAdminPaymentMethodActive\([\s\S]*?if \(!mountedRef\.current \|\| !request\.isCurrent\(identityRef\.current\)\) \{\s*return false;\s*\}/,
  );
  assert.doesNotMatch(
    rowActions,
    /await setAdminPaymentMethodArchived\([\s\S]*?if \(!mountedRef\.current \|\| !request\.isCurrent\(identityRef\.current\)\) \{\s*return false;\s*\}/,
  );
  assert.match(
    rowActions,
    /Are you sure you want to \$\{actionLabel\} this payment account\?/
  );
  assert.match(rowActions, /if \(archived\) reloadCurrentCatalog\(\);\s*else restoreVisibleFilter\(\);/s);
  assert.match(controller, /createAdminPaymentMethodsAuthIdentity\(userId, accessToken\)/);
  assert.match(controller, /setArchiveFilter\("visible"\)/);
  assert.match(controller, /Session expired\. Please sign in again\./);
  assert.match(controller, /createAdminPaymentMethodsEditorState\(identity\)/);
});

test("fiat payment-method presentation preserves the established copy and archive contract", async () => {
  const [panel, editor, list, publicSurface] = await Promise.all([
    readRepositoryFile(
      "src/domains/fiat-deposits/ui/admin/AdminFiatPaymentMethodsPanel.tsx",
    ),
    readRepositoryFile(
      "src/domains/fiat-deposits/ui/admin/AdminPaymentMethodEditor.tsx",
    ),
    readRepositoryFile(
      "src/domains/fiat-deposits/ui/admin/AdminPaymentMethodList.tsx",
    ),
    readRepositoryFile("src/domains/fiat-deposits/public.ts"),
  ]);

  assert.deepEqual(ADMIN_PAYMENT_METHOD_LABELS, {
    cbe: "CBE",
    telebirr: "TeleBirr",
  });
  assert.deepEqual(ADMIN_PAYMENT_METHOD_TYPES, ["cbe", "telebirr"]);
  assert.deepEqual(ADMIN_PAYMENT_METHOD_ARCHIVE_FILTERS, [
    { key: "visible", label: "Visible" },
    { key: "archived", label: "Archived" },
    { key: "all", label: "All" },
  ]);

  for (const copy of ["Manage deposit accounts", "Add"]) {
    assert.match(panel, new RegExp(copy));
  }
  for (const copy of [
    "New Payment Account",
    "Account Name",
    "Account Number",
    "Instructions (optional)",
    "Create",
    "Cancel",
    "Save Changes",
    "Last 8 digits are generated automatically from the CBE account number.",
  ]) {
    assert.match(
      editor,
      new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  for (const copy of [
    "No archived payment methods.",
    "No payment methods configured.",
    "Archived",
    "Active",
    "Off",
    "Disable",
    "Enable",
    "Restore",
    "Archive",
  ]) {
    assert.match(
      list,
      new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.match(panel, /useAdminPaymentMethods\(userId, accessToken\)/);
  assert.match(panel, /setArchiveFilter\(filter\.key\)/);
  assert.match(list, /method\.is_archived/);
  assert.match(list, /method\.is_active/);
  assert.match(
    publicSurface,
    /export \{ AdminFiatPaymentMethodsPanel \} from "\.\/ui\/admin\/AdminFiatPaymentMethodsPanel\.js";/,
  );
  assert.doesNotMatch(publicSurface, /export \*/);
});

test("admin route delegates Payment settings through the fiat-deposits public facade", async () => {
  const route = await readRepositoryFile("src/routes/_app/admin.tsx");

  assert.match(
    route,
    /AdminFiatPaymentMethodsPanel,[\s\S]*DepositVerificationAuditPanel,[\s\S]*from "@\/domains\/fiat-deposits\/public\.js"/,
  );
  assert.match(route, /\{ key: "support", label: "Support" \}/);
  assert.match(route, /\{ key: "payment", label: "Payment" \}/);
  assert.match(route, /hidden=\{activeSettingsTab !== "support"\}/);
  assert.match(
    route,
    /\{activeSettingsTab === "payment" && \(\s*<AdminFiatPaymentMethodsPanel accessToken=\{accessToken\} userId=\{userId\} \/>\s*\)\}/s,
  );
  assert.doesNotMatch(
    route,
    /function PaymentMethodsTab|getPaymentMethodsFn|createPaymentMethodFn|updatePaymentMethodFn|archivePaymentMethodFn|type PaymentMethod\b|PaymentMethodType/,
  );
});

test("payment-method server retains independent admin authorization and CBE/archive semantics", async () => {
  const server = await readRepositoryFile("src/lib/server/payment-methods.ts");

  assert.match(server, /admin\.auth\.getUser\(accessToken\)/);
  assert.match(server, /\.select\("is_admin, is_frozen"\)/);
  assert.match(server, /\.eq\("id", authUser\.id\)/);
  assert.match(server, /profile\.is_admin !== true/);
  assert.match(server, /profile\.is_frozen === true/);
  assert.doesNotMatch(server, /data\.userId|data\.user_id/);
  assert.match(server, /const activeOnlyResolved = activeOnly !== false/);
  assert.match(server, /if \(!data\.activeOnly\) \{\s*await assertAdminToken\(data\.accessToken as string\);\s*\}/s);
  assert.match(server, /archiveFilter === "archived" \|\| archiveFilter === "all"/);
  assert.match(server, /accountNumber\.replace\(\/\\D\/g, ""\)/);
  assert.match(server, /return digits\.slice\(-8\)/);
  assert.match(server, /type === "cbe"/);
  assert.match(server, /return null/);
  assert.match(
    server,
    /data\.archived\s*\? \{ is_archived: true, is_active: false \}\s*: \{ is_archived: false \}/s,
  );
  assert.match(server, /deliberately does NOT auto-enable/);
  assert.doesNotMatch(server, /\.delete\(/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAdminSupportSettingsAuthIdentity,
  createAdminSupportSettingsScopedValue,
  createAdminSupportSettingsSaveFlight,
  createLatestAdminSupportSettingsRequestGuard,
  isSameAdminSupportSettingsAuthIdentity,
  readAdminSupportSettingsScopedValue,
} from "../src/domains/support/application/admin-support-settings-auth-lifecycle.ts";

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

test("admin support identity binds the exact administrator and access-token generation", () => {
  const original = createAdminSupportSettingsAuthIdentity("admin-a", "token-a");
  const same = createAdminSupportSettingsAuthIdentity("admin-a", "token-a");
  const refreshed = createAdminSupportSettingsAuthIdentity("admin-a", "token-b");
  const replacement = createAdminSupportSettingsAuthIdentity("admin-b", "token-a");

  assert.ok(original);
  assert.ok(same);
  assert.ok(refreshed);
  assert.ok(replacement);
  assert.equal(createAdminSupportSettingsAuthIdentity(null, "token-a"), null);
  assert.equal(createAdminSupportSettingsAuthIdentity("admin-a", null), null);
  assert.equal(isSameAdminSupportSettingsAuthIdentity(original, same), true);
  assert.equal(isSameAdminSupportSettingsAuthIdentity(original, refreshed), false);
  assert.equal(isSameAdminSupportSettingsAuthIdentity(original, replacement), false);
  assert.equal(isSameAdminSupportSettingsAuthIdentity(original, null), false);
});

test("admin support visible state is unavailable to a replacement auth generation before effects run", () => {
  const adminA = createAdminSupportSettingsAuthIdentity("admin-a", "token-a");
  const adminB = createAdminSupportSettingsAuthIdentity("admin-b", "token-b");
  assert.ok(adminA);
  assert.ok(adminB);

  const draft = createAdminSupportSettingsScopedValue(adminA, "old-draft");
  const loading = createAdminSupportSettingsScopedValue(adminA, false);
  const saving = createAdminSupportSettingsScopedValue(adminA, true);

  assert.equal(readAdminSupportSettingsScopedValue(draft, adminA), "old-draft");
  assert.equal(readAdminSupportSettingsScopedValue(draft, adminB), null);
  assert.equal(readAdminSupportSettingsScopedValue(loading, adminB) ?? true, true);
  assert.equal(readAdminSupportSettingsScopedValue(saving, adminB) ?? false, false);
});

test("late support loads and saves cannot publish, notify, or finalize across auth generations", async () => {
  const loadGuard = createLatestAdminSupportSettingsRequestGuard();
  const saveGuard = createLatestAdminSupportSettingsRequestGuard();
  const adminA = createAdminSupportSettingsAuthIdentity("admin-a", "token-a");
  const adminB = createAdminSupportSettingsAuthIdentity("admin-b", "token-b");
  assert.ok(adminA);
  assert.ok(adminB);

  let currentIdentity = adminA;
  let visibleUsername = "replacement-draft";
  let notices = 0;
  let loading = true;
  let saving = true;
  const oldLoad = deferred();
  const oldSave = deferred();
  const loadTicket = loadGuard.begin(adminA);
  const saveTicket = saveGuard.begin(adminA);
  const loadCommit = oldLoad.promise.then((value) => {
    if (loadTicket.isCurrent(currentIdentity)) visibleUsername = value;
  }).catch(() => {
    if (loadTicket.isCurrent(currentIdentity)) notices += 1;
  }).finally(() => {
    if (loadTicket.isCurrent(currentIdentity)) loading = false;
  });
  const saveCommit = oldSave.promise.then((value) => {
    if (saveTicket.isCurrent(currentIdentity)) {
      visibleUsername = value;
      notices += 1;
    }
  }).catch(() => {
    if (saveTicket.isCurrent(currentIdentity)) notices += 1;
  }).finally(() => {
    if (saveTicket.isCurrent(currentIdentity)) saving = false;
  });

  currentIdentity = adminB;
  loadGuard.invalidate();
  saveGuard.invalidate();
  loading = true;
  saving = true;
  oldLoad.resolve("stale-load");
  oldSave.resolve("stale-save");
  await Promise.all([loadCommit, saveCommit]);

  assert.equal(visibleUsername, "replacement-draft");
  assert.equal(notices, 0);
  assert.equal(loading, true);
  assert.equal(saving, true);
  assert.equal(loadTicket.isCurrent(currentIdentity), false);
  assert.equal(saveTicket.isCurrent(currentIdentity), false);
});

test("support saves serialize across auth generations and old cleanup cannot detach a replacement", async () => {
  const coordinator = createAdminSupportSettingsSaveFlight();
  const adminA = createAdminSupportSettingsAuthIdentity("admin-a", "token-a");
  const adminB = createAdminSupportSettingsAuthIdentity("admin-b", "token-b");
  assert.ok(adminA);
  assert.ok(adminB);

  let calls = 0;
  const first = deferred();
  const replacement = deferred();
  const executionOrder = [];
  const firstPromise = coordinator.run(adminA, () => {
    calls += 1;
    executionOrder.push("old-start");
    return first.promise.then((value) => {
      executionOrder.push("old-finish");
      return value;
    });
  });
  const duplicatePromise = coordinator.run(adminA, () => {
    calls += 1;
    return Promise.resolve("duplicate");
  });
  assert.equal(firstPromise, duplicatePromise);
  await Promise.resolve();
  assert.equal(calls, 1);

  const replacementPromise = coordinator.run(adminB, () => {
    calls += 1;
    executionOrder.push("new-start");
    return replacement.promise.then((value) => {
      executionOrder.push("new-finish");
      return value;
    });
  });
  assert.equal(calls, 1);
  assert.deepEqual(executionOrder, ["old-start"]);
  first.resolve("old");
  await firstPromise;
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.deepEqual(executionOrder, ["old-start", "old-finish", "new-start"]);

  const replacementDuplicate = coordinator.run(adminB, () => {
    calls += 1;
    return Promise.resolve("unexpected");
  });
  assert.equal(replacementDuplicate, replacementPromise);
  assert.equal(calls, 2);
  replacement.resolve("new");
  assert.equal(await replacementPromise, "new");
  await coordinator.whenIdle();
  assert.deepEqual(executionOrder, [
    "old-start",
    "old-finish",
    "new-start",
    "new-finish",
  ]);
});

test("a replacement load can wait until the last accepted global save is authoritative", async () => {
  const coordinator = createAdminSupportSettingsSaveFlight();
  const adminA = createAdminSupportSettingsAuthIdentity("admin-a", "token-a");
  const adminB = createAdminSupportSettingsAuthIdentity("admin-b", "token-b");
  assert.ok(adminA);
  assert.ok(adminB);

  const oldGate = deferred();
  let storedUsername = "initial";
  const oldSave = coordinator.run(adminA, async () => {
    await oldGate.promise;
    storedUsername = "old-admin-save";
  });
  const newSave = coordinator.run(adminB, async () => {
    storedUsername = "new-admin-save";
  });
  const replacementLoad = (async () => {
    await coordinator.whenIdle();
    return storedUsername;
  })();

  oldGate.resolve();
  await Promise.all([oldSave, newSave]);
  assert.equal(await replacementLoad, "new-admin-save");
  assert.equal(storedUsername, "new-admin-save");
});

test("admin support controller isolates reads, saves, drafts, notices, and finalizers", async () => {
  const controller = await readRepositoryFile(
    "src/domains/support/ui/admin/useAdminSupportSettings.ts",
  );

  assert.match(
    controller,
    /createAdminSupportSettingsAuthIdentity\(userId, accessToken\)/,
  );
  assert.match(controller, /createLatestAdminSupportSettingsRequestGuard/);
  assert.match(controller, /adminSupportSettingsGlobalSaveFlight/);
  assert.match(controller, /return activeLoad\.promise/);
  assert.match(controller, /await adminSupportSettingsGlobalSaveFlight\.whenIdle\(\)/);
  assert.match(controller, /return adminSupportSettingsGlobalSaveFlight\.run\(requestIdentity/);
  assert.match(controller, /draftRef\.current = nextDraft;\s*setDraft\(nextDraft\);/s);
  assert.match(controller, /readAdminSupportSettingsScopedValue\(loadingState, identity\) \?\? true/);
  assert.match(controller, /readAdminSupportSettingsScopedValue\(savingState, identity\) \?\? false/);
  assert.ok(
    [...controller.matchAll(/request\.isCurrent\(identityRef\.current\)/g)].length >= 6,
    "load/save success, failure, and finalizers must be generation gated",
  );
  assert.match(controller, /draftRef\.current,[\s\S]*requestIdentity,[\s\S]*\) === submittedUsername/);
  assert.match(controller, /setSnapshot\(\{ identity: requestIdentity, settings \}\)/);
  assert.match(controller, /Session expired\. Please sign in again\./);
  assert.match(controller, /Support Telegram username updated\./);
  assert.match(controller, /getSafeErrorMessage\(error, "SUPPORT"\)\.message/);
  assert.doesNotMatch(controller, /supabase|auth\.getSession|setInterval|visibilitychange|addEventListener/);
});

test("admin support bridge owns the exact existing read and update calls", async () => {
  const service = await readRepositoryFile(
    "src/domains/support/application/admin-support-settings-browser-service.ts",
  );

  assert.match(service, /getSupportSettingsFn/);
  assert.match(service, /updateSupportTelegramUsernameFn/);
  assert.match(service, /getSupportSettingsFn\(\{ data: \{\} \}\)/);
  assert.match(
    service,
    /updateSupportTelegramUsernameFn\(\{\s*data: \{\s*accessToken,\s*telegramUsername,\s*\},\s*\}\)/s,
  );
  assert.doesNotMatch(service, /supabase|createClient|\.from\(|\.rpc\(|fetch\(/);
});

test("admin support panel preserves the established visible Telegram contract", async () => {
  const panel = await readRepositoryFile(
    "src/domains/support/ui/admin/AdminSupportSettingsPanel.tsx",
  );

  for (const copy of [
    "Support Settings",
    "Loading support settings...",
    "Telegram Support Username",
    "QHashSupport",
    "Letters, numbers, and underscores only. @ is optional. Do not paste a full link.",
    "Current public support contact",
    "Open current Telegram support",
    "Save Support Username",
    "Support v1 uses Telegram only. Internal support tickets are not active.",
    "The public Support page builds the link as t.me/username from this setting.",
  ]) {
    assert.match(panel, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(panel, /useAdminSupportSettings\(userId, accessToken\)/);
  assert.match(panel, /settings\?\.isConfigured/);
  assert.match(panel, /settings\.telegramDisplay/);
  assert.match(panel, /window\.open\(settings\.telegramUrl, "_blank", "noopener,noreferrer"\)/);
  assert.match(panel, /loading=\{saving\}/);
});

test("admin settings keeps the support controller mounted across Support and Payment switches", async () => {
  const route = await readRepositoryFile("src/routes/_app/admin.tsx");

  assert.match(
    route,
    /<div\s+hidden=\{activeSettingsTab !== "support"\}\s+aria-hidden=\{activeSettingsTab !== "support"\}\s*>\s*<AdminSupportSettingsPanel[\s\S]*?<\/div>/,
  );
  assert.match(
    route,
    /\{activeSettingsTab === "payment" && <PaymentMethodsTab userId=\{userId\} \/>\}/,
  );
  assert.doesNotMatch(
    route,
    /activeSettingsTab === "support"\s*\?\s*\(\s*<AdminSupportSettingsPanel/,
  );
});

test("support server keeps the public sanitized read and independent active-admin update authorization", async () => {
  const server = await readRepositoryFile("src/lib/server/support-settings.ts");

  assert.match(server, /SUPPORT_TELEGRAM_USERNAME_KEY = "support_telegram_username"/);
  assert.match(server, /export const getSupportSettingsFn = createServerFn\(\{ method: "POST" \}\)/);
  assert.match(server, /\.inputValidator\(\(\) => \(\{\}\)\)/);
  assert.match(server, /export const updateSupportTelegramUsernameFn = createServerFn\(\{ method: "POST" \}\)/);
  assert.match(server, /admin\.auth\.getUser\(accessToken\)/);
  assert.match(server, /\.select\("is_admin, is_frozen"\)/);
  assert.match(server, /profile\.is_admin !== true \|\| profile\.is_frozen === true/);
  assert.match(server, /normalizeTelegramUsername\(telegramUsername\)/);
  assert.match(server, /\.upsert\(/);
});

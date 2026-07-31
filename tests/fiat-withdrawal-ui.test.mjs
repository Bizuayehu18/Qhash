import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createFiatWithdrawalAuthIdentity,
  createLatestFiatWithdrawalRequestGuard,
  isSameFiatWithdrawalAuthIdentity,
} from "../src/domains/fiat-withdrawals/ui/fiat-withdrawal-auth-lifecycle.ts";

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

const [
  publicSurface,
  browserService,
  controller,
  remoteState,
  detailsForm,
  confirmForm,
  history,
  methodList,
  notice,
  providerRegistry,
  cbeProvider,
  telebirrProvider,
  etPolicy,
  authLifecycle,
] = await Promise.all([
  readRepositoryFile("src/domains/fiat-withdrawals/public.ts"),
  readRepositoryFile("src/domains/fiat-withdrawals/application/fiat-withdrawal-browser-service.ts"),
  readRepositoryFile("src/domains/fiat-withdrawals/ui/useFiatWithdrawal.ts"),
  readRepositoryFile("src/domains/fiat-withdrawals/ui/useFiatWithdrawalRemoteState.ts"),
  readRepositoryFile("src/domains/fiat-withdrawals/ui/FiatWithdrawalDetailsForm.tsx"),
  readRepositoryFile("src/domains/fiat-withdrawals/ui/FiatWithdrawalConfirmForm.tsx"),
  readRepositoryFile("src/domains/fiat-withdrawals/ui/FiatWithdrawalHistory.tsx"),
  readRepositoryFile("src/domains/fiat-withdrawals/ui/FiatWithdrawalMethodList.tsx"),
  readRepositoryFile("src/domains/fiat-withdrawals/ui/FiatWithdrawalNotice.tsx"),
  readRepositoryFile("src/domains/fiat-withdrawals/ui/fiat-withdrawal-providers.ts"),
  readRepositoryFile("src/domains/fiat-withdrawals/ui/providers/et/cbe-withdrawal-provider.tsx"),
  readRepositoryFile("src/domains/fiat-withdrawals/ui/providers/et/telebirr-withdrawal-provider.tsx"),
  readRepositoryFile("src/domains/fiat-withdrawals/ui/providers/et/ethiopia-withdrawal-policy.ts"),
  readRepositoryFile("src/domains/fiat-withdrawals/ui/fiat-withdrawal-auth-lifecycle.ts"),
]);

test("fiat withdrawal public surface stays client-safe and cross-rail neutral", () => {
  assert.match(publicSurface, /FiatWithdrawalDetailsForm/);
  assert.match(publicSurface, /FiatWithdrawalConfirmForm/);
  assert.match(publicSurface, /FiatWithdrawalHistory/);
  assert.match(publicSurface, /FiatWithdrawalMethodList/);
  assert.match(publicSurface, /useFiatWithdrawal/);

  const sources = [
    publicSurface,
    browserService,
    controller,
    remoteState,
    detailsForm,
    confirmForm,
    history,
    methodList,
    notice,
    providerRegistry,
    cbeProvider,
    telebirrProvider,
    etPolicy,
    authLifecycle,
  ].join("\n");
  assert.doesNotMatch(sources, /crypto\/usdt|USDT Withdrawal|Nowpayments/i);
  assert.doesNotMatch(
    sources,
    /SUPABASE_SERVICE_ROLE_KEY|NOWPAYMENTS_API_KEY|createClient|\.from\(|\.rpc\(|api\.nowpayments/i,
  );
  assert.match(browserService, /\.\.\/domain\/fiat-withdrawal-method\.js/);
  assert.doesNotMatch(browserService, /\.\.\/ui\//);
});

test("Ethiopia CBE and TeleBirr providers retain exact payout presentation", () => {
  assert.match(providerRegistry, /cbe-withdrawal-provider\.js/);
  assert.match(providerRegistry, /telebirr-withdrawal-provider\.js/);
  assert.match(providerRegistry, /left\.order - right\.order/);

  assert.match(cbeProvider, /countryCode: "et"/);
  assert.match(cbeProvider, /method: "cbe"/);
  assert.match(cbeProvider, /displayName: "CBE"/);
  assert.match(cbeProvider, /title: "CBE Withdrawal"/);
  assert.match(cbeProvider, /nameLabel: "CBE Account Name"/);
  assert.match(cbeProvider, /numberLabel: "CBE Account Number"/);

  assert.match(telebirrProvider, /countryCode: "et"/);
  assert.match(telebirrProvider, /method: "telebirr"/);
  assert.match(telebirrProvider, /displayName: "TeleBirr"/);
  assert.match(telebirrProvider, /title: "TeleBirr Withdrawal"/);
  assert.match(telebirrProvider, /nameLabel: "TeleBirr Account Name"/);
  assert.match(telebirrProvider, /numberLabel: "TeleBirr Phone Number"/);
  assert.match(methodList, /Payout/);
});

test("legacy Ethiopia amount, fee, Fund PIN, and submission rules are unchanged", () => {
  assert.match(etPolicy, /ETHIOPIA_MIN_WITHDRAWAL_AMOUNT_ETB = 200/);
  assert.match(etPolicy, /ETHIOPIA_WITHDRAWAL_FEE_PERCENT = 5/);
  assert.match(controller, /Number\(visibleAmount\)/);
  assert.match(browserService, /submitWithdrawalFn\(/);
  assert.equal((browserService.match(/submitWithdrawalFn\(/g) ?? []).length, 1);
  assert.match(browserService, /getUserWithdrawalsFn\(/);
  assert.match(browserService, /getSecurityStatusFn\(/);
  assert.match(controller, /visibleFundPassword\.length !== 4/);
  assert.match(controller, /formatWithdrawalCooldownMessage\(result\.next_allowed_at\)/);
  assert.match(controller, /remote\.refreshWallet\(true\)/);
  assert.match(
    remoteState,
    /fetchWallet\(\s*authIdentity\.userId,\s*force \? \{ force: true \} : undefined,\s*\)/,
  );
  assert.match(detailsForm, /Amount \(ETB\)/);
  assert.match(detailsForm, /Minimum withdrawal is/);
  assert.match(confirmForm, /Enter 4-digit fund password/);
  assert.match(confirmForm, /Confirm Withdrawal/);

  const amountField = detailsForm.indexOf('label="Amount (ETB)"');
  const accountNameField = detailsForm.indexOf("label={selectedMeta?.nameLabel");
  const accountNumberField = detailsForm.indexOf("label={selectedMeta?.numberLabel");
  const summary = detailsForm.indexOf("<FiatWithdrawalSummaryCard");
  assert.ok(amountField >= 0);
  assert.ok(amountField < accountNameField);
  assert.ok(accountNameField < accountNumberField);
  assert.ok(accountNumberField < summary);
  assert.match(controller, /visibleAccountName\.trim\(\)\.length < 2/);
  assert.match(controller, /visibleAccountNumber\.trim\(\)\.length < 5/);
});

test("fiat withdrawal history and shared policy disclosure preserve existing UX", () => {
  assert.match(history, /Withdrawal History/);
  assert.match(history, /No withdrawals yet/);
  assert.match(history, /approved:[\s\S]*Approved/);
  assert.match(history, /pending:[\s\S]*Pending/);
  assert.match(history, /rejected:[\s\S]*Rejected/);
  assert.match(notice, /24h processing/);
  assert.match(notice, /CROSS_RAIL_WITHDRAWAL_POLICY_MESSAGE/);
  assert.doesNotMatch(`${history}\n${confirmForm}`, /transaction_hash|current_broadcast_id|confirmations|manual review/i);
});

test("authentication identity includes the exact user and access-token generation", () => {
  const first = createFiatWithdrawalAuthIdentity("user-a", "token-a");
  const same = createFiatWithdrawalAuthIdentity("user-a", "token-a");
  const refreshed = createFiatWithdrawalAuthIdentity("user-a", "token-b");
  const otherUser = createFiatWithdrawalAuthIdentity("user-b", "token-a");

  assert.ok(first);
  assert.equal(isSameFiatWithdrawalAuthIdentity(first, same), true);
  assert.equal(isSameFiatWithdrawalAuthIdentity(first, refreshed), false);
  assert.equal(isSameFiatWithdrawalAuthIdentity(first, otherUser), false);
  assert.equal(createFiatWithdrawalAuthIdentity("user-a", null), null);
});

test("late history success cannot cross an authentication generation", async () => {
  const guard = createLatestFiatWithdrawalRequestGuard();
  let currentIdentity = createFiatWithdrawalAuthIdentity("user-a", "token-a");
  const userARequest = deferred();
  const userATicket = guard.begin(currentIdentity);
  const commits = [];
  const userAResult = userARequest.promise.then((value) => {
    if (userATicket.isCurrent(currentIdentity)) commits.push(value);
  });

  currentIdentity = createFiatWithdrawalAuthIdentity("user-b", "token-b");
  const userBTicket = guard.begin(currentIdentity);
  const userBRequest = deferred();
  const userBResult = userBRequest.promise.then((value) => {
    if (userBTicket.isCurrent(currentIdentity)) commits.push(value);
  });

  userBRequest.resolve("user-b-history");
  await userBResult;
  userARequest.resolve("user-a-history");
  await userAResult;

  assert.deepEqual(commits, ["user-b-history"]);
});

test("late history failure cannot schedule work for a new authentication generation", async () => {
  const guard = createLatestFiatWithdrawalRequestGuard();
  let currentIdentity = createFiatWithdrawalAuthIdentity("user-a", "token-a");
  const userARequest = deferred();
  const userATicket = guard.begin(currentIdentity);
  const errors = [];
  const userAResult = userARequest.promise.catch((error) => {
    if (userATicket.isCurrent(currentIdentity)) errors.push(error.message);
  });

  currentIdentity = createFiatWithdrawalAuthIdentity("user-b", "token-b");
  guard.begin(currentIdentity);
  userARequest.reject(new Error("late-user-a-failure"));
  await userAResult;

  assert.deepEqual(errors, []);
});

test("remote loaders and submission lifecycle purge and guard auth-bound state", () => {
  assert.match(remoteState, /createLatestFiatWithdrawalRequestGuard/);
  assert.match(remoteState, /setSnapshot\(createEmptyRemoteSnapshot\(authIdentity\)\)/);
  assert.match(remoteState, /ticket\.isCurrent\(authIdentityRef\.current\)/);
  assert.match(remoteState, /historyGuardRef\.current\.invalidate\(\)/);
  assert.match(remoteState, /securityGuardRef\.current\.invalidate\(\)/);

  assert.match(controller, /setFormIdentity\(remote\.authIdentity\)/);
  assert.match(controller, /submissionGuardRef\.current\.invalidate\(\)/);
  assert.match(controller, /submissionPromiseRef\.current = null/);
  assert.match(controller, /ticket\.isCurrent\(authIdentityRef\.current\)/);
  assert.match(controller, /visibleFundPassword/);
});

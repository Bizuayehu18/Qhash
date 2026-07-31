import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

const [
  publicSurface,
  controller,
  form,
  history,
  methodList,
  providerRegistry,
  cbeProvider,
  telebirrProvider,
] = await Promise.all([
  readRepositoryFile("src/domains/fiat-deposits/public.ts"),
  readRepositoryFile("src/domains/fiat-deposits/ui/useFiatDeposit.ts"),
  readRepositoryFile("src/domains/fiat-deposits/ui/FiatDepositForm.tsx"),
  readRepositoryFile("src/domains/fiat-deposits/ui/FiatDepositHistory.tsx"),
  readRepositoryFile("src/domains/fiat-deposits/ui/FiatDepositMethodList.tsx"),
  readRepositoryFile("src/domains/fiat-deposits/ui/fiat-deposit-providers.ts"),
  readRepositoryFile("src/domains/fiat-deposits/ui/providers/et/cbe-deposit-provider.tsx"),
  readRepositoryFile("src/domains/fiat-deposits/ui/providers/et/telebirr-deposit-provider.tsx"),
]);

test("fiat deposit surface is client-safe and separated from cross-rail navigation", () => {
  assert.match(publicSurface, /FiatDepositForm/);
  assert.match(publicSurface, /FiatDepositHistory/);
  assert.match(publicSurface, /FiatDepositMethodList/);
  assert.match(publicSurface, /useFiatDeposit/);

  const fiatSources = [
    publicSurface,
    controller,
    form,
    history,
    methodList,
    providerRegistry,
    cbeProvider,
    telebirrProvider,
  ].join("\n");
  assert.doesNotMatch(fiatSources, /crypto-deposits|\/deposit\/crypto|Crypto Deposit/);
  assert.doesNotMatch(
    fiatSources,
    /SUPABASE_SERVICE_ROLE_KEY|NOWPAYMENTS_API_KEY|createClient|\.from\(|\.rpc\(|api\.nowpayments/i,
  );
});

test("Ethiopia CBE and TeleBirr providers keep exact collection rules", () => {
  assert.match(providerRegistry, /cbe-deposit-provider\.js/);
  assert.match(providerRegistry, /telebirr-deposit-provider\.js/);

  assert.match(cbeProvider, /method: "cbe"/);
  assert.match(cbeProvider, /label: "CBE"/);
  assert.match(cbeProvider, /refPrefix: "FT"/);
  assert.match(cbeProvider, /refLabel: "CBE Transaction ID"/);
  assert.match(cbeProvider, /Starts with \"FT\"/);
  assert.match(cbeProvider, /CBE deposit submitted successfully/);

  assert.match(telebirrProvider, /method: "telebirr"/);
  assert.match(telebirrProvider, /label: "TeleBirr"/);
  assert.match(telebirrProvider, /refPrefix: "D"/);
  assert.match(telebirrProvider, /refLabel: "TeleBirr Transaction ID"/);
  assert.match(telebirrProvider, /Starts with \"D\"/);
  assert.match(telebirrProvider, /TeleBirr deposit submitted successfully/);
});

test("fiat submission and history keep the existing server-owned boundaries", () => {
  assert.match(controller, /getPaymentMethodsFn\(\{ data: \{ activeOnly: true \} \}\)/);
  assert.equal((controller.match(/submitDepositFn\(/g) ?? []).length, 1);
  assert.equal((controller.match(/getUserDepositsFn\(/g) ?? []).length, 1);
  assert.match(controller, /transactionReference: reference/);
  assert.match(controller, /paymentMethodId: selectedMethod\.id/);
  assert.match(controller, /reference\.startsWith\(meta\.refPrefix\)/);
  assert.match(controller, /Enter a valid amount or leave it blank/);
  assert.match(controller, /Session expired\. Please sign in again/);
  assert.match(form, /Amount \(ETB\) — optional/);
  assert.match(form, /Submit Deposit/);
  assert.match(history, /Deposit History/);
  assert.match(history, /Submitted deposits will appear here/);
  assert.match(history, /approved:[\s\S]*Done/);
  assert.match(history, /pending:[\s\S]*Pending/);
  assert.match(history, /rejected:[\s\S]*Failed/);
});

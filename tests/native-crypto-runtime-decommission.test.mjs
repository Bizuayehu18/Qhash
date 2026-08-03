import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

test("native crypto runtime files are absent", async () => {
  const removedRuntimeFiles = [
    "netlify/functions/bsc-deposit-watcher.mts",
    "src/components/admin/AdminCryptoAddressInventoryPanel.tsx",
    "src/components/admin/AdminCryptoBscConfirmationDryRunPanel.tsx",
    "src/components/admin/AdminCryptoBscDryRunPanel.tsx",
    "src/components/admin/AdminCryptoDepositAuditPanel.tsx",
    "src/components/admin/AdminCryptoSettingsPanel.tsx",
    "src/lib/crypto-deposit-availability.ts",
    "src/lib/server/bsc-watcher-range-plan.ts",
    "src/lib/server/crypto-admin-address-assignment.ts",
    "src/lib/server/crypto-admin-address-rotation.ts",
    "src/lib/server/crypto-admin-addresses.ts",
    "src/lib/server/crypto-admin-deposits.ts",
    "src/lib/server/crypto-admin-settings.ts",
    "src/lib/server/crypto-bsc-confirmation-dry-run.ts",
    "src/lib/server/crypto-bsc-confirmation-writer.ts",
    "src/lib/server/crypto-bsc-dry-run-detector.ts",
    "src/lib/server/crypto-bsc-manual-credit.ts",
    "src/lib/server/crypto-deposits.ts",
    "src/lib/server/crypto-target-user-lookups.ts",
  ];

  for (const path of removedRuntimeFiles) {
    await assert.rejects(access(new URL(path, repositoryRoot)), { code: "ENOENT" }, path);
  }
});

test("traditional deposit flows remain while retired native-crypto UI stays removed", async () => {
  const depositRoute = await readRepositoryFile("src/routes/_app/deposit.tsx");
  const depositHub = await readRepositoryFile("src/domains/deposits/ui/DepositHub.tsx");
  const fiatDepositUi = (await Promise.all([
    "useFiatDeposit.ts",
    "FiatDepositForm.tsx",
    "FiatDepositHistory.tsx",
    "FiatDepositMethodList.tsx",
    "providers/et/cbe-deposit-provider.tsx",
    "providers/et/telebirr-deposit-provider.tsx",
  ].map((file) => readRepositoryFile(`src/domains/fiat-deposits/ui/${file}`)))).join("\n");
  const cryptoDepositRoute = await readRepositoryFile(
    "src/routes/_app/deposit_.crypto.usdt.bep20.tsx",
  );
  const cryptoDepositSurface = await readRepositoryFile(
    "src/domains/crypto-deposits/public.ts",
  );
  const nowpaymentsDepositUi = (await Promise.all([
    "UsdtBep20Deposit.tsx", "UsdtBep20DepositView.tsx", "UsdtBep20AddressCard.tsx",
    "UsdtBep20DepositHistory.tsx", "useUsdtBep20Deposit.ts",
    "useUsdtBep20AddressPresentation.ts", "usdt-bep20-deposit-state.ts",
  ].map((file) => readRepositoryFile(`src/domains/crypto-deposits/ui/${file}`)))).join("\n");
  const legacyDepositBridge = await readRepositoryFile(
    "src/components/deposit/NowpaymentsUsdtDeposit.tsx",
  );
  const adminRoute = await readRepositoryFile("src/routes/_app/admin.tsx");
  const fiatDepositSurface = await readRepositoryFile(
    "src/domains/fiat-deposits/public.ts",
  );
  const fiatWithdrawalSurface = await readRepositoryFile(
    "src/domains/fiat-withdrawals/public.ts",
  );
  const paymentMethodsBridge = await readRepositoryFile(
    "src/domains/fiat-deposits/application/admin-payment-methods-browser-service.ts",
  );
  const depositOperationsBridge = await readRepositoryFile(
    "src/domains/fiat-deposits/application/admin-fiat-deposit-operations-browser-service.ts",
  );
  const withdrawalOperationsBridge = await readRepositoryFile(
    "src/domains/fiat-withdrawals/application/admin-fiat-withdrawal-operations-browser-service.ts",
  );

  assert.match(depositRoute, /@\/domains\/deposits\/public\.js/);
  assert.match(fiatDepositUi, /getPaymentMethodsFn/);
  assert.match(fiatDepositUi, /submitDepositFn/);
  assert.match(fiatDepositUi, /getUserDepositsFn/);
  assert.match(fiatDepositUi, /label: "CBE"/);
  assert.match(fiatDepositUi, /refPrefix: "FT"/);
  assert.match(fiatDepositUi, /label: "TeleBirr"/);
  assert.match(fiatDepositUi, /refPrefix: "D"/);
  assert.match(depositHub, /\/deposit\/crypto\/usdt\/bep20/);
  assert.match(cryptoDepositRoute, /UsdtBep20Deposit/);
  assert.match(cryptoDepositSurface, /UsdtBep20Deposit/);
  assert.match(nowpaymentsDepositUi, /USDT/);
  assert.match(nowpaymentsDepositUi, /BEP20/);
  assert.match(
    legacyDepositBridge,
    /@\/domains\/crypto-deposits\/ui\/UsdtBep20Deposit\.js/,
  );
  assert.doesNotMatch(`${depositRoute}\n${depositHub}\n${fiatDepositUi}`, /TRC20|crypto_deposit_addresses|crypto_deposits/);
  assert.doesNotMatch(cryptoDepositRoute, /TRC20|crypto_deposit_addresses|crypto_deposits/);
  assert.doesNotMatch(nowpaymentsDepositUi, /TRC20|crypto_deposit_addresses|crypto_deposits/);

  assert.match(adminRoute, /AdminFiatPaymentMethodsPanel/);
  assert.match(adminRoute, /AdminFiatDepositOperationsPanel/);
  assert.match(adminRoute, /AdminFiatWithdrawalOperationsPanel/);
  assert.doesNotMatch(
    adminRoute,
    /getAdminDepositsFn|DepositsTab|getPaymentMethodsFn|PaymentMethodsTab|createPaymentMethodFn|updatePaymentMethodFn|archivePaymentMethodFn|getAdminWithdrawalsFn|approveWithdrawalFn|rejectWithdrawalFn|WithdrawalsTab|WithdrawalDetailPanel|AdminWithdrawal/,
  );
  assert.match(fiatDepositSurface, /AdminFiatPaymentMethodsPanel/);
  assert.match(fiatDepositSurface, /AdminFiatDepositOperationsPanel/);
  assert.match(fiatWithdrawalSurface, /AdminFiatWithdrawalOperationsPanel/);
  assert.match(depositOperationsBridge, /getAdminDepositsFn/);
  assert.match(depositOperationsBridge, /\/api\/admin\/approve-deposit/);
  assert.match(paymentMethodsBridge, /getPaymentMethodsFn/);
  assert.match(paymentMethodsBridge, /createPaymentMethodFn/);
  assert.match(paymentMethodsBridge, /updatePaymentMethodFn/);
  assert.match(paymentMethodsBridge, /archivePaymentMethodFn/);
  assert.match(withdrawalOperationsBridge, /getAdminWithdrawalsFn/);
  assert.match(withdrawalOperationsBridge, /approveWithdrawalFn/);
  assert.match(withdrawalOperationsBridge, /rejectWithdrawalFn/);
  assert.doesNotMatch(
    withdrawalOperationsBridge,
    /createClient|from\(|rpc\(|fetch\(|NOWPayments|provider|sign|private.?key|seed.?phrase/i,
  );
  assert.doesNotMatch(
    `${paymentMethodsBridge}\n${depositOperationsBridge}\n${fiatWithdrawalSurface}\n${withdrawalOperationsBridge}`,
    /AdminCrypto|TRC20|crypto_deposit_addresses|crypto_deposits/,
  );
  assert.doesNotMatch(adminRoute, /AdminCrypto|label: "Crypto"/);
});

test("shared financial paths and immutable migration history remain", async () => {
  const transactionHelpers = await readRepositoryFile("src/components/ui/TransactionHelpers.tsx");
  const investmentServer = await readRepositoryFile("src/lib/server/investments.ts");
  const protectedFiles = [
    "netlify/functions/admin-approve-deposit.mts",
    "netlify/functions/verifier-submit-telebirr-result.mts",
    "src/lib/database.types.ts",
    "scripts/apply-migrations.mjs",
    "supabase/migrations/20260710120000_crypto_deposit_foundation/migration.sql",
    "supabase/migrations/20260716160000_bsc_confirmation_writer/migration.sql",
    "supabase/migrations/20260716185000_crypto_manual_crediting_uuid_preflight/migration.sql",
    "supabase/migrations/20260716190000_crypto_manual_crediting/migration.sql",
    "supabase/migrations/20260717030000_crypto_user_id_uuid_repair/migration.sql",
    "supabase/migrations/20260717130000_crypto_reference_id_uuid_repair/migration.sql",
    "supabase/migrations/20260717150000_crypto_schema_reconciliation/migration.sql",
    "supabase/migrations/20260717170000_bsc_user_deposit_exposure/migration.sql",
    "supabase/migrations/20260717221500_bsc_address_rotation/migration.sql",
  ];

  assert.match(transactionHelpers, /plan_purchase/);
  assert.match(investmentServer, /purchase_plan_tx/);

  for (const path of protectedFiles) {
    await access(new URL(path, repositoryRoot));
  }
});

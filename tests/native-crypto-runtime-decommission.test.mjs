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

test("traditional deposit flows remain and crypto UI stays removed", async () => {
  const depositRoute = await readRepositoryFile("src/routes/_app/deposit.tsx");
  const adminRoute = await readRepositoryFile("src/routes/_app/admin.tsx");

  assert.match(depositRoute, /getPaymentMethodsFn/);
  assert.match(depositRoute, /submitDepositFn/);
  assert.match(depositRoute, /getUserDepositsFn/);
  assert.match(depositRoute, /label: "CBE"/);
  assert.match(depositRoute, /refPrefix: "FT"/);
  assert.match(depositRoute, /label: "TeleBirr"/);
  assert.match(depositRoute, /refPrefix: "D"/);
  assert.doesNotMatch(depositRoute, /CryptoDeposit|USDT|TRC20|BEP20/);

  assert.match(adminRoute, /getPaymentMethodsFn/);
  assert.match(adminRoute, /PaymentMethodsTab/);
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

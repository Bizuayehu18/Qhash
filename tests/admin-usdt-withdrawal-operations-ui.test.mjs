import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

test("admin USDT withdrawals compose through one client-safe domain facade and thin legacy bridges", async () => {
  const [route, publicSurface, componentBridge, helperBridge] = await Promise.all([
    readRepositoryFile("src/routes/_app/admin.tsx"),
    readRepositoryFile("src/domains/withdrawals/public.ts"),
    readRepositoryFile("src/components/admin/NowpaymentsUsdtWithdrawalAdmin.tsx"),
    readRepositoryFile("src/lib/nowpayments-withdrawal-admin-ui.ts"),
  ]);

  assert.match(
    route,
    /import \{ AdminUsdtBep20WithdrawalOperationsPanel \} from "@\/domains\/withdrawals\/public\.js";/,
  );
  assert.match(route, /<AdminUsdtBep20WithdrawalOperationsPanel/);
  assert.doesNotMatch(
    route,
    /components\/admin\/NowpaymentsUsdtWithdrawalAdmin|<NowpaymentsUsdtWithdrawalAdmin/,
  );

  assert.match(
    publicSurface,
    /AdminUsdtBep20WithdrawalOperationsPanel,[\s\S]*AdminUsdtBep20WithdrawalOperationsPanel as NowpaymentsUsdtWithdrawalAdmin,[\s\S]*from "\.\/ui\/admin\/AdminUsdtBep20WithdrawalOperationsPanel\.js";/,
  );
  assert.doesNotMatch(publicSurface, /export \*/);
  assert.doesNotMatch(
    publicSurface,
    /lib\/server|netlify\/functions|supabase-admin|service.role|createClient|\.from\(|\.rpc\(|fetch\(/i,
  );

  assert.match(
    componentBridge,
    /AdminUsdtBep20WithdrawalOperationsPanel as NowpaymentsUsdtWithdrawalAdmin/,
  );
  assert.match(
    componentBridge,
    /@\/domains\/withdrawals\/ui\/admin\/AdminUsdtBep20WithdrawalOperationsPanel\.js/,
  );
  assert.doesNotMatch(componentBridge, /useState|useEffect|fetch\(|<section|<Button/);

  for (const canonicalPath of [
    "../domains/withdrawals/application/admin-usdt-withdrawal-browser-service.ts",
    "../domains/withdrawals/application/admin-usdt-withdrawal-action-lifecycle.ts",
    "../domains/withdrawals/ui/admin/admin-usdt-withdrawal-presentation.ts",
  ]) {
    assert.match(helperBridge, new RegExp(canonicalPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(
    helperBridge,
    /class NowpaymentsAdminWithdrawalError|function parseWithdrawal|new AbortController|function formatAdminUsdtSix/,
  );
});

test("browser service owns the exact validated QHash Function transport contract", async () => {
  const service = await readRepositoryFile(
    "src/domains/withdrawals/application/admin-usdt-withdrawal-browser-service.ts",
  );

  assert.match(service, /shared\/validation\/non-null-non-array-object\.ts/);
  assert.match(service, /shared\/validation\/parseable-timestamp\.ts/);
  assert.match(
    service,
    /NOWPAYMENTS_ADMIN_WITHDRAWAL_STATUSES\s*=\s*\[[\s\S]*"pending",[\s\S]*"completed",[\s\S]*"rejected",[\s\S]*\] as const/,
  );
  assert.equal(
    [...service.matchAll(/"\/api\/admin\/crypto\/nowpayments\/withdrawals"/g)].length,
    2,
  );
  assert.match(service, /method: "GET"/);
  assert.match(service, /method: "POST"/);
  assert.match(service, /authorization: `Bearer \$\{accessToken\}`/);
  assert.ok([...service.matchAll(/signal,/g)].length >= 2);
  assert.match(service, /new Set\(withdrawals\.map\(\(row\) => row\.id\)\)\.size/);
  assert.match(service, /fee !== \(gross \* 5n \+ 50n\) \/ 100n \|\| net !== gross - fee/);
  assert.match(service, /error === "idempotency_conflict" \|\| error === "withdrawal_state_conflict"/);
  assert.doesNotMatch(
    service,
    /@\/lib\/server|supabase|service.role|api\.nowpayments|bscscan|etherscan|signTransaction|private[_ -]?key|seed phrase|mnemonic|payout|\.from\(|\.rpc\(/i,
  );
});

test("request and action lifecycles preserve auth-generation isolation and exact safe retries", async () => {
  const lifecycle = await readRepositoryFile(
    "src/domains/withdrawals/application/admin-usdt-withdrawal-action-lifecycle.ts",
  );

  assert.match(lifecycle, /createLatestAdminWithdrawalRequestGuard/);
  assert.match(lifecycle, /active\?\.controller\.abort\(\)/);
  assert.match(lifecycle, /Object\.is\(active\.identity, identity\)/);
  assert.match(lifecycle, /createAdminWithdrawalActionKeyManager/);
  assert.match(lifecycle, /fingerprint !== nextFingerprint \|\| key === null/);
  assert.match(lifecycle, /UUID_V4_PATTERN\.test\(nextKey\)/);
  assert.match(lifecycle, /key = nextKey\.toLowerCase\(\)/);
  assert.match(lifecycle, /runAdminWithdrawalSingleFlight/);
  assert.match(lifecycle, /if \(holder\.current\) return holder\.current/);
  assert.match(lifecycle, /tokenGeneration: number/);
  assert.match(lifecycle, /controller\.abort\(\)/);
  assert.match(lifecycle, /actionKeys\.clear\(\)/);
  assert.match(lifecycle, /if \(active\) \{[\s\S]*onBusyChange\(false\)/);
});

test("operations controller binds overview, dialogs, notices, and busy state to the current authentication generation", async () => {
  const controller = await readRepositoryFile(
    "src/domains/withdrawals/ui/admin/useAdminUsdtWithdrawalOperations.ts",
  );

  assert.match(
    controller,
    /\(\) => \(accessToken && userId \? \{ userId \} : null\),[\s\S]*\[accessToken, userId\]/,
  );
  assert.match(controller, /overviewState\.identity === authIdentity/);
  assert.match(controller, /requestGuardRef\.current!\.begin\(authIdentity\)/);
  assert.ok([...controller.matchAll(/request\.isCurrent\(\)/g)].length >= 3);
  assert.match(controller, /previousLifecycle\?\.invalidate/);
  assert.match(controller, /tokenGeneration/);
  assert.match(controller, /authIdentityRef\.current === actionIdentity/);
  assert.match(controller, /actionLifecycleRef\.current === lifecycle/);
  assert.match(controller, /requestGuardRef\.current!\.invalidate\(\)/);
  assert.match(controller, /normalizeOptionalAdminUsdtTransactionHash/);
  assert.match(controller, /`reject\|\$\{selected\.id\}`/);
  assert.match(controller, /`complete\|\$\{selected\.id\}\|\$\{normalizedHash\}`/);
  assert.match(controller, /transaction_hash: normalizedHash \|\| null/);
  assert.match(controller, /Withdrawal rejected and the full gross amount returned\./);
  assert.match(controller, /Withdrawal completed\./);
  assert.doesNotMatch(
    controller,
    /api\.nowpayments|bscscan|etherscan|signTransaction|private[_ -]?key|seed phrase|mnemonic|payout|\.from\(|\.rpc\(/i,
  );
});

test("decomposed panel preserves the simplified administrator presentation and action boundary", async () => {
  const [panel, list, card, dialog, presentation] = await Promise.all([
    readRepositoryFile(
      "src/domains/withdrawals/ui/admin/AdminUsdtBep20WithdrawalOperationsPanel.tsx",
    ),
    readRepositoryFile("src/domains/withdrawals/ui/admin/AdminUsdtWithdrawalList.tsx"),
    readRepositoryFile("src/domains/withdrawals/ui/admin/AdminUsdtWithdrawalCard.tsx"),
    readRepositoryFile(
      "src/domains/withdrawals/ui/admin/AdminUsdtWithdrawalActionDialog.tsx",
    ),
    readRepositoryFile(
      "src/domains/withdrawals/ui/admin/admin-usdt-withdrawal-presentation.ts",
    ),
  ]);

  assert.match(panel, /useAdminUsdtWithdrawalOperations\(accessToken, userId\)/);
  assert.match(panel, /New USDT withdrawal requests are disabled\. Existing pending requests remain actionable\./);
  assert.match(panel, /ADMIN_USDT_WITHDRAWAL_FILTERS/);
  assert.match(panel, /<AdminUsdtWithdrawalList/);
  assert.match(panel, /<AdminUsdtWithdrawalActionDialog/);
  assert.match(list, /No matching USDT withdrawals\./);
  assert.match(list, /onOpenDialog\("complete", withdrawal\)/);
  assert.match(list, /onOpenDialog\("reject", withdrawal\)/);

  assert.match(card, /withdrawal\.status === "pending"/);
  assert.match(card, />\s*Complete\s*</);
  assert.match(card, />\s*Reject\s*</);
  assert.match(card, /Audit hash: \{withdrawal\.transaction_hash\}/);
  assert.match(card, /formatDateTime\(withdrawal\.requested_at\)/);
  assert.match(card, /Net to send/);

  assert.match(dialog, /Public BSC transaction hash \(optional\)/);
  assert.match(dialog, /Confirm only after exactly/);
  assert.match(dialog, /Confirm Complete/);
  assert.match(dialog, /Confirm Reject/);
  assert.match(dialog, /Rejecting returns the full/);
  assert.deepEqual(
    [...presentation.matchAll(/(?:pending|completed|rejected): "(?:Pending|Completed|Rejected)"/g)]
      .map((match) => match[0]),
    [
      'pending: "Pending"',
      'completed: "Completed"',
      'rejected: "Rejected"',
    ],
  );
  assert.match(presentation, /HASH_PATTERN\.test\(normalized\)/);

  assert.doesNotMatch(
    `${panel}\n${list}\n${card}\n${dialog}`,
    /begin_review|send_lock|record_broadcast|confirmations|block_number|log_index|api\.nowpayments|bscscan|etherscan|signTransaction|payout/i,
  );
});

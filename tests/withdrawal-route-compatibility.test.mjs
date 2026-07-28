import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

test("withdrawal hub keeps fiat behavior and links USDT to the canonical route", async () => {
  const source = await readRepositoryFile("src/routes/_app/withdraw.tsx");

  assert.match(source, /createFileRoute\("\/_app\/withdraw"\)/);
  assert.match(source, /METHOD_META[\s\S]*cbe:/);
  assert.match(source, /METHOD_META[\s\S]*telebirr:/);
  assert.match(source, /submitWithdrawalFn/);
  assert.match(source, /WithdrawalHistory/);
  assert.match(source, /USDT Withdrawal/);
  assert.match(
    source,
    /navigate\(\{ to: "\/withdraw\/crypto\/usdt\/bep20" \}\)/,
  );
  assert.doesNotMatch(
    source,
    /usdtSelected|setUsdtSelected|<NowpaymentsUsdtWithdrawal/,
  );
});

test("canonical USDT-BEP20 withdrawal route is thin, authenticated, and returns to the hub", async () => {
  const [route, appLayout, publicSurface, legacyBridge] = await Promise.all([
    readRepositoryFile("src/routes/_app/withdraw_.crypto.usdt.bep20.tsx"),
    readRepositoryFile("src/routes/_app.tsx"),
    readRepositoryFile("src/domains/withdrawals/public.ts"),
    readRepositoryFile("src/components/withdrawal/NowpaymentsUsdtWithdrawal.tsx"),
  ]);

  assert.match(
    route,
    /createFileRoute\("\/_app\/withdraw_\/crypto\/usdt\/bep20"\)/,
  );
  assert.match(route, /@\/domains\/withdrawals\/public\.js/);
  assert.match(route, /state\.session\?\.access_token \?\? null/);
  assert.match(route, /state\.user\?\.id \?\? null/);
  assert.match(route, /<NowpaymentsUsdtWithdrawal/);
  assert.match(route, /accessToken=\{accessToken\}/);
  assert.match(route, /userId=\{userId\}/);
  assert.match(route, /navigate\(\{ to: "\/withdraw", replace: true \}\)/);

  assert.match(appLayout, /if \(initialized && !loading && !session\)/);
  assert.match(appLayout, /navigate\(\{ to: '\/login', replace: true \}\)/);
  assert.match(appLayout, /<Outlet \/>/);

  assert.match(publicSurface, /NowpaymentsUsdtWithdrawal/);
  assert.match(publicSurface, /UsdtBep20Withdrawal/);
  assert.match(publicSurface, /\.\/ui\/UsdtBep20Withdrawal\.js/);
  assert.match(publicSurface, /NowpaymentsWithdrawalOverview/);
  assert.match(publicSurface, /NowpaymentsWithdrawalHistoryView/);
  assert.match(legacyBridge, /@\/domains\/withdrawals\/ui\/UsdtBep20Withdrawal\.js/);
  assert.match(legacyBridge, /NowpaymentsUsdtWithdrawal/);
});

test("canonical withdrawal route is non-nested and exposes no sensitive or server-only state", async () => {
  const [route, publicSurface, legacyBridge, canonicalEntry, routeTree] = await Promise.all([
    readRepositoryFile("src/routes/_app/withdraw_.crypto.usdt.bep20.tsx"),
    readRepositoryFile("src/domains/withdrawals/public.ts"),
    readRepositoryFile("src/components/withdrawal/NowpaymentsUsdtWithdrawal.tsx"),
    readRepositoryFile("src/domains/withdrawals/ui/UsdtBep20Withdrawal.tsx"),
    readRepositoryFile("src/routeTree.gen.ts"),
  ]);
  const clientSurface = `${route}\n${publicSurface}\n${legacyBridge}\n${canonicalEntry}`;

  assert.match(routeTree, /'\/withdraw\/crypto\/usdt\/bep20'/);
  assert.match(
    routeTree,
    /const AppWithdrawCryptoUsdtBep20Route[\s\S]*?id: '\/withdraw_\/crypto\/usdt\/bep20',[\s\S]*?getParentRoute: \(\) => AppRoute,/,
  );
  assert.doesNotMatch(
    routeTree,
    /const AppWithdrawCryptoUsdtBep20Route[\s\S]*?getParentRoute: \(\) => AppWithdrawRoute,/,
  );
  assert.doesNotMatch(
    clientSurface,
    /lib\/server|netlify\/functions|supabase-admin|service.role|NOWPAYMENTS_(?:API|IPN)_KEY|api\.nowpayments|transaction_hash|search:/i,
  );
  assert.doesNotMatch(clientSurface, /createClient|\.from\(|\.rpc\(|fetch\(/);
});

test("canonical withdrawal entry composes the controller and focused views", async () => {
  const [entry, view, form, history] = await Promise.all([
    readRepositoryFile("src/domains/withdrawals/ui/UsdtBep20Withdrawal.tsx"),
    readRepositoryFile("src/domains/withdrawals/ui/UsdtBep20WithdrawalView.tsx"),
    readRepositoryFile("src/domains/withdrawals/ui/UsdtBep20WithdrawalRequestForm.tsx"),
    readRepositoryFile("src/domains/withdrawals/ui/UsdtBep20WithdrawalHistory.tsx"),
  ]);
  assert.match(entry, /useUsdtBep20Withdrawal/);
  assert.match(entry, /<UsdtBep20WithdrawalView/);
  assert.match(view, /<UsdtBep20WithdrawalRequestForm/);
  assert.match(view, /<UsdtBep20WithdrawalHistory/);
  assert.match(form, /Four-digit Fund PIN/);
  assert.match(history, /Pending|nowpaymentsWithdrawalStatusLabel/);
  assert.doesNotMatch(`${entry}\n${view}\n${form}\n${history}`, /transaction_hash|current_broadcast_id|confirmations|manual review/i);
});

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
  const [route, appLayout, publicSurface] = await Promise.all([
    readRepositoryFile("src/routes/_app/withdraw_.crypto.usdt.bep20.tsx"),
    readRepositoryFile("src/routes/_app.tsx"),
    readRepositoryFile("src/domains/withdrawals/public.ts"),
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
  assert.match(publicSurface, /NowpaymentsWithdrawalOverview/);
  assert.match(publicSurface, /NowpaymentsWithdrawalHistoryView/);
});

test("canonical withdrawal route is non-nested and exposes no sensitive or server-only state", async () => {
  const [route, publicSurface, routeTree] = await Promise.all([
    readRepositoryFile("src/routes/_app/withdraw_.crypto.usdt.bep20.tsx"),
    readRepositoryFile("src/domains/withdrawals/public.ts"),
    readRepositoryFile("src/routeTree.gen.ts"),
  ]);
  const clientSurface = `${route}\n${publicSurface}`;

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

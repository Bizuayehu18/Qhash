import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

test("deposit hub keeps fiat behavior and links crypto to the canonical route", async () => {
  const source = await readRepositoryFile("src/routes/_app/deposit.tsx");

  assert.match(source, /createFileRoute\("\/_app\/deposit"\)/);
  assert.match(source, /METHOD_META[\s\S]*cbe:/);
  assert.match(source, /METHOD_META[\s\S]*telebirr:/);
  assert.match(source, /submitDepositFn/);
  assert.match(source, /DepositHistory/);
  assert.match(source, /Crypto Deposit/);
  assert.match(source, /navigate\(\{ to: "\/deposit\/crypto\/usdt-bep20" \}\)/);
  assert.doesNotMatch(source, /setStep\("crypto"\)|step === "crypto"/);
});

test("canonical USDT-BEP20 route is thin, authenticated, and returns to the hub", async () => {
  const [route, appLayout, publicSurface] = await Promise.all([
    readRepositoryFile("src/routes/_app/deposit_.crypto.usdt-bep20.tsx"),
    readRepositoryFile("src/routes/_app.tsx"),
    readRepositoryFile("src/domains/crypto-deposits/public.ts"),
  ]);

  assert.match(
    route,
    /createFileRoute\("\/_app\/deposit_\/crypto\/usdt-bep20"\)/,
  );
  assert.match(route, /@\/domains\/crypto-deposits\/public\.js/);
  assert.match(route, /state\.session\?\.access_token \?\? null/);
  assert.match(route, /<NowpaymentsUsdtDeposit/);
  assert.match(route, /navigate\(\{ to: "\/deposit", replace: true \}\)/);

  assert.match(appLayout, /if \(initialized && !loading && !session\)/);
  assert.match(appLayout, /navigate\(\{ to: '\/login', replace: true \}\)/);
  assert.match(appLayout, /<Outlet \/>/);

  assert.match(publicSurface, /NowpaymentsUsdtDeposit/);
  assert.match(publicSurface, /CryptoDepositMethodIcon/);
  assert.match(publicSurface, /NowpaymentsDepositOverview/);
});

test("canonical route is non-nested and exposes no sensitive or server-only state", async () => {
  const [route, publicSurface, routeTree] = await Promise.all([
    readRepositoryFile("src/routes/_app/deposit_.crypto.usdt-bep20.tsx"),
    readRepositoryFile("src/domains/crypto-deposits/public.ts"),
    readRepositoryFile("src/routeTree.gen.ts"),
  ]);
  const clientSurface = `${route}\n${publicSurface}`;

  assert.match(routeTree, /'\/deposit\/crypto\/usdt-bep20'/);
  assert.match(
    routeTree,
    /const AppDepositCryptoUsdtBep20Route[\s\S]*?id: '\/deposit_\/crypto\/usdt-bep20',[\s\S]*?getParentRoute: \(\) => AppRoute,/,
  );
  assert.doesNotMatch(
    routeTree,
    /const AppDepositCryptoUsdtBep20Route[\s\S]*?getParentRoute: \(\) => AppDepositRoute,/,
  );
  assert.doesNotMatch(
    clientSurface,
    /lib\/server|netlify\/functions|supabase-admin|service.role|NOWPAYMENTS_(?:API|IPN)_KEY|api\.nowpayments|transaction_hash|fund.?pin|user.?id|search:/i,
  );
  assert.doesNotMatch(clientSurface, /createClient|\.from\(|\.rpc\(|fetch\(/);
});

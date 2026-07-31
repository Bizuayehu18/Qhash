import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

test("deposit hub keeps fiat behavior and links crypto to the canonical route", async () => {
  const [route, publicSurface, hub, fiatSurface, routeTree] = await Promise.all([
    readRepositoryFile("src/routes/_app/deposit.tsx"),
    readRepositoryFile("src/domains/deposits/public.ts"),
    readRepositoryFile("src/domains/deposits/ui/DepositHub.tsx"),
    readRepositoryFile("src/domains/fiat-deposits/public.ts"),
    readRepositoryFile("src/routeTree.gen.ts"),
  ]);

  assert.match(route, /createFileRoute\("\/_app\/deposit"\)/);
  assert.match(route, /@\/domains\/deposits\/public\.js/);
  assert.match(route, /component: DepositHub/);
  assert.doesNotMatch(route, /lib\/server|fiat-deposits|crypto-deposits|useNavigate/);

  assert.match(publicSurface, /\.\/ui\/DepositHub\.js/);
  assert.doesNotMatch(publicSurface, /lib\/server|fiat-deposits|crypto-deposits/);
  assert.match(hub, /@\/domains\/fiat-deposits\/public\.js/);
  assert.match(hub, /@\/domains\/crypto-deposits\/public\.js/);
  assert.match(hub, /FiatDepositMethodList/);
  assert.match(hub, /FiatDepositForm/);
  assert.match(hub, /FiatDepositHistory/);
  assert.match(hub, /Crypto Deposit/);
  assert.match(hub, /navigate\(\{ to: "\/deposit\/crypto\/usdt\/bep20" \}\)/);
  assert.doesNotMatch(hub, /submitDepositFn|getPaymentMethodsFn|getUserDepositsFn/);
  assert.doesNotMatch(fiatSurface, /crypto-deposits|\/deposit\/crypto/);
  assert.doesNotMatch(`${route}\n${hub}`, /setStep\("crypto"\)|step === "crypto"/);
  assert.doesNotMatch(routeTree, /\/deposit\/fiat\/(?:et\/)?(?:cbe|telebirr)/);
});

test("canonical USDT-BEP20 route is thin, authenticated, and returns to the hub", async () => {
  const [
    route,
    appLayout,
    publicSurface,
    legacyComponentBridge,
    legacyClientBridge,
  ] = await Promise.all([
    readRepositoryFile("src/routes/_app/deposit_.crypto.usdt.bep20.tsx"),
    readRepositoryFile("src/routes/_app.tsx"),
    readRepositoryFile("src/domains/crypto-deposits/public.ts"),
    readRepositoryFile("src/components/deposit/NowpaymentsUsdtDeposit.tsx"),
    readRepositoryFile("src/lib/nowpayments-deposit-ui.ts"),
  ]);

  assert.match(
    route,
    /createFileRoute\("\/_app\/deposit_\/crypto\/usdt\/bep20"\)/,
  );
  assert.match(route, /@\/domains\/crypto-deposits\/public\.js/);
  assert.match(route, /state\.session\?\.access_token \?\? null/);
  assert.match(route, /<UsdtBep20Deposit/);
  assert.match(route, /navigate\(\{ to: "\/deposit", replace: true \}\)/);

  assert.match(appLayout, /if \(initialized && !loading && !session\)/);
  assert.match(appLayout, /navigate\(\{ to: '\/login', replace: true \}\)/);
  assert.match(appLayout, /<Outlet \/>/);

  assert.match(publicSurface, /\.\/ui\/UsdtBep20Deposit\.js/);
  assert.match(publicSurface, /UsdtBep20Deposit/);
  assert.match(publicSurface, /UsdtBep20Deposit as NowpaymentsUsdtDeposit/);
  assert.match(publicSurface, /CryptoDepositMethodIcon/);
  assert.match(publicSurface, /NowpaymentsDepositOverview/);
  assert.doesNotMatch(
    publicSurface,
    /@\/components\/deposit|@\/lib\/nowpayments-deposit-ui/,
  );

  assert.match(
    legacyComponentBridge,
    /@\/domains\/crypto-deposits\/ui\/UsdtBep20Deposit\.js/,
  );
  assert.match(
    legacyClientBridge,
    /@\/domains\/crypto-deposits\/ui\/nowpayments-deposit-ui\.js/,
  );
});

test("canonical route is non-nested and exposes no sensitive or server-only state", async () => {
  const [route, publicSurface, routeTree] = await Promise.all([
    readRepositoryFile("src/routes/_app/deposit_.crypto.usdt.bep20.tsx"),
    readRepositoryFile("src/domains/crypto-deposits/public.ts"),
    readRepositoryFile("src/routeTree.gen.ts"),
  ]);
  const clientSurface = `${route}\n${publicSurface}`;

  assert.match(routeTree, /'\/deposit\/crypto\/usdt\/bep20'/);
  assert.match(
    routeTree,
    /const AppDepositCryptoUsdtBep20Route[\s\S]*?id: '\/deposit_\/crypto\/usdt\/bep20',[\s\S]*?getParentRoute: \(\) => AppRoute,/,
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

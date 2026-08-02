import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

async function listRepositoryFiles(path) {
  const directory = new URL(`${path}/`, repositoryRoot);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const child = `${path}/${entry.name}`;
    return entry.isDirectory() ? listRepositoryFiles(child) : [child];
  }));
  return files.flat();
}

test("admin route delegates its overview through the client-safe admin surface", async () => {
  const [route, publicSurface] = await Promise.all([
    readRepositoryFile("src/routes/_app/admin.tsx"),
    readRepositoryFile("src/domains/admin/public.ts"),
  ]);

  assert.match(route, /createFileRoute\("\/_app\/admin"\)/);
  assert.match(
    route,
    /from "@\/domains\/admin\/public\.js"/,
  );
  assert.match(route, /<AdminOverviewPanel/);
  assert.match(route, /accessToken=\{session\?\.access_token \?\? null\}/);
  assert.match(route, /userId=\{user\?\.id\}/);
  assert.doesNotMatch(route, /getAdminStatsFn|function OverviewTab/);

  for (const label of [
    "Overview",
    "Deposits",
    "ETB Withdrawals",
    "USDT Withdrawals",
    "Verification Audit",
    "Security",
    "Settings",
  ]) {
    assert.match(route, new RegExp(`label: "${label}"`));
  }

  assert.match(route, /if \(profile && !profile\.is_admin\) navigate\(\{ to: "\/dashboard" \}\)/);
  assert.match(route, /if \(!profile\?\.is_admin\) return null;/);
  assert.match(route, /<NowpaymentsUsdtWithdrawalAdmin/);
  assert.match(route, /<DepositsTab/);
  assert.match(route, /<WithdrawalsTab/);
  assert.match(route, /<AuditLogsTab/);
  assert.match(route, /<AdminSecurityTab/);
  assert.match(route, /<SettingsTab/);

  assert.match(
    publicSurface,
    /export \{ AdminEtbAmount \} from "\.\/ui\/AdminEtbAmount\.js";/,
  );
  assert.match(
    publicSurface,
    /export \{ AdminOverviewPanel \} from "\.\/ui\/AdminOverviewPanel\.js";/,
  );
  assert.doesNotMatch(publicSurface, /export \*/);
  assert.doesNotMatch(
    publicSurface,
    /lib\/server|netlify\/functions|supabase-admin|service.role|createClient|\.from\(|\.rpc\(|fetch\(/i,
  );
});

test("admin domain has one explicit browser-to-server overview bridge", async () => {
  const domainFiles = (await listRepositoryFiles("src/domains/admin"))
    .filter((path) => /\.(?:ts|tsx)$/.test(path));
  const sources = await Promise.all(domainFiles.map(async (path) => ({
    path,
    source: await readRepositoryFile(path),
  })));
  const serverImporters = sources
    .filter(({ source }) => /@\/lib\/server\//.test(source))
    .map(({ path }) => path)
    .sort();

  assert.deepEqual(serverImporters, [
    "src/domains/admin/application/admin-overview-browser-service.ts",
  ]);

  const service = sources.find(({ path }) => (
    path === "src/domains/admin/application/admin-overview-browser-service.ts"
  ))?.source;
  assert.ok(service);
  assert.match(service, /import \{ getAdminStatsFn \} from "@\/lib\/server\/admin\.js";/);
  assert.match(service, /export type AdminOverviewStats/);
  assert.match(service, /export function loadAdminOverview/);
  assert.match(service, /getAdminStatsFn\(\{ data: \{ accessToken \} \}\)/);
  assert.doesNotMatch(service, /userId|supabase-admin|service.role|NOWPAYMENTS/i);
});

test("admin overview server retains independent active-administrator authorization", async () => {
  const server = await readRepositoryFile("src/lib/server/admin.ts");

  assert.match(server, /createServerFn\(\{ method: "POST" \}\)/);
  assert.match(server, /admin\.auth\.getUser\(accessToken\)/);
  assert.match(server, /\.from\("profiles"\)/);
  assert.match(server, /\.select\("is_admin, is_frozen"\)/);
  assert.match(server, /\.eq\("id", authUser\.id\)/);
  assert.match(server, /adminProfile\.is_admin !== true/);
  assert.match(server, /adminProfile\.is_frozen === true/);
  assert.doesNotMatch(server, /data\.userId|data\.user_id/);

  for (const contract of [
    /\.from\("profiles"\)[\s\S]*\.select\("id", \{ count: "exact", head: true \}\)/,
    /\.from\("investments"\)[\s\S]*\.eq\("status", "active"\)/,
    /\.from\("withdrawals"\)[\s\S]*\.eq\("status", "pending"\)/,
    /\.from\("deposits"\)[\s\S]*\.eq\("status", "pending"\)/,
    /\.from\("transactions"\)[\s\S]*\.eq\("type", "plan_purchase"\)/,
    /\.order\("created_at", \{ ascending: false \}\)[\s\S]*\.limit\(20\)/,
    /username: prof\?\.username \?\? "Unknown"/,
  ]) {
    assert.match(server, contract);
  }
});

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

test("dashboard route is a thin adapter over the client-safe accounts facade", async () => {
  const [route, publicSurface] = await Promise.all([
    readRepositoryFile("src/routes/_app/dashboard.tsx"),
    readRepositoryFile("src/domains/accounts/public.ts"),
  ]);
  const routeImports = [...route.matchAll(/from ["']([^"']+)["']/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(routeImports, [
    "@/domains/accounts/public.js",
    "@tanstack/react-router",
  ]);
  assert.match(route, /createFileRoute\("\/_app\/dashboard"\)/);
  assert.match(route, /component: DashboardPage/);
  assert.doesNotMatch(
    route,
    /lib\/server|useAuthStore|withTimeout|Support|AmountText|CurrencyUnit|activeInvestments|recentTransactions/,
  );

  assert.match(
    publicSurface,
    /export \{ DashboardPage \} from "\.\/ui\/dashboard\/DashboardPage\.js";/,
  );
  assert.doesNotMatch(publicSurface, /export \*/);
  assert.doesNotMatch(
    publicSurface,
    /lib\/server|netlify\/functions|supabase-admin|service.role|createClient|\.from\(|\.rpc\(|fetch\(/i,
  );
});

test("accounts and support domains keep browser-to-server dependencies behind application bridges", async () => {
  const [accountFiles, supportFiles] = await Promise.all([
    listRepositoryFiles("src/domains/accounts"),
    listRepositoryFiles("src/domains/support"),
  ]);
  const sources = await Promise.all([...accountFiles, ...supportFiles]
    .filter((path) => /\.(?:ts|tsx)$/.test(path))
    .map(async (path) => ({ path, source: await readRepositoryFile(path) })));
  const accountServerImporters = sources
    .filter(({ path, source }) => path.startsWith("src/domains/accounts/") && /@\/lib\/server\//.test(source))
    .map(({ path }) => path)
    .sort();
  const supportServerImporters = sources
    .filter(({ path, source }) => path.startsWith("src/domains/support/") && /@\/lib\/server\//.test(source))
    .map(({ path }) => path)
    .sort();

  assert.deepEqual(accountServerImporters, [
    "src/domains/accounts/application/dashboard-browser-service.ts",
    "src/domains/accounts/application/transaction-history-browser-service.ts",
  ]);
  assert.deepEqual(supportServerImporters, [
    "src/domains/support/application/support-settings-browser-service.ts",
  ]);

  const dashboardUi = sources
    .filter(({ path }) => path.startsWith("src/domains/accounts/ui/dashboard/"))
    .map(({ source }) => source)
    .join("\n");
  assert.match(dashboardUi, /@\/domains\/support\/public\.js/);
  assert.doesNotMatch(dashboardUi, /domains\/support\/(?:application|ui)\//);
  assert.doesNotMatch(dashboardUi, /@\/lib\/server\//);

  const supportPublic = sources.find(({ path }) => path === "src/domains/support/public.ts")?.source;
  assert.ok(supportPublic);
  assert.match(
    supportPublic,
    /export \{ useSupportDestination \} from "\.\/ui\/useSupportDestination\.js";/,
  );
  assert.doesNotMatch(supportPublic, /export \*|@\/lib\/server\//);
  assert.doesNotMatch(supportPublic, /updateSupportTelegramUsernameFn/);
});

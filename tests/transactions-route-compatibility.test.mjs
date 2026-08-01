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

test("transactions route is a thin adapter over the client-safe accounts facade", async () => {
  const [route, publicSurface] = await Promise.all([
    readRepositoryFile("src/routes/_app/transactions.tsx"),
    readRepositoryFile("src/domains/accounts/public.ts"),
  ]);
  const routeImports = [...route.matchAll(/from ["']([^"']+)["']/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(routeImports, [
    "@/domains/accounts/public.js",
    "@tanstack/react-router",
  ]);
  assert.match(route, /createFileRoute\("\/_app\/transactions"\)/);
  assert.match(route, /component: TransactionsPage/);
  assert.doesNotMatch(
    route,
    /lib\/server|useAuthStore|withTimeout|TransactionHistoryList|AmountText|formatDateTime/,
  );

  assert.match(
    publicSurface,
    /export \{ TransactionsPage \} from "\.\/ui\/transactions\/TransactionsPage\.js";/,
  );
  assert.doesNotMatch(publicSurface, /export \*/);
  assert.doesNotMatch(
    publicSurface,
    /lib\/server|netlify\/functions|supabase-admin|service.role|createClient|\.from\(|\.rpc\(|fetch\(/i,
  );
});

test("accounts domain confines transaction history to one browser-to-server bridge", async () => {
  const domainFiles = (await listRepositoryFiles("src/domains/accounts"))
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
    "src/domains/accounts/application/dashboard-browser-service.ts",
    "src/domains/accounts/application/transaction-history-browser-service.ts",
  ]);

  for (const { path, source } of sources.filter(({ path }) => path.includes("/domain/"))) {
    assert.doesNotMatch(
      source,
      /\.\.\/application\/|\.\.\/ui\//,
      `${path} must not reverse the dependency direction`,
    );
  }

  const service = sources.find(({ path }) => (
    path === "src/domains/accounts/application/transaction-history-browser-service.ts"
  ))?.source;
  assert.ok(service);
  assert.match(service, /getTransactionsFn/);
  assert.match(service, /export function loadTransactionHistory/);
  assert.match(service, /data: \{ accessToken, type: filter \}/);
  assert.doesNotMatch(
    service,
    /supabase-admin|service.role|NOWPAYMENTS|private.?key|seed.?phrase/i,
  );
});

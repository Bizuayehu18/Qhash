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

test("plans route is a thin adapter over the client-safe public facade", async () => {
  const [route, publicSurface] = await Promise.all([
    readRepositoryFile("src/routes/_app/plans.tsx"),
    readRepositoryFile("src/domains/plans/public.ts"),
  ]);
  const routeImports = [...route.matchAll(/from ["']([^"']+)["']/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(routeImports, [
    "@/domains/plans/public.js",
    "@tanstack/react-router",
  ]);
  assert.match(route, /createFileRoute\("\/_app\/plans"\)/);
  assert.match(route, /@\/domains\/plans\/public\.js/);
  assert.match(route, /component: PlansPage/);
  assert.doesNotMatch(
    route,
    /lib\/server|useAuthStore|useWalletStore|withTimeout|toast|PlanCard|investment_amount|daily_earning/,
  );

  assert.match(
    publicSurface,
    /export \{ PlansPage \} from "\.\/ui\/PlansPage\.js";/,
  );
  assert.doesNotMatch(publicSurface, /export \*/);
  assert.doesNotMatch(
    publicSurface,
    /lib\/server|netlify\/functions|supabase-admin|service.role|createClient|\.from\(|\.rpc\(|fetch\(/i,
  );
});

test("plans domain has one browser-to-server bridge", async () => {
  const domainFiles = (await listRepositoryFiles("src/domains/plans"))
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
    "src/domains/plans/application/plans-browser-service.ts",
  ]);

  for (const { path, source } of sources.filter(({ path }) => path.includes("/domain/"))) {
    assert.doesNotMatch(
      source,
      /\.\.\/application\//,
      `${path} must not reverse the application-to-domain dependency direction`,
    );
  }

  const service = sources.find(({ path }) => (
    path === "src/domains/plans/application/plans-browser-service.ts"
  ))?.source;
  assert.ok(service);
  assert.match(service, /getPlansWithEligibilityFn/);
  assert.match(service, /purchasePlanFn/);
  assert.match(service, /export (?:async )?function loadPlansWithEligibility/);
  assert.match(service, /export (?:async )?function purchasePlan/);
  assert.doesNotMatch(
    service,
    /supabase-admin|service.role|NOWPAYMENTS|private.?key|seed.?phrase/i,
  );
});

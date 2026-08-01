import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

test("public support route is a thin adapter over the client-safe support facade", async () => {
  const [route, publicSurface] = await Promise.all([
    readRepositoryFile("src/routes/support.tsx"),
    readRepositoryFile("src/domains/support/public.ts"),
  ]);
  const routeImports = [...route.matchAll(/from ["']([^"']+)["']/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(routeImports, [
    "@/domains/support/public.js",
    "@tanstack/react-router",
  ]);
  assert.match(route, /createFileRoute\("\/support"\)/);
  assert.match(route, /component: SupportRedirectPage/);
  assert.doesNotMatch(
    route,
    /lib\/server|useEffect|useState|getSupportSettingsFn|window\.location/,
  );

  assert.match(
    publicSurface,
    /export \{ SupportRedirectPage \} from "\.\/ui\/SupportRedirectPage\.js";/,
  );
  assert.match(
    publicSurface,
    /export \{ useSupportDestination \} from "\.\/ui\/useSupportDestination\.js";/,
  );
  assert.doesNotMatch(
    publicSurface,
    /export \*|@\/lib\/server|updateSupportTelegramUsernameFn/,
  );
});

test("support redirect preserves its one-shot redirect and unavailable-state contract", async () => {
  const page = await readRepositoryFile(
    "src/domains/support/ui/SupportRedirectPage.tsx",
  );

  assert.match(
    page,
    /loadSupportDestination.*\.then\(\(url\).*window\.location\.replace\(url\)/s,
  );
  assert.match(page, /let active = true/);
  assert.match(page, /if \(!active\) return/);
  assert.match(page, /return \(\) => \{\s*active = false;/s);
  assert.match(page, /\[QHash\] Support redirect failed:/);
  assert.match(page, /Support contact unavailable/);
  assert.match(
    page,
    /Telegram support is not configured yet\. Please check back later\./,
  );
  assert.doesNotMatch(
    page,
    /window\.location\.assign|visibilitychange|addEventListener|setInterval|setTimeout/,
  );
});

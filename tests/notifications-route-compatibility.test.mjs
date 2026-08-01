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

test("notifications route is a thin adapter over the client-safe public facade", async () => {
  const [route, publicSurface] = await Promise.all([
    readRepositoryFile("src/routes/_app/notifications.tsx"),
    readRepositoryFile("src/domains/notifications/public.ts"),
  ]);
  const routeImports = [...route.matchAll(/from ["']([^"']+)["']/g)]
    .map((match) => match[1])
    .sort();

  assert.deepEqual(routeImports, [
    "@/domains/notifications/public.js",
    "@tanstack/react-router",
  ]);
  assert.match(route, /createFileRoute\("\/_app\/notifications"\)/);
  assert.match(route, /component: NotificationsPage/);
  assert.doesNotMatch(
    route,
    /lib\/server|useAuthStore|withTimeout|markNotificationsReadFn|getNotificationsFn|NotificationList/,
  );

  assert.match(
    publicSurface,
    /export \{ NotificationsPage \} from "\.\/ui\/NotificationsPage\.js";/,
  );
  assert.match(
    publicSurface,
    /export \{ useUnreadNotificationCount \} from "\.\/ui\/useUnreadNotificationCount\.js";/,
  );
  assert.doesNotMatch(publicSurface, /export \*/);
  assert.doesNotMatch(
    publicSurface,
    /lib\/server|netlify\/functions|supabase-admin|service.role|createClient|\.from\(|\.rpc\(|fetch\(/i,
  );
});

test("notifications domain has one browser-to-server bridge", async () => {
  const domainFiles = (await listRepositoryFiles("src/domains/notifications"))
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
    "src/domains/notifications/application/notifications-browser-service.ts",
  ]);

  for (const { path, source } of sources.filter(({ path }) => path.includes("/domain/"))) {
    assert.doesNotMatch(
      source,
      /\.\.\/application\/|\.\.\/ui\//,
      `${path} must not reverse the dependency direction`,
    );
  }

  const service = sources.find(({ path }) => (
    path === "src/domains/notifications/application/notifications-browser-service.ts"
  ))?.source;
  assert.ok(service);
  assert.match(service, /getNotificationsFn/);
  assert.match(service, /getUnreadCountFn/);
  assert.match(service, /markNotificationsReadFn/);
  assert.match(service, /export function loadNotifications/);
  assert.match(service, /export async function loadUnreadNotificationCount/);
  assert.match(service, /export async function markAllNotificationsRead/);
  assert.doesNotMatch(
    service,
    /supabase-admin|service.role|NOWPAYMENTS|private.?key|seed.?phrase/i,
  );
});

test("application shell consumes the notifications facade and retains navigation ownership", async () => {
  const layout = await readRepositoryFile("src/components/layout/AppLayout.tsx");

  assert.match(
    layout,
    /import \{ useUnreadNotificationCount \} from ['"]@\/domains\/notifications\/public\.js['"]/,
  );
  assert.match(layout, /const unreadCount = useUnreadNotificationCount\(\)/);
  assert.match(layout, /navigate\(\{ to: ['"]\/notifications['"] \}\)/);
  assert.match(layout, /unreadCount > 0/);
  assert.match(layout, /unreadCount > 9 \? ['"]9\+['"] : unreadCount/);
  assert.doesNotMatch(layout, /lib\/server\/notifications|getUnreadCountFn/);
  assert.doesNotMatch(layout, /supabase\.auth\.getSession|@\/lib\/supabase/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createLatestNotificationsRequestGuard,
  createNotificationsAuthIdentity,
  createNotificationsRetryPolicy,
  isSameNotificationsAuthIdentity,
} from "../src/domains/notifications/application/notifications-auth-lifecycle.ts";
import {
  getNotificationMessage,
  getNotificationTitle,
  getNotificationType,
} from "../src/domains/notifications/domain/notification-presentation.ts";

const repositoryRoot = new URL("../", import.meta.url);

async function readRepositoryFile(path) {
  return readFile(new URL(path, repositoryRoot), "utf8");
}

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

test("notification presentation preserves metadata, legacy withdrawal, and fallback behavior", () => {
  const metadataNotification = {
    message: "Deposit received.",
    metadata: { type: "deposit_approved" },
    title: "Deposit Approved",
  };
  assert.equal(getNotificationType(metadataNotification), "deposit_approved");
  assert.equal(
    getNotificationTitle(metadataNotification, "deposit_approved"),
    "Deposit Approved",
  );
  assert.equal(
    getNotificationMessage(metadataNotification, "deposit_approved"),
    "Deposit received.",
  );

  const approved = {
    message: "Your withdrawal request has been approved.",
    metadata: null,
    title: "  WITHDRAWAL APPROVED  ",
  };
  assert.equal(getNotificationType(approved), "withdrawal_approved");
  assert.equal(
    getNotificationTitle(approved, getNotificationType(approved)),
    "Withdrawal Approved",
  );
  assert.equal(
    getNotificationMessage(approved, getNotificationType(approved)),
    "Your withdrawal has been approved.",
  );

  const rejected = {
    message: "Your withdrawal request was rejected and the full amount was returned to your wallet.",
    metadata: {},
    title: "Withdrawal Rejected",
  };
  assert.equal(getNotificationType(rejected), "withdrawal_rejected");
  assert.equal(
    getNotificationTitle(rejected, getNotificationType(rejected)),
    "Withdrawal Rejected",
  );
  assert.equal(
    getNotificationMessage(rejected, getNotificationType(rejected)),
    "Your withdrawal request was rejected. The full amount was returned to your wallet.",
  );

  const unknown = {
    message: "Original message",
    metadata: { type: 7 },
    title: "Original title",
  };
  assert.equal(getNotificationType(unknown), undefined);
  assert.equal(getNotificationTitle(unknown), "Original title");
  assert.equal(getNotificationMessage(unknown), "Original message");
});

test("notification identities bind the exact user and access-token generation", () => {
  const original = createNotificationsAuthIdentity("user-a", "token-a");
  const same = createNotificationsAuthIdentity("user-a", "token-a");
  const refreshedToken = createNotificationsAuthIdentity("user-a", "token-b");
  const replacementUser = createNotificationsAuthIdentity("user-b", "token-a");

  assert.ok(original);
  assert.ok(same);
  assert.ok(refreshedToken);
  assert.ok(replacementUser);
  assert.equal(createNotificationsAuthIdentity(null, "token-a"), null);
  assert.equal(createNotificationsAuthIdentity("user-a", null), null);
  assert.equal(isSameNotificationsAuthIdentity(original, same), true);
  assert.equal(isSameNotificationsAuthIdentity(original, refreshedToken), false);
  assert.equal(isSameNotificationsAuthIdentity(original, replacementUser), false);
  assert.equal(isSameNotificationsAuthIdentity(original, null), false);

  const guard = createLatestNotificationsRequestGuard();
  const older = guard.begin(original);
  const newer = guard.begin(same);
  assert.equal(older.isCurrent(original), false);
  assert.equal(newer.isCurrent(same), true);
  guard.invalidate();
  assert.equal(newer.isCurrent(same), false);
});

test("notification retry admission preserves the budget across coalesced refreshes", () => {
  const policy = createNotificationsRetryPolicy(2);

  assert.equal(policy.reserveRetry(), true);
  assert.equal(policy.admitLoad({
    coalescesWithActiveFlight: true,
    resetRetryCount: true,
  }), false);
  assert.equal(policy.reserveRetry(), true);
  assert.equal(policy.reserveRetry(), false);

  assert.equal(policy.admitLoad({
    coalescesWithActiveFlight: false,
    resetRetryCount: true,
  }), true);
  assert.equal(policy.reserveRetry(), true);
  policy.reset();
  assert.equal(policy.reserveRetry(), true);
});

test("late notification success and failure cannot cross authentication generations", async () => {
  const successGuard = createLatestNotificationsRequestGuard();
  const failureGuard = createLatestNotificationsRequestGuard();
  const userA = createNotificationsAuthIdentity("user-a", "token-a");
  const userB = createNotificationsAuthIdentity("user-b", "token-b");
  assert.ok(userA);
  assert.ok(userB);

  let currentIdentity = userA;
  let visibleRows = [];
  let scheduledRetries = 0;
  const oldSuccess = deferred();
  const oldFailure = deferred();
  const oldSuccessTicket = successGuard.begin(userA);
  const oldFailureTicket = failureGuard.begin(userA);
  const oldSuccessCommit = oldSuccess.promise.then((rows) => {
    if (oldSuccessTicket.isCurrent(currentIdentity)) visibleRows = rows;
  });
  const oldFailureCommit = oldFailure.promise.catch(() => {
    if (oldFailureTicket.isCurrent(currentIdentity)) scheduledRetries += 1;
  });

  currentIdentity = userB;
  successGuard.invalidate();
  failureGuard.invalidate();
  visibleRows = [];
  const replacement = deferred();
  const replacementTicket = successGuard.begin(userB);
  const replacementCommit = replacement.promise.then((rows) => {
    if (replacementTicket.isCurrent(currentIdentity)) visibleRows = rows;
  });

  replacement.resolve([{ id: "notification-b" }]);
  await replacementCommit;
  oldSuccess.resolve([{ id: "notification-a" }]);
  oldFailure.reject(new Error("stale failure"));
  await Promise.all([oldSuccessCommit, oldFailureCommit]);

  assert.deepEqual(visibleRows, [{ id: "notification-b" }]);
  assert.equal(scheduledRetries, 0);
  assert.equal(oldSuccessTicket.isCurrent(currentIdentity), false);
  assert.equal(oldFailureTicket.isCurrent(currentIdentity), false);
  assert.equal(replacementTicket.isCurrent(currentIdentity), true);
});

test("pending mark-all completion cannot update rows or notices after an auth switch", async () => {
  const guard = createLatestNotificationsRequestGuard();
  const userA = createNotificationsAuthIdentity("user-a", "token-a");
  const userB = createNotificationsAuthIdentity("user-b", "token-b");
  assert.ok(userA);
  assert.ok(userB);

  let currentIdentity = userA;
  let visibleRows = [{ id: "a", is_read: false }];
  const notices = [];
  const pending = deferred();
  const ticket = guard.begin(userA);
  const completion = pending.promise.then(() => {
    if (!ticket.isCurrent(currentIdentity)) return;
    visibleRows = visibleRows.map((row) => ({ ...row, is_read: true }));
    notices.push("success");
  }).catch(() => {
    if (ticket.isCurrent(currentIdentity)) notices.push("error");
  });

  currentIdentity = userB;
  guard.invalidate();
  visibleRows = [{ id: "b", is_read: false }];
  pending.resolve();
  await completion;

  assert.deepEqual(visibleRows, [{ id: "b", is_read: false }]);
  assert.deepEqual(notices, []);
});

test("late unread-badge results cannot replace the current auth generation", async () => {
  const guard = createLatestNotificationsRequestGuard();
  const userA = createNotificationsAuthIdentity("user-a", "token-a");
  const userB = createNotificationsAuthIdentity("user-b", "token-b");
  assert.ok(userA);
  assert.ok(userB);

  let currentIdentity = userA;
  let visibleCount = 0;
  const oldCount = deferred();
  const oldTicket = guard.begin(userA);
  const oldCommit = oldCount.promise.then((count) => {
    if (oldTicket.isCurrent(currentIdentity)) visibleCount = count;
  });

  currentIdentity = userB;
  const newCount = deferred();
  const newTicket = guard.begin(userB);
  const newCommit = newCount.promise.then((count) => {
    if (newTicket.isCurrent(currentIdentity)) visibleCount = count;
  });
  newCount.resolve(2);
  await newCommit;
  oldCount.resolve(8);
  await oldCommit;

  assert.equal(visibleCount, 2);
  assert.equal(oldTicket.isCurrent(currentIdentity), false);
  assert.equal(newTicket.isCurrent(currentIdentity), true);

  currentIdentity = null;
  guard.invalidate();
  visibleCount = 0;
  assert.equal(newTicket.isCurrent(currentIdentity), false);
  assert.equal(visibleCount, 0);
});

test("notification page and list preserve exact visible presentation", async () => {
  const [page, list, layout] = await Promise.all([
    readRepositoryFile("src/domains/notifications/ui/NotificationsPage.tsx"),
    readRepositoryFile("src/domains/notifications/ui/NotificationList.tsx"),
    readRepositoryFile("src/components/layout/AppLayout.tsx"),
  ]);
  const visibleUi = `${page}\n${list}`;

  for (const copy of [
    "Notifications",
    "Checking notification status",
    "unread",
    "All caught up",
    "Read all",
    "No notifications yet",
  ]) {
    assert.match(visibleUi, new RegExp(copy));
  }

  assert.match(list, /\[1, 2, 3\]/);
  assert.match(list, /skeleton h-16 rounded-xl/);
  assert.match(list, /deposit_submitted:[\s\S]*text-blue-400/);
  assert.match(list, /deposit_approved:[\s\S]*text-emerald-400/);
  assert.match(list, /deposit_rejected:[\s\S]*text-red-400/);
  assert.match(list, /deposit_review:[\s\S]*text-amber-400/);
  assert.match(list, /withdrawal_approved:[\s\S]*text-emerald-400/);
  assert.match(list, /withdrawal_rejected:[\s\S]*text-red-400/);
  assert.match(list, /FALLBACK_ICON = <Bell size=\{14\} className="text-gray-500"/);
  assert.match(list, /unread=\{!notification\.is_read\}/);
  assert.match(list, /bg-\[#00ff41\]/);
  assert.match(list, /formatDateTime\(notification\.created_at\)/);

  assert.match(layout, /onClick=\{\(\) => navigate\(\{ to: '\/notifications' \}\)\}/);
  assert.match(layout, /unreadCount > 0/);
  assert.match(layout, /unreadCount > 9 \? '9\+' : unreadCount/);
});

test("notification controllers preserve timing, refresh, and single-flight anchors", async () => {
  const [controller, badge] = await Promise.all([
    readRepositoryFile("src/domains/notifications/ui/useNotifications.ts"),
    readRepositoryFile("src/domains/notifications/ui/useUnreadNotificationCount.ts"),
  ]);

  assert.match(controller, /NOTIFICATIONS_LOAD_TIMEOUT_MS\s*=\s*10_000/);
  assert.match(controller, /AUTO_RETRY_DELAY_MS\s*=\s*1_500/);
  assert.match(controller, /MAX_AUTO_RETRIES\s*=\s*2/);
  assert.match(controller, /Notifications request timed out\./);
  assert.match(controller, /document\.addEventListener\("visibilitychange"/);
  assert.match(controller, /window\.addEventListener\("online"/);
  assert.doesNotMatch(controller, /setInterval/);

  assert.match(controller, /createNotificationsAuthIdentity\(userId, accessToken\)/);
  assert.match(controller, /activeLoadRef/);
  assert.match(controller, /isSameNotificationsAuthIdentity\(activeLoad\.identity, requestIdentity\)/);
  assert.match(controller, /return activeLoad\.promise/);
  assert.match(controller, /forceNewFlight/);
  assert.match(controller, /Symbol\("notifications-load-flight"\)/);
  assert.match(controller, /activeLoadRef\.current\?\.token === flightToken/);
  assert.ok(
    [...controller.matchAll(/request\.isCurrent\(identityRef\.current\)/g)].length >= 5,
    "load and mark-all success, failure, and completion paths must be generation gated",
  );
  assert.match(controller, /activeMarkRef/);
  assert.match(controller, /return activeMark\.promise/);
  assert.match(controller, /Symbol\("notifications-mark-all-flight"\)/);
  assert.match(controller, /setSnapshot\(null\)/);
  assert.match(controller, /setMarkingIdentity\(null\)/);
  assert.match(controller, /Session expired\. Please sign in again\./);
  assert.match(controller, /All notifications marked as read\./);
  assert.match(controller, /Failed to mark notifications\./);

  assert.match(badge, /UNREAD_COUNT_POLL_INTERVAL_MS\s*=\s*60_000/);
  assert.match(badge, /setInterval/);
  assert.match(badge, /createNotificationsAuthIdentity\(userId, accessToken\)/);
  assert.match(badge, /createLatestNotificationsRequestGuard/);
  assert.match(badge, /isSameNotificationsAuthIdentity\(activeFlight\.identity, requestIdentity\)/);
  assert.match(badge, /return activeFlight\.promise/);
  assert.match(badge, /Symbol\("notifications-unread-count-flight"\)/);
  assert.match(badge, /request\.isCurrent\(identityRef\.current\)/);
  assert.match(badge, /setSnapshot\(null\)/);
  assert.match(badge, /return snapshot[\s\S]*\? snapshot\.count[\s\S]*: 0;/);
  assert.doesNotMatch(badge, /toast\./);
});

test("browser bridge and server retain authenticated notification invariants", async () => {
  const [service, server, route, publicSurface, layout] = await Promise.all([
    readRepositoryFile("src/domains/notifications/application/notifications-browser-service.ts"),
    readRepositoryFile("src/lib/server/notifications.ts"),
    readRepositoryFile("src/routes/_app/notifications.tsx"),
    readRepositoryFile("src/domains/notifications/public.ts"),
    readRepositoryFile("src/components/layout/AppLayout.tsx"),
  ]);

  for (const serverFunction of [
    "getNotificationsFn",
    "getUnreadCountFn",
    "markNotificationsReadFn",
  ]) {
    assert.match(service, new RegExp(serverFunction));
  }
  assert.match(service, /getNotificationsFn\(\{ data: \{ accessToken \} \}\)/);
  assert.match(service, /getUnreadCountFn\(\{ data: \{ accessToken \} \}\)/);
  assert.match(service, /markNotificationsReadFn\(\{ data: \{ accessToken \} \}\)/);

  assert.match(server, /admin\.auth\.getUser\(data\.accessToken\)/);
  assert.ok(
    [...server.matchAll(/\.eq\("user_id", authUser\.id\)/g)].length >= 3,
    "list, unread count, and mark-read mutations must remain Auth-user scoped",
  );
  assert.match(server, /\.order\("created_at", \{ ascending: false \}\)/);
  assert.match(server, /\.limit\(30\)/);
  assert.match(server, /\.eq\("is_read", false\)/);
  assert.match(server, /if \(authError \|\| !authUser\) return \{ count: 0 \};/);
  assert.match(server, /if \(error\) return \{ count: 0 \};/);
  assert.match(server, /\.in\("id", data\.notificationIds\)/);
  assert.match(server, /return \{ success: true \};/);
  assert.doesNotMatch(server, /data\.userId|data\.user_id/);

  assert.match(route, /@\/domains\/notifications\/public\.js/);
  assert.doesNotMatch(route, /lib\/server|useAuthStore|withTimeout/);
  assert.match(publicSurface, /export \{ NotificationsPage \}/);
  assert.match(publicSurface, /export \{ useUnreadNotificationCount \}/);
  assert.match(layout, /@\/domains\/notifications\/public\.js/);
  assert.doesNotMatch(layout, /lib\/server\/notifications|lib\/supabase/);
});

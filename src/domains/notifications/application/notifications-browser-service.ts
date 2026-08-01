import {
  getNotificationsFn,
  getUnreadCountFn,
  markNotificationsReadFn,
} from "@/lib/server/notifications.js";

export type NotificationRecord = Awaited<
  ReturnType<typeof getNotificationsFn>
>[number];

export function loadNotifications(
  accessToken: string,
): Promise<NotificationRecord[]> {
  return getNotificationsFn({ data: { accessToken } });
}

export async function loadUnreadNotificationCount(
  accessToken: string,
): Promise<number> {
  const result = await getUnreadCountFn({ data: { accessToken } });
  return result.count;
}

export async function markAllNotificationsRead(
  accessToken: string,
): Promise<void> {
  await markNotificationsReadFn({ data: { accessToken } });
}

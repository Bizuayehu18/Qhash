import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/Button.js";
import { PageHeader } from "@/components/ui/PageHeader.js";
import { NotificationList } from "./NotificationList.js";
import { useNotifications } from "./useNotifications.js";

export function NotificationsPage() {
  const {
    markAllRead,
    markingAll,
    notifications,
    notificationsLoaded,
    unreadCount,
  } = useNotifications();
  const description = !notificationsLoaded
    ? "Checking notification status"
    : unreadCount > 0
      ? `${unreadCount} unread`
      : "All caught up";

  return (
    <div className="space-y-4 lg:mx-auto lg:max-w-3xl">
      <PageHeader
        icon={<Bell size={16} />}
        title="Notifications"
        description={description}
        action={
          notificationsLoaded && unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              loading={markingAll}
              onClick={() => void markAllRead()}
            >
              <CheckCheck size={13} />
              <span className="text-[11px]">Read all</span>
            </Button>
          ) : undefined
        }
      />

      <NotificationList
        loaded={notificationsLoaded}
        notifications={notifications}
      />
    </div>
  );
}

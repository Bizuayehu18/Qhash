import {
  ArrowDownCircle,
  Bell,
  CheckCircle,
  Eye,
  XCircle,
} from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState.js";
import { ListPanel } from "@/components/ui/ListPanel.js";
import { ListRow } from "@/components/ui/ListRow.js";
import { formatDateTime } from "@/lib/format.js";
import type { NotificationRecord } from "../application/notifications-browser-service.js";
import {
  getNotificationMessage,
  getNotificationTitle,
  getNotificationType,
} from "../domain/notification-presentation.js";

const TYPE_ICONS: Record<string, React.ReactNode> = {
  deposit_submitted: <ArrowDownCircle size={14} className="text-blue-400" />,
  deposit_approved: <CheckCircle size={14} className="text-emerald-400" />,
  deposit_rejected: <XCircle size={14} className="text-red-400" />,
  deposit_review: <Eye size={14} className="text-amber-400" />,
  withdrawal_approved: <CheckCircle size={14} className="text-emerald-400" />,
  withdrawal_rejected: <XCircle size={14} className="text-red-400" />,
};

const FALLBACK_ICON = <Bell size={14} className="text-gray-500" />;

export function NotificationList({
  loaded,
  notifications,
}: {
  loaded: boolean;
  notifications: NotificationRecord[];
}) {
  if (!loaded) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((index) => (
          <div key={index} className="skeleton h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (notifications.length === 0) {
    return <EmptyState icon={<Bell size={24} />} title="No notifications yet" />;
  }

  return (
    <ListPanel>
      {notifications.map((notification) => {
        const notificationType = getNotificationType(notification);
        const icon = notificationType
          ? TYPE_ICONS[notificationType] ?? FALLBACK_ICON
          : FALLBACK_ICON;

        return (
          <ListRow
            key={notification.id}
            unread={!notification.is_read}
            icon={icon}
            title={
              <span className="inline-flex min-w-0 items-center gap-2">
                <span className="truncate">
                  {getNotificationTitle(notification, notificationType)}
                </span>
                {!notification.is_read && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#00ff41]" />
                )}
              </span>
            }
            description={getNotificationMessage(notification, notificationType)}
            meta={formatDateTime(notification.created_at)}
          />
        );
      })}
    </ListPanel>
  );
}

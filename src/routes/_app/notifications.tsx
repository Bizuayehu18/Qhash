import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button.js";
import { EmptyState } from "@/components/ui/EmptyState.js";
import { ListPanel } from "@/components/ui/ListPanel.js";
import { ListRow } from "@/components/ui/ListRow.js";
import { PageHeader } from "@/components/ui/PageHeader.js";
import {
  Bell,
  CheckCircle,
  XCircle,
  ArrowDownCircle,
  Eye,
  CheckCheck,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format.js";
import { useAuthStore } from "@/store/authStore.js";
import {
  getNotificationsFn,
  markNotificationsReadFn,
} from "@/lib/server/notifications.js";
import { withTimeout } from "@/lib/async.js";

export const Route = createFileRoute("/_app/notifications")({
  component: NotificationsPage,
});

type Notification = Awaited<ReturnType<typeof getNotificationsFn>>[number];

const NOTIFICATIONS_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

const TYPE_ICONS: Record<string, React.ReactNode> = {
  deposit_submitted: <ArrowDownCircle size={14} className="text-blue-400" />,
  deposit_approved: <CheckCircle size={14} className="text-emerald-400" />,
  deposit_rejected: <XCircle size={14} className="text-red-400" />,
  deposit_review: <Eye size={14} className="text-amber-400" />,
  withdrawal_approved: <CheckCircle size={14} className="text-emerald-400" />,
  withdrawal_rejected: <XCircle size={14} className="text-red-400" />,
};

const getNotificationType = (notification: Notification) => {
  const metadataType = (notification.metadata as Record<string, unknown> | null)
    ?.type;

  if (typeof metadataType === "string") {
    return metadataType;
  }

  const normalizedTitle = notification.title.trim().toLowerCase();

  if (normalizedTitle === "withdrawal approved") {
    return "withdrawal_approved";
  }

  if (normalizedTitle === "withdrawal rejected") {
    return "withdrawal_rejected";
  }

  return undefined;
};

const getNotificationTitle = (
  notification: Notification,
  notificationType?: string,
) => {
  if (notificationType === "withdrawal_approved") {
    return "Withdrawal Approved";
  }

  if (notificationType === "withdrawal_rejected") {
    return "Withdrawal Rejected";
  }

  return notification.title;
};

const getNotificationMessage = (
  notification: Notification,
  notificationType?: string,
) => {
  if (notificationType === "withdrawal_approved") {
    return notification.message.replace(
      "Your withdrawal request has been approved.",
      "Your withdrawal has been approved.",
    );
  }

  if (notificationType === "withdrawal_rejected") {
    return notification.message.replace(
      "Your withdrawal request was rejected and the full amount was returned to your wallet.",
      "Your withdrawal request was rejected. The full amount was returned to your wallet.",
    );
  }

  return notification.message;
};

function NotificationsPage() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback(
    (loadFn: () => void) => {
      clearRetryTimer();

      if (retryCountRef.current >= MAX_AUTO_RETRIES) return;

      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(loadFn, AUTO_RETRY_DELAY_MS);
    },
    [clearRetryTimer],
  );

  const loadNotifications = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (loadingRef.current) return;

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (!user?.id) return;

      if (!accessToken) {
        scheduleRetry(() => {
          void loadNotifications();
        });
        return;
      }

      clearRetryTimer();
      loadingRef.current = true;

      try {
        const rows = await withTimeout(
          getNotificationsFn({ data: { accessToken } }),
          NOTIFICATIONS_LOAD_TIMEOUT_MS,
          "Notifications request timed out.",
        );

        if (!mountedRef.current) return;

        setNotifications(rows);
        setNotificationsLoaded(true);
        retryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Notifications background refresh failed:", err);

        if (!mountedRef.current) return;

        scheduleRetry(() => {
          void loadNotifications();
        });
      } finally {
        loadingRef.current = false;
      }
    },
    [accessToken, clearRetryTimer, scheduleRetry, user?.id],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadNotifications({ resetRetryCount: true });

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer, loadNotifications]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void loadNotifications({ resetRetryCount: true });
      }
    };

    const handleOnline = () => {
      void loadNotifications({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadNotifications]);

  const handleMarkAllRead = async () => {
    if (!user?.id) return;

    if (!accessToken) {
      toast.error("Session expired. Please sign in again.");
      return;
    }

    setMarkingAll(true);
    try {
      await markNotificationsReadFn({ data: { accessToken } });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      toast.success("All notifications marked as read.");
    } catch {
      toast.error("Failed to mark notifications.");
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;
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
              onClick={handleMarkAllRead}
            >
              <CheckCheck size={13} />
              <span className="text-[11px]">Read all</span>
            </Button>
          ) : undefined
        }
      />

      {!notificationsLoaded ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <EmptyState icon={<Bell size={24} />} title="No notifications yet" />
      ) : (
        <ListPanel>
          {notifications.map((n) => {
            const notificationType = getNotificationType(n);
            const icon = notificationType
              ? TYPE_ICONS[notificationType] ?? <Bell size={14} className="text-gray-500" />
              : <Bell size={14} className="text-gray-500" />;

            return (
              <ListRow
                key={n.id}
                unread={!n.is_read}
                icon={icon}
                title={
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span className="truncate">{getNotificationTitle(n, notificationType)}</span>
                    {!n.is_read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#00ff41]" />}
                  </span>
                }
                description={getNotificationMessage(n, notificationType)}
                meta={formatDateTime(n.created_at)}
              />
            );
          })}
        </ListPanel>
      )}
    </div>
  );
}

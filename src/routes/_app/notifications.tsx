import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button.js";
import {
  Bell,
  CheckCircle,
  XCircle,
  ArrowDownCircle,
  Eye,
  CheckCheck,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format.js";
import { useAuthStore } from "@/store/authStore.js";
import { supabase } from "@/lib/supabase.js";
import {
  getNotificationsFn,
  markNotificationsReadFn,
} from "@/lib/server/notifications.js";

export const Route = createFileRoute("/_app/notifications")({
  component: NotificationsPage,
});

type Notification = Awaited<ReturnType<typeof getNotificationsFn>>[number];

const TYPE_ICONS: Record<string, React.ReactNode> = {
  deposit_submitted: <ArrowDownCircle size={14} className="text-blue-400" />,
  deposit_approved: <CheckCircle size={14} className="text-emerald-400" />,
  deposit_rejected: <XCircle size={14} className="text-red-400" />,
  deposit_review: <Eye size={14} className="text-amber-400" />,
};

function NotificationsPage() {
  const { user } = useAuthStore();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);

  const loadNotifications = () => {
    if (!user?.id) return;
    setLoading(true);
    supabase.auth
      .getSession()
      .then(({ data: sessionData }) => {
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) {
          setNotifications([]);
          return;
        }
        return getNotificationsFn({ data: { accessToken } }).then(
          setNotifications,
        );
      })
      .catch(() => toast.error("Failed to load notifications"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadNotifications();
  }, [user?.id]);

  const handleMarkAllRead = async () => {
    if (!user?.id) return;
    setMarkingAll(true);
    try {
      await markNotificationsReadFn({ data: { userId: user.id } });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      toast.success("All notifications marked as read.");
    } catch {
      toast.error("Failed to mark notifications.");
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Notifications</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {unreadCount > 0
              ? `${unreadCount} unread`
              : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" loading={markingAll} onClick={handleMarkAllRead}>
            <CheckCheck size={13} />
            <span className="text-[11px]">Read all</span>
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
        </div>
      ) : notifications.length === 0 ? (
        <div className="text-center py-16">
          <Bell size={24} className="mx-auto mb-3 text-gray-700" />
          <p className="text-xs text-gray-600">No notifications yet</p>
        </div>
      ) : (
        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`flex gap-3 px-4 py-3 ${!n.is_read ? "bg-[rgba(0,255,65,0.02)]" : ""}`}
            >
              <div className="h-8 w-8 rounded-full bg-white/5 flex items-center justify-center shrink-0 mt-0.5">
                {TYPE_ICONS[(n.metadata as Record<string, unknown>)?.type as string] ?? <Bell size={14} className="text-gray-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-200">{n.title}</span>
                  {!n.is_read && <span className="h-1.5 w-1.5 rounded-full bg-[#00ff41]" />}
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">{n.message}</p>
                <p className="text-[10px] text-gray-700 mt-1">
                  {formatDateTime(n.created_at)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

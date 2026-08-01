import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { withTimeout } from "@/lib/async.js";
import { useAuthStore } from "@/store/authStore.js";
import {
  createLatestNotificationsRequestGuard,
  createNotificationsAuthIdentity,
  createNotificationsRetryPolicy,
  isSameNotificationsAuthIdentity,
  type NotificationsAuthIdentity,
} from "../application/notifications-auth-lifecycle.js";
import {
  loadNotifications,
  markAllNotificationsRead,
  type NotificationRecord,
} from "../application/notifications-browser-service.js";

const NOTIFICATIONS_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

type NotificationsSnapshot = Readonly<{
  identity: NotificationsAuthIdentity;
  notifications: NotificationRecord[];
}>;

type NotificationsLoadOptions = Readonly<{
  forceNewFlight?: boolean;
  resetRetryCount?: boolean;
}>;

type NotificationsFlight = Readonly<{
  identity: NotificationsAuthIdentity;
  promise: Promise<boolean>;
  token: symbol;
}>;

export function useNotifications() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const accessToken = useAuthStore(
    (state) => state.session?.access_token ?? null,
  );
  const identity = useMemo(
    () => createNotificationsAuthIdentity(userId, accessToken),
    [accessToken, userId],
  );
  const identityRef = useRef(identity);
  const userIdRef = useRef(userId);
  identityRef.current = identity;
  userIdRef.current = userId;

  const [snapshot, setSnapshot] = useState<NotificationsSnapshot | null>(null);
  const [markingIdentity, setMarkingIdentity] = useState<
    NotificationsAuthIdentity | null
  >(null);
  const mountedRef = useRef(false);
  const retryPolicyRef = useRef(createNotificationsRetryPolicy(MAX_AUTO_RETRIES));
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadGuardRef = useRef(createLatestNotificationsRequestGuard());
  const markGuardRef = useRef(createLatestNotificationsRequestGuard());
  const activeLoadRef = useRef<NotificationsFlight | null>(null);
  const activeMarkRef = useRef<NotificationsFlight | null>(null);
  const loadRef = useRef<(
    options?: NotificationsLoadOptions,
  ) => Promise<boolean>>(() => Promise.resolve(false));

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback((retry: () => void) => {
    clearRetryTimer();
    if (!retryPolicyRef.current.reserveRetry()) return;
    retryTimerRef.current = setTimeout(retry, AUTO_RETRY_DELAY_MS);
  }, [clearRetryTimer]);

  const load = useCallback((options?: NotificationsLoadOptions): Promise<boolean> => {
    const requestIdentity = identityRef.current;
    const requestUserId = userIdRef.current;

    if (!requestIdentity) {
      if (!requestUserId) return Promise.resolve(false);

      retryPolicyRef.current.admitLoad({
        coalescesWithActiveFlight: false,
        resetRetryCount: options?.resetRetryCount,
      });
      scheduleRetry(() => {
        if (mountedRef.current && userIdRef.current === requestUserId) {
          void loadRef.current();
        }
      });
      return Promise.resolve(false);
    }

    const activeLoad = activeLoadRef.current;
    if (
      !options?.forceNewFlight
      && activeLoad
      && isSameNotificationsAuthIdentity(activeLoad.identity, requestIdentity)
    ) {
      retryPolicyRef.current.admitLoad({
        coalescesWithActiveFlight: true,
        resetRetryCount: options?.resetRetryCount,
      });
      return activeLoad.promise;
    }

    retryPolicyRef.current.admitLoad({
      coalescesWithActiveFlight: false,
      resetRetryCount: options?.resetRetryCount,
    });
    clearRetryTimer();
    const request = loadGuardRef.current.begin(requestIdentity);
    const flightToken = Symbol("notifications-load-flight");

    const promise = (async () => {
      try {
        const rows = await withTimeout(
          loadNotifications(requestIdentity.accessToken),
          NOTIFICATIONS_LOAD_TIMEOUT_MS,
          "Notifications request timed out.",
        );

        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        setSnapshot({ identity: requestIdentity, notifications: rows });
        retryPolicyRef.current.reset();
        return true;
      } catch (error) {
        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        console.error("[QHash] Notifications background refresh failed:", error);
        scheduleRetry(() => {
          if (
            mountedRef.current
            && isSameNotificationsAuthIdentity(identityRef.current, requestIdentity)
          ) {
            void loadRef.current({ forceNewFlight: true });
          }
        });
        return false;
      } finally {
        if (activeLoadRef.current?.token === flightToken) {
          activeLoadRef.current = null;
        }
      }
    })();

    activeLoadRef.current = {
      identity: requestIdentity,
      promise,
      token: flightToken,
    };
    return promise;
  }, [clearRetryTimer, scheduleRetry]);
  loadRef.current = load;

  const markAllRead = useCallback((): Promise<boolean> => {
    const requestIdentity = identityRef.current;
    if (!userIdRef.current) return Promise.resolve(false);

    if (!requestIdentity) {
      toast.error("Session expired. Please sign in again.");
      return Promise.resolve(false);
    }

    const activeMark = activeMarkRef.current;
    if (
      activeMark
      && isSameNotificationsAuthIdentity(activeMark.identity, requestIdentity)
    ) {
      return activeMark.promise;
    }

    const request = markGuardRef.current.begin(requestIdentity);
    const flightToken = Symbol("notifications-mark-all-flight");
    setMarkingIdentity(requestIdentity);

    const promise = (async () => {
      try {
        await markAllNotificationsRead(requestIdentity.accessToken);
        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        setSnapshot((current) => (
          current
          && isSameNotificationsAuthIdentity(current.identity, requestIdentity)
            ? {
                ...current,
                notifications: current.notifications.map((notification) => ({
                  ...notification,
                  is_read: true,
                })),
              }
            : current
        ));
        toast.success("All notifications marked as read.");
        return true;
      } catch {
        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        toast.error("Failed to mark notifications.");
        return false;
      } finally {
        if (activeMarkRef.current?.token === flightToken) {
          activeMarkRef.current = null;
        }
        if (mountedRef.current && request.isCurrent(identityRef.current)) {
          setMarkingIdentity(null);
        }
      }
    })();

    activeMarkRef.current = {
      identity: requestIdentity,
      promise,
      token: flightToken,
    };
    return promise;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadGuardRef.current.invalidate();
      markGuardRef.current.invalidate();
      activeLoadRef.current = null;
      activeMarkRef.current = null;
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  useEffect(() => {
    loadGuardRef.current.invalidate();
    markGuardRef.current.invalidate();
    activeLoadRef.current = null;
    activeMarkRef.current = null;
    clearRetryTimer();
    retryPolicyRef.current.reset();
    setSnapshot(null);
    setMarkingIdentity(null);
    void load({ forceNewFlight: true, resetRetryCount: true });

    return () => {
      loadGuardRef.current.invalidate();
      markGuardRef.current.invalidate();
      activeLoadRef.current = null;
      activeMarkRef.current = null;
      clearRetryTimer();
    };
  }, [clearRetryTimer, identity, load]);

  useEffect(() => {
    const refresh = () => void load({ resetRetryCount: true });
    const handleVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", refresh);
    };
  }, [load]);

  const visibleSnapshot = snapshot
    && isSameNotificationsAuthIdentity(snapshot.identity, identity)
    ? snapshot
    : null;
  const notifications = visibleSnapshot?.notifications ?? [];

  return {
    markAllRead,
    markingAll: isSameNotificationsAuthIdentity(markingIdentity, identity),
    notifications,
    notificationsLoaded: visibleSnapshot !== null,
    unreadCount: notifications.filter((notification) => !notification.is_read).length,
  };
}

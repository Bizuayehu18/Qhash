import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuthStore } from "@/store/authStore.js";
import {
  createLatestNotificationsRequestGuard,
  createNotificationsAuthIdentity,
  isSameNotificationsAuthIdentity,
  type NotificationsAuthIdentity,
} from "../application/notifications-auth-lifecycle.js";
import { loadUnreadNotificationCount } from "../application/notifications-browser-service.js";

const UNREAD_COUNT_POLL_INTERVAL_MS = 60_000;

type UnreadCountSnapshot = Readonly<{
  count: number;
  identity: NotificationsAuthIdentity;
}>;

type UnreadCountFlight = Readonly<{
  identity: NotificationsAuthIdentity;
  promise: Promise<void>;
  token: symbol;
}>;

export function useUnreadNotificationCount(): number {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const accessToken = useAuthStore(
    (state) => state.session?.access_token ?? null,
  );
  const identity = useMemo(
    () => createNotificationsAuthIdentity(userId, accessToken),
    [accessToken, userId],
  );
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const [snapshot, setSnapshot] = useState<UnreadCountSnapshot | null>(null);
  const mountedRef = useRef(false);
  const requestGuardRef = useRef(createLatestNotificationsRequestGuard());
  const activeFlightRef = useRef<UnreadCountFlight | null>(null);

  const refresh = useCallback((): Promise<void> => {
    const requestIdentity = identityRef.current;
    if (!requestIdentity) return Promise.resolve();

    const activeFlight = activeFlightRef.current;
    if (
      activeFlight
      && isSameNotificationsAuthIdentity(activeFlight.identity, requestIdentity)
    ) {
      return activeFlight.promise;
    }

    const request = requestGuardRef.current.begin(requestIdentity);
    const flightToken = Symbol("notifications-unread-count-flight");
    const promise = (async () => {
      try {
        const count = await loadUnreadNotificationCount(
          requestIdentity.accessToken,
        );
        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return;
        }

        setSnapshot({ count, identity: requestIdentity });
      } catch {
        // The header badge remains silent on background refresh failures.
      } finally {
        if (activeFlightRef.current?.token === flightToken) {
          activeFlightRef.current = null;
        }
      }
    })();

    activeFlightRef.current = {
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
      requestGuardRef.current.invalidate();
      activeFlightRef.current = null;
    };
  }, []);

  useEffect(() => {
    requestGuardRef.current.invalidate();
    activeFlightRef.current = null;
    setSnapshot(null);

    if (!identity) return;

    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, UNREAD_COUNT_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
      requestGuardRef.current.invalidate();
      activeFlightRef.current = null;
    };
  }, [identity, refresh]);

  return snapshot && isSameNotificationsAuthIdentity(snapshot.identity, identity)
    ? snapshot.count
    : 0;
}

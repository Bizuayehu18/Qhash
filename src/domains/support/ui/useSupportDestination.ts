import { useCallback, useEffect, useRef, useState } from "react";
import { withTimeout } from "@/lib/async.js";
import {
  createLatestSupportDestinationRequestGuard,
  getSupportNavigationTarget,
  runLatestSupportDestinationRequest,
  runPassiveSupportDestinationRequest,
} from "../application/support-destination-request-guard.js";
import { loadSupportDestination } from "../application/support-settings-browser-service.js";

const SUPPORT_SETTINGS_LOAD_TIMEOUT_MS = 10_000;

export function useSupportDestination() {
  const [supportUrl, setSupportUrl] = useState<string | null>(null);
  const [supportOpening, setSupportOpening] = useState(false);
  const mountedRef = useRef(true);
  const supportOpeningRef = useRef(false);
  const requestGuardRef = useRef(createLatestSupportDestinationRequestGuard());

  const loadSupportUrl = useCallback(async ({ interactive = false } = {}) => {
    try {
      const requestOptions = {
        guard: requestGuardRef.current,
        isMounted: () => mountedRef.current,
        load: () => withTimeout(
          loadSupportDestination(),
          SUPPORT_SETTINGS_LOAD_TIMEOUT_MS,
          "Support settings request timed out.",
        ),
        publish: setSupportUrl,
      };

      if (interactive) {
        return await runLatestSupportDestinationRequest(requestOptions);
      }

      return await runPassiveSupportDestinationRequest({
        ...requestOptions,
        isInteractivePending: () => supportOpeningRef.current,
      });
    } catch (error) {
      console.error("[QHash] Support settings preload failed:", error);
      return { status: "failed" } as const;
    }
  }, []);

  const openSupport = useCallback(async () => {
    if (supportOpeningRef.current) return;

    if (supportUrl) {
      window.location.assign(supportUrl);
      return;
    }

    supportOpeningRef.current = true;
    setSupportOpening(true);
    const result = await loadSupportUrl({ interactive: true });

    if (!mountedRef.current) return;

    supportOpeningRef.current = false;
    setSupportOpening(false);
    const navigationTarget = getSupportNavigationTarget(result);

    if (navigationTarget) {
      window.location.assign(navigationTarget);
    }
  }, [loadSupportUrl, supportUrl]);

  useEffect(() => {
    mountedRef.current = true;
    void loadSupportUrl();

    return () => {
      mountedRef.current = false;
      supportOpeningRef.current = false;
      requestGuardRef.current.invalidate();
    };
  }, [loadSupportUrl]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void loadSupportUrl();
      }
    };
    const handleOnline = () => {
      void loadSupportUrl();
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadSupportUrl]);

  return {
    openSupport,
    supportDescription: supportOpening ? "Opening..." : "Get help fast",
    supportOpening,
    supportUrl,
  };
}

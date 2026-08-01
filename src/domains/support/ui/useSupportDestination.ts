import { useCallback, useEffect, useRef, useState } from "react";
import { withTimeout } from "@/lib/async.js";
import {
  createLatestSupportDestinationRequestGuard,
  runLatestSupportDestinationRequest,
} from "../application/support-destination-request-guard.js";
import { loadSupportDestination } from "../application/support-settings-browser-service.js";

const SUPPORT_SETTINGS_LOAD_TIMEOUT_MS = 10_000;

export function useSupportDestination() {
  const [supportUrl, setSupportUrl] = useState<string | null>(null);
  const [supportOpening, setSupportOpening] = useState(false);
  const mountedRef = useRef(true);
  const requestGuardRef = useRef(createLatestSupportDestinationRequestGuard());

  const loadSupportUrl = useCallback(async () => {
    try {
      return await runLatestSupportDestinationRequest({
        guard: requestGuardRef.current,
        isMounted: () => mountedRef.current,
        load: () => withTimeout(
          loadSupportDestination(),
          SUPPORT_SETTINGS_LOAD_TIMEOUT_MS,
          "Support settings request timed out.",
        ),
        publish: setSupportUrl,
      });
    } catch (error) {
      console.error("[QHash] Support settings preload failed:", error);
      return null;
    }
  }, []);

  const openSupport = useCallback(async () => {
    if (supportOpening) return;

    if (supportUrl) {
      window.location.assign(supportUrl);
      return;
    }

    setSupportOpening(true);
    const loadedUrl = await loadSupportUrl();

    if (!mountedRef.current) return;

    setSupportOpening(false);
    if (loadedUrl) {
      window.location.assign(loadedUrl);
      return;
    }

    window.location.assign("/support");
  }, [loadSupportUrl, supportOpening, supportUrl]);

  useEffect(() => {
    mountedRef.current = true;
    void loadSupportUrl();

    return () => {
      mountedRef.current = false;
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

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, HeadphonesIcon, Info, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/Button.js";
import {
  getSupportSettingsFn,
  type SupportSettings,
} from "@/lib/server/support-settings.js";
import { withTimeout } from "@/lib/async.js";

export const Route = createFileRoute("/_app/support")({
  component: SupportPage,
});

const SUPPORT_SETTINGS_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

function SupportPage() {
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

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

  const loadSettings = useCallback(
    async (options?: { resetRetryCount?: boolean; resetLoaded?: boolean }) => {
      if (loadingRef.current) return;

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (options?.resetLoaded) {
        setSettings(null);
        setSettingsLoaded(false);
      }

      clearRetryTimer();
      loadingRef.current = true;

      try {
        const result = await withTimeout(
          getSupportSettingsFn({ data: {} }),
          SUPPORT_SETTINGS_TIMEOUT_MS,
          "Support settings request timed out.",
        );

        if (!mountedRef.current) return;

        setSettings(result);
        setSettingsLoaded(true);
        retryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Support settings background refresh failed:", err);

        if (!mountedRef.current) return;

        scheduleRetry(() => {
          void loadSettings();
        });
      } finally {
        loadingRef.current = false;
      }
    },
    [clearRetryTimer, scheduleRetry],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadSettings({ resetRetryCount: true, resetLoaded: true });

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer, loadSettings]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void loadSettings({ resetRetryCount: true });
      }
    };

    const handleOnline = () => {
      void loadSettings({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadSettings]);

  const openTelegram = () => {
    if (!settings?.telegramUrl) return;
    window.open(settings.telegramUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-5 lg:max-w-3xl lg:mx-auto">
      <div>
        <h1 className="text-lg font-bold">Support</h1>
        <p className="text-xs text-gray-500 mt-1">Get help from the official QHash support team</p>
      </div>

      <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-4">
        <div className="flex items-center gap-2">
          <HeadphonesIcon size={14} className="text-[#00ff41]" />
          <span className="text-xs font-semibold">Telegram Support</span>
        </div>

        {!settingsLoaded ? (
          <div className="space-y-3">
            <div className="skeleton h-16 rounded-xl" aria-label="Loading support contact" />
            <div className="skeleton h-10 rounded-xl" />
          </div>
        ) : settings?.isConfigured ? (
          <>
            <div className="flex gap-2.5 p-3 rounded-xl bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.1)]">
              <Send size={15} className="text-[#00ff41] shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Need help? Message our official QHash support contact on Telegram.
                </p>
                <p className="text-xs font-mono text-[#00ff41] mt-2">{settings.telegramDisplay}</p>
              </div>
            </div>

            <Button fullWidth onClick={openTelegram}>
              <ExternalLink size={14} /> Open Telegram Support
            </Button>

            <p className="text-[10px] text-gray-600 text-center">
              If Telegram does not open automatically, search for {settings.telegramDisplay} in Telegram.
            </p>
          </>
        ) : (
          <div className="flex gap-2.5 p-3 rounded-xl bg-yellow-500/[0.04] border border-yellow-500/[0.12]">
            <Info size={15} className="text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Telegram support is not configured yet. Please check back later.
            </p>
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare size={14} className="text-gray-500" />
          <h2 className="text-sm font-semibold">Support Notes</h2>
        </div>

        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-4 text-[11px] text-gray-500 leading-relaxed space-y-2">
          <p>Only use the official Telegram support username shown on this page.</p>
          <p>QHash support will never ask for your password or private wallet credentials.</p>
        </div>
      </div>
    </div>
  );
}

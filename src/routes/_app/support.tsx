import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, HeadphonesIcon, Info } from "lucide-react";
import { getSupportSettingsFn } from "@/lib/server/support-settings.js";
import { withTimeout } from "@/lib/async.js";

export const Route = createFileRoute("/_app/support")({
  component: SupportPage,
});

const SUPPORT_SETTINGS_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

type SupportRedirectStatus = "loading" | "redirecting" | "unavailable";

function SupportPage() {
  const [status, setStatus] = useState<SupportRedirectStatus>("loading");
  const [telegramDisplay, setTelegramDisplay] = useState<string | null>(null);
  const [telegramUrl, setTelegramUrl] = useState<string | null>(null);

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

      if (retryCountRef.current >= MAX_AUTO_RETRIES) {
        setStatus("unavailable");
        return;
      }

      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(loadFn, AUTO_RETRY_DELAY_MS);
    },
    [clearRetryTimer],
  );

  const loadSupportSettings = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (loadingRef.current) return;

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      clearRetryTimer();
      loadingRef.current = true;
      setStatus("loading");

      try {
        const result = await withTimeout(
          getSupportSettingsFn({ data: {} }),
          SUPPORT_SETTINGS_TIMEOUT_MS,
          "Support settings request timed out.",
        );

        if (!mountedRef.current) return;

        setTelegramDisplay(result.telegramDisplay);
        setTelegramUrl(result.telegramUrl);
        retryCountRef.current = 0;

        if (result.isConfigured && result.telegramUrl) {
          setStatus("redirecting");
          window.location.assign(result.telegramUrl);
          return;
        }

        setStatus("unavailable");
      } catch (err) {
        console.error("[QHash] Support redirect failed:", err);

        if (!mountedRef.current) return;

        scheduleRetry(() => {
          void loadSupportSettings();
        });
      } finally {
        loadingRef.current = false;
      }
    },
    [clearRetryTimer, scheduleRetry],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadSupportSettings({ resetRetryCount: true });

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer, loadSupportSettings]);

  const isUnavailable = status === "unavailable";

  return (
    <div className="flex min-h-[55vh] items-center justify-center px-2">
      <div className="w-full max-w-sm rounded-2xl border border-[#1f1f1f] bg-[#111] p-4 text-center shadow-[0_0_20px_rgba(0,255,65,0.04)]">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(0,255,65,0.22)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]">
          {isUnavailable ? <Info size={19} /> : <HeadphonesIcon size={19} />}
        </div>

        <h1 className="mt-3 text-base font-bold text-gray-100">
          {isUnavailable ? "Support contact unavailable" : "Opening Telegram Support"}
        </h1>

        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          {isUnavailable
            ? "Telegram support is not configured yet. Please check back later."
            : telegramDisplay
              ? `Redirecting you to ${telegramDisplay}.`
              : "Finding the official QHash support contact."}
        </p>

        {!isUnavailable && telegramUrl && (
          <a
            href={telegramUrl}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#00ff41] px-4 py-2.5 text-sm font-semibold text-black transition-all active:scale-[0.99]"
          >
            <ExternalLink size={14} /> Open Telegram Manually
          </a>
        )}
      </div>
    </div>
  );
}

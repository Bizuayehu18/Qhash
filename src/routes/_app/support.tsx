import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CheckCircle2,
  ExternalLink,
  HeadphonesIcon,
  Info,
  MessageSquare,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/Button.js";
import { Card } from "@/components/ui/Card.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";
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
    <div className="space-y-3 lg:mx-auto lg:max-w-3xl">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
          Support Center
        </p>
        <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">Support</h1>
        <p className="mt-1 text-xs leading-relaxed text-gray-500">
          Get help from the official QHash support team.
        </p>
      </div>

      <Card neon className="overflow-hidden" padding="none">
        <div className="border-b border-[rgba(0,255,65,0.12)] bg-[rgba(0,255,65,0.04)] px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(0,255,65,0.22)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]">
              <HeadphonesIcon size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight text-gray-100">Telegram Support</p>
              <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                Use the official contact below for account and mining support.
              </p>
            </div>
            {settingsLoaded && settings?.isConfigured && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[rgba(0,255,65,0.22)] bg-[rgba(0,255,65,0.08)] px-2 py-1 text-[10px] font-semibold text-[#00ff41]">
                <CheckCircle2 size={11} /> Live
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3 p-4">
          {!settingsLoaded ? (
            <div className="space-y-3">
              <div className="skeleton h-20 rounded-xl" aria-label="Loading support contact" />
              <div className="skeleton h-10 rounded-xl" />
              <div className="skeleton mx-auto h-3 w-52 rounded" />
            </div>
          ) : settings?.isConfigured ? (
            <>
              <div className="rounded-xl border border-[#1f1f1f] bg-[#0a0a0a] p-3">
                <div className="flex items-start gap-2.5">
                  <Send size={15} className="mt-0.5 shrink-0 text-[#00ff41]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-gray-300">Official Telegram</p>
                    <p className="mt-1 truncate font-mono text-base font-bold text-[#00ff41]">
                      {settings.telegramDisplay}
                    </p>
                    <p className="mt-1 text-[10px] leading-relaxed text-gray-600">
                      Tap the button below to open Telegram securely.
                    </p>
                  </div>
                </div>
              </div>

              <Button fullWidth onClick={openTelegram}>
                <ExternalLink size={14} /> Open Telegram Support
              </Button>

              <p className="text-center text-[10px] leading-relaxed text-gray-600">
                If Telegram does not open automatically, search for {settings.telegramDisplay} in Telegram.
              </p>
            </>
          ) : (
            <div className="flex gap-2.5 rounded-xl border border-yellow-500/[0.12] bg-yellow-500/[0.04] p-3">
              <Info size={15} className="mt-0.5 shrink-0 text-yellow-400" />
              <div>
                <p className="text-xs font-semibold text-gray-200">Support contact unavailable</p>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
                  Telegram support is not configured yet. Please check back later.
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card padding="sm">
        <SectionHeader
          title="Security Reminder"
          description="Use only the official support channel shown on this page."
          className="mb-3"
          action={<ShieldCheck size={15} className="text-[#00ff41]" />}
        />

        <div className="space-y-2">
          <SupportNote icon={<MessageSquare size={13} />}>
            QHash support will never ask for your password or private wallet credentials.
          </SupportNote>
          <SupportNote icon={<CheckCircle2 size={13} />}>
            Confirm the Telegram username before sharing account details.
          </SupportNote>
        </div>
      </Card>
    </div>
  );
}

function SupportNote({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2.5">
      <span className="mt-0.5 text-[#00ff41]">{icon}</span>
      <p className="text-[11px] leading-relaxed text-gray-500">{children}</p>
    </div>
  );
}

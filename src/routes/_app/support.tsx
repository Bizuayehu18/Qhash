import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ExternalLink, HeadphonesIcon, Info, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button.js";
import { Spinner } from "@/components/ui/Spinner.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import {
  getSupportSettingsFn,
  type SupportSettings,
} from "@/lib/server/support-settings.js";

export const Route = createFileRoute("/_app/support")({
  component: SupportPage,
});

function SupportPage() {
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSettings = () => {
    setLoading(true);

    (async () => {
      try {
        const result = await getSupportSettingsFn({ data: {} });
        setSettings(result);
      } catch (err) {
        toast.error(getSafeErrorMessage(err, "SUPPORT").message);
      } finally {
        setLoading(false);
      }
    })();
  };

  useEffect(() => { loadSettings(); }, []);

  const openTelegram = () => {
    if (!settings?.telegramUrl) return;
    window.open(settings.telegramUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Support</h1>
        <p className="text-xs text-gray-500 mt-1">Get help from the official QHash support team</p>
      </div>

      <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-4">
        <div className="flex items-center gap-2">
          <HeadphonesIcon size={14} className="text-[#00ff41]" />
          <span className="text-xs font-semibold">Telegram Support</span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Spinner size="sm" /> Loading support contact...
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

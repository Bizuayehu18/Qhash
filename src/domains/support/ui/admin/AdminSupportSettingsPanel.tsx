import { ExternalLink, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { Spinner } from "@/components/ui/Spinner.js";
import { useAdminSupportSettings } from "./useAdminSupportSettings.js";

type AdminSupportSettingsPanelProps = Readonly<{
  accessToken: string | null | undefined;
  userId: string | null | undefined;
}>;

export function AdminSupportSettingsPanel({
  accessToken,
  userId,
}: AdminSupportSettingsPanelProps) {
  const {
    loading,
    save,
    saving,
    settings,
    setTelegramUsername,
    telegramUsername,
  } = useAdminSupportSettings(userId, accessToken);

  const openCurrentSupport = () => {
    if (!settings?.telegramUrl) return;
    window.open(settings.telegramUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-[#00ff41]" />
          <span className="text-xs font-semibold">Support Settings</span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Spinner size="sm" /> Loading support settings...
          </div>
        ) : (
          <>
            <Input
              label="Telegram Support Username"
              placeholder="QHashSupport"
              value={telegramUsername}
              onChange={(event) => setTelegramUsername(event.target.value)}
              hint="Letters, numbers, and underscores only. @ is optional. Do not paste a full link."
            />

            {settings?.isConfigured && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-[#0d0d0d] border border-[#1a1a1a] p-3">
                <div className="min-w-0">
                  <p className="text-[10px] text-gray-500">Current public support contact</p>
                  <p className="text-xs text-[#00ff41] font-mono truncate">{settings.telegramDisplay}</p>
                </div>
                <button
                  onClick={openCurrentSupport}
                  className="shrink-0 p-2 rounded-lg text-gray-500 hover:text-[#00ff41] transition-colors card-press"
                  title="Open current Telegram support"
                >
                  <ExternalLink size={14} />
                </button>
              </div>
            )}

            <Button size="sm" loading={saving} onClick={() => void save()}>
              Save Support Username
            </Button>
          </>
        )}
      </div>

      <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-4 text-[11px] text-gray-500 leading-relaxed space-y-2">
        <p>Support v1 uses Telegram only. Internal support tickets are not active.</p>
        <p>The public Support page builds the link as t.me/username from this setting.</p>
      </div>
    </>
  );
}

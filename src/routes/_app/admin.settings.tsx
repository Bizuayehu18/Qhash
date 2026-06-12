import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ExternalLink, MessageSquare, Settings, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { Spinner } from "@/components/ui/Spinner.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { supabase } from "@/lib/supabase.js";
import {
  getSupportSettingsFn,
  updateSupportTelegramUsernameFn,
  type SupportSettings,
} from "@/lib/server/support-settings.js";
import { useAuthStore } from "@/store/authStore.js";

export const Route = createFileRoute("/_app/admin/settings")({
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [telegramUsername, setTelegramUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile && !profile.is_admin) navigate({ to: "/dashboard" });
  }, [profile, navigate]);

  const loadSettings = () => {
    if (!user?.id || !profile?.is_admin) return;

    setLoading(true);

    (async () => {
      try {
        const result = await getSupportSettingsFn({ data: {} });
        setSettings(result);
        setTelegramUsername(result.telegramUsername ?? "");
      } catch (err) {
        toast.error(getSafeErrorMessage(err, "SUPPORT").message);
      } finally {
        setLoading(false);
      }
    })();
  };

  useEffect(() => { loadSettings(); }, [user?.id, profile?.is_admin]);

  if (!profile?.is_admin) return null;

  const saveSupportUsername = async () => {
    if (!user?.id || saving) return;

    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        toast.error("Session expired. Please sign in again.");
        setSaving(false);
        return;
      }

      const updated = await updateSupportTelegramUsernameFn({
        data: {
          accessToken,
          telegramUsername,
        },
      });

      setSettings(updated);
      setTelegramUsername(updated.telegramUsername ?? "");
      toast.success("Support Telegram username updated.");
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "SUPPORT").message);
    } finally {
      setSaving(false);
    }
  };

  const openCurrentSupport = () => {
    if (!settings?.telegramUrl) return;
    window.open(settings.telegramUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ShieldCheck size={18} className="text-[#00ff41]" />
        <div>
          <h1 className="text-lg font-bold">Admin Settings</h1>
          <p className="text-[11px] text-gray-500">Platform configuration</p>
        </div>
        <Badge variant="neon" className="ml-auto">Admin</Badge>
      </div>

      <div className="flex items-center gap-2">
        <Settings size={14} className="text-gray-500" />
        <p className="text-[11px] text-gray-500">Manage app-level settings</p>
      </div>

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
              onChange={(e) => setTelegramUsername(e.target.value)}
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

            <Button size="sm" loading={saving} onClick={saveSupportUsername}>
              Save Support Username
            </Button>
          </>
        )}
      </div>

      <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-4 text-[11px] text-gray-500 leading-relaxed space-y-2">
        <p>Support v1 uses Telegram only. Internal support tickets are not active.</p>
        <p>The public Support page builds the link as t.me/username from this setting.</p>
      </div>
    </div>
  );
}

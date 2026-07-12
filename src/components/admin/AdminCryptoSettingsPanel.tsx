import { useCallback, useEffect, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { Spinner } from "@/components/ui/Spinner.js";
import { AdminCryptoAddressInventoryPanel } from "@/components/admin/AdminCryptoAddressInventoryPanel.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { supabase } from "@/lib/supabase.js";
import { withTimeout } from "@/lib/async.js";
import {
  getAdminCryptoSettingsFn,
  updateAdminCryptoSettingsFn,
  type AdminCryptoSettings,
} from "@/lib/server/crypto-admin-settings.js";
import { useAuthStore } from "@/store/authStore.js";

const ADMIN_CRYPTO_SETTINGS_TIMEOUT_MS = 10_000;
const ADMIN_CRYPTO_SETTINGS_RETRY_DELAY_MS = 1_500;
const ADMIN_CRYPTO_SETTINGS_MAX_RETRIES = 2;

function formatSettingValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildFormState(settings: AdminCryptoSettings) {
  return {
    usdtEtbRate: formatSettingValue(settings.usdtEtbRate),
    tronMinUsdt: formatSettingValue(settings.tronMinUsdt),
    bscMinUsdt: formatSettingValue(settings.bscMinUsdt),
  };
}

export function AdminCryptoSettingsPanel({ userId }: { userId: string | undefined }) {
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const [settings, setSettings] = useState<AdminCryptoSettings | null>(null);
  const [usdtEtbRate, setUsdtEtbRate] = useState("160");
  const [tronMinUsdt, setTronMinUsdt] = useState("10");
  const [bscMinUsdt, setBscMinUsdt] = useState("5");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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

      if (retryCountRef.current >= ADMIN_CRYPTO_SETTINGS_MAX_RETRIES) return;

      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(loadFn, ADMIN_CRYPTO_SETTINGS_RETRY_DELAY_MS);
    },
    [clearRetryTimer],
  );

  const applySettings = useCallback((nextSettings: AdminCryptoSettings) => {
    const formState = buildFormState(nextSettings);
    setSettings(nextSettings);
    setUsdtEtbRate(formState.usdtEtbRate);
    setTronMinUsdt(formState.tronMinUsdt);
    setBscMinUsdt(formState.bscMinUsdt);
  }, []);

  const loadSettings = useCallback(
    async (options?: { resetRetryCount?: boolean; resetLoaded?: boolean }) => {
      if (loadingRef.current) return;

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (options?.resetLoaded) {
        setLoaded(false);
      }

      if (!userId) return;

      if (!accessToken) {
        scheduleRetry(() => {
          void loadSettings();
        });
        return;
      }

      clearRetryTimer();
      loadingRef.current = true;
      setRefreshing(true);

      try {
        const result = await withTimeout(
          getAdminCryptoSettingsFn({
            data: {
              accessToken,
            },
          }),
          ADMIN_CRYPTO_SETTINGS_TIMEOUT_MS,
          "Admin crypto settings request timed out.",
        );

        if (!mountedRef.current) return;

        applySettings(result);
        setLoaded(true);
        retryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Admin crypto settings background refresh failed:", err);

        if (!mountedRef.current) return;

        scheduleRetry(() => {
          void loadSettings();
        });
      } finally {
        loadingRef.current = false;
        if (mountedRef.current) {
          setRefreshing(false);
        }
      }
    },
    [accessToken, applySettings, clearRetryTimer, scheduleRetry, userId],
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

  const handleResetForm = () => {
    if (!settings) return;
    applySettings(settings);
  };

  const handleSave = async () => {
    if (!userId || saving) return;

    const parsedRate = parsePositiveNumber(usdtEtbRate.trim());
    const parsedTronMin = parsePositiveNumber(tronMinUsdt.trim());
    const parsedBscMin = parsePositiveNumber(bscMinUsdt.trim());

    if (!parsedRate || parsedRate < 1 || parsedRate > 1_000_000) {
      toast.error("USDT/ETB rate must be between 1 and 1,000,000.");
      return;
    }

    if (!parsedTronMin || parsedTronMin < 0.01 || parsedTronMin > 1_000_000) {
      toast.error("TRON minimum must be between 0.01 and 1,000,000 USDT.");
      return;
    }

    if (!parsedBscMin || parsedBscMin < 0.01 || parsedBscMin > 1_000_000) {
      toast.error("BSC minimum must be between 0.01 and 1,000,000 USDT.");
      return;
    }

    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      if (!token) {
        toast.error("Session expired. Please sign in again.");
        return;
      }

      const updated = await updateAdminCryptoSettingsFn({
        data: {
          accessToken: token,
          usdtEtbRate: parsedRate,
          tronMinUsdt: parsedTronMin,
          bscMinUsdt: parsedBscMin,
        },
      });

      applySettings(updated);
      setLoaded(true);
      toast.success("Crypto settings updated.");
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "ADMIN").message);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    settings !== null &&
    (usdtEtbRate.trim() !== formatSettingValue(settings.usdtEtbRate) ||
      tronMinUsdt.trim() !== formatSettingValue(settings.tronMinUsdt) ||
      bscMinUsdt.trim() !== formatSettingValue(settings.bscMinUsdt));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-[11px] leading-relaxed text-amber-200/80">
        <div className="mb-1 flex items-center gap-2">
          <Settings size={13} className="text-amber-300" />
          <span className="text-xs font-semibold text-amber-100">Crypto deposits are still guarded</span>
        </div>
        <p>
          This panel only manages display-rate and minimum-deposit values. It does not enable crypto deposits,
          expose deposit addresses, generate addresses, run watchers, credit wallets, or handle private keys.
        </p>
      </div>

      <div className="rounded-xl border border-[rgba(0,255,65,0.15)] bg-[#111] p-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Settings size={14} className="text-[#00ff41]" />
              <span className="text-xs font-semibold">Crypto Settings</span>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">Admin-only numeric settings for the read-only crypto deposit UI.</p>
          </div>
          <Badge variant={loaded ? "success" : "default"}>{loaded ? "Loaded" : "Loading"}</Badge>
        </div>

        {!loaded ? (
          <div className="flex items-center gap-2 rounded-lg border border-[#1a1a1a] bg-[#0d0d0d] p-3 text-xs text-gray-500">
            <Spinner size="sm" /> Loading crypto settings...
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="USDT/ETB Rate"
                type="number"
                min="1"
                step="0.01"
                inputMode="decimal"
                value={usdtEtbRate}
                onChange={(e) => setUsdtEtbRate(e.target.value)}
                hint="Used for crypto deposit display and future crediting calculations."
              />
              <Input
                label="TRON Minimum USDT"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={tronMinUsdt}
                onChange={(e) => setTronMinUsdt(e.target.value)}
                hint="Minimum displayed for TRC20 deposits."
              />
              <Input
                label="BSC Minimum USDT"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={bscMinUsdt}
                onChange={(e) => setBscMinUsdt(e.target.value)}
                hint="Minimum displayed for BEP20 deposits."
              />
            </div>

            <div className="rounded-lg border border-[#1a1a1a] bg-[#0d0d0d] p-3 text-[11px] leading-relaxed text-gray-500">
              The address-exposure control is intentionally not included here. Keep it disabled until watcher,
              idempotent crediting, audit trail, and manual review behavior are implemented and reviewed.
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={saving} disabled={!hasChanges} onClick={handleSave}>
                Save Crypto Settings
              </Button>
              <Button size="sm" variant="outline" disabled={!hasChanges || saving} onClick={handleResetForm}>
                Reset Changes
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={refreshing && !saving}
                disabled={saving}
                onClick={() => void loadSettings({ resetRetryCount: true })}
              >
                Refresh
              </Button>
            </div>
          </>
        )}
      </div>

      <AdminCryptoAddressInventoryPanel userId={userId} />
    </div>
  );
}

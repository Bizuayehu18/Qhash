import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import {
  User, LogOut, Receipt, HeadphonesIcon, ShieldCheck,
  ChevronRight, Bell, Wallet,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AmountText } from "@/components/ui/AmountText.js";
import { Badge } from "@/components/ui/Badge.js";
import { ListPanel } from "@/components/ui/ListPanel.js";
import { ListRow } from "@/components/ui/ListRow.js";
import { getDisplayPhone, getDisplayUsername } from "@/lib/profileDisplay.js";
import { getSupportSettingsFn } from "@/lib/server/support-settings.js";
import { withTimeout } from "@/lib/async.js";

export const Route = createFileRoute("/_app/profile")({
  component: ProfilePage,
});

const SUPPORT_SETTINGS_LOAD_TIMEOUT_MS = 10_000;

function ProfilePage() {
  const { profile, user, signOut } = useAuthStore();
  const walletBalance = useWalletStore((s) => s.balance);
  const fetchWallet = useWalletStore((s) => s.fetchWallet);
  const [supportUrl, setSupportUrl] = useState<string | null>(null);
  const [supportOpening, setSupportOpening] = useState(false);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isProfileIndex = pathname === "/profile";
  const displayUsername = getDisplayUsername(profile, user);
  const displayPhone = getDisplayPhone(profile, user);

  const refreshWallet = useCallback(() => {
    if (!isProfileIndex || !user?.id) return;
    void fetchWallet(user.id);
  }, [fetchWallet, isProfileIndex, user?.id]);

  const loadSupportUrl = useCallback(async () => {
    try {
      const result = await withTimeout(
        getSupportSettingsFn({ data: {} }),
        SUPPORT_SETTINGS_LOAD_TIMEOUT_MS,
        "Support settings request timed out.",
      );
      const url = result.isConfigured ? result.telegramUrl : null;
      setSupportUrl(url);
      return url;
    } catch (err) {
      console.error("[QHash] Support settings preload failed:", err);
      return null;
    }
  }, []);

  const handleOpenSupport = useCallback(async () => {
    if (supportOpening) return;

    if (supportUrl) {
      window.location.assign(supportUrl);
      return;
    }

    setSupportOpening(true);
    const url = await loadSupportUrl();

    if (url) {
      setSupportOpening(false);
      window.location.assign(url);
      return;
    }

    setSupportOpening(false);
    window.location.assign("/support");
  }, [loadSupportUrl, supportOpening, supportUrl]);

  useEffect(() => {
    if (isProfileIndex && user?.id && walletBalance === null) {
      refreshWallet();
    }
  }, [isProfileIndex, refreshWallet, user?.id, walletBalance]);

  useEffect(() => {
    if (!isProfileIndex) return;
    void loadSupportUrl();
  }, [isProfileIndex, loadSupportUrl]);

  useEffect(() => {
    if (!isProfileIndex) return;

    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        refreshWallet();
        void loadSupportUrl();
      }
    };

    const handleOnline = () => {
      refreshWallet();
      void loadSupportUrl();
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [isProfileIndex, loadSupportUrl, refreshWallet]);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login", replace: true });
  };

  if (!isProfileIndex) {
    return <Outlet />;
  }

  const menuItems = [
    { to: "/transactions", label: "Transactions", icon: Receipt },
    { to: "/notifications", label: "Notifications", icon: Bell },
    { to: "/withdraw", label: "Withdraw", icon: Wallet },
    { to: "/profile/security", label: "Security", icon: ShieldCheck },
  ];

  const adminMenuItems = profile?.is_admin
    ? [{ to: "/admin", label: "Admin Panel", icon: ShieldCheck }]
    : [];

  return (
    <div className="space-y-3 lg:mx-auto lg:grid lg:max-w-4xl lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0">
      <div className="lg:col-span-12">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
          Account Center
        </p>
        <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">Profile</h1>
      </div>

      <div className="rounded-2xl border border-[#1a1a1a] bg-[#111] p-4 lg:col-span-4 lg:p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-[rgba(0,255,65,0.25)] bg-[rgba(0,255,65,0.1)]">
            <User size={22} className="text-[#00ff41]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-bold leading-tight text-gray-100">
                @{displayUsername}
              </h2>
              {profile?.is_admin && <Badge variant="neon">Admin</Badge>}
            </div>
            <p className="mt-1 min-h-[16px] truncate text-xs text-gray-500">
              {displayPhone}
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-[11px] text-gray-500">Wallet Balance</span>
            <Wallet size={14} className="text-[#00ff41]" />
          </div>
          {walletBalance === null ? (
            <span className="skeleton inline-block h-5 w-28 rounded" aria-label="Loading wallet balance" />
          ) : (
            <AmountText value={walletBalance} tone="positive" size="lg" />
          )}
        </div>
      </div>

      <div className="lg:col-span-8">
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
          Account
        </h2>
        <ListPanel>
          {menuItems.map((item) => {
            const Icon = item.icon;

            return (
              <Link key={item.to} to={item.to} className="block card-press">
                <ListRow
                  className="py-2.5"
                  icon={<Icon size={16} className="text-gray-400" />}
                  title={item.label}
                  right={<ChevronRight size={14} className="text-gray-700" />}
                />
              </Link>
            );
          })}

          {supportUrl ? (
            <a href={supportUrl} className="block card-press">
              <ListRow
                className="py-2.5"
                icon={<HeadphonesIcon size={16} className="text-gray-400" />}
                title="Support"
                right={<ChevronRight size={14} className="text-gray-700" />}
              />
            </a>
          ) : (
            <button
              type="button"
              onClick={handleOpenSupport}
              disabled={supportOpening}
              className="block w-full cursor-pointer border-0 bg-transparent p-0 text-left card-press disabled:cursor-wait disabled:opacity-70"
            >
              <ListRow
                className="py-2.5"
                icon={<HeadphonesIcon size={16} className="text-gray-400" />}
                title={supportOpening ? "Opening Support" : "Support"}
                right={<ChevronRight size={14} className="text-gray-700" />}
              />
            </button>
          )}

          {adminMenuItems.map((item) => {
            const Icon = item.icon;

            return (
              <Link key={item.to} to={item.to} className="block card-press">
                <ListRow
                  className="py-2.5"
                  icon={<Icon size={16} className="text-gray-400" />}
                  title={item.label}
                  right={<ChevronRight size={14} className="text-gray-700" />}
                />
              </Link>
            );
          })}
        </ListPanel>
      </div>

      <button
        onClick={handleSignOut}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#1a1a1a] bg-[#111] py-3 text-sm font-medium text-red-400 card-press lg:col-span-12"
      >
        <LogOut size={16} />
        Sign Out
      </button>

      <p className="pb-4 text-center text-[10px] text-gray-700 lg:col-span-12">
        QHash v1.0 — Cloud Mining Platform
      </p>
    </div>
  );
}

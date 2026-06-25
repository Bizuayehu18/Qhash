import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import {
  User, LogOut, Receipt, HeadphonesIcon, ShieldCheck,
  ChevronRight, Bell, Wallet,
} from "lucide-react";
import { useCallback, useEffect } from "react";
import { AmountText } from "@/components/ui/AmountText.js";
import { Badge } from "@/components/ui/Badge.js";
import { ListPanel } from "@/components/ui/ListPanel.js";
import { ListRow } from "@/components/ui/ListRow.js";
import { PageHeader } from "@/components/ui/PageHeader.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";

export const Route = createFileRoute("/_app/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { profile, user, signOut } = useAuthStore();
  const walletBalance = useWalletStore((s) => s.balance);
  const fetchWallet = useWalletStore((s) => s.fetchWallet);
  const navigate = useNavigate();

  const refreshWallet = useCallback(() => {
    if (!user?.id) return;
    void fetchWallet(user.id);
  }, [fetchWallet, user?.id]);

  useEffect(() => {
    if (user?.id && walletBalance === null) {
      refreshWallet();
    }
  }, [refreshWallet, user?.id, walletBalance]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        refreshWallet();
      }
    };

    const handleOnline = () => {
      refreshWallet();
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [refreshWallet]);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login", replace: true });
  };

  const menuItems = [
    { to: "/transactions", label: "Transactions", icon: Receipt, desc: "View all activity" },
    { to: "/notifications", label: "Notifications", icon: Bell, desc: "Alerts & updates" },
    { to: "/withdraw", label: "Withdraw", icon: Wallet, desc: "Cash out earnings" },
    { to: "/security", label: "Security", icon: ShieldCheck, desc: "Passwords & fund PIN" },
    { to: "/support", label: "Support", icon: HeadphonesIcon, desc: "Get help" },
    ...(profile?.is_admin
      ? [{ to: "/admin", label: "Admin Panel", icon: ShieldCheck, desc: "Manage platform" }]
      : []),
  ];

  return (
    <div className="space-y-4 lg:mx-auto lg:grid lg:max-w-4xl lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0">
      <PageHeader
        title="Profile"
        description="Manage your account, wallet, and platform settings"
        icon={<User size={18} />}
        badge={profile?.is_admin ? <Badge variant="neon">Admin</Badge> : undefined}
        className="lg:col-span-12"
      />

      {/* Profile card */}
      <div className="rounded-2xl border border-[#1a1a1a] bg-[#111] p-4 text-center lg:col-span-4 lg:p-5">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border-2 border-[rgba(0,255,65,0.25)] bg-[rgba(0,255,65,0.1)]">
          <User size={28} className="text-[#00ff41]" />
        </div>
        <h2 className="text-base font-bold leading-tight">@{profile?.username ?? "User"}</h2>
        <p className="mt-0.5 min-h-[16px] text-xs text-gray-500">{profile?.phone ?? ""}</p>

        <div className="mt-4 rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] p-3 text-left">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-xs text-gray-500">Wallet Balance</span>
            <Wallet size={14} className="text-[#00ff41]" />
          </div>
          {walletBalance === null ? (
            <span className="skeleton inline-block h-4 w-24 rounded" aria-label="Loading wallet balance" />
          ) : (
            <AmountText value={walletBalance} tone="positive" size="lg" />
          )}
        </div>
      </div>

      {/* Menu items */}
      <div className="lg:col-span-8">
        <SectionHeader title="Account" description="Quick access to your activity and settings" className="mb-3" />
        <ListPanel>
          {menuItems.map((item) => (
            <Link key={item.to} to={item.to} className="block card-press">
              <ListRow
                icon={<item.icon size={16} className="text-gray-400" />}
                title={item.label}
                description={item.desc}
                right={
                  <div className="flex items-center gap-2">
                    {"soon" in item && item.soon && (
                      <span className="rounded-full border border-[rgba(0,255,65,0.2)] bg-[rgba(0,255,65,0.1)] px-2 py-0.5 text-[9px] font-semibold text-[#00ff41]">
                        Soon
                      </span>
                    )}
                    <ChevronRight size={14} className="text-gray-700" />
                  </div>
                }
              />
            </Link>
          ))}
        </ListPanel>
      </div>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#1a1a1a] bg-[#111] py-3.5 text-sm font-medium text-red-400 card-press lg:col-span-12"
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

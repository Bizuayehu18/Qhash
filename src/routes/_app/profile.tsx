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
    { to: "/transactions", label: "Transactions", icon: Receipt },
    { to: "/notifications", label: "Notifications", icon: Bell },
    { to: "/withdraw", label: "Withdraw", icon: Wallet },
    { to: "/security", label: "Security", icon: ShieldCheck },
    { to: "/support", label: "Support", icon: HeadphonesIcon },
    ...(profile?.is_admin
      ? [{ to: "/admin", label: "Admin Panel", icon: ShieldCheck }]
      : []),
  ];

  return (
    <div className="space-y-3 lg:mx-auto lg:grid lg:max-w-4xl lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0">
      <div className="lg:col-span-12">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
          Account Center
        </p>
        <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">Profile</h1>
      </div>

      {/* Profile summary */}
      <div className="rounded-2xl border border-[#1a1a1a] bg-[#111] p-4 lg:col-span-4 lg:p-5">
        <div className="flex items-start gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-[rgba(0,255,65,0.25)] bg-[rgba(0,255,65,0.1)]">
            <User size={22} className="text-[#00ff41]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-bold leading-tight text-gray-100">
                @{profile?.username ?? "User"}
              </h2>
              {profile?.is_admin && <Badge variant="neon">Admin</Badge>}
            </div>
            <p className="mt-1 min-h-[16px] truncate text-xs text-gray-500">
              {profile?.phone ?? ""}
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

      {/* Menu items */}
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
        </ListPanel>
      </div>

      {/* Sign out */}
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

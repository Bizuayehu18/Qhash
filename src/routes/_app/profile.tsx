import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import {
  User, LogOut, Receipt, HeadphonesIcon, ShieldCheck,
  ChevronRight, Bell, Wallet,
} from "lucide-react";
import { Spinner } from "@/components/ui/Spinner.js";
import { useEffect } from "react";

export const Route = createFileRoute("/_app/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { profile, user, signOut } = useAuthStore();
  const walletBalance = useWalletStore((s) => s.balance);
  const loadingBalance = useWalletStore((s) => s.loading);
  const fetchWallet = useWalletStore((s) => s.fetchWallet);
  const navigate = useNavigate();

  useEffect(() => {
    if (user?.id && walletBalance === null) {
      fetchWallet(user.id);
    }
  }, [user?.id, walletBalance, fetchWallet]);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login", replace: true });
  };

  const menuItems = [
    { to: "/transactions", label: "Transactions", icon: Receipt, desc: "View all activity" },
    { to: "/notifications", label: "Notifications", icon: Bell, desc: "Alerts & updates" },
    { to: "/withdraw", label: "Withdraw", icon: Wallet, desc: "Cash out earnings", soon: true },
    { to: "/support", label: "Support", icon: HeadphonesIcon, desc: "Get help", soon: true },
    ...(profile?.is_admin
      ? [{ to: "/admin", label: "Admin Panel", icon: ShieldCheck, desc: "Manage platform" }]
      : []),
  ];

  return (
    <div className="space-y-5">
      {/* Profile card */}
      <div className="bg-[#111] rounded-2xl border border-[#1a1a1a] p-5 text-center">
        <div className="h-16 w-16 rounded-full bg-[rgba(0,255,65,0.1)] border-2 border-[rgba(0,255,65,0.25)] flex items-center justify-center mx-auto mb-3">
          <User size={28} className="text-[#00ff41]" />
        </div>
        <h2 className="text-base font-bold">@{profile?.username ?? "User"}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{profile?.phone ?? ""}</p>

        <div className="mt-4 bg-[#0a0a0a] rounded-xl p-3 flex items-center justify-between">
          <span className="text-xs text-gray-500">Wallet Balance</span>
          {loadingBalance ? (
            <Spinner size="sm" />
          ) : (
            <span className="text-sm font-bold text-[#00ff41]">
              {walletBalance?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "0.00"} ETB
            </span>
          )}
        </div>
      </div>

      {/* Menu items */}
      <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
        {menuItems.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="flex items-center gap-3 px-4 py-3.5 card-press"
          >
            <div className="h-9 w-9 rounded-xl bg-white/[0.04] flex items-center justify-center">
              <item.icon size={16} className="text-gray-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-200">{item.label}</p>
              <p className="text-[10px] text-gray-600">{item.desc}</p>
            </div>
            {item.soon && (
              <span className="text-[9px] font-semibold text-[#00ff41] bg-[rgba(0,255,65,0.1)] border border-[rgba(0,255,65,0.2)] rounded-full px-2 py-0.5">
                Soon
              </span>
            )}
            <ChevronRight size={14} className="text-gray-700" />
          </Link>
        ))}
      </div>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="w-full flex items-center justify-center gap-2 bg-[#111] border border-[#1a1a1a] rounded-xl py-3.5 text-red-400 text-sm font-medium card-press"
      >
        <LogOut size={16} />
        Sign Out
      </button>

      <p className="text-center text-[10px] text-gray-700 pb-4">
        QHash v1.0 — Cloud Mining Platform
      </p>
    </div>
  );
}

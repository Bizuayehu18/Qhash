import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, KeyRound, ShieldCheck, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { ListPanel } from "@/components/ui/ListPanel.js";
import { ListRow } from "@/components/ui/ListRow.js";
import { Spinner } from "@/components/ui/Spinner.js";
import { withTimeout } from "@/lib/async.js";
import {
  getSecurityStatusFn,
  type SecurityStatus,
} from "@/lib/server/security.js";
import { useAuthStore } from "@/store/authStore.js";

export const Route = createFileRoute("/_app/profile/security")({
  component: AccountSecurityPage,
});

const SECURITY_STATUS_TIMEOUT_MS = 10_000;

const EMPTY_SECURITY_STATUS: SecurityStatus = {
  hasFundPassword: false,
  fundPasswordLockedUntil: null,
  fundPasswordFailedAttempts: 0,
  isFundPasswordLocked: false,
};

function AccountSecurityPage() {
  const { user } = useAuthStore();
  const accessToken = useAuthStore((state) => state.session?.access_token ?? null);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isSecurityIndex = pathname === "/profile/security";
  const [status, setStatus] = useState<SecurityStatus>(EMPTY_SECURITY_STATUS);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const loadSecurityStatus = useCallback(async () => {
    if (!isSecurityIndex) return;

    if (!user?.id || !accessToken) {
      setStatus(EMPTY_SECURITY_STATUS);
      setLoadingStatus(false);
      return;
    }

    setLoadingStatus(true);

    try {
      const result = await withTimeout(
        getSecurityStatusFn({ data: { accessToken } }),
        SECURITY_STATUS_TIMEOUT_MS,
        "Security status request timed out.",
      );
      setStatus(result);
    } catch (err) {
      console.error("[QHash] Security status load failed:", err);
      setStatus(EMPTY_SECURITY_STATUS);
    } finally {
      setLoadingStatus(false);
    }
  }, [accessToken, isSecurityIndex, user?.id]);

  useEffect(() => {
    void loadSecurityStatus();
  }, [loadSecurityStatus]);

  useEffect(() => {
    if (!isSecurityIndex) return;

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void loadSecurityStatus();
      }
    };

    const refreshWhenOnline = () => {
      void loadSecurityStatus();
    };

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("online", refreshWhenOnline);

    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenOnline);
    };
  }, [isSecurityIndex, loadSecurityStatus]);

  const fundStatus = useMemo(() => {
    if (status.isFundPasswordLocked) {
      return { label: "Locked", variant: "warning" as const };
    }

    if (status.hasFundPassword) {
      return { label: "Set", variant: "success" as const };
    }

    return { label: "Not set", variant: "default" as const };
  }, [status.hasFundPassword, status.isFundPasswordLocked]);

  if (!isSecurityIndex) {
    return <Outlet />;
  }

  return (
    <div className="space-y-3 lg:mx-auto lg:max-w-3xl">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/profile" })}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.06] bg-[#111] text-gray-300 card-press"
          aria-label="Back to profile"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
            Account Security
          </p>
          <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">Security</h1>
        </div>
      </div>

      <div className="rounded-2xl border border-[#1a1a1a] bg-[#111] p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[rgba(0,255,65,0.25)] bg-[rgba(0,255,65,0.1)]">
            <ShieldCheck size={20} className="text-[#00ff41]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold leading-tight text-gray-100">Protected account</h2>
              <Badge variant="neon">Protected</Badge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              Manage your sign-in password and withdrawal fund password.
            </p>
          </div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
          Passwords
        </h2>
        <ListPanel>
          <Link to="/profile/security/login-password" className="block card-press">
            <ListRow
              className="py-3"
              icon={<KeyRound size={16} className="text-[#00ff41]" />}
              title="Login Password"
              description="Update your account sign-in password"
              right={
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-gray-500">Update</span>
                  <ChevronRight size={14} className="text-gray-700" />
                </div>
              }
            />
          </Link>

          <Link to="/profile/security/fund-password" className="block card-press">
            <ListRow
              className="py-3"
              icon={<Wallet size={16} className="text-[#00ff41]" />}
              title="Fund Password"
              description="Required for withdrawal security"
              right={
                <div className="flex items-center gap-2">
                  {loadingStatus ? <Spinner size="sm" /> : <Badge variant={fundStatus.variant}>{fundStatus.label}</Badge>}
                  <ChevronRight size={14} className="text-gray-700" />
                </div>
              }
            />
          </Link>
        </ListPanel>
      </div>
    </div>
  );
}

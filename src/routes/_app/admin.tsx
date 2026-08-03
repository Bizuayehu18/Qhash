import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import {
  ShieldCheck,
  Settings,
  Copy,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { useAuthStore } from "@/store/authStore.js";
import { supabase } from "@/lib/supabase.js";
import { withTimeout } from "@/lib/async.js";
import { NowpaymentsUsdtWithdrawalAdmin } from "@/components/admin/NowpaymentsUsdtWithdrawalAdmin.js";
import { AdminOverviewPanel } from "@/domains/admin/public.js";
import {
  AdminFiatDepositOperationsPanel,
  AdminFiatPaymentMethodsPanel,
  DepositVerificationAuditPanel,
} from "@/domains/fiat-deposits/public.js";
import { AdminSupportSettingsPanel } from "@/domains/support/public.js";
import { AdminFiatWithdrawalOperationsPanel } from "@/domains/fiat-withdrawals/public.js";
import {
  getAdminSecurityUsersFn,
  resetUserFundPasswordFn,
  resetUserLoginPasswordFn,
} from "@/lib/server/admin-security-resets.js";

export const Route = createFileRoute("/_app/admin")({
  component: AdminPage,
});

type AdminSecurityUser = Awaited<ReturnType<typeof getAdminSecurityUsersFn>>[number];

const ADMIN_TAB_LOAD_TIMEOUT_MS = 10_000;
const ADMIN_AUTO_RETRY_DELAY_MS = 1_500;
const ADMIN_MAX_AUTO_RETRIES = 2;

function AdminPage() {
  const { user, profile, session } = useAuthStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<
    "overview" | "deposits" | "withdrawals" | "usdt-withdrawals" | "audit" | "security" | "settings"
  >("overview");

  useEffect(() => {
    if (profile && !profile.is_admin) navigate({ to: "/dashboard" });
  }, [profile, navigate]);

  if (!profile?.is_admin) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ShieldCheck size={18} className="text-[#00ff41]" />
        <div>
          <h1 className="text-lg font-bold">Admin</h1>
          <p className="text-[11px] text-gray-500">Platform management</p>
        </div>
        <Badge variant="neon" className="ml-auto">Admin</Badge>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {([
          { key: "overview", label: "Overview" },
          { key: "deposits", label: "Deposits" },
          { key: "withdrawals", label: "ETB Withdrawals" },
          { key: "usdt-withdrawals", label: "USDT Withdrawals" },
          { key: "audit", label: "Verification Audit" },
          { key: "security", label: "Security" },
          { key: "settings", label: "Settings" },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 px-3 py-1.5 text-[11px] rounded-full border transition-colors card-press ${
              activeTab === tab.key
                ? "border-[rgba(0,255,65,0.3)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
                : "border-[#1f1f1f] text-gray-500"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <AdminOverviewPanel
          accessToken={session?.access_token ?? null}
          userId={user?.id}
        />
      )}
      {activeTab === "deposits" && (
        <AdminFiatDepositOperationsPanel
          accessToken={session?.access_token ?? null}
          userId={user?.id}
        />
      )}
      {activeTab === "withdrawals" && (
        <AdminFiatWithdrawalOperationsPanel
          accessToken={session?.access_token ?? null}
          userId={user?.id}
        />
      )}
      {activeTab === "usdt-withdrawals" && (
        <NowpaymentsUsdtWithdrawalAdmin
          accessToken={session?.access_token ?? null}
          userId={user?.id}
        />
      )}
      {activeTab === "audit" && (
        <DepositVerificationAuditPanel
          accessToken={session?.access_token ?? null}
          userId={user?.id}
        />
      )}
      {activeTab === "security" && <AdminSecurityTab userId={user?.id} />}
      {activeTab === "settings" && (
        <SettingsTab
          accessToken={session?.access_token ?? null}
          userId={user?.id}
        />
      )}
    </div>
  );
}

function AdminSecurityTab({ userId }: { userId: string | undefined }) {
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const [users, setUsers] = useState<AdminSecurityUser[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [securityUsersRefreshing, setSecurityUsersRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<AdminSecurityUser | null>(null);
  const [resetReason, setResetReason] = useState("");
  const [temporaryLoginPassword, setTemporaryLoginPassword] = useState("");
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [resettingLoginUserId, setResettingLoginUserId] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const selectedUserRef = useRef<AdminSecurityUser | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback(
    (loadFn: () => void) => {
      clearRetryTimer();

      if (retryCountRef.current >= ADMIN_MAX_AUTO_RETRIES) return;

      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(loadFn, ADMIN_AUTO_RETRY_DELAY_MS);
    },
    [clearRetryTimer],
  );

  const loadUsers = useCallback(
    async (options?: { resetRetryCount?: boolean; resetLoaded?: boolean }) => {
      if (loadingRef.current) return;

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (options?.resetLoaded) {
        setUsersLoaded(false);
        setUsers([]);
      }

      if (!userId) return;

      if (!accessToken) {
        scheduleRetry(() => {
          void loadUsers();
        });
        return;
      }

      clearRetryTimer();
      loadingRef.current = true;
      setSecurityUsersRefreshing(true);

      try {
        const rows = await withTimeout(
          getAdminSecurityUsersFn({
            data: {
              accessToken,
              searchQuery,
            },
          }),
          ADMIN_TAB_LOAD_TIMEOUT_MS,
          "Admin security users request timed out.",
        );

        if (!mountedRef.current) return;

        setUsers(rows);
        setUsersLoaded(true);
        retryCountRef.current = 0;

        const currentSelectedUser = selectedUserRef.current;
        if (currentSelectedUser && !rows.some((row) => row.id === currentSelectedUser.id)) {
          setSelectedUser(null);
          setResetReason("");
          setTemporaryLoginPassword("");
        }
      } catch (err) {
        console.error("[QHash] Admin security users background refresh failed:", err);

        if (!mountedRef.current) return;

        scheduleRetry(() => {
          void loadUsers();
        });
      } finally {
        loadingRef.current = false;
        if (mountedRef.current) {
          setSecurityUsersRefreshing(false);
        }
      }
    },
    [accessToken, clearRetryTimer, scheduleRetry, searchQuery, userId],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadUsers({ resetRetryCount: true, resetLoaded: true });

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer, loadUsers]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void loadUsers({ resetRetryCount: true });
      }
    };

    const handleOnline = () => {
      void loadUsers({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadUsers]);

  const handleResetFundPassword = async () => {
    if (!selectedUser || resettingUserId) return;

    const reason = resetReason.trim();

    if (reason.length < 5) {
      toast.error("Please enter a reset reason.");
      return;
    }

    if (selectedUser.isAdmin) {
      toast.error("Admin account security resets are not allowed from this panel.");
      return;
    }

    const confirmed = window.confirm(
      `Reset fund password for @${selectedUser.username}? The user will need to create a new fund password from Profile → Security.`,
    );

    if (!confirmed) return;

    setResettingUserId(selectedUser.id);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        toast.error("Session expired. Please sign in again.");
        return;
      }

      const result = await resetUserFundPasswordFn({
        data: {
          accessToken,
          targetUserId: selectedUser.id,
          reason,
        },
      });

      toast.success(result.message);
      setResetReason("");
      setSelectedUser(null);
      void loadUsers({ resetRetryCount: true });
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "ADMIN").message);
    } finally {
      setResettingUserId(null);
    }
  };

  const handleResetLoginPassword = async () => {
    if (!selectedUser || resettingLoginUserId) return;

    const reason = resetReason.trim();

    if (reason.length < 5) {
      toast.error("Please enter a reset reason.");
      return;
    }

    if (selectedUser.isAdmin) {
      toast.error("Admin account security resets are not allowed from this panel.");
      return;
    }

    const confirmed = window.confirm(
      `Generate a temporary login password for @${selectedUser.username}? This immediately changes the user's login password. Copy the temporary password after success and tell the user to change it from Profile → Security.`,
    );

    if (!confirmed) return;

    setResettingLoginUserId(selectedUser.id);
    setTemporaryLoginPassword("");

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        toast.error("Session expired. Please sign in again.");
        return;
      }

      const result = await resetUserLoginPasswordFn({
        data: {
          accessToken,
          targetUserId: selectedUser.id,
          reason,
        },
      });

      setTemporaryLoginPassword(result.temporaryPassword);
      setResetReason("");
      toast.success(result.message);
      void loadUsers({ resetRetryCount: true });
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "ADMIN").message);
    } finally {
      setResettingLoginUserId(null);
    }
  };

  const copyTemporaryLoginPassword = () => {
    if (!temporaryLoginPassword) return;
    navigator.clipboard.writeText(temporaryLoginPassword).then(
      () => toast.success("Temporary password copied."),
      () => toast.error("Unable to copy temporary password."),
    );
  };

  const selectedUserCanReset =
    selectedUser !== null &&
    !selectedUser.isAdmin &&
    resetReason.trim().length >= 5 &&
    resettingUserId === null &&
    resettingLoginUserId === null;

  return (
    <div className="space-y-4">
      <div className="bg-[rgba(0,255,65,0.04)] rounded-xl border border-[rgba(0,255,65,0.2)] p-4 flex gap-2.5">
        <ShieldCheck size={15} className="text-[#00ff41] shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-[#00ff41]">Security reset actions</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Fund password reset clears the PIN only. Login password reset generates a temporary password shown once.
          </p>
        </div>
      </div>

      <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-4 space-y-3">
        <Input
          label="Search user"
          placeholder="Username or phone"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          hint="Leave empty to show recent users. Admin accounts cannot be reset from this panel."
        />
        <Button size="sm" loading={securityUsersRefreshing} onClick={() => void loadUsers({ resetRetryCount: true, resetLoaded: true })}>
          Search Users
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a] overflow-hidden">
          {!usersLoaded ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="skeleton h-14 rounded-xl" />)}
            </div>
          ) : users.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-600">No users found.</div>
          ) : (
            users.map((securityUser) => (
              <button
                key={securityUser.id}
                onClick={() => { setSelectedUser(securityUser); setResetReason(""); setTemporaryLoginPassword(""); }}
                className={`w-full text-left px-4 py-3 card-press transition-colors ${
                  selectedUser?.id === securityUser.id ? "bg-[rgba(0,255,65,0.05)]" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-200 truncate">@{securityUser.username}</p>
                    <p className="text-[10px] text-gray-600">{securityUser.phone || "No phone"}</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {securityUser.isAdmin && <Badge variant="neon">Admin</Badge>}
                      {securityUser.isFrozen && <Badge variant="danger">Frozen</Badge>}
                      {securityUser.hasFundPassword ? (
                        <Badge variant="success">Fund PIN Set</Badge>
                      ) : (
                        <Badge variant="default">No Fund PIN</Badge>
                      )}
                      {securityUser.isFundPasswordLocked && <Badge variant="warning">Locked</Badge>}
                    </div>
                  </div>
                  <span className="text-[10px] text-gray-600 shrink-0">
                    {securityUser.fundPasswordFailedAttempts > 0
                      ? `${securityUser.fundPasswordFailedAttempts} failed`
                      : ""}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-3 h-fit">
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-[#00ff41]" />
            <span className="text-xs font-semibold">Selected User</span>
          </div>

          {!selectedUser ? (
            <p className="text-[11px] text-gray-500">Select a user to reset their fund password or generate a temporary login password.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <DetailRow label="Username" value={`@${selectedUser.username}`} />
                <DetailRow label="Phone" value={selectedUser.phone || "—"} />
                <DetailRow label="Fund PIN" value={selectedUser.hasFundPassword ? "Set" : "Not set"} />
                <DetailRow label="Failed attempts" value={String(selectedUser.fundPasswordFailedAttempts)} />
              </div>

              {selectedUser.isAdmin && (
                <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                  <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                  Admin accounts cannot be reset from this panel.
                </div>
              )}

              <Input
                label="Reset Reason"
                placeholder="e.g. User verified through Telegram support"
                value={resetReason}
                onChange={(e) => setResetReason(e.target.value)}
                hint="Required. This is saved in the admin security audit log."
              />

              {temporaryLoginPassword && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                  <div className="flex gap-2 text-[11px] text-amber-200">
                    <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                    <span>Temporary login password. Copy it now; it will not be shown again.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-lg bg-black/40 border border-amber-500/20 px-3 py-2 text-xs text-amber-100 break-all">
                      {temporaryLoginPassword}
                    </code>
                    <Button variant="ghost" size="sm" onClick={copyTemporaryLoginPassword}>
                      <Copy size={13} />
                    </Button>
                  </div>
                  <p className="text-[10px] text-amber-200/80">
                    Tell the user to log in with this password and change it from Profile → Security.
                  </p>
                </div>
              )}

              <div className="grid gap-2">
                <Button
                  variant="danger"
                  fullWidth
                  loading={resettingUserId === selectedUser.id}
                  disabled={!selectedUserCanReset}
                  onClick={handleResetFundPassword}
                >
                  Reset Fund Password
                </Button>

                <Button
                  variant="danger"
                  fullWidth
                  loading={resettingLoginUserId === selectedUser.id}
                  disabled={!selectedUserCanReset}
                  onClick={handleResetLoginPassword}
                >
                  Generate Temporary Login Password
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsTab({
  accessToken,
  userId,
}: {
  accessToken: string | null;
  userId: string | undefined;
}) {
  const [activeSettingsTab, setActiveSettingsTab] = useState<"support" | "payment">("support");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings size={13} className="text-gray-500" />
        <p className="text-[11px] text-gray-500">Manage app-level settings</p>
      </div>

      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {([
          { key: "support", label: "Support" },
          { key: "payment", label: "Payment" },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveSettingsTab(tab.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] border transition-colors card-press ${
              activeSettingsTab === tab.key
                ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]"
                : "text-gray-500 border-[#1f1f1f]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div hidden={activeSettingsTab !== "support"} aria-hidden={activeSettingsTab !== "support"}>
        <AdminSupportSettingsPanel accessToken={accessToken} userId={userId} />
      </div>

      {activeSettingsTab === "payment" && (
        <AdminFiatPaymentMethodsPanel accessToken={accessToken} userId={userId} />
      )}
    </div>
  );
}

function DetailRow({ label, value, highlight }: { label: string; value: ReactNode; highlight?: boolean }) {
  return (
    <div>
      <span className="text-gray-500 text-[10px] block">{label}</span>
      <span className={`text-xs ${highlight ? "text-[#00ff41] font-mono" : "text-gray-200"}`}>{value}</span>
    </div>
  );
}

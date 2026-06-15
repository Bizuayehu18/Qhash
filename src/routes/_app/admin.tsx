import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { Spinner } from "@/components/ui/Spinner.js";
import {
  ShieldCheck,
  Users,
  Settings,
  MessageSquare,
  ArrowDownCircle,
  Building2,
  Smartphone,
  CheckCircle,
  XCircle,
  Plus,
  Power,
  Pencil,
  ExternalLink,
  Copy,
  Clock,
  AlertTriangle,
  ScrollText,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { formatDateTime } from "@/lib/format.js";
import { useAuthStore } from "@/store/authStore.js";
import { supabase } from "@/lib/supabase.js";
import { withTimeout } from "@/lib/async.js";
import { getAdminStatsFn } from "@/lib/server/admin.js";
import {
  getPaymentMethodsFn,
  createPaymentMethodFn,
  updatePaymentMethodFn,
  archivePaymentMethodFn,
} from "@/lib/server/payment-methods.js";
import { getAdminDepositsFn } from "@/lib/server/deposits.js";
import { getDepositVerificationLogsFn } from "@/lib/server/deposit-audit-logs.js";
import {
  getAdminWithdrawalsFn,
  approveWithdrawalFn,
  rejectWithdrawalFn,
} from "@/lib/server/withdrawals.js";
import {
  getSupportSettingsFn,
  updateSupportTelegramUsernameFn,
  type SupportSettings,
} from "@/lib/server/support-settings.js";
import {
  getAdminSecurityUsersFn,
  resetUserFundPasswordFn,
  resetUserLoginPasswordFn,
} from "@/lib/server/admin-security-resets.js";
import type { PaymentMethodType } from "@/lib/database.types.js";

export const Route = createFileRoute("/_app/admin")({
  component: AdminPage,
});

type AdminStats = Awaited<ReturnType<typeof getAdminStatsFn>>;
type AdminDeposit = Awaited<ReturnType<typeof getAdminDepositsFn>>[number];
type PaymentMethod = Awaited<ReturnType<typeof getPaymentMethodsFn>>[number];
type AuditLog = Awaited<ReturnType<typeof getDepositVerificationLogsFn>>[number];
type AdminWithdrawal = Awaited<ReturnType<typeof getAdminWithdrawalsFn>>[number];
type AdminSecurityUser = Awaited<ReturnType<typeof getAdminSecurityUsersFn>>[number];

const METHOD_LABELS: Record<string, string> = { cbe: "CBE", telebirr: "TeleBirr" };

const ADMIN_TAB_LOAD_TIMEOUT_MS = 10_000;
const ADMIN_AUTO_RETRY_DELAY_MS = 1_500;
const ADMIN_MAX_AUTO_RETRIES = 2;

function AdminPage() {
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"overview" | "deposits" | "withdrawals" | "audit" | "security" | "settings">("overview");

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
          { key: "withdrawals", label: "Withdrawals" },
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

      {activeTab === "overview" && <OverviewTab userId={user?.id} />}
      {activeTab === "deposits" && <DepositsTab userId={user?.id} />}
      {activeTab === "withdrawals" && <WithdrawalsTab userId={user?.id} />}
      {activeTab === "audit" && <AuditLogsTab userId={user?.id} />}
      {activeTab === "security" && <AdminSecurityTab userId={user?.id} />}
      {activeTab === "settings" && <SettingsTab userId={user?.id} />}
    </div>
  );
}

function OverviewTab({ userId }: { userId: string | undefined }) {
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoaded, setStatsLoaded] = useState(false);
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

      if (retryCountRef.current >= ADMIN_MAX_AUTO_RETRIES) return;

      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(loadFn, ADMIN_AUTO_RETRY_DELAY_MS);
    },
    [clearRetryTimer],
  );

  const loadOverview = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (loadingRef.current) return;

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (!userId) return;

      if (!accessToken) {
        scheduleRetry(() => {
          void loadOverview();
        });
        return;
      }

      clearRetryTimer();
      loadingRef.current = true;

      try {
        const result = await withTimeout(
          getAdminStatsFn({
            data: {
              accessToken,
            },
          }),
          ADMIN_TAB_LOAD_TIMEOUT_MS,
          "Admin overview request timed out.",
        );

        if (!mountedRef.current) return;

        setStats(result);
        setStatsLoaded(true);
        retryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Admin overview background refresh failed:", err);

        if (!mountedRef.current) return;

        scheduleRetry(() => {
          void loadOverview();
        });
      } finally {
        loadingRef.current = false;
      }
    },
    [accessToken, clearRetryTimer, scheduleRetry, userId],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadOverview({ resetRetryCount: true });

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer, loadOverview]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void loadOverview({ resetRetryCount: true });
      }
    };

    const handleOnline = () => {
      void loadOverview({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadOverview]);

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Total Users", value: stats?.totalUsers, icon: <Users size={14} /> },
          { label: "Active Plans", value: stats?.activeInvestments, icon: <ShieldCheck size={14} /> },
          { label: "Pending Deposits", value: stats?.pendingDeposits, icon: <ArrowDownCircle size={14} /> },
          {
            label: "Revenue",
            value: stats?.totalRevenue !== undefined
              ? `${stats.totalRevenue.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB`
              : undefined,
            icon: <Settings size={14} />,
          },
        ].map((s) => (
          <div key={s.label} className="bg-[#111] rounded-xl border border-[#1a1a1a] p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-gray-500">{s.label}</p>
              <span className="text-gray-600">{s.icon}</span>
            </div>
            {!statsLoaded ? (
              <span className="skeleton inline-block h-5 w-16 rounded" aria-label={`Loading ${s.label}`} />
            ) : (
              <p className="text-lg font-bold">{s.value ?? 0}</p>
            )}
          </div>
        ))}
      </div>

      {/* Recent Users */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 mb-2">Recent Users</h2>
        {!statsLoaded ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>
        ) : !stats?.recentUsers.length ? (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-6 text-center text-xs text-gray-600">No users yet.</div>
        ) : (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
            {stats.recentUsers.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-xs font-medium text-gray-200">@{u.username}</p>
                  <p className="text-[10px] text-gray-600">{u.phone}</p>
                </div>
                <div className="flex items-center gap-2">
                  {u.is_frozen ? <Badge variant="danger">Frozen</Badge> : u.is_admin ? <Badge variant="neon">Admin</Badge> : <Badge variant="default">User</Badge>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending Withdrawals */}
      <div>
        <h2 className="text-xs font-semibold text-gray-400 mb-2">Pending Withdrawals</h2>
        {!statsLoaded ? (
          <div className="skeleton h-16 rounded-xl" />
        ) : !stats?.pendingWithdrawalRecords.length ? (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-6 text-center text-xs text-gray-600">No pending requests.</div>
        ) : (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
            {stats.pendingWithdrawalRecords.map((w) => (
              <div key={w.id} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-xs font-medium text-gray-200">@{w.username}</p>
                  <p className="text-[10px] text-gray-600">{new Date(w.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</p>
                </div>
                <span className="text-xs text-red-400 font-mono">{w.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB</span>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

function DepositsTab({ userId }: { userId: string | undefined }) {
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const [deposits, setDeposits] = useState<AdminDeposit[]>([]);
  const [depositsLoaded, setDepositsLoaded] = useState(false);
  const [filter, setFilter] = useState("all");
  const [adminNote, setAdminNote] = useState("");
  const [approvalAmount, setApprovalAmount] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedDeposit, setSelectedDeposit] = useState<AdminDeposit | null>(null);

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

      if (retryCountRef.current >= ADMIN_MAX_AUTO_RETRIES) return;

      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(loadFn, ADMIN_AUTO_RETRY_DELAY_MS);
    },
    [clearRetryTimer],
  );

  const loadDeposits = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (loadingRef.current) return;

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (!userId) return;

      if (!accessToken) {
        scheduleRetry(() => {
          void loadDeposits();
        });
        return;
      }

      clearRetryTimer();
      loadingRef.current = true;

      try {
        const rows = await withTimeout(
          getAdminDepositsFn({
            data: {
              accessToken,
              statusFilter: filter,
            },
          }),
          ADMIN_TAB_LOAD_TIMEOUT_MS,
          "Admin deposits request timed out.",
        );

        if (!mountedRef.current) return;

        setDeposits(rows);
        setDepositsLoaded(true);
        retryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Admin deposits background refresh failed:", err);

        if (!mountedRef.current) return;

        scheduleRetry(() => {
          void loadDeposits();
        });
      } finally {
        loadingRef.current = false;
      }
    },
    [accessToken, clearRetryTimer, filter, scheduleRetry, userId],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  useEffect(() => {
    setSelectedDeposit(null);
    setAdminNote("");
    setApprovalAmount("");
    setDeposits([]);
    setDepositsLoaded(false);
    retryCountRef.current = 0;
    void loadDeposits({ resetRetryCount: true });
  }, [filter, loadDeposits]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void loadDeposits({ resetRetryCount: true });
      }
    };

    const handleOnline = () => {
      void loadDeposits({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadDeposits]);

  const handleReview = async (depositId: string, action: "approve" | "reject") => {
    if (!userId) return;

    if (action === "approve") {
      const parsed = Number(approvalAmount);
      if (!approvalAmount || !Number.isFinite(parsed) || parsed <= 0) {
        toast.error("Enter the verified receipt amount before approving.");
        return;
      }
    }

    setActionLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error("Session expired. Please log in again.");

      const res = await fetch("/api/admin/approve-deposit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          depositId,
          action,
          adminNote: adminNote || null,
          ...(action === "approve" ? { verifiedAmount: Number(approvalAmount) } : {}),
        }),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.message || "Failed to review deposit.");
      }

      toast.success(`Deposit ${action === "approve" ? "approved" : "rejected"}.`);
      setSelectedDeposit(null);
      setAdminNote("");
      setApprovalAmount("");
      void loadDeposits({ resetRetryCount: true });
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "ADMIN").message);
    } finally {
      setActionLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied!"));
  };

  const pendingCount = deposits.filter((d) => d.status === "pending").length;

  const statusConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "default" }> = {
    approved: { label: "Approved", variant: "success" },
    pending: { label: "Pending", variant: "warning" },
    rejected: { label: "Rejected", variant: "danger" },
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {["all", "pending", "approved", "rejected"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] border transition-colors card-press ${
              filter === f
                ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]"
                : "text-gray-500 border-[#1f1f1f]"
            }`}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            {f === "pending" && pendingCount > 0 && (
              <span className="ml-1 text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Selected deposit detail */}
      {selectedDeposit && (
        <DepositDetailPanel
          deposit={selectedDeposit}
          statusConfig={statusConfig}
          adminNote={adminNote}
          setAdminNote={setAdminNote}
          approvalAmount={approvalAmount}
          setApprovalAmount={setApprovalAmount}
          actionLoading={actionLoading}
          onReview={handleReview}
          onClose={() => { setSelectedDeposit(null); setAdminNote(""); setApprovalAmount(""); }}
          onCopy={copyToClipboard}
        />
      )}

      {/* Deposit list */}
      {!depositsLoaded ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-14 rounded-xl" />)}</div>
      ) : deposits.length === 0 ? (
        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-8 text-center text-xs text-gray-600">No deposits found.</div>
      ) : (
        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
          {deposits.map((d) => {
            const sc = statusConfig[d.status];
            return (
              <button
                key={d.id}
                onClick={() => { setSelectedDeposit(d); setAdminNote(""); setApprovalAmount(""); }}
                className="w-full text-left flex items-center justify-between px-4 py-3 card-press"
              >
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-gray-200">@{d.username}</p>
                    {d.status === "pending" && (
                      <Clock size={10} className="text-yellow-400" />
                    )}
                    {d.status === "pending" && d.admin_note?.startsWith("Verifier review:") && (
                      <Badge variant="warning" className="text-[9px] px-1.5 py-0">Verifier Review</Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-600">
                    {METHOD_LABELS[d.method_type]} &middot; {formatDateTime(d.created_at)}
                  </p>
                </div>
                <div className="text-right flex items-center gap-2">
                  <span className="text-xs text-[#00ff41] font-mono">
                    {d.amount > 0
                      ? `${d.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB`
                      : "—"}
                  </span>
                  <Badge variant={sc?.variant ?? "default"}>{sc?.label ?? d.status}</Badge>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WithdrawalsTab({ userId }: { userId: string | undefined }) {
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[]>([]);
  const [withdrawalsLoaded, setWithdrawalsLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [selectedWithdrawal, setSelectedWithdrawal] = useState<AdminWithdrawal | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

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

      if (retryCountRef.current >= ADMIN_MAX_AUTO_RETRIES) return;

      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(loadFn, ADMIN_AUTO_RETRY_DELAY_MS);
    },
    [clearRetryTimer],
  );

  const loadWithdrawals = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (loadingRef.current) return;

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (!userId) return;

      if (!accessToken) {
        scheduleRetry(() => {
          void loadWithdrawals();
        });
        return;
      }

      clearRetryTimer();
      loadingRef.current = true;

      try {
        const rows = await withTimeout(
          getAdminWithdrawalsFn({
            data: {
              accessToken,
              statusFilter: filter,
            },
          }),
          ADMIN_TAB_LOAD_TIMEOUT_MS,
          "Admin withdrawals request timed out.",
        );

        if (!mountedRef.current) return;

        setWithdrawals(rows);
        setWithdrawalsLoaded(true);
        retryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Admin withdrawals background refresh failed:", err);

        if (!mountedRef.current) return;

        scheduleRetry(() => {
          void loadWithdrawals();
        });
      } finally {
        loadingRef.current = false;
      }
    },
    [accessToken, clearRetryTimer, filter, scheduleRetry, userId],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  useEffect(() => {
    setSelectedWithdrawal(null);
    setAdminNote("");
    setWithdrawals([]);
    setWithdrawalsLoaded(false);
    retryCountRef.current = 0;
    void loadWithdrawals({ resetRetryCount: true });
  }, [filter, loadWithdrawals]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void loadWithdrawals({ resetRetryCount: true });
      }
    };

    const handleOnline = () => {
      void loadWithdrawals({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadWithdrawals]);

  const handleReview = async (withdrawalId: string, action: "approve" | "reject") => {
    if (actionLoading) return;

    const confirmed = window.confirm(
      action === "approve"
        ? "Approve this withdrawal request?"
        : "Reject this withdrawal request and refund the full amount to the user wallet?",
    );

    if (!confirmed) return;

    setActionLoading(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw new Error("Session expired. Please sign in again.");
      }

      if (action === "approve") {
        await approveWithdrawalFn({
          data: {
            accessToken,
            withdrawalId,
            adminNote: adminNote.trim() || null,
          },
        });
        toast.success("Withdrawal approved.");
      } else {
        await rejectWithdrawalFn({
          data: {
            accessToken,
            withdrawalId,
            adminNote: adminNote.trim() || null,
          },
        });
        toast.success("Withdrawal rejected and refunded.");
      }

      setSelectedWithdrawal(null);
      setAdminNote("");
      void loadWithdrawals({ resetRetryCount: true });
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "ADMIN").message);
    } finally {
      setActionLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied!"));
  };

  const pendingCount = withdrawals.filter((w) => w.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {(["all", "pending", "approved", "rejected"] as const).map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setSelectedWithdrawal(null); setAdminNote(""); }}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] border transition-colors card-press ${
              filter === f
                ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]"
                : "text-gray-500 border-[#1f1f1f]"
            }`}
          >
            {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            {f === "pending" && pendingCount > 0 && (
              <span className="ml-1 text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {selectedWithdrawal && (
        <WithdrawalDetailPanel
          withdrawal={selectedWithdrawal}
          adminNote={adminNote}
          setAdminNote={setAdminNote}
          actionLoading={actionLoading}
          onReview={handleReview}
          onClose={() => { setSelectedWithdrawal(null); setAdminNote(""); }}
          onCopy={copyToClipboard}
        />
      )}

      {!withdrawalsLoaded ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
      ) : withdrawals.length === 0 ? (
        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-8 text-center text-xs text-gray-600">No withdrawals found.</div>
      ) : (
        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
          {withdrawals.map((w) => (
            <button
              key={w.id}
              onClick={() => { setSelectedWithdrawal(w); setAdminNote(w.admin_note ?? ""); }}
              className="w-full text-left px-4 py-3 card-press"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-gray-200 truncate">@{w.username}</p>
                    {w.status === "pending" && <Clock size={10} className="text-yellow-400" />}
                  </div>
                  <p className="text-[10px] text-gray-600">{w.phone || "No phone"}</p>
                  <p className="text-[10px] text-gray-500 mt-1">
                    {METHOD_LABELS[w.method] ?? w.method} &middot; {w.account_name} &middot; {w.account_last4 ? `****${w.account_last4}` : "No account"}
                  </p>
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <p className="text-xs text-red-400 font-mono">{formatEtb(w.amount)}</p>
                  <WithdrawalStatusBadge status={w.status} />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function WithdrawalDetailPanel({
  withdrawal,
  adminNote,
  setAdminNote,
  actionLoading,
  onReview,
  onClose,
  onCopy,
}: {
  withdrawal: AdminWithdrawal;
  adminNote: string;
  setAdminNote: (v: string) => void;
  actionLoading: boolean;
  onReview: (id: string, action: "approve" | "reject") => void;
  onClose: () => void;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Withdrawal Details</span>
        <button onClick={onClose} className="text-[10px] text-gray-500">Close</button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <DetailRow label="User" value={`@${withdrawal.username}`} />
        <DetailRow label="Phone" value={withdrawal.phone || "—"} />
        <DetailRow label="Amount" value={formatEtb(withdrawal.amount)} highlight />
        <DetailRow label="Net payout" value={formatEtb(withdrawal.net_amount ?? 0)} highlight />
        <DetailRow label="Fee" value={formatEtb(withdrawal.fee_amount ?? 0)} />
        <DetailRow label="Method" value={METHOD_LABELS[withdrawal.method] ?? withdrawal.method} />
        <DetailRow label="Account Name" value={withdrawal.account_name} />
        <div>
          <span className="text-gray-500 text-[10px] block mb-1">Status</span>
          <WithdrawalStatusBadge status={withdrawal.status} />
        </div>
        <div className="col-span-2">
          <span className="text-gray-500 text-[10px] block mb-1">Account Number</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-200 font-mono break-all">{withdrawal.account_number || "—"}</span>
            {withdrawal.account_number && (
              <button
                onClick={() => onCopy(withdrawal.account_number)}
                className="p-1 rounded text-gray-600 hover:text-gray-300 transition-colors shrink-0"
              >
                <Copy size={11} />
              </button>
            )}
          </div>
        </div>
        <DetailRow label="Requested" value={formatDateTime(withdrawal.created_at)} />
        <DetailRow label="Reviewed" value={withdrawal.reviewed_at ? formatDateTime(withdrawal.reviewed_at) : "—"} />
      </div>

      {withdrawal.admin_note && withdrawal.status !== "pending" && (
        <div className="text-[11px] text-gray-500">
          <span className="text-gray-600">Note:</span> {withdrawal.admin_note}
        </div>
      )}

      {withdrawal.status === "pending" && (
        <div className="pt-3 border-t border-[#1f1f1f] space-y-3">
          <Input
            label="Review Note (optional)"
            placeholder="e.g. Paid to customer account"
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={actionLoading}
              onClick={() => onReview(withdrawal.id, "approve")}
              className="flex-1"
            >
              <CheckCircle size={13} /> Approve
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={actionLoading}
              onClick={() => onReview(withdrawal.id, "reject")}
              className="flex-1"
            >
              <XCircle size={13} /> Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function WithdrawalStatusBadge({ status }: { status: string }) {
  const statusConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "default" }> = {
    approved: { label: "Approved", variant: "success" },
    pending: { label: "Pending", variant: "warning" },
    rejected: { label: "Rejected", variant: "danger" },
  };
  const sc = statusConfig[status] ?? { label: status, variant: "default" as const };
  return <Badge variant={sc.variant}>{sc.label}</Badge>;
}

function formatEtb(value: number): string {
  return `${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ETB`;
}

function PaymentMethodsTab({ userId }: { userId: string | undefined }) {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newType, setNewType] = useState<PaymentMethodType>("cbe");
  const [newName, setNewName] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [newInstructions, setNewInstructions] = useState("");
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveFilter, setArchiveFilter] = useState<"visible" | "archived" | "all">("visible");
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [editName, setEditName] = useState("");
  const [editNumber, setEditNumber] = useState("");
  const [editInstructions, setEditInstructions] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const loadMethods = () => {
    if (!userId) return;
    setLoading(true);

    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;

        if (!accessToken) {
          toast.error("Session expired. Please sign in again.");
          setLoading(false);
          return;
        }

        const rows = await getPaymentMethodsFn({
          data: {
            activeOnly: false,
            accessToken,
            archiveFilter,
          },
        });

        setMethods(rows as PaymentMethod[]);
      } catch (err) {
        toast.error(getSafeErrorMessage(err, "PAYMENT").message);
      } finally {
        setLoading(false);
      }
    })();
  };

  useEffect(() => { loadMethods(); }, [userId, archiveFilter]);

  const handleAdd = async () => {
    if (!userId || !newName.trim() || !newNumber.trim()) return;
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        toast.error("Session expired. Please sign in again.");
        setSaving(false);
        return;
      }

      await createPaymentMethodFn({
        data: {
          accessToken,
          type: newType,
          accountName: newName.trim(),
          accountNumber: newNumber.trim(),
          instructions: newInstructions.trim() || null,
        },
      });
      toast.success("Payment method created.");
      setShowAdd(false);
      setNewName(""); setNewNumber(""); setNewInstructions("");
      loadMethods();
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "PAYMENT").message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (m: PaymentMethod) => {
    setEditingMethod(m);
    setEditName(m.account_name);
    setEditNumber(m.account_number);
    setEditInstructions(m.instructions ?? "");
  };

  const handleEdit = async () => {
    if (!userId || !editingMethod || !editName.trim() || !editNumber.trim()) return;
    setEditSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        toast.error("Session expired. Please sign in again.");
        setEditSaving(false);
        return;
      }

      await updatePaymentMethodFn({
        data: {
          accessToken,
          methodId: editingMethod.id,
          accountName: editName.trim(),
          accountNumber: editNumber.trim(),
          instructions: editInstructions.trim() || null,
        },
      });
      toast.success("Payment method updated.");
      setEditingMethod(null);
      loadMethods();
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "PAYMENT").message);
    } finally {
      setEditSaving(false);
    }
  };

  const toggleActive = async (method: PaymentMethod) => {
    if (!userId) return;
    setTogglingId(method.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        toast.error("Session expired. Please sign in again.");
        setTogglingId(null);
        return;
      }

      await updatePaymentMethodFn({ data: { accessToken, methodId: method.id, isActive: !method.is_active } });
      toast.success(method.is_active ? "Disabled." : "Enabled.");
      loadMethods();
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "PAYMENT").message);
    } finally {
      setTogglingId(null);
    }
  };

  const archiveMethod = async (method: PaymentMethod, archived: boolean) => {
    if (!userId) return;

    const actionLabel = archived ? "archive" : "restore";
    if (!window.confirm(`Are you sure you want to ${actionLabel} this payment account?`)) return;

    setArchivingId(method.id);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        toast.error("Session expired. Please sign in again.");
        setArchivingId(null);
        return;
      }

      await archivePaymentMethodFn({ data: { accessToken, methodId: method.id, archived } });
      toast.success(archived ? "Payment account archived." : "Payment account restored.");
      if (!archived) setArchiveFilter("visible");
      loadMethods();
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "PAYMENT").message);
    } finally {
      setArchivingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-500">Manage deposit accounts</p>
        <Button size="sm" onClick={() => setShowAdd(!showAdd)}>
          <Plus size={13} /> Add
        </Button>
      </div>

      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {([
          { key: "visible", label: "Visible" },
          { key: "archived", label: "Archived" },
          { key: "all", label: "All" },
        ] as const).map((f) => (
          <button
            key={f.key}
            onClick={() => setArchiveFilter(f.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] border transition-colors card-press ${
              archiveFilter === f.key
                ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]"
                : "text-gray-500 border-[#1f1f1f]"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {showAdd && (
        <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-3">
          <span className="text-xs font-semibold">New Payment Account</span>
          <div className="flex gap-2">
            {(["cbe", "telebirr"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setNewType(t)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-all card-press ${
                  newType === t ? "border-[rgba(0,255,65,0.4)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]" : "border-[#1f1f1f] text-gray-400"
                }`}
              >
                {t === "cbe" ? <Building2 size={13} /> : <Smartphone size={13} />}
                {METHOD_LABELS[t]}
              </button>
            ))}
          </div>
          <Input label="Account Name" placeholder="e.g. QHash Trading PLC" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Input label="Account Number" placeholder="e.g. 1000123456789" value={newNumber} onChange={(e) => setNewNumber(e.target.value)} />
          {newType === "cbe" && (
            <p className="text-[10px] text-gray-500 -mt-1">
              Last 8 digits are generated automatically from the CBE account number.
            </p>
          )}
          <Input label="Instructions (optional)" placeholder="e.g. Use username as remark" value={newInstructions} onChange={(e) => setNewInstructions(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" loading={saving} disabled={!newName.trim() || !newNumber.trim()} onClick={handleAdd}>Create</Button>
            <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {editingMethod && (
        <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">Edit {METHOD_LABELS[editingMethod.type]} Account</span>
            <button onClick={() => setEditingMethod(null)} className="text-[10px] text-gray-500">Cancel</button>
          </div>
          <Input label="Account Name" value={editName} onChange={(e) => setEditName(e.target.value)} />
          <Input label="Account Number" value={editNumber} onChange={(e) => setEditNumber(e.target.value)} />
          {editingMethod.type === "cbe" && (
            <p className="text-[10px] text-gray-500 -mt-1">
              Last 8 digits are generated automatically from the CBE account number.
            </p>
          )}
          <Input label="Instructions (optional)" value={editInstructions} onChange={(e) => setEditInstructions(e.target.value)} />
          <Button size="sm" loading={editSaving} disabled={!editName.trim() || !editNumber.trim()} onClick={handleEdit}>Save Changes</Button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
      ) : methods.length === 0 ? (
        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-8 text-center text-xs text-gray-600">{archiveFilter === "archived" ? "No archived payment methods." : "No payment methods configured."}</div>
      ) : (
        <div className="space-y-2">
          {methods.map((m) => (
            <div
              key={m.id}
              className={`flex items-center gap-3 bg-[#111] rounded-xl border p-3 ${
                (m as PaymentMethod & { is_archived?: boolean }).is_archived
                  ? "border-[#1a1a1a] opacity-50"
                  : m.is_active
                    ? "border-[#1a1a1a]"
                    : "border-[#1a1a1a] opacity-70"
              }`}
            >
              <span className="text-gray-500">
                {m.type === "cbe" ? <Building2 size={16} /> : <Smartphone size={16} />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-gray-200 truncate">{m.account_name}</span>
                  {(m as PaymentMethod & { is_archived?: boolean }).is_archived ? (
                    <Badge variant="default">Archived</Badge>
                  ) : (
                    <Badge variant={m.is_active ? "neon" : "default"}>{m.is_active ? "Active" : "Off"}</Badge>
                  )}
                </div>
                <p className="text-[10px] text-gray-500 font-mono mt-0.5">{METHOD_LABELS[m.type]} — {m.account_number}</p>
              </div>
              {!(m as PaymentMethod & { is_archived?: boolean }).is_archived && (
                <>
                  <button
                    onClick={() => startEdit(m)}
                    className="p-2 rounded-lg text-gray-600 hover:text-gray-300 transition-colors card-press"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => toggleActive(m)}
                    disabled={togglingId === m.id}
                    className={`p-2 rounded-lg transition-colors card-press ${
                      m.is_active ? "text-gray-500 hover:text-red-400" : "text-gray-600 hover:text-[#00ff41]"
                    }`}
                    title={m.is_active ? "Disable" : "Enable"}
                  >
                    {togglingId === m.id ? <Spinner size="sm" /> : <Power size={14} />}
                  </button>
                </>
              )}
              <button
                onClick={() => archiveMethod(m, !(m as PaymentMethod & { is_archived?: boolean }).is_archived)}
                disabled={archivingId === m.id}
                className={`p-2 rounded-lg transition-colors card-press ${
                  (m as PaymentMethod & { is_archived?: boolean }).is_archived
                    ? "text-gray-600 hover:text-[#00ff41]"
                    : "text-gray-500 hover:text-red-400"
                }`}
                title={(m as PaymentMethod & { is_archived?: boolean }).is_archived ? "Restore" : "Archive"}
              >
                {archivingId === m.id ? (
                  <Spinner size="sm" />
                ) : (m as PaymentMethod & { is_archived?: boolean }).is_archived ? (
                  <ArchiveRestore size={14} />
                ) : (
                  <Archive size={14} />
                )}
              </button>
            </div>
          ))}
        </div>
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

function SettingsTab({ userId }: { userId: string | undefined }) {
  const [activeSettingsTab, setActiveSettingsTab] = useState<"support" | "payment">("support");
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [telegramUsername, setTelegramUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadSettings = () => {
    if (!userId) return;

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

  useEffect(() => { loadSettings(); }, [userId]);

  const saveSupportUsername = async () => {
    if (!userId || saving) return;

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

      {activeSettingsTab === "support" ? (
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
        </>
      ) : (
        <PaymentMethodsTab userId={userId} />
      )}
    </div>
  );
}

const AUDIT_LIMIT = 100;

function shortId(id: string | null): string {
  if (!id) return "—";
  return id.length <= 8 ? id : id.slice(0, 8);
}

function AuditLogsTab({ userId }: { userId: string | undefined }) {
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);
  const [paymentType, setPaymentType] = useState<"all" | "cbe" | "telebirr">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

      if (retryCountRef.current >= ADMIN_MAX_AUTO_RETRIES) return;

      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(loadFn, ADMIN_AUTO_RETRY_DELAY_MS);
    },
    [clearRetryTimer],
  );

  const loadAuditLogs = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (loadingRef.current) return;

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (!userId) return;

      if (!accessToken) {
        scheduleRetry(() => {
          void loadAuditLogs();
        });
        return;
      }

      clearRetryTimer();
      loadingRef.current = true;

      try {
        const rows = await withTimeout(
          getDepositVerificationLogsFn({
            data: {
              accessToken,
              paymentType: paymentType === "all" ? undefined : paymentType,
              limit: AUDIT_LIMIT,
            },
          }),
          ADMIN_TAB_LOAD_TIMEOUT_MS,
          "Admin audit logs request timed out.",
        );

        if (!mountedRef.current) return;

        setLogs(rows);
        setLogsLoaded(true);
        retryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Admin audit logs background refresh failed:", err);

        if (!mountedRef.current) return;

        scheduleRetry(() => {
          void loadAuditLogs();
        });
      } finally {
        loadingRef.current = false;
      }
    },
    [accessToken, clearRetryTimer, paymentType, scheduleRetry, userId],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  useEffect(() => {
    setExpandedId(null);
    setLogs([]);
    setLogsLoaded(false);
    retryCountRef.current = 0;
    void loadAuditLogs({ resetRetryCount: true });
  }, [loadAuditLogs, paymentType]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void loadAuditLogs({ resetRetryCount: true });
      }
    };

    const handleOnline = () => {
      void loadAuditLogs({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadAuditLogs]);

  const actionConfig: Record<string, { variant: "success" | "warning" | "danger" | "default" }> = {
    approve: { variant: "success" },
    reject: { variant: "danger" },
    manual_review: { variant: "warning" },
    skipped: { variant: "default" },
    error: { variant: "danger" },
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ScrollText size={13} className="text-gray-500" />
        <p className="text-[11px] text-gray-500">
          Read-only verification audit trail — latest {AUDIT_LIMIT}
        </p>
      </div>

      {/* Payment type filter */}
      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {(["all", "cbe", "telebirr"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setPaymentType(t)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] border transition-colors card-press ${
              paymentType === t
                ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]"
                : "text-gray-500 border-[#1f1f1f]"
            }`}
          >
            {t === "all" ? "All" : METHOD_LABELS[t] ?? t}
          </button>
        ))}
      </div>

      {!logsLoaded ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}</div>
      ) : logs.length === 0 ? (
        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-8 text-center text-xs text-gray-600">No audit logs found.</div>
      ) : (
        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
          {logs.map((logRow) => {
            const ac = logRow.action ? actionConfig[logRow.action] : undefined;
            const isOpen = expandedId === logRow.id;
            return (
              <div key={logRow.id}>
                <button
                  onClick={() => setExpandedId(isOpen ? null : logRow.id)}
                  className="w-full text-left flex items-start justify-between gap-3 px-4 py-3 card-press"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-medium text-gray-200">
                        {logRow.payment_type ? METHOD_LABELS[logRow.payment_type] ?? logRow.payment_type : "—"}
                      </span>
                      {logRow.action && (
                        <Badge variant={ac?.variant ?? "default"} className="text-[9px] px-1.5 py-0">
                          {logRow.action}
                        </Badge>
                      )}
                      <span className="text-[10px] text-gray-600 font-mono">{logRow.event ?? "—"}</span>
                    </div>
                    <p className="text-[10px] text-gray-600 mt-0.5">
                      {formatDateTime(logRow.created_at)}
                      {logRow.reason_code ? <> &middot; <span className="font-mono">{logRow.reason_code}</span></> : null}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs text-[#00ff41] font-mono">
                      {typeof logRow.amount === "number" && logRow.amount > 0
                        ? `${logRow.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB`
                        : "—"}
                    </span>
                    {logRow.tx_ref_last4 && (
                      <p className="text-[10px] text-gray-600 font-mono mt-0.5">****{logRow.tx_ref_last4}</p>
                    )}
                  </div>
                </button>

                {isOpen && (
                  <div className="px-4 pb-3 -mt-1">
                    <div className="grid grid-cols-2 gap-2.5 text-xs bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] p-3">
                      <AuditRow label="Source" value={logRow.source ?? "—"} />
                      <AuditRow label="Actor" value={logRow.actor_type ?? "—"} />
                      <AuditRow
                        label="Receiver Matched"
                        value={logRow.receiver_matched === null ? "—" : logRow.receiver_matched ? "Yes" : "No"}
                      />
                      <AuditRow label="Freshness" value={logRow.freshness_decision ?? "—"} />
                      <AuditRow
                        label="Age (min)"
                        value={typeof logRow.age_minutes === "number" ? String(logRow.age_minutes) : "—"}
                      />
                      <AuditRow label="Reason Code" value={logRow.reason_code ?? "—"} />
                      <AuditRow label="Deposit" value={shortId(logRow.deposit_id)} mono />
                      <AuditRow label="User" value={shortId(logRow.user_id)} mono />
                    </div>

                    {logRow.reason_message_safe && (
                      <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
                        {logRow.reason_message_safe}
                      </p>
                    )}

                    {logRow.metadata && Object.keys(logRow.metadata).length > 0 && (
                      <details className="mt-2">
                        <summary className="text-[10px] text-gray-500 cursor-pointer select-none">
                          Metadata
                        </summary>
                        <pre className="text-[10px] text-gray-500 font-mono mt-1 p-2 bg-[#0d0d0d] rounded-lg border border-[#1a1a1a] overflow-x-auto whitespace-pre-wrap break-all">
                          {JSON.stringify(logRow.metadata, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AuditRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-gray-500 text-[10px] block">{label}</span>
      <span className={`text-xs text-gray-200 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function DepositDetailPanel({
  deposit,
  statusConfig,
  adminNote,
  setAdminNote,
  approvalAmount,
  setApprovalAmount,
  actionLoading,
  onReview,
  onClose,
  onCopy,
}: {
  deposit: AdminDeposit;
  statusConfig: Record<string, { label: string; variant: "success" | "warning" | "danger" | "default" }>;
  adminNote: string;
  setAdminNote: (v: string) => void;
  approvalAmount: string;
  setApprovalAmount: (v: string) => void;
  actionLoading: boolean;
  onReview: (id: string, action: "approve" | "reject") => void;
  onClose: () => void;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold">Deposit Details</span>
        <button onClick={onClose} className="text-[10px] text-gray-500">Close</button>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <DetailRow label="User" value={`@${deposit.username}`} />
        <DetailRow label="Phone" value={deposit.phone} />
        <DetailRow label="Amount" value={deposit.amount > 0 ? `${deposit.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB` : "Not specified"} highlight={deposit.amount > 0} />
        <DetailRow label="Method" value={`${METHOD_LABELS[deposit.method_type] ?? deposit.method_type}`} />
        <DetailRow label="Account" value={deposit.method_number} />
        <DetailRow label="Status" value={statusConfig[deposit.status]?.label ?? deposit.status} />
        <div className="col-span-2">
          <span className="text-gray-500 text-[10px] block mb-1">Transaction ID</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#00ff41] font-mono">{deposit.transaction_reference}</span>
            <button
              onClick={() => onCopy(deposit.transaction_reference)}
              className="p-1 rounded text-gray-600 hover:text-gray-300 transition-colors"
            >
              <Copy size={11} />
            </button>
          </div>
        </div>
      </div>

      {deposit.admin_note && deposit.admin_note.startsWith("Verifier review:") && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="text-[11px] text-amber-300 leading-relaxed">
            <span className="font-semibold text-amber-400 block mb-0.5">Manual Review Required</span>
            {deposit.admin_note}
          </div>
        </div>
      )}

      {deposit.admin_note && !deposit.admin_note.startsWith("Verifier review:") && (
        <div className="text-[11px] text-gray-500">
          <span className="text-gray-600">Note:</span> {deposit.admin_note}
        </div>
      )}

      {/* Receipt link */}
      {deposit.receipt_url && (
        <a
          href={deposit.receipt_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl border border-[rgba(0,255,65,0.2)] bg-[rgba(0,255,65,0.04)] text-[#00ff41] text-xs font-medium transition-colors hover:bg-[rgba(0,255,65,0.08)] card-press"
        >
          <ExternalLink size={13} />
          Open Receipt
        </a>
      )}

      {/* Admin actions for pending deposits */}
      {deposit.status === "pending" && (
        <div className="pt-3 border-t border-[#1f1f1f] space-y-3">
          <Input
            label="Verified Amount (ETB)"
            type="number"
            placeholder="Enter amount from receipt"
            value={approvalAmount}
            onChange={(e) => setApprovalAmount(e.target.value)}
            min="100"
            step="0.01"
            hint={deposit.amount > 0 ? `User entered: ${deposit.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB` : "User did not specify amount — check receipt"}
          />
          <Input
            label="Verification Note (optional)"
            placeholder="e.g. Verified receiver name and amount"
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={actionLoading}
              onClick={() => onReview(deposit.id, "approve")}
              className="flex-1"
            >
              <CheckCircle size={13} /> Approve
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={actionLoading}
              onClick={() => onReview(deposit.id, "reject")}
              className="flex-1"
            >
              <XCircle size={13} /> Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <span className="text-gray-500 text-[10px] block">{label}</span>
      <span className={`text-xs ${highlight ? "text-[#00ff41] font-mono" : "text-gray-200"}`}>{value}</span>
    </div>
  );
}

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Info, KeyRound, ShieldCheck, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { InlineNotice } from "@/components/ui/InlineNotice.js";
import { Input } from "@/components/ui/Input.js";
import { PageHeader } from "@/components/ui/PageHeader.js";
import { PillTabs } from "@/components/ui/PillTabs.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";
import { Spinner } from "@/components/ui/Spinner.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { withTimeout } from "@/lib/async.js";
import {
  changeFundPasswordFn,
  changeLoginPasswordFn,
  getSecurityStatusFn,
  setFundPasswordFn,
  type SecurityStatus,
} from "@/lib/server/security.js";
import { useAuthStore } from "@/store/authStore.js";

export const Route = createFileRoute("/_app/security")({
  component: SecurityPage,
});

type SecurityTab = "login" | "fund";

const SECURITY_STATUS_TIMEOUT_MS = 10_000;
const SECURITY_ACTION_TIMEOUT_MS = 15_000;

const EMPTY_SECURITY_STATUS: SecurityStatus = {
  hasFundPassword: false,
  fundPasswordLockedUntil: null,
  fundPasswordFailedAttempts: 0,
  isFundPasswordLocked: false,
};

const SECURITY_TABS: { key: SecurityTab; label: string }[] = [
  { key: "login", label: "Login Password" },
  { key: "fund", label: "Fund Password" },
];

function onlyFourDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

function isValidLoginPassword(value: string): boolean {
  return value.trim().length >= 8;
}

function SecurityPage() {
  const { user, signOut } = useAuthStore();
  const accessToken = useAuthStore((state) => state.session?.access_token ?? null);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SecurityTab>("login");
  const [status, setStatus] = useState<SecurityStatus>(EMPTY_SECURITY_STATUS);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const [currentLoginPassword, setCurrentLoginPassword] = useState("");
  const [newLoginPassword, setNewLoginPassword] = useState("");
  const [confirmLoginPassword, setConfirmLoginPassword] = useState("");
  const [savingLoginPassword, setSavingLoginPassword] = useState(false);

  const [fundPassword, setFundPassword] = useState("");
  const [confirmFundPassword, setConfirmFundPassword] = useState("");
  const [currentFundPassword, setCurrentFundPassword] = useState("");
  const [newFundPassword, setNewFundPassword] = useState("");
  const [confirmNewFundPassword, setConfirmNewFundPassword] = useState("");
  const [savingFundPassword, setSavingFundPassword] = useState(false);

  const loadSecurityStatus = useCallback(async () => {
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
  }, [accessToken, user?.id]);

  useEffect(() => {
    void loadSecurityStatus();
  }, [loadSecurityStatus]);

  useEffect(() => {
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
  }, [loadSecurityStatus]);

  const resetLoginPasswordForm = () => {
    setCurrentLoginPassword("");
    setNewLoginPassword("");
    setConfirmLoginPassword("");
  };

  const resetFundPasswordForms = () => {
    setFundPassword("");
    setConfirmFundPassword("");
    setCurrentFundPassword("");
    setNewFundPassword("");
    setConfirmNewFundPassword("");
  };

  const handleChangeLoginPassword = async () => {
    if (savingLoginPassword) return;

    if (!currentLoginPassword.trim()) {
      toast.error("Enter your current login password.");
      return;
    }

    if (!isValidLoginPassword(newLoginPassword)) {
      toast.error("New login password must be at least 8 characters.");
      return;
    }

    if (newLoginPassword !== confirmLoginPassword) {
      toast.error("New login passwords do not match.");
      return;
    }

    if (currentLoginPassword === newLoginPassword) {
      toast.error("New login password must be different from the current one.");
      return;
    }

    if (!accessToken) {
      toast.error("Session expired. Please sign in again.");
      return;
    }

    setSavingLoginPassword(true);

    try {
      const result = await withTimeout(
        changeLoginPasswordFn({
          data: {
            accessToken,
            currentLoginPassword,
            newLoginPassword,
            confirmNewLoginPassword: confirmLoginPassword,
          },
        }),
        SECURITY_ACTION_TIMEOUT_MS,
        "Login password update timed out.",
      );

      if (result.success !== true) {
        toast.error(result.message);
        return;
      }

      resetLoginPasswordForm();
      toast.success(result.message);
      await signOut();
      navigate({ to: "/login", replace: true });
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "AUTH").message);
    } finally {
      setSavingLoginPassword(false);
    }
  };

  const handleCreateFundPassword = async () => {
    if (savingFundPassword) return;

    if (fundPassword.length !== 4 || confirmFundPassword.length !== 4) {
      toast.error("Fund password must be exactly 4 digits.");
      return;
    }

    if (fundPassword !== confirmFundPassword) {
      toast.error("Fund passwords do not match.");
      return;
    }

    if (!accessToken) {
      toast.error("Session expired. Please sign in again.");
      return;
    }

    setSavingFundPassword(true);

    try {
      const result = await withTimeout(
        setFundPasswordFn({
          data: {
            accessToken,
            fundPassword,
            confirmFundPassword,
          },
        }),
        SECURITY_ACTION_TIMEOUT_MS,
        "Fund password creation timed out.",
      );

      setStatus(result);
      resetFundPasswordForms();
      toast.success("Fund password created.");
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "AUTH").message);
    } finally {
      setSavingFundPassword(false);
    }
  };

  const handleChangeFundPassword = async () => {
    if (savingFundPassword) return;

    if (
      currentFundPassword.length !== 4 ||
      newFundPassword.length !== 4 ||
      confirmNewFundPassword.length !== 4
    ) {
      toast.error("Fund password must be exactly 4 digits.");
      return;
    }

    if (newFundPassword !== confirmNewFundPassword) {
      toast.error("New fund passwords do not match.");
      return;
    }

    if (currentFundPassword === newFundPassword) {
      toast.error("New fund password must be different from the current one.");
      return;
    }

    if (!accessToken) {
      toast.error("Session expired. Please sign in again.");
      return;
    }

    setSavingFundPassword(true);

    try {
      const result = await withTimeout(
        changeFundPasswordFn({
          data: {
            accessToken,
            currentFundPassword,
            newFundPassword,
            confirmNewFundPassword,
          },
        }),
        SECURITY_ACTION_TIMEOUT_MS,
        "Fund password update timed out.",
      );

      setStatus(result);
      resetFundPasswordForms();
      toast.success("Fund password updated.");
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "AUTH").message);
      void loadSecurityStatus();
    } finally {
      setSavingFundPassword(false);
    }
  };

  return (
    <div className="space-y-4 lg:mx-auto lg:max-w-3xl">
      <PageHeader
        title="Security"
        description="Manage login and fund passwords"
        icon={<ShieldCheck size={18} />}
        badge={<Badge variant="neon">Protected</Badge>}
      />

      <PillTabs
        tabs={SECURITY_TABS}
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as SecurityTab)}
      />

      {activeTab === "login" ? (
        <div className="space-y-4 rounded-xl border border-[rgba(0,255,65,0.15)] bg-[#111] p-4">
          <SectionHeader
            title="Login Password"
            description="Update your account sign-in password"
            action={<KeyRound size={14} className="text-[#00ff41]" />}
          />

          <Input
            label="Current Login Password"
            type="password"
            placeholder="Enter current password"
            value={currentLoginPassword}
            onChange={(e) => setCurrentLoginPassword(e.target.value)}
            autoComplete="current-password"
          />

          <Input
            label="New Login Password"
            type="password"
            placeholder="Enter new password"
            value={newLoginPassword}
            onChange={(e) => setNewLoginPassword(e.target.value)}
            autoComplete="new-password"
            hint="Use at least 8 characters."
          />

          <Input
            label="Confirm New Login Password"
            type="password"
            placeholder="Confirm new password"
            value={confirmLoginPassword}
            onChange={(e) => setConfirmLoginPassword(e.target.value)}
            autoComplete="new-password"
          />

          <Button
            fullWidth
            loading={savingLoginPassword}
            onClick={handleChangeLoginPassword}
          >
            Save Login Password
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-4 rounded-xl border border-[rgba(0,255,65,0.15)] bg-[#111] p-4">
            <SectionHeader
              title="Fund Password"
              description="Required for withdrawal security"
              action={
                loadingStatus ? (
                  <Spinner size="sm" />
                ) : (
                  <Badge variant={status.hasFundPassword ? "success" : "default"}>
                    {status.hasFundPassword ? "Set" : "Not Set"}
                  </Badge>
                )
              }
            />

            {status.isFundPasswordLocked && (
              <InlineNotice variant="warning" icon={<Info size={13} />}>
                Fund password is temporarily locked due to failed attempts. Please try again later.
              </InlineNotice>
            )}

            {!status.hasFundPassword ? (
              <>
                <Input
                  label="Create 4-Digit Fund Password"
                  type="password"
                  placeholder="••••"
                  inputMode="numeric"
                  value={fundPassword}
                  onChange={(e) => setFundPassword(onlyFourDigits(e.target.value))}
                  autoComplete="new-password"
                  hint="This password is required for withdrawals."
                />
                <Input
                  label="Confirm Fund Password"
                  type="password"
                  placeholder="••••"
                  inputMode="numeric"
                  value={confirmFundPassword}
                  onChange={(e) => setConfirmFundPassword(onlyFourDigits(e.target.value))}
                  autoComplete="new-password"
                />
                <Button
                  fullWidth
                  loading={savingFundPassword}
                  onClick={handleCreateFundPassword}
                >
                  Create Fund Password
                </Button>
              </>
            ) : (
              <>
                <Input
                  label="Current Fund Password"
                  type="password"
                  placeholder="••••"
                  inputMode="numeric"
                  value={currentFundPassword}
                  onChange={(e) => setCurrentFundPassword(onlyFourDigits(e.target.value))}
                  autoComplete="current-password"
                />
                <Input
                  label="New Fund Password"
                  type="password"
                  placeholder="••••"
                  inputMode="numeric"
                  value={newFundPassword}
                  onChange={(e) => setNewFundPassword(onlyFourDigits(e.target.value))}
                  autoComplete="new-password"
                />
                <Input
                  label="Confirm New Fund Password"
                  type="password"
                  placeholder="••••"
                  inputMode="numeric"
                  value={confirmNewFundPassword}
                  onChange={(e) => setConfirmNewFundPassword(onlyFourDigits(e.target.value))}
                  autoComplete="new-password"
                />
                <Button
                  fullWidth
                  loading={savingFundPassword}
                  disabled={status.isFundPasswordLocked}
                  onClick={handleChangeFundPassword}
                >
                  Save Fund Password
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

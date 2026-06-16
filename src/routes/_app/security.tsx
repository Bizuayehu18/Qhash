import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Info, KeyRound, ShieldCheck, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { Spinner } from "@/components/ui/Spinner.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { supabase } from "@/lib/supabase.js";
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

const EMPTY_SECURITY_STATUS: SecurityStatus = {
  hasFundPassword: false,
  fundPasswordLockedUntil: null,
  fundPasswordFailedAttempts: 0,
  isFundPasswordLocked: false,
};

function onlyFourDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

function isValidLoginPassword(value: string): boolean {
  return value.trim().length >= 8;
}

function SecurityPage() {
  const { user, signOut } = useAuthStore();
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
    if (!user?.id) {
      setStatus(EMPTY_SECURITY_STATUS);
      setLoadingStatus(false);
      return;
    }

    setLoadingStatus(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        toast.error("Session expired. Please sign in again.");
        setStatus(EMPTY_SECURITY_STATUS);
        return;
      }

      const result = await getSecurityStatusFn({ data: { accessToken } });
      setStatus(result);
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "AUTH").message);
      setStatus(EMPTY_SECURITY_STATUS);
    } finally {
      setLoadingStatus(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadSecurityStatus();
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

    setSavingLoginPassword(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        toast.error("Session expired. Please sign in again.");
        return;
      }

      const result = await changeLoginPasswordFn({
        data: {
          accessToken,
          currentLoginPassword,
          newLoginPassword,
          confirmNewLoginPassword: confirmLoginPassword,
        },
      });

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

    setSavingFundPassword(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        toast.error("Session expired. Please sign in again.");
        return;
      }

      const result = await setFundPasswordFn({
        data: {
          accessToken,
          fundPassword,
          confirmFundPassword,
        },
      });

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

    setSavingFundPassword(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        toast.error("Session expired. Please sign in again.");
        return;
      }

      const result = await changeFundPasswordFn({
        data: {
          accessToken,
          currentFundPassword,
          newFundPassword,
          confirmNewFundPassword,
        },
      });

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
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ShieldCheck size={18} className="text-[#00ff41]" />
        <div>
          <h1 className="text-lg font-bold">Security</h1>
          <p className="text-xs text-gray-500 mt-1">Manage login and fund passwords</p>
        </div>
        <Badge variant="neon" className="ml-auto">Protected</Badge>
      </div>

      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {([
          { key: "login", label: "Login Password" },
          { key: "fund", label: "Fund Password" },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] border transition-colors card-press ${
              activeTab === tab.key
                ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]"
                : "text-gray-500 border-[#1f1f1f]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "login" ? (
        <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound size={14} className="text-[#00ff41]" />
            <span className="text-xs font-semibold">Login Password</span>
          </div>

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
          <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Wallet size={14} className="text-[#00ff41]" />
                <span className="text-xs font-semibold">Fund Password</span>
              </div>
              {loadingStatus ? (
                <Spinner size="sm" />
              ) : (
                <Badge variant={status.hasFundPassword ? "success" : "default"}>
                  {status.hasFundPassword ? "Set" : "Not Set"}
                </Badge>
              )}
            </div>

            {status.isFundPasswordLocked && (
              <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-300">
                <Info size={13} className="text-amber-400 shrink-0 mt-0.5" />
                Fund password is temporarily locked due to failed attempts. Please try again later.
              </div>
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

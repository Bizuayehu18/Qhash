import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Info, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { InlineNotice } from "@/components/ui/InlineNotice.js";
import { Input } from "@/components/ui/Input.js";
import { Spinner } from "@/components/ui/Spinner.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { withTimeout } from "@/lib/async.js";
import {
  changeFundPasswordFn,
  getSecurityStatusFn,
  setFundPasswordFn,
  type SecurityStatus,
} from "@/lib/server/security.js";
import { useAuthStore } from "@/store/authStore.js";

export const Route = createFileRoute("/_app/profile/security/fund-password")({
  component: FundPasswordPage,
});

const SECURITY_STATUS_TIMEOUT_MS = 10_000;
const SECURITY_ACTION_TIMEOUT_MS = 15_000;

const EMPTY_SECURITY_STATUS: SecurityStatus = {
  hasFundPassword: false,
  fundPasswordLockedUntil: null,
  fundPasswordFailedAttempts: 0,
  isFundPasswordLocked: false,
};

function onlyFourDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

function FundPasswordPage() {
  const { user } = useAuthStore();
  const accessToken = useAuthStore((state) => state.session?.access_token ?? null);
  const navigate = useNavigate();

  const [status, setStatus] = useState<SecurityStatus>(EMPTY_SECURITY_STATUS);
  const [loadingStatus, setLoadingStatus] = useState(true);

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

  const resetFundPasswordForms = () => {
    setFundPassword("");
    setConfirmFundPassword("");
    setCurrentFundPassword("");
    setNewFundPassword("");
    setConfirmNewFundPassword("");
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
    <div className="space-y-3 lg:mx-auto lg:max-w-3xl">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate({ to: "/profile/security" })}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.06] bg-[#111] text-gray-300 card-press"
          aria-label="Back to security"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
            Account Security
          </p>
          <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">Fund Password</h1>
        </div>
      </div>

      <div className="rounded-2xl border border-[#1a1a1a] bg-[#111] p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[rgba(0,255,65,0.25)] bg-[rgba(0,255,65,0.1)]">
            <Wallet size={20} className="text-[#00ff41]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold leading-tight text-gray-100">
                Withdrawal security
              </h2>
              {loadingStatus ? (
                <Spinner size="sm" />
              ) : (
                <Badge variant={status.hasFundPassword ? "success" : "default"}>
                  {status.hasFundPassword ? "Set" : "Not set"}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              Your 4-digit fund password is required before withdrawals.
            </p>
          </div>
        </div>
      </div>

      {status.isFundPasswordLocked && (
        <InlineNotice variant="warning" icon={<Info size={13} />}>
          Fund password is temporarily locked due to failed attempts. Please try again later.
        </InlineNotice>
      )}

      <div className="space-y-4 rounded-2xl border border-[rgba(0,255,65,0.14)] bg-[#111] p-4">
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
              size="lg"
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
              size="lg"
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
  );
}

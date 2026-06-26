import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, KeyRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { withTimeout } from "@/lib/async.js";
import { changeLoginPasswordFn } from "@/lib/server/security.js";
import { useAuthStore } from "@/store/authStore.js";

export const Route = createFileRoute("/_app/profile/security/login-password")({
  component: LoginPasswordPage,
});

const SECURITY_ACTION_TIMEOUT_MS = 15_000;

function isValidLoginPassword(value: string): boolean {
  return value.trim().length >= 8;
}

function LoginPasswordPage() {
  const signOut = useAuthStore((state) => state.signOut);
  const accessToken = useAuthStore((state) => state.session?.access_token ?? null);
  const navigate = useNavigate();

  const [currentLoginPassword, setCurrentLoginPassword] = useState("");
  const [newLoginPassword, setNewLoginPassword] = useState("");
  const [confirmLoginPassword, setConfirmLoginPassword] = useState("");
  const [savingLoginPassword, setSavingLoginPassword] = useState(false);

  const resetLoginPasswordForm = () => {
    setCurrentLoginPassword("");
    setNewLoginPassword("");
    setConfirmLoginPassword("");
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
          <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">Login Password</h1>
        </div>
      </div>

      <div className="rounded-2xl border border-[#1a1a1a] bg-[#111] p-4">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-[rgba(0,255,65,0.25)] bg-[rgba(0,255,65,0.1)]">
            <KeyRound size={20} className="text-[#00ff41]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold leading-tight text-gray-100">Update login password</h2>
            <p className="mt-1 text-xs leading-relaxed text-gray-500">
              Change the password used to sign in. You will need to log in again after saving.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border border-[rgba(0,255,65,0.14)] bg-[#111] p-4">
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
          size="lg"
          loading={savingLoginPassword}
          onClick={handleChangeLoginPassword}
        >
          Save Login Password
        </Button>
      </div>
    </div>
  );
}

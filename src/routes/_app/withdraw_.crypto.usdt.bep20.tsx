import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { NowpaymentsUsdtWithdrawal } from "@/domains/withdrawals/public.js";
import { useAuthStore } from "@/store/authStore.js";

export const Route = createFileRoute("/_app/withdraw_/crypto/usdt/bep20")({
  component: UsdtBep20WithdrawalPage,
});

function UsdtBep20WithdrawalPage() {
  const accessToken = useAuthStore((state) => state.session?.access_token ?? null);
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const navigate = useNavigate();

  return (
    <div className="space-y-3 lg:mx-auto lg:max-w-3xl">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
          Withdrawal Center
        </p>
        <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">Withdraw</h1>
        <p className="mt-1 text-xs text-gray-500">
          Request a withdrawal via CBE, TeleBirr, or USDT BEP20.
        </p>
      </div>

      <NowpaymentsUsdtWithdrawal
        accessToken={accessToken}
        userId={userId}
        onBack={() => {
          void navigate({ to: "/withdraw", replace: true });
        }}
      />
    </div>
  );
}

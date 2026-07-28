import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { UsdtBep20Deposit } from "@/domains/crypto-deposits/public.js";
import { useAuthStore } from "@/store/authStore.js";

export const Route = createFileRoute("/_app/deposit_/crypto/usdt/bep20")({
  component: UsdtBep20DepositPage,
});

function UsdtBep20DepositPage() {
  const accessToken = useAuthStore((state) => state.session?.access_token ?? null);
  const navigate = useNavigate();

  return (
    <div className="space-y-3 lg:mx-auto lg:max-w-3xl">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
          Deposit Center
        </p>
        <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">Deposit</h1>
        <p className="mt-1 text-xs text-gray-500">
          Add funds via CBE, TeleBirr, or USDT BEP20
        </p>
      </div>

      <UsdtBep20Deposit
        accessToken={accessToken}
        onBack={() => {
          void navigate({ to: "/deposit", replace: true });
        }}
      />
    </div>
  );
}

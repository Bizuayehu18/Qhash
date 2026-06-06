import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { Spinner } from "@/components/ui/Spinner.js";
import { ArrowUpCircle, Info } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/authStore.js";
import { useWalletStore } from "@/store/walletStore.js";
import { supabase } from "@/lib/supabase.js";
import { getTransactionsFn } from "@/lib/server/transactions.js";

export const Route = createFileRoute("/_app/withdraw")({
  component: WithdrawPage,
});

type Transaction = Awaited<ReturnType<typeof getTransactionsFn>>[number];

function WithdrawPage() {
  const { user } = useAuthStore();
  const [amount, setAmount] = useState("");
  const [address, setAddress] = useState("");
  const walletBalance = useWalletStore((s) => s.balance);
  const loadingBalance = useWalletStore((s) => s.loading);
  const fetchWallet = useWalletStore((s) => s.fetchWallet);
  const [withdrawals, setWithdrawals] = useState<Transaction[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    if (user?.id && walletBalance === null) {
      fetchWallet(user.id);
    }
  }, [user?.id, walletBalance, fetchWallet]);

  useEffect(() => {
    if (!user?.id) return;
    setLoadingHistory(true);
    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        setWithdrawals([]);
        return;
      }
      const rows = await getTransactionsFn({ data: { accessToken, type: "withdrawal" } });
      setWithdrawals(rows);
    })()
      .catch((err) => {
        console.error("Failed to load withdrawal history:", err);
      })
      .finally(() => setLoadingHistory(false));
  }, [user?.id]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Withdraw</h1>
        <p className="text-xs text-gray-500 mt-1">Request a withdrawal</p>
      </div>

      {/* Coming soon notice */}
      <div className="bg-[rgba(0,255,65,0.04)] rounded-xl border border-[rgba(0,255,65,0.2)] p-4 flex gap-2.5">
        <Info size={15} className="text-[#00ff41] shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-[#00ff41]">Coming soon</p>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Withdrawals are coming soon. This feature is not available yet.
          </p>
        </div>
      </div>

      {/* Balance */}
      <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-4 flex items-center justify-between">
        <span className="text-xs text-gray-500">Available Balance</span>
        {loadingBalance ? (
          <Spinner size="sm" />
        ) : (
          <span className="text-sm font-bold text-[#00ff41]">
            {walletBalance?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "0.00"} ETB
          </span>
        )}
      </div>

      {/* Withdraw form */}
      <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-4 opacity-60">
        <div className="flex items-center gap-2 mb-1">
          <ArrowUpCircle size={14} className="text-[#00ff41]" />
          <span className="text-xs font-semibold">Withdrawal Request</span>
        </div>

        <Input
          label="Amount (ETB)"
          type="number"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          min="500"
          step="0.01"
          disabled
        />
        <Input
          label="Bank Account / Mobile Money"
          type="text"
          placeholder="Enter your receiving account"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled
        />

        <div className="p-3 rounded-xl bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.1)] flex gap-2 text-[11px] text-gray-400">
          <Info size={13} className="text-[#00ff41] shrink-0 mt-0.5" />
          Withdrawals are processed within 24 hours. Minimum 500 ETB. 2% fee applies.
        </div>

        <Button fullWidth disabled>
          Coming Soon
        </Button>
      </div>

      {/* History */}
      <div>
        <h2 className="text-sm font-semibold mb-3">Withdrawal History</h2>
        {loadingHistory ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton h-14 rounded-xl" />)}
          </div>
        ) : withdrawals.length === 0 ? (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-8 text-center text-xs text-gray-600">
            No withdrawals yet
          </div>
        ) : (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
            {withdrawals.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <span className="text-xs font-mono text-red-400">
                    -{Math.abs(tx.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB
                  </span>
                  <p className="text-[10px] text-gray-600 mt-0.5">
                    {new Date(tx.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>
                <TxStatusBadge status={tx.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TxStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "success" | "warning" | "danger" | "default" }> = {
    completed: { label: "Completed", variant: "success" },
    pending: { label: "Pending", variant: "warning" },
    failed: { label: "Failed", variant: "danger" },
  };
  const { label, variant } = config[status] ?? { label: status, variant: "default" as const };
  return <Badge variant={variant}>{label}</Badge>;
}

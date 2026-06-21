import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Clock, Power, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { supabase } from "@/lib/supabase.js";
import { useAuthStore } from "@/store/authStore.js";

export const Route = createFileRoute("/_app/admin-earnings")({
  component: AdminEarningsPage,
});

function AdminEarningsPage() {
  const { profile } = useAuthStore();
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    runId: string;
    triggerType: string;
    status: string;
    activeInvestments: number;
    usersProcessed: number;
    investmentsProcessed: number;
    earningsCredited: number;
    transactionsCreated: number;
    errors: number;
  } | null>(null);

  useEffect(() => {
    if (profile && !profile.is_admin) navigate({ to: "/dashboard" });
  }, [profile, navigate]);

  if (!profile?.is_admin) return null;

  const runEarningsNow = async () => {
    if (running) return;

    if (!accessToken) {
      toast.error("Session expired. Please sign in again.");
      return;
    }

    const confirmed = window.confirm(
      "Run due mining earnings now? Only investments whose next earning time has already arrived will be credited.",
    );

    if (!confirmed) return;

    setRunning(true);
    setResult(null);

    try {
      const response = await fetch("/api/admin/trigger-daily-earnings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const body = await response.json();

      if (!response.ok || !body?.success) {
        throw new Error(body?.message ?? "Failed to run earnings processor.");
      }

      const summary = {
        runId: String(body.run_id ?? ""),
        triggerType: String(body.trigger_type ?? "manual"),
        status: String(body.status ?? "unknown"),
        activeInvestments: Number(body.total_active_investments ?? 0),
        usersProcessed: Number(body.total_users_processed ?? 0),
        investmentsProcessed: Number(body.total_investments_processed ?? 0),
        earningsCredited: Number(body.total_earnings_credited ?? 0),
        transactionsCreated: Number(body.total_transactions_created ?? 0),
        errors: Number(body.total_errors ?? 0),
      };

      setResult(summary);

      if (summary.errors > 0) {
        toast.warning("Earnings run completed with errors. Check earning_run_logs.");
      } else {
        toast.success("Earnings run completed successfully.");
      }
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "ADMIN").message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <ShieldCheck size={18} className="text-[#00ff41]" />
        <div>
          <h1 className="text-lg font-bold">Earnings Processor</h1>
          <p className="text-[11px] text-gray-500">Manual admin run for due mining earnings</p>
        </div>
        <Badge variant="neon" className="ml-auto">Admin</Badge>
      </div>

      <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-4 space-y-4">
        <div className="flex items-start gap-3">
          <Clock size={16} className="text-[#00ff41] mt-0.5 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-gray-200">Run earnings now</h2>
            <p className="text-[11px] text-gray-500 leading-relaxed mt-1">
              This uses the same server endpoint as the scheduled job. It checks all active investments and credits only those whose next earning time is already due.
            </p>
          </div>
        </div>

        <Button loading={running} onClick={runEarningsNow} className="w-full">
          <Power size={14} /> Run due earnings now
        </Button>

        {result && (
          <div className="grid grid-cols-2 gap-3 pt-4 border-t border-[#1f1f1f]">
            <SummaryItem label="Run ID" value={result.runId} />
            <SummaryItem label="Trigger" value={result.triggerType} />
            <SummaryItem label="Status" value={result.status} highlight={result.errors === 0} />
            <SummaryItem label="Active Plans" value={String(result.activeInvestments)} />
            <SummaryItem label="Users Processed" value={String(result.usersProcessed)} />
            <SummaryItem label="Plans Processed" value={String(result.investmentsProcessed)} />
            <SummaryItem label="Transactions" value={String(result.transactionsCreated)} />
            <SummaryItem
              label="Credited"
              value={`${result.earningsCredited.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB`}
              highlight
            />
            <SummaryItem label="Errors" value={String(result.errors)} highlight={result.errors === 0} />
          </div>
        )}
      </div>

      <Button variant="secondary" onClick={() => navigate({ to: "/admin" })} className="w-full">
        Back to admin
      </Button>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#1a1a1a] bg-[#0b0b0b] p-3">
      <p className="text-[10px] text-gray-500 mb-1">{label}</p>
      <p className={`text-xs font-medium break-all ${highlight ? "text-[#00ff41]" : "text-gray-200"}`}>{value}</p>
    </div>
  );
}

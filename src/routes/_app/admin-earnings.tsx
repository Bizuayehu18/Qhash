import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Clock, Power, RefreshCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { useAuthStore } from "@/store/authStore.js";

export const Route = createFileRoute("/_app/admin-earnings")({
  component: AdminEarningsPage,
});

type RunSummary = {
  runId: string;
  triggerType: string;
  status: string;
  activeInvestments: number;
  usersProcessed: number;
  investmentsProcessed: number;
  earningsCredited: number;
  transactionsCreated: number;
  errors: number;
};

type RunHistoryRow = {
  run_id: string;
  trigger_type: string;
  started_at: string | null;
  completed_at: string | null;
  status: string;
  total_active_investments: number | null;
  total_users_processed: number | null;
  total_investments_processed: number | null;
  total_earnings_credited: number | null;
  total_errors: number | null;
  total_transactions_created: number | null;
  created_at: string | null;
};

function AdminEarningsPage() {
  const { profile } = useAuthStore();
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [history, setHistory] = useState<RunHistoryRow[]>([]);
  const [result, setResult] = useState<RunSummary | null>(null);

  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${accessToken ?? ""}` }), [accessToken]);

  const loadHistory = useCallback(async () => {
    if (!accessToken) return;
    setLoadingHistory(true);
    try {
      const response = await fetch("/api/admin/trigger-daily-earnings", {
        method: "GET",
        headers: authHeaders(),
      });
      const body = await response.json();
      if (!response.ok || !body?.success) throw new Error(body?.message ?? "Failed to load earning run history.");
      setHistory(Array.isArray(body.runs) ? body.runs : []);
      setHistoryLoaded(true);
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "ADMIN").message);
    } finally {
      setLoadingHistory(false);
    }
  }, [accessToken, authHeaders]);

  useEffect(() => {
    if (profile && !profile.is_admin) navigate({ to: "/dashboard" });
  }, [profile, navigate]);

  useEffect(() => {
    if (profile?.is_admin && accessToken) void loadHistory();
  }, [profile?.is_admin, accessToken, loadHistory]);

  if (!profile?.is_admin) return null;

  const runEarningsNow = async () => {
    if (running) return;
    if (!accessToken) return toast.error("Session expired. Please sign in again.");
    if (!window.confirm("Run due mining earnings now? Only due investments will be credited.")) return;

    setRunning(true);
    setResult(null);
    try {
      const response = await fetch("/api/admin/trigger-daily-earnings", {
        method: "POST",
        headers: authHeaders(),
      });
      const body = await response.json();
      if (!response.ok || !body?.success) throw new Error(body?.message ?? "Failed to run earnings processor.");

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
      void loadHistory();
      summary.errors > 0
        ? toast.warning("Earnings run completed with errors.")
        : toast.success("Earnings run completed successfully.");
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
              This checks all active investments and credits only those whose next earning time is already due.
            </p>
          </div>
        </div>
        <Button loading={running} onClick={runEarningsNow} className="w-full">
          <Power size={14} /> Run due earnings now
        </Button>
        {result && <RunSummaryGrid result={result} />}
      </div>

      <section className="bg-[#111] rounded-xl border border-[#1a1a1a] p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-200">Earning Run History</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">Latest scheduled and manual earning checks</p>
          </div>
          <button
            type="button"
            onClick={() => void loadHistory()}
            disabled={loadingHistory}
            className="grid h-8 w-8 place-items-center rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] text-gray-500 hover:text-[#00ff41] disabled:opacity-50 card-press"
            aria-label="Refresh earning run history"
          >
            <RefreshCcw size={14} className={loadingHistory ? "animate-spin" : ""} />
          </button>
        </div>
        {!historyLoaded && loadingHistory ? (
          <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-20 rounded-xl" />)}</div>
        ) : history.length === 0 ? (
          <div className="rounded-xl border border-[#1a1a1a] bg-[#0b0b0b] p-6 text-center text-xs text-gray-600">No earning runs yet</div>
        ) : (
          <div className="space-y-2.5">{history.map((run) => <RunHistoryCard key={run.run_id} run={run} />)}</div>
        )}
      </section>

      <Button variant="secondary" onClick={() => navigate({ to: "/admin" })} className="w-full">
        Back to admin
      </Button>
    </div>
  );
}

function RunSummaryGrid({ result }: { result: RunSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 pt-4 border-t border-[#1f1f1f]">
      <SummaryItem label="Run ID" value={result.runId} />
      <SummaryItem label="Trigger" value={result.triggerType} />
      <SummaryItem label="Status" value={result.status} highlight={result.errors === 0} />
      <SummaryItem label="Active Plans" value={String(result.activeInvestments)} />
      <SummaryItem label="Plans Processed" value={String(result.investmentsProcessed)} />
      <SummaryItem label="Transactions" value={String(result.transactionsCreated)} />
      <SummaryItem label="Credited" value={`${formatMoney(result.earningsCredited)} ETB`} highlight />
      <SummaryItem label="Errors" value={String(result.errors)} highlight={result.errors === 0} />
    </div>
  );
}

function RunHistoryCard({ run }: { run: RunHistoryRow }) {
  const errors = Number(run.total_errors ?? 0);
  const credited = Number(run.total_earnings_credited ?? 0);
  const transactions = Number(run.total_transactions_created ?? 0);
  return (
    <div className="rounded-xl border border-[#1a1a1a] bg-[#0b0b0b] p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-gray-200 capitalize">{run.trigger_type ?? "unknown"} · {run.status ?? "unknown"}</p>
          <p className="text-[10px] text-gray-600 mt-1 break-all">{run.run_id}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs font-bold text-[#00ff41]">{formatMoney(credited)} ETB</p>
          <p className="text-[10px] text-gray-600">{transactions} tx</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-500">
        <Meta label="Started" value={formatDateTime(run.started_at ?? run.created_at)} />
        <Meta label="Completed" value={formatDateTime(run.completed_at)} />
        <Meta label="Active" value={String(run.total_active_investments ?? 0)} />
        <Meta label="Processed" value={String(run.total_investments_processed ?? 0)} />
        <Meta label="Users" value={String(run.total_users_processed ?? 0)} />
        <Meta label="Errors" value={String(errors)} accent={errors === 0} danger={errors > 0} />
      </div>
    </div>
  );
}

function Meta({ label, value, accent, danger }: { label: string; value: string; accent?: boolean; danger?: boolean }) {
  return <div><span className="text-gray-600">{label}</span><p className={danger ? "text-red-400" : accent ? "text-[#00ff41]" : "text-gray-400"}>{value}</p></div>;
}

function SummaryItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-[#1a1a1a] bg-[#0b0b0b] p-3">
      <p className="text-[10px] text-gray-500 mb-1">{label}</p>
      <p className={`text-xs font-medium break-all ${highlight ? "text-[#00ff41]" : "text-gray-200"}`}>{value}</p>
    </div>
  );
}

function formatMoney(value: number): string {
  return Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

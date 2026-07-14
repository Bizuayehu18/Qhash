import { useCallback, useEffect, useRef, useState } from "react";
import { Database, ExternalLink, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { withTimeout } from "@/lib/async.js";
import {
  getAdminCryptoDepositAuditFn,
  type AdminCryptoDepositAuditRow,
} from "@/lib/server/crypto-admin-deposits.js";
import { useAuthStore } from "@/store/authStore.js";

const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 1_500;
const MAX_RETRIES = 2;

type NetworkFilter = "all" | "TRON" | "BSC";
type StatusFilter = "all" | "detected" | "confirmed" | "credited" | "swept" | "failed";

type RequestState = {
  accessToken: string | null;
  userId: string | undefined;
  networkFilter: NetworkFilter;
  statusFilter: StatusFilter;
  submittedSearchQuery: string;
};

function shortValue(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "—";
  return timestamp.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusVariant(status: string): "success" | "warning" | "danger" | "default" {
  if (status === "detected") return "warning";
  if (status === "credited" || status === "swept") return "success";
  if (status === "failed") return "danger";
  return "default";
}

function AuditRow({ row }: { row: AdminCryptoDepositAuditRow }) {
  const explorerUrl = row.network === "BSC" ? `https://bscscan.com/tx/${row.txHash}` : null;

  return (
    <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] p-3 text-[11px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={row.network === "TRON" ? "neon" : "default"}>{row.network}</Badge>
            <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
            <Badge variant="default">event #{row.eventIndex}</Badge>
          </div>
          <p className="text-xs font-medium text-gray-200">@{row.username}</p>
          <p className="text-[10px] text-gray-600">{row.phone ?? "No phone"}</p>
        </div>
        <div className="shrink-0 text-right text-[10px] text-gray-600">
          <p>{row.asset}</p>
          <p>{formatTimestamp(row.detectedAt)}</p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-[#1a1a1a] bg-[#111] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <code className="min-w-0 truncate text-[11px] text-[#00ff41]" title={row.txHash}>{shortValue(row.txHash)}</code>
          {explorerUrl ? (
            <a href={explorerUrl} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] text-gray-500 transition-colors hover:text-[#00ff41]">
              <ExternalLink size={11} /> Explorer
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <span className="block text-gray-700">Amount</span>
          <span className="font-mono text-gray-200">{row.amountUsdt} USDT</span>
          <span className="mt-0.5 block break-all font-mono text-[10px] text-gray-700">raw {row.amountRaw}</span>
        </div>
        <div>
          <span className="block text-gray-700">Block / confirmations</span>
          <span className="font-mono text-gray-500">{row.blockNumber ?? "—"} / {row.confirmations}</span>
        </div>
        <div>
          <span className="block text-gray-700">From</span>
          <span className="font-mono text-gray-500" title={row.fromAddress ?? undefined}>{row.fromAddress ? shortValue(row.fromAddress) : "—"}</span>
        </div>
        <div>
          <span className="block text-gray-700">To</span>
          <span className="font-mono text-gray-500" title={row.toAddress}>{shortValue(row.toAddress)}</span>
        </div>
        <div>
          <span className="block text-gray-700">Assigned address</span>
          <span className="font-mono text-gray-500" title={row.assignedAddress ?? undefined}>{row.assignedAddress ? shortValue(row.assignedAddress) : "—"}</span>
        </div>
        <div>
          <span className="block text-gray-700">User ID</span>
          <span className="font-mono text-gray-500" title={row.userId}>{shortValue(row.userId)}</span>
        </div>
      </div>
    </div>
  );
}

export function AdminCryptoDepositAuditPanel({ userId }: { userId: string | undefined }) {
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const [rows, setRows] = useState<AdminCryptoDepositAuditRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>("BSC");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("detected");
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const pendingReloadRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRequestRef = useRef<RequestState>({ accessToken, userId, networkFilter, statusFilter, submittedSearchQuery });
  latestRequestRef.current = { accessToken, userId, networkFilter, statusFilter, submittedSearchQuery };

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback((loadFn: () => void) => {
    clearRetryTimer();
    if (retryCountRef.current >= MAX_RETRIES) return;
    retryCountRef.current += 1;
    retryTimerRef.current = setTimeout(loadFn, RETRY_DELAY_MS);
  }, [clearRetryTimer]);

  const loadAudit = useCallback(async (options?: { resetRetryCount?: boolean; resetLoaded?: boolean }) => {
    if (options?.resetRetryCount) retryCountRef.current = 0;
    if (options?.resetLoaded) setLoaded(false);

    if (loadingRef.current) {
      pendingReloadRef.current = true;
      requestSequenceRef.current += 1;
      return;
    }

    const requestState = latestRequestRef.current;
    if (!requestState.userId) return;
    if (!requestState.accessToken) {
      scheduleRetry(() => void loadAudit());
      return;
    }

    clearRetryTimer();
    loadingRef.current = true;
    pendingReloadRef.current = false;
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    setRefreshing(true);

    try {
      const result = await withTimeout(
        getAdminCryptoDepositAuditFn({
          data: {
            accessToken: requestState.accessToken,
            searchQuery: requestState.submittedSearchQuery,
            networkFilter: requestState.networkFilter,
            statusFilter: requestState.statusFilter,
          },
        }),
        TIMEOUT_MS,
        "Admin crypto deposit audit request timed out.",
      );

      if (!mountedRef.current || requestId !== requestSequenceRef.current) return;
      setRows(result.rows);
      setLoaded(true);
      retryCountRef.current = 0;
    } catch (err) {
      console.error("[QHash] Admin crypto deposit audit background refresh failed:", err);
      if (!mountedRef.current || requestId !== requestSequenceRef.current) return;
      scheduleRetry(() => void loadAudit());
    } finally {
      loadingRef.current = false;
      if (!mountedRef.current) return;

      if (pendingReloadRef.current) {
        pendingReloadRef.current = false;
        void loadAudit({ resetRetryCount: true, resetLoaded: true });
        return;
      }

      setRefreshing(false);
    }
  }, [clearRetryTimer, scheduleRetry]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  useEffect(() => {
    void loadAudit({ resetRetryCount: true, resetLoaded: true });
  }, [accessToken, loadAudit, networkFilter, statusFilter, submittedSearchQuery, userId]);

  const handleSearch = () => {
    const nextSearchQuery = searchQuery.trim();
    if (nextSearchQuery === submittedSearchQuery) {
      void loadAudit({ resetRetryCount: true, resetLoaded: true });
      return;
    }

    retryCountRef.current = 0;
    setLoaded(false);
    setSubmittedSearchQuery(nextSearchQuery);
  };

  return (
    <div className="rounded-xl border border-[rgba(0,255,65,0.15)] bg-[#111] p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Database size={14} className="text-[#00ff41]" />
            <span className="text-xs font-semibold">Crypto Deposit Audit</span>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">Admin-only read-only audit of stored crypto deposit rows.</p>
        </div>
        <Badge variant={loaded ? "success" : "default"}>{loaded ? `${rows.length} shown` : "Loading"}</Badge>
      </div>

      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-[11px] leading-relaxed text-blue-100/80">
        Read-only admin view. This panel cannot confirm, credit, sweep, edit balances, expose addresses to users, or enable crypto deposits.
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input label="Search deposit audit" placeholder="Username, phone, user ID, address, tx hash" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} hint="Click Search to apply changes." />
        <div className="flex items-end">
          <Button size="sm" loading={refreshing} onClick={handleSearch}><RefreshCw size={13} /> Search</Button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {(["all", "TRON", "BSC"] as const).map((filter) => (
          <button key={filter} onClick={() => setNetworkFilter(filter)} className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] border transition-colors card-press ${networkFilter === filter ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]" : "text-gray-500 border-[#1f1f1f]"}`}>{filter === "all" ? "All networks" : filter}</button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {(["all", "detected", "confirmed", "credited", "swept", "failed"] as const).map((filter) => (
          <button key={filter} onClick={() => setStatusFilter(filter)} className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] border transition-colors card-press ${statusFilter === filter ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]" : "text-gray-500 border-[#1f1f1f]"}`}>{filter === "all" ? "All statuses" : filter}</button>
        ))}
      </div>

      {!loaded ? (
        <div className="space-y-2">{[1, 2].map((item) => <div key={item} className="skeleton h-28 rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] p-6 text-center text-xs text-gray-600">No crypto deposit audit rows found.</div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">{rows.map((row) => <AuditRow key={row.id} row={row} />)}</div>
      )}
    </div>
  );
}

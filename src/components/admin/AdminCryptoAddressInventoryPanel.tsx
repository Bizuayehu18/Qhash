import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, RefreshCw, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { Spinner } from "@/components/ui/Spinner.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { withTimeout } from "@/lib/async.js";
import {
  getAdminCryptoAddressInventoryFn,
  type AdminCryptoAddressInventoryRow,
} from "@/lib/server/crypto-admin-addresses.js";
import { useAuthStore } from "@/store/authStore.js";

const ADMIN_CRYPTO_ADDRESS_TIMEOUT_MS = 10_000;
const ADMIN_CRYPTO_ADDRESS_RETRY_DELAY_MS = 1_500;
const ADMIN_CRYPTO_ADDRESS_MAX_RETRIES = 2;

type NetworkFilter = "all" | "TRON" | "BSC";

function shortAddress(address: string): string {
  if (address.length <= 18) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "—";

  return timestamp.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function addressStatusVariant(status: string): "success" | "warning" | "danger" | "default" {
  if (status === "active") return "success";
  if (status === "reserved" || status === "pending") return "warning";
  if (status === "disabled" || status === "blocked") return "danger";
  return "default";
}

function activationStatusVariant(status: string): "success" | "warning" | "danger" | "default" {
  if (status === "active" || status === "not_required") return "success";
  if (status === "pending") return "warning";
  if (status === "failed" || status === "inactive") return "danger";
  return "default";
}

function AddressInventoryRow({ row }: { row: AdminCryptoAddressInventoryRow }) {
  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(row.address);
      toast.success("Address copied.");
    } catch {
      toast.error("Unable to copy address.");
    }
  };

  return (
    <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={row.network === "TRON" ? "neon" : "default"}>{row.network}</Badge>
            <Badge variant={addressStatusVariant(row.status)}>{row.status}</Badge>
            <Badge variant={activationStatusVariant(row.activationStatus)}>{row.activationStatus}</Badge>
          </div>
          <p className="text-xs font-medium text-gray-200">@{row.username}</p>
          <p className="text-[10px] text-gray-600">{row.phone ?? "No phone"}</p>
        </div>
        <div className="shrink-0 text-right text-[10px] text-gray-600">
          <p>{row.asset}</p>
          <p>{formatTimestamp(row.createdAt)}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#1a1a1a] bg-[#111] px-3 py-2">
        <code className="min-w-0 flex-1 truncate text-[11px] text-[#00ff41]" title={row.address}>
          {shortAddress(row.address)}
        </code>
        <button
          type="button"
          onClick={copyAddress}
          className="shrink-0 rounded-lg p-1.5 text-gray-500 transition-colors hover:text-[#00ff41]"
          title="Copy public deposit address"
        >
          <Copy size={13} />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-gray-600">
        <div>
          <span className="block text-gray-700">User ID</span>
          <span className="font-mono">{shortAddress(row.userId)}</span>
        </div>
        <div>
          <span className="block text-gray-700">Derivation</span>
          <span>{row.derivationIndex ?? "—"}</span>
        </div>
      </div>
    </div>
  );
}

export function AdminCryptoAddressInventoryPanel({ userId }: { userId: string | undefined }) {
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const [rows, setRows] = useState<AdminCryptoAddressInventoryRow[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedSearchQuery, setSubmittedSearchQuery] = useState("");
  const [networkFilter, setNetworkFilter] = useState<NetworkFilter>("all");
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback(
    (loadFn: () => void) => {
      clearRetryTimer();

      if (retryCountRef.current >= ADMIN_CRYPTO_ADDRESS_MAX_RETRIES) return;

      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(loadFn, ADMIN_CRYPTO_ADDRESS_RETRY_DELAY_MS);
    },
    [clearRetryTimer],
  );

  const loadInventory = useCallback(
    async (options?: { resetRetryCount?: boolean; resetLoaded?: boolean }) => {
      if (loadingRef.current) return;

      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (options?.resetLoaded) {
        setLoaded(false);
      }

      if (!userId) return;

      if (!accessToken) {
        scheduleRetry(() => {
          void loadInventory();
        });
        return;
      }

      clearRetryTimer();
      loadingRef.current = true;
      setRefreshing(true);

      try {
        const result = await withTimeout(
          getAdminCryptoAddressInventoryFn({
            data: {
              accessToken,
              searchQuery: submittedSearchQuery,
              networkFilter,
            },
          }),
          ADMIN_CRYPTO_ADDRESS_TIMEOUT_MS,
          "Admin crypto address inventory request timed out.",
        );

        if (!mountedRef.current) return;

        setRows(result.rows);
        setLoaded(true);
        retryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Admin crypto address inventory background refresh failed:", err);

        if (!mountedRef.current) return;

        scheduleRetry(() => {
          void loadInventory();
        });
      } finally {
        loadingRef.current = false;
        if (mountedRef.current) {
          setRefreshing(false);
        }
      }
    },
    [accessToken, clearRetryTimer, networkFilter, scheduleRetry, submittedSearchQuery, userId],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadInventory({ resetRetryCount: true, resetLoaded: true });

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer, loadInventory]);

  useEffect(() => {
    const handleVisible = () => {
      if (document.visibilityState === "visible") {
        void loadInventory({ resetRetryCount: true });
      }
    };

    const handleOnline = () => {
      void loadInventory({ resetRetryCount: true });
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", handleOnline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", handleOnline);
    };
  }, [loadInventory]);

  const handleSearch = () => {
    const nextSearchQuery = searchQuery.trim();

    if (nextSearchQuery === submittedSearchQuery) {
      void loadInventory({ resetRetryCount: true, resetLoaded: true });
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
            <WalletCards size={14} className="text-[#00ff41]" />
            <span className="text-xs font-semibold">Crypto Address Inventory</span>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            Admin-only read-only inventory. This does not expose addresses to users or enable auto-credit.
          </p>
        </div>
        <Badge variant={loaded ? "success" : "default"}>{loaded ? `${rows.length} shown` : "Loading"}</Badge>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-200/80">
        Public deposit addresses may be visible here for admin operations only. This panel does not assign,
        generate, activate, sweep, sign, credit, or enable crypto deposits.
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          label="Search inventory"
          placeholder="Username, phone, user ID, address, status"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          hint="Read-only search across the latest address inventory rows. Click Search to apply changes."
        />
        <div className="flex items-end">
          <Button size="sm" loading={refreshing} onClick={handleSearch}>
            <RefreshCw size={13} /> Search
          </Button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {([
          { key: "all", label: "All" },
          { key: "TRON", label: "TRON" },
          { key: "BSC", label: "BSC" },
        ] as const).map((filter) => (
          <button
            key={filter.key}
            onClick={() => setNetworkFilter(filter.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] border transition-colors card-press ${
              networkFilter === filter.key
                ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]"
                : "text-gray-500 border-[#1f1f1f]"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {!loaded ? (
        <div className="space-y-2">
          {[1, 2].map((item) => (
            <div key={item} className="skeleton h-24 rounded-xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] p-6 text-center text-xs text-gray-600">
          No crypto deposit addresses found.
        </div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {rows.map((row) => (
            <AddressInventoryRow key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, RefreshCw, RotateCw, WalletCards } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { withTimeout } from "@/lib/async.js";
import { assignAdminCryptoDepositAddressFn } from "@/lib/server/crypto-admin-address-assignment.js";
import { rotateAdminBscDepositAddressFn } from "@/lib/server/crypto-admin-address-rotation.js";
import {
  getAdminCryptoAddressInventoryFn,
  type AdminCryptoAddressInventoryRow,
} from "@/lib/server/crypto-admin-addresses.js";
import { useAuthStore } from "@/store/authStore.js";

const ADMIN_CRYPTO_ADDRESS_TIMEOUT_MS = 10_000;
const ADMIN_CRYPTO_ADDRESS_RETRY_DELAY_MS = 1_500;
const ADMIN_CRYPTO_ADDRESS_MAX_RETRIES = 2;

type NetworkFilter = "all" | "TRON" | "BSC";
type AssignNetwork = "TRON" | "BSC";
type TronActivationStatus = "inactive" | "active";

type InventoryRequestState = {
  accessToken: string | null;
  userId: string | undefined;
  networkFilter: NetworkFilter;
  submittedSearchQuery: string;
};

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

function isValidAddressForNetwork(network: AssignNetwork, address: string): boolean {
  if (network === "TRON") return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address.trim());
  return /^0x[a-fA-F0-9]{40}$/.test(address.trim());
}

function AddressInventoryRow({
  row,
  onRotate,
}: {
  row: AdminCryptoAddressInventoryRow;
  onRotate: (row: AdminCryptoAddressInventoryRow) => void;
}) {
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

      {row.network === "BSC" && row.status === "active" && (
        <button
          type="button"
          onClick={() => onRotate(row)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 px-2.5 py-1.5 text-[10px] text-amber-200/80 transition-colors hover:border-amber-500/40 hover:text-amber-100"
        >
          <RotateCw size={11} /> Replace BSC Address
        </button>
      )}
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
  const [assigning, setAssigning] = useState(false);
  const [assignTargetUserRef, setAssignTargetUserRef] = useState("");
  const [assignNetwork, setAssignNetwork] = useState<AssignNetwork>("TRON");
  const [assignAddress, setAssignAddress] = useState("");
  const [assignTronActivationStatus, setAssignTronActivationStatus] = useState<TronActivationStatus>("inactive");
  const [rotationTarget, setRotationTarget] = useState<AdminCryptoAddressInventoryRow | null>(null);
  const [replacementAddress, setReplacementAddress] = useState("");
  const [rotating, setRotating] = useState(false);

  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const pendingReloadRef = useRef(false);
  const requestSequenceRef = useRef(0);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRequestRef = useRef<InventoryRequestState>({
    accessToken,
    userId,
    networkFilter,
    submittedSearchQuery,
  });

  latestRequestRef.current = {
    accessToken,
    userId,
    networkFilter,
    submittedSearchQuery,
  };

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
      if (options?.resetRetryCount) {
        retryCountRef.current = 0;
      }

      if (options?.resetLoaded) {
        setLoaded(false);
      }

      if (loadingRef.current) {
        pendingReloadRef.current = true;
        requestSequenceRef.current += 1;
        return;
      }

      const requestState = latestRequestRef.current;

      if (!requestState.userId) return;

      if (!requestState.accessToken) {
        scheduleRetry(() => {
          void loadInventory();
        });
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
          getAdminCryptoAddressInventoryFn({
            data: {
              accessToken: requestState.accessToken,
              searchQuery: requestState.submittedSearchQuery,
              networkFilter: requestState.networkFilter,
            },
          }),
          ADMIN_CRYPTO_ADDRESS_TIMEOUT_MS,
          "Admin crypto address inventory request timed out.",
        );

        if (!mountedRef.current || requestId !== requestSequenceRef.current) return;

        setRows(result.rows);
        setLoaded(true);
        retryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Admin crypto address inventory background refresh failed:", err);

        if (!mountedRef.current || requestId !== requestSequenceRef.current) return;

        scheduleRetry(() => {
          void loadInventory();
        });
      } finally {
        loadingRef.current = false;

        if (!mountedRef.current) return;

        if (pendingReloadRef.current) {
          pendingReloadRef.current = false;
          void loadInventory({ resetRetryCount: true, resetLoaded: true });
          return;
        }

        setRefreshing(false);
      }
    },
    [clearRetryTimer, scheduleRetry],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  useEffect(() => {
    void loadInventory({ resetRetryCount: true, resetLoaded: true });
  }, [accessToken, loadInventory, networkFilter, submittedSearchQuery, userId]);

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

  const handleAssignAddress = async () => {
    if (!userId || assigning) return;

    const targetUserRef = assignTargetUserRef.trim();
    const address = assignAddress.trim();

    if (!accessToken) {
      toast.error("Session expired. Please sign in again.");
      return;
    }

    if (targetUserRef.length < 2) {
      toast.error("Enter a target username, phone, or user ID.");
      return;
    }

    if (!isValidAddressForNetwork(assignNetwork, address)) {
      toast.error(assignNetwork === "TRON" ? "Enter a valid TRON address starting with T." : "Enter a valid BSC address starting with 0x.");
      return;
    }

    setAssigning(true);
    try {
      await assignAdminCryptoDepositAddressFn({
        data: {
          accessToken,
          targetUserRef,
          network: assignNetwork,
          address,
          activationStatus: assignNetwork === "TRON" ? assignTronActivationStatus : "not_required",
        },
      });

      toast.success("Crypto deposit address assigned.");
      setAssignAddress("");
      await loadInventory({ resetRetryCount: true, resetLoaded: true });
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "ADMIN").message);
    } finally {
      setAssigning(false);
    }
  };

  const handleRotateAddress = async () => {
    if (!userId || !rotationTarget || rotating) return;

    const newAddress = replacementAddress.trim();
    if (!accessToken) {
      toast.error("Session expired. Please sign in again.");
      return;
    }

    if (!isValidAddressForNetwork("BSC", newAddress)) {
      toast.error("Enter a valid BSC public address starting with 0x.");
      return;
    }

    if (newAddress.toLowerCase() === rotationTarget.address.toLowerCase()) {
      toast.error("Enter a different BSC address.");
      return;
    }

    const confirmed = window.confirm(
      "Replace this user's active BSC address? The old public address will be disabled and kept for deposit history. BSC user deposits must remain disabled during this operation.",
    );
    if (!confirmed) return;

    setRotating(true);
    try {
      await rotateAdminBscDepositAddressFn({
        data: {
          accessToken,
          userId: rotationTarget.userId,
          currentAddressId: rotationTarget.id,
          expectedCurrentAddress: rotationTarget.address,
          newAddress,
        },
      });

      toast.success("BSC address replaced. The old address remains in history as disabled.");
      setRotationTarget(null);
      setReplacementAddress("");
      await loadInventory({ resetRetryCount: true, resetLoaded: true });
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "ADMIN").message);
    } finally {
      setRotating(false);
    }
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
            Admin-only inventory and manual public-address assignment. This does not expose addresses to users or enable auto-credit.
          </p>
        </div>
        <Badge variant={loaded ? "success" : "default"}>{loaded ? `${rows.length} shown` : "Loading"}</Badge>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-200/80">
        Public deposit addresses may be visible here for admin operations only. This panel only assigns public addresses
        that admins provide manually. It does not generate addresses, activate deposits for users, sweep, sign, credit, or enable crypto deposits.
      </div>

      <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] p-3 space-y-3">
        <div>
          <p className="text-xs font-semibold text-gray-200">Assign public deposit address</p>
          <p className="mt-1 text-[11px] text-gray-600">
            Manual admin-only assignment. Enter a public TRON/BSC USDT address only — never private keys or seed phrases.
          </p>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            label="Target user"
            placeholder="Username, phone, or user ID"
            value={assignTargetUserRef}
            onChange={(e) => setAssignTargetUserRef(e.target.value)}
            hint="Exact match only. The server resolves this to a profile ID."
          />
          <div className="flex items-end gap-2">
            {(["TRON", "BSC"] as const).map((network) => (
              <button
                key={network}
                type="button"
                onClick={() => setAssignNetwork(network)}
                className={`shrink-0 px-3 py-2 rounded-lg text-[11px] border transition-colors card-press ${
                  assignNetwork === network
                    ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]"
                    : "text-gray-500 border-[#1f1f1f]"
                }`}
              >
                {network}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
          <Input
            label="Public address"
            placeholder={assignNetwork === "TRON" ? "T..." : "0x..."}
            value={assignAddress}
            onChange={(e) => setAssignAddress(e.target.value)}
            hint={assignNetwork === "TRON" ? "TRON TRC20 public address." : "BSC BEP20 public address."}
          />

          {assignNetwork === "TRON" ? (
            <div className="flex items-end gap-2">
              {(["inactive", "active"] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setAssignTronActivationStatus(status)}
                  className={`shrink-0 px-3 py-2 rounded-lg text-[11px] border transition-colors card-press ${
                    assignTronActivationStatus === status
                      ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]"
                      : "text-gray-500 border-[#1f1f1f]"
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-end">
              <Badge variant="success">not_required</Badge>
            </div>
          )}

          <div className="flex items-end">
            <Button size="sm" loading={assigning} onClick={handleAssignAddress}>
              Assign Address
            </Button>
          </div>
        </div>
      </div>

      {rotationTarget && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <RotateCw size={13} className="text-amber-300" />
              <p className="text-xs font-semibold text-amber-100">Replace active BSC address</p>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">
              @{rotationTarget.username}: {shortAddress(rotationTarget.address)}. The old public address will be disabled,
              not deleted, so existing deposit history remains linked correctly. Never enter a private key or seed phrase.
            </p>
          </div>

          <Input
            label="New BSC public address"
            placeholder="0x..."
            value={replacementAddress}
            onChange={(event) => setReplacementAddress(event.target.value)}
            hint="Trust Wallet-controlled BEP20 receive address. User exposure must be disabled and the watcher must be healthy."
          />

          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={rotating} onClick={handleRotateAddress}>
              Replace Address Safely
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={rotating}
              onClick={() => {
                setRotationTarget(null);
                setReplacementAddress("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

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
            <AddressInventoryRow
              key={row.id}
              row={row}
              onRotate={(selectedRow) => {
                setRotationTarget(selectedRow);
                setReplacementAddress("");
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

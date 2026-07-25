import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { formatDateTime } from "@/lib/format.js";
import {
  createAdminWithdrawalActionLifecycle,
  createLatestAdminWithdrawalRequestGuard,
  fetchNowpaymentsAdminWithdrawalOverview,
  formatAdminUsdtSix,
  NowpaymentsAdminWithdrawalError,
  submitNowpaymentsAdminWithdrawalAction,
  type NowpaymentsAdminActionInput,
  type NowpaymentsAdminWithdrawal,
  type NowpaymentsAdminWithdrawalOverview,
  type NowpaymentsAdminWithdrawalStatus,
} from "@/lib/nowpayments-withdrawal-admin-ui.js";

const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
type DialogKind = "complete" | "reject";

const STATUS_LABELS: Record<NowpaymentsAdminWithdrawalStatus, string> = {
  pending: "Pending",
  completed: "Completed",
  rejected: "Rejected",
};

const STATUS_VARIANTS: Record<
  NowpaymentsAdminWithdrawalStatus,
  "warning" | "success" | "default"
> = {
  pending: "warning",
  completed: "success",
  rejected: "default",
};

export function NowpaymentsUsdtWithdrawalAdmin({
  accessToken,
  userId,
}: {
  accessToken: string | null;
  userId: string | undefined;
}) {
  const authIdentity = useMemo(
    () => (accessToken && userId ? { userId } : null),
    [accessToken, userId],
  );
  const [overviewState, setOverviewState] = useState<{
    identity: object | null;
    overview: NowpaymentsAdminWithdrawalOverview | null;
    loading: boolean;
    loadError: boolean;
  }>({
    identity: null,
    overview: null,
    loading: true,
    loadError: false,
  });
  const [filter, setFilter] = useState<"all" | NowpaymentsAdminWithdrawalStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [transactionHash, setTransactionHash] = useState("");
  const [actionState, setActionState] = useState<{
    lifecycle: ReturnType<typeof createAdminWithdrawalActionLifecycle> | null;
    busy: boolean;
  }>({ lifecycle: null, busy: false });

  const mountedRef = useRef(true);
  const authIdentityRef = useRef(authIdentity);
  authIdentityRef.current = authIdentity;
  const authGenerationRef = useRef(0);
  const requestGuardRef = useRef<ReturnType<
    typeof createLatestAdminWithdrawalRequestGuard
  > | null>(null);
  if (requestGuardRef.current === null) {
    requestGuardRef.current = createLatestAdminWithdrawalRequestGuard();
  }
  const actionLifecycleRef = useRef<ReturnType<
    typeof createAdminWithdrawalActionLifecycle
  > | null>(null);

  const visibleState = overviewState.identity === authIdentity
    ? overviewState
    : {
        identity: authIdentity,
        overview: null,
        loading: authIdentity !== null,
        loadError: authIdentity === null,
      };
  const { overview, loading, loadError } = visibleState;
  const selected = overview?.withdrawals.find((row) => row.id === selectedId) ?? null;
  const visibleWithdrawals = overview?.withdrawals.filter(
    (row) => filter === "all" || row.status === filter,
  ) ?? [];
  const actionBusy = actionState.lifecycle !== null
    && actionState.lifecycle === actionLifecycleRef.current
    && actionState.lifecycle.isActive()
    && actionState.busy;

  const loadOverview = useCallback(async () => {
    if (!accessToken || !authIdentity) {
      requestGuardRef.current!.invalidate();
      if (mountedRef.current) {
        setOverviewState({
          identity: null,
          overview: null,
          loading: false,
          loadError: true,
        });
      }
      return;
    }
    const request = requestGuardRef.current!.begin(authIdentity);
    if (mountedRef.current && request.isCurrent()) {
      setOverviewState((current) => ({
        identity: authIdentity,
        overview: current.identity === authIdentity ? current.overview : null,
        loading: true,
        loadError: false,
      }));
    }
    try {
      const nextOverview = await fetchNowpaymentsAdminWithdrawalOverview(
        accessToken,
        fetch,
        request.signal,
      );
      if (mountedRef.current && request.isCurrent()) {
        setOverviewState({
          identity: authIdentity,
          overview: nextOverview,
          loading: false,
          loadError: false,
        });
      }
    } catch {
      if (mountedRef.current && request.isCurrent()) {
        setOverviewState((current) => ({
          identity: authIdentity,
          overview: current.identity === authIdentity ? current.overview : null,
          loading: false,
          loadError: true,
        }));
      }
    }
  }, [accessToken, authIdentity]);

  const resetDialog = useCallback(() => {
    setDialog(null);
    setSelectedId(null);
    setTransactionHash("");
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const tokenGeneration = authGenerationRef.current + 1;
    authGenerationRef.current = tokenGeneration;
    const previousLifecycle = actionLifecycleRef.current;
    previousLifecycle?.invalidate((noticeId) => toast.dismiss(noticeId));
    const nextLifecycle = authIdentity === null
      ? null
      : createAdminWithdrawalActionLifecycle({
          userId: authIdentity.userId,
          tokenGeneration,
        });
    actionLifecycleRef.current = nextLifecycle;
    setActionState({ lifecycle: nextLifecycle, busy: false });
    setFilter("all");
    resetDialog();
    void loadOverview();
    return () => {
      mountedRef.current = false;
      requestGuardRef.current!.invalidate();
      if (actionLifecycleRef.current === nextLifecycle) {
        nextLifecycle?.invalidate((noticeId) => toast.dismiss(noticeId));
        actionLifecycleRef.current = null;
      }
    };
  }, [authIdentity, loadOverview, resetDialog]);

  const performAction = (
    fingerprint: string,
    buildInput: (actionId: string) => NowpaymentsAdminActionInput,
    successMessage: string,
  ) => {
    if (!accessToken || !authIdentity) return Promise.resolve();
    const lifecycle = actionLifecycleRef.current;
    if (
      lifecycle === null
      || !lifecycle.isActive()
      || lifecycle.identity.userId !== authIdentity.userId
    ) {
      return Promise.resolve();
    }
    const actionIdentity = authIdentity;
    const isCurrentAction = () => (
      mountedRef.current
      && authIdentityRef.current === actionIdentity
      && actionLifecycleRef.current === lifecycle
      && lifecycle.isActive()
    );
    return lifecycle.run(
      fingerprint,
      async ({ actionId, signal }) => {
        if (!isCurrentAction()) return;
        requestGuardRef.current!.invalidate();
        try {
          await submitNowpaymentsAdminWithdrawalAction(
            accessToken,
            buildInput(actionId),
            fetch,
            signal,
          );
          if (!isCurrentAction()) return;
          lifecycle.clearActionKey();
          resetDialog();
          const noticeId = toast.success(successMessage);
          lifecycle.setNotice(noticeId, (id) => toast.dismiss(id));
          await loadOverview();
        } catch (error) {
          if (!isCurrentAction()) return;
          let message = "The action failed. It is safe to retry the same action.";
          if (error instanceof NowpaymentsAdminWithdrawalError) {
            const messages: Record<NowpaymentsAdminWithdrawalError["kind"], string> = {
              authentication: "Your session expired. Sign in again.",
              authorization: "Administrator access is unavailable.",
              conflict: "The withdrawal changed or this action conflicts. Refresh first.",
              validation: "Check the optional transaction hash.",
              unavailable: "The action failed. It is safe to retry the same action.",
            };
            message = messages[error.kind];
          }
          const noticeId = toast.error(message);
          lifecycle.setNotice(noticeId, (id) => toast.dismiss(id));
        }
      },
      (busy) => {
        if (isCurrentAction()) {
          setActionState({ lifecycle, busy });
        }
      },
    );
  };

  const openDialog = (kind: DialogKind, withdrawal: NowpaymentsAdminWithdrawal) => {
    resetDialog();
    setSelectedId(withdrawal.id);
    setDialog(kind);
    if (kind === "complete") {
      setTransactionHash(withdrawal.transaction_hash ?? "");
    }
  };

  const submitDialog = () => {
    if (!selected || !dialog) return;
    if (dialog === "reject") {
      void performAction(
        `reject|${selected.id}`,
        (actionId) => ({
          action: "reject",
          withdrawal_id: selected.id,
          action_id: actionId,
        }),
        "Withdrawal rejected and the full gross amount returned.",
      );
      return;
    }
    const normalizedHash = transactionHash.trim().toLowerCase();
    if (normalizedHash !== "" && !HASH_PATTERN.test(normalizedHash)) {
      toast.error("Enter a valid public BSC transaction hash or leave it blank.");
      return;
    }
    void performAction(
      `complete|${selected.id}|${normalizedHash}`,
      (actionId) => ({
        action: "complete",
        withdrawal_id: selected.id,
        action_id: actionId,
        transaction_hash: normalizedHash || null,
      }),
      "Withdrawal completed.",
    );
  };

  return (
    <section className="space-y-4 rounded-2xl border border-[#1f1f1f] bg-[#0b0b0b] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00ff41]/70">
            USDT BEP20
          </p>
          <h2 className="text-base font-bold text-gray-100">Withdrawal requests</h2>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={loading || actionBusy}
          onClick={() => void loadOverview()}
        >
          <RefreshCw size={13} />
          Refresh
        </Button>
      </div>

      {loading && !overview ? (
        <div className="skeleton h-28 rounded-xl" />
      ) : loadError || !overview ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-xs text-red-300">
          Administrator withdrawal data is unavailable.
        </div>
      ) : (
        <>
          {!overview.withdrawals_enabled && (
            <div className="flex items-start gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0 text-yellow-400" />
              <p className="text-xs text-yellow-300">
                New USDT withdrawal requests are disabled. Existing pending requests remain actionable.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {(["all", ...NOWPAYMENTS_FILTERS] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={`rounded-lg border px-2.5 py-1 text-[10px] font-semibold ${
                  filter === value
                    ? "border-[#00ff41]/40 bg-[#00ff41]/10 text-[#00ff41]"
                    : "border-[#242424] text-gray-500"
                }`}
              >
                {value === "all" ? "All" : STATUS_LABELS[value]}
              </button>
            ))}
          </div>

          {visibleWithdrawals.length === 0 ? (
            <div className="rounded-xl border border-[#1f1f1f] bg-[#111] p-6 text-center">
              <Clock size={18} className="mx-auto text-gray-600" />
              <p className="mt-2 text-xs text-gray-500">No matching USDT withdrawals.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleWithdrawals.map((withdrawal) => (
                <WithdrawalCard
                  key={withdrawal.id}
                  withdrawal={withdrawal}
                  busy={actionBusy}
                  onComplete={() => openDialog("complete", withdrawal)}
                  onReject={() => openDialog("reject", withdrawal)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {selected && dialog && (
        <ActionDialog
          kind={dialog}
          withdrawal={selected}
          transactionHash={transactionHash}
          busy={actionBusy}
          onTransactionHashChange={setTransactionHash}
          onCancel={resetDialog}
          onSubmit={submitDialog}
        />
      )}
    </section>
  );
}

const NOWPAYMENTS_FILTERS = [
  "pending",
  "completed",
  "rejected",
] as const satisfies readonly NowpaymentsAdminWithdrawalStatus[];

function WithdrawalCard({
  withdrawal,
  busy,
  onComplete,
  onReject,
}: {
  withdrawal: NowpaymentsAdminWithdrawal;
  busy: boolean;
  onComplete: () => void;
  onReject: () => void;
}) {
  return (
    <article className="rounded-xl border border-[#1f1f1f] bg-[#111] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-gray-100">
            {formatAdminUsdtSix(withdrawal.gross_amount_usdt)} USDT
          </p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            @{withdrawal.username} · {formatDateTime(withdrawal.requested_at)}
          </p>
        </div>
        <Badge variant={STATUS_VARIANTS[withdrawal.status]}>
          {STATUS_LABELS[withdrawal.status]}
        </Badge>
      </div>
      <div className="mt-3 grid gap-2 text-[11px] sm:grid-cols-3">
        <Summary label="Fee" value={`${formatAdminUsdtSix(withdrawal.fee_amount_usdt)} USDT`} />
        <Summary label="Net to send" value={`${formatAdminUsdtSix(withdrawal.net_amount_usdt)} USDT`} />
        <Summary label="Destination" value={withdrawal.destination_address} mono />
      </div>
      {withdrawal.transaction_hash && (
        <p className="mt-2 truncate font-mono text-[10px] text-gray-500">
          Audit hash: {withdrawal.transaction_hash}
        </p>
      )}
      {withdrawal.status === "pending" && (
        <div className="mt-3 flex gap-2 border-t border-[#1f1f1f] pt-3">
          <Button size="sm" disabled={busy} onClick={onComplete}>
            <CheckCircle size={13} />
            Complete
          </Button>
          <Button size="sm" variant="danger" disabled={busy} onClick={onReject}>
            <XCircle size={13} />
            Reject
          </Button>
        </div>
      )}
    </article>
  );
}

function Summary({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[#1c1c1c] bg-[#0b0b0b] p-2.5">
      <p className="text-[9px] uppercase tracking-wide text-gray-600">{label}</p>
      <p className={`mt-1 truncate text-gray-300 ${mono ? "font-mono text-[10px]" : "font-semibold"}`}>
        {value}
      </p>
    </div>
  );
}

function ActionDialog({
  kind,
  withdrawal,
  transactionHash,
  busy,
  onTransactionHashChange,
  onCancel,
  onSubmit,
}: {
  kind: DialogKind;
  withdrawal: NowpaymentsAdminWithdrawal;
  transactionHash: string;
  busy: boolean;
  onTransactionHashChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={kind === "complete" ? "Complete USDT withdrawal" : "Reject USDT withdrawal"}
        className="w-full max-w-md rounded-2xl border border-[#292929] bg-[#111] p-4 shadow-2xl"
      >
        <h3 className="text-base font-bold text-gray-100">
          {kind === "complete" ? "Confirm completion" : "Confirm rejection"}
        </h3>
        {kind === "complete" ? (
          <div className="mt-3 space-y-3">
            <p className="text-xs leading-relaxed text-gray-400">
              Confirm only after exactly {formatAdminUsdtSix(withdrawal.net_amount_usdt)} USDT
              was sent to the stored BEP20 destination.
            </p>
            <Input
              label="Public BSC transaction hash (optional)"
              type="text"
              value={transactionHash}
              onChange={(event) => onTransactionHashChange(event.target.value)}
              placeholder="0x…"
              disabled={busy}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <p className="text-[10px] text-gray-500">
              Completion consumes the full {formatAdminUsdtSix(withdrawal.gross_amount_usdt)} USDT
              reservation and records the fee and net amount atomically.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs leading-relaxed text-gray-400">
            Rejecting returns the full {formatAdminUsdtSix(withdrawal.gross_amount_usdt)} USDT
            reservation to the user.
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={kind === "reject" ? "danger" : "primary"}
            loading={busy}
            disabled={busy}
            onClick={onSubmit}
          >
            {kind === "complete" ? "Confirm Complete" : "Confirm Reject"}
          </Button>
        </div>
      </div>
    </div>
  );
}

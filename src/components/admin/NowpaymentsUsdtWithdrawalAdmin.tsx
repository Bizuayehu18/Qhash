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
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { formatDateTime } from "@/lib/format.js";
import {
  createAdminWithdrawalActionKeyManager,
  createLatestAdminWithdrawalRequestGuard,
  currentBroadcast,
  fetchNowpaymentsAdminWithdrawalOverview,
  formatAdminUsdtSix,
  NowpaymentsAdminWithdrawalError,
  runAdminWithdrawalSingleFlight,
  submitNowpaymentsAdminWithdrawalAction,
  type NowpaymentsAdminActionInput,
  type NowpaymentsAdminWithdrawal,
  type NowpaymentsAdminWithdrawalOverview,
  type NowpaymentsAdminWithdrawalStatus,
} from "@/lib/nowpayments-withdrawal-admin-ui.js";

const TOKEN_CONTRACT = "0x55d398326f99059ff775485246999027b3197955";
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/;

type DialogKind = "reject" | "send_lock" | "broadcast" | "correct" | "complete";

const STATUS_LABELS: Record<NowpaymentsAdminWithdrawalStatus, string> = {
  reserved: "Reserved",
  reviewing: "Reviewing",
  send_locked: "Send locked",
  broadcasted: "Broadcasted",
  completed: "Completed",
  rejected: "Rejected",
};

const STATUS_VARIANTS: Record<
  NowpaymentsAdminWithdrawalStatus,
  "default" | "warning" | "info" | "success" | "danger"
> = {
  reserved: "warning",
  reviewing: "info",
  send_locked: "danger",
  broadcasted: "warning",
  completed: "success",
  rejected: "default",
};

function safeInteger(value: string): number | null {
  if (!INTEGER_PATTERN.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

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
  const [actionBusy, setActionBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [liquidityConfirmed, setLiquidityConfirmed] = useState(false);
  const [destinationConfirmed, setDestinationConfirmed] = useState(false);
  const [irreversibleConfirmed, setIrreversibleConfirmed] = useState(false);
  const [transactionSuccess, setTransactionSuccess] = useState(false);
  const [singleTransferConfirmed, setSingleTransferConfirmed] = useState(false);
  const [blockNumber, setBlockNumber] = useState("");
  const [transferLogIndex, setTransferLogIndex] = useState("");
  const [confirmations, setConfirmations] = useState("");
  const [verifiedAt, setVerifiedAt] = useState("");

  const mountedRef = useRef(true);
  const authIdentityRef = useRef(authIdentity);
  authIdentityRef.current = authIdentity;
  const requestGuardRef = useRef<ReturnType<
    typeof createLatestAdminWithdrawalRequestGuard
  > | null>(null);
  if (requestGuardRef.current === null) {
    requestGuardRef.current = createLatestAdminWithdrawalRequestGuard();
  }
  const actionPromiseRef = useRef<Promise<void> | null>(null);
  const actionKeysRef = useRef<ReturnType<
    typeof createAdminWithdrawalActionKeyManager
  > | null>(null);
  if (actionKeysRef.current === null) {
    actionKeysRef.current = createAdminWithdrawalActionKeyManager();
  }

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

  useEffect(() => {
    mountedRef.current = true;
    setSelectedId(null);
    setDialog(null);
    void loadOverview();
    return () => {
      mountedRef.current = false;
      requestGuardRef.current!.invalidate();
    };
  }, [loadOverview]);

  const resetDialog = useCallback(() => {
    setDialog(null);
    setReason("");
    setTransactionHash("");
    setLiquidityConfirmed(false);
    setDestinationConfirmed(false);
    setIrreversibleConfirmed(false);
    setTransactionSuccess(false);
    setSingleTransferConfirmed(false);
    setBlockNumber("");
    setTransferLogIndex("");
    setConfirmations("");
    setVerifiedAt("");
  }, []);

  const openDialog = (kind: DialogKind, withdrawal: NowpaymentsAdminWithdrawal) => {
    resetDialog();
    setSelectedId(withdrawal.id);
    setDialog(kind);
    if (kind === "complete") {
      setTransactionHash(currentBroadcast(withdrawal)?.transaction_hash ?? "");
    }
  };

  const performAction = (
    fingerprint: string,
    buildInput: (actionId: string) => NowpaymentsAdminActionInput,
    successMessage: string,
  ) => runAdminWithdrawalSingleFlight(actionPromiseRef, async () => {
    if (!accessToken || !authIdentity) return;
    const actionIdentity = authIdentity;
    const actionId = actionKeysRef.current!.keyFor(fingerprint);
    requestGuardRef.current!.invalidate();
    setActionBusy(true);
    try {
      await submitNowpaymentsAdminWithdrawalAction(
        accessToken,
        buildInput(actionId),
      );
      if (!mountedRef.current || authIdentityRef.current !== actionIdentity) return;
      actionKeysRef.current!.clear();
      resetDialog();
      toast.success(successMessage);
      await loadOverview();
    } catch (error) {
      if (!mountedRef.current || authIdentityRef.current !== actionIdentity) return;
      if (error instanceof NowpaymentsAdminWithdrawalError) {
        const messages: Record<NowpaymentsAdminWithdrawalError["kind"], string> = {
          authentication: "Your session expired. Sign in again.",
          authorization: "Administrator access is unavailable.",
          disabled: "USDT withdrawals are disabled.",
          conflict: "The withdrawal changed or this action conflicts. Refresh before continuing.",
          validation: "Check the supplied withdrawal evidence.",
          unavailable: "The administrator action failed. It is safe to retry the same action.",
        };
        toast.error(messages[error.kind]);
      } else {
        toast.error("The administrator action failed. It is safe to retry the same action.");
      }
    } finally {
      if (mountedRef.current && authIdentityRef.current === actionIdentity) {
        setActionBusy(false);
      }
    }
  });

  const beginReview = (withdrawal: NowpaymentsAdminWithdrawal) => {
    void performAction(
      `begin_review|${withdrawal.id}`,
      (actionId) => ({
        action: "begin_review",
        withdrawal_id: withdrawal.id,
        action_id: actionId,
      }),
      "Withdrawal review started.",
    );
  };

  const submitDialog = () => {
    if (!selected || !dialog) return;
    if (dialog === "reject") {
      const normalizedReason = reason.trim();
      if (!normalizedReason || normalizedReason.length > 500) {
        toast.error("Enter a concise rejection reason.");
        return;
      }
      void performAction(
        `reject|${selected.id}|${normalizedReason}`,
        (actionId) => ({
          action: "reject",
          withdrawal_id: selected.id,
          action_id: actionId,
          reason: normalizedReason,
        }),
        "Withdrawal rejected and the full gross amount released.",
      );
      return;
    }
    if (dialog === "send_lock") {
      if (!liquidityConfirmed || !destinationConfirmed || !irreversibleConfirmed) {
        toast.error("Complete every irreversible send-lock confirmation.");
        return;
      }
      void performAction(
        `send_lock|${selected.id}|true|true|true`,
        (actionId) => ({
          action: "send_lock",
          withdrawal_id: selected.id,
          action_id: actionId,
          external_liquidity_confirmed: true,
          destination_manually_verified: true,
          irreversible_send_confirmed: true,
        }),
        "Withdrawal is irreversibly locked for manual sending.",
      );
      return;
    }
    if (dialog === "broadcast" || dialog === "correct") {
      const hash = transactionHash.trim();
      const correctionReason = dialog === "correct" ? reason.trim() : null;
      if (!HASH_PATTERN.test(hash)) {
        toast.error("Enter a normalized lowercase BSC transaction hash.");
        return;
      }
      if (dialog === "correct" && (!correctionReason || correctionReason.length > 500)) {
        toast.error("Enter a concise correction reason.");
        return;
      }
      void performAction(
        `record_broadcast|${selected.id}|${hash}|${correctionReason ?? ""}`,
        (actionId) => ({
          action: "record_broadcast",
          withdrawal_id: selected.id,
          action_id: actionId,
          transaction_hash: hash,
          correction_reason: correctionReason,
        }),
        dialog === "correct"
          ? "Corrected broadcast evidence appended."
          : "External broadcast recorded.",
      );
      return;
    }

    const broadcast = currentBroadcast(selected);
    const parsedBlock = safeInteger(blockNumber);
    const parsedLogIndex = safeInteger(transferLogIndex);
    const parsedConfirmations = safeInteger(confirmations);
    const verificationTime = Date.parse(verifiedAt);
    if (
      !broadcast
      || !transactionSuccess
      || !singleTransferConfirmed
      || parsedBlock === null
      || parsedBlock <= 0
      || parsedLogIndex === null
      || parsedConfirmations === null
      || parsedConfirmations < 120
      || !Number.isFinite(verificationTime)
      || verificationTime > Date.now()
    ) {
      toast.error("Complete every BscScan verification field with at least 120 confirmations.");
      return;
    }
    void performAction(
      [
        "complete",
        selected.id,
        broadcast.transaction_hash,
        selected.destination_address,
        selected.net_amount_usdt,
        parsedBlock,
        parsedLogIndex,
        parsedConfirmations,
        new Date(verificationTime).toISOString(),
      ].join("|"),
      (actionId) => ({
        action: "complete",
        withdrawal_id: selected.id,
        action_id: actionId,
        transaction_hash: broadcast.transaction_hash,
        chain_id: 56,
        token_contract: TOKEN_CONTRACT,
        transaction_success: true,
        exactly_one_matching_transfer: true,
        destination_address: selected.destination_address,
        net_amount_usdt: selected.net_amount_usdt,
        block_number: parsedBlock,
        transfer_log_index: parsedLogIndex,
        confirmations: parsedConfirmations,
        verified_at: new Date(verificationTime).toISOString(),
      }),
      "Withdrawal completed with immutable verification evidence.",
    );
  };

  if (loading && !overview) {
    return (
      <div className="space-y-2">
        <div className="skeleton h-16 rounded-xl" />
        <div className="skeleton h-32 rounded-xl" />
      </div>
    );
  }

  if (loadError || !overview) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-5 text-center">
        <p className="text-xs text-red-300">USDT withdrawal administration is unavailable.</p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => void loadOverview()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-3">
        <ShieldAlert size={15} className="mt-0.5 shrink-0 text-yellow-400" />
        <div>
          <p className="text-xs font-semibold text-yellow-300">
            Manual USDT-BEP20 processing only
          </p>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
            QHash never signs or sends funds. Verify external liquidity before send-lock,
            send exactly the displayed net amount outside QHash, and complete only after
            independent BscScan evidence reaches 120 confirmations.
          </p>
        </div>
        <Button
          aria-label="Refresh USDT withdrawal administration"
          className="ml-auto shrink-0"
          size="sm"
          variant="ghost"
          disabled={actionBusy || loading}
          onClick={() => void loadOverview()}
        >
          <RefreshCw size={13} />
        </Button>
      </div>

      {!overview.withdrawals_enabled && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-300">
          New review and send-lock actions are disabled. Existing pre-send rejections and
          post-send evidence actions remain governed by the database state machine.
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {(["all", ...Object.keys(STATUS_LABELS)] as Array<
          "all" | NowpaymentsAdminWithdrawalStatus
        >).map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(status)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] transition-colors ${
              filter === status
                ? "border-[rgba(0,255,65,0.3)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
                : "border-[#1f1f1f] text-gray-500"
            }`}
          >
            {status === "all" ? "All" : STATUS_LABELS[status]}
          </button>
        ))}
      </div>

      {visibleWithdrawals.length === 0 ? (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-8 text-center">
          <Clock size={18} className="mx-auto text-gray-600" />
          <p className="mt-2 text-xs text-gray-500">No USDT withdrawals in this status.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleWithdrawals.map((withdrawal) => (
            <WithdrawalCard
              key={withdrawal.id}
              withdrawal={withdrawal}
              withdrawalsEnabled={overview.withdrawals_enabled}
              busy={actionBusy}
              onBeginReview={beginReview}
              onOpenDialog={openDialog}
            />
          ))}
        </div>
      )}

      {dialog && selected && (
        <ActionDialog
          kind={dialog}
          withdrawal={selected}
          busy={actionBusy}
          reason={reason}
          setReason={setReason}
          transactionHash={transactionHash}
          setTransactionHash={setTransactionHash}
          liquidityConfirmed={liquidityConfirmed}
          setLiquidityConfirmed={setLiquidityConfirmed}
          destinationConfirmed={destinationConfirmed}
          setDestinationConfirmed={setDestinationConfirmed}
          irreversibleConfirmed={irreversibleConfirmed}
          setIrreversibleConfirmed={setIrreversibleConfirmed}
          transactionSuccess={transactionSuccess}
          setTransactionSuccess={setTransactionSuccess}
          singleTransferConfirmed={singleTransferConfirmed}
          setSingleTransferConfirmed={setSingleTransferConfirmed}
          blockNumber={blockNumber}
          setBlockNumber={setBlockNumber}
          transferLogIndex={transferLogIndex}
          setTransferLogIndex={setTransferLogIndex}
          confirmations={confirmations}
          setConfirmations={setConfirmations}
          verifiedAt={verifiedAt}
          setVerifiedAt={setVerifiedAt}
          onCancel={resetDialog}
          onSubmit={submitDialog}
        />
      )}
    </div>
  );
}

function WithdrawalCard({
  withdrawal,
  withdrawalsEnabled,
  busy,
  onBeginReview,
  onOpenDialog,
}: {
  withdrawal: NowpaymentsAdminWithdrawal;
  withdrawalsEnabled: boolean;
  busy: boolean;
  onBeginReview: (withdrawal: NowpaymentsAdminWithdrawal) => void;
  onOpenDialog: (kind: DialogKind, withdrawal: NowpaymentsAdminWithdrawal) => void;
}) {
  const broadcast = currentBroadcast(withdrawal);
  const canBegin = withdrawal.status === "reserved" && withdrawalsEnabled;
  const canReject = withdrawal.status === "reserved"
    || (withdrawal.status === "reviewing" && withdrawal.assigned_to_current_admin);
  const canSendLock = withdrawal.status === "reviewing"
    && withdrawal.assigned_to_current_admin
    && withdrawalsEnabled;
  const canBroadcast = withdrawal.status === "send_locked"
    && withdrawal.assigned_to_current_admin;
  const canCorrectOrComplete = withdrawal.status === "broadcasted"
    && withdrawal.assigned_to_current_admin;

  return (
    <article className="rounded-xl border border-[#1a1a1a] bg-[#111] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-100">@{withdrawal.username}</p>
          <p className="mt-0.5 text-[10px] text-gray-600">
            Requested {formatDateTime(withdrawal.requested_at)}
          </p>
        </div>
        <Badge variant={STATUS_VARIANTS[withdrawal.status]}>
          {STATUS_LABELS[withdrawal.status]}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Amount label="Gross reserved" value={withdrawal.gross_amount_usdt} />
        <Amount label="QHash fee (5%)" value={withdrawal.fee_amount_usdt} />
        <Amount label="Recipient must receive" value={withdrawal.net_amount_usdt} highlight />
      </div>

      <div className="mt-3 rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] p-2.5">
        <p className="text-[9px] uppercase tracking-[0.14em] text-gray-600">BEP20 destination</p>
        <p className="mt-1 break-all font-mono text-[11px] text-gray-300">
          {withdrawal.destination_address}
        </p>
      </div>

      {broadcast && (
        <div className="mt-2 rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] p-2.5">
          <p className="text-[9px] uppercase tracking-[0.14em] text-gray-600">
            Current public BSC transaction hash
          </p>
          <p className="mt-1 break-all font-mono text-[10px] text-gray-400">
            {broadcast.transaction_hash}
          </p>
        </div>
      )}

      {withdrawal.rejection_reason && (
        <p className="mt-2 rounded-lg border border-red-500/15 bg-red-500/5 p-2 text-[10px] text-red-300">
          {withdrawal.rejection_reason}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {canBegin && (
          <Button size="sm" disabled={busy} onClick={() => onBeginReview(withdrawal)}>
            Begin review
          </Button>
        )}
        {canReject && (
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => onOpenDialog("reject", withdrawal)}
          >
            Reject and release gross
          </Button>
        )}
        {canSendLock && (
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => onOpenDialog("send_lock", withdrawal)}
          >
            Irreversible send-lock
          </Button>
        )}
        {canBroadcast && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => onOpenDialog("broadcast", withdrawal)}
          >
            Record external broadcast
          </Button>
        )}
        {canCorrectOrComplete && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenDialog("correct", withdrawal)}
            >
              Append broadcast correction
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => onOpenDialog("complete", withdrawal)}
            >
              Verify and complete
            </Button>
          </>
        )}
      </div>

      {withdrawal.status !== "reserved"
        && !withdrawal.assigned_to_current_admin
        && !["completed", "rejected"].includes(withdrawal.status) && (
          <p className="mt-2 text-[10px] text-yellow-400">
            This withdrawal is assigned to another administrator.
          </p>
        )}

      <details className="mt-3 text-[10px] text-gray-500">
        <summary className="cursor-pointer select-none">Immutable audit timeline</summary>
        <ol className="mt-2 space-y-1 border-l border-[#242424] pl-3">
          {withdrawal.events.map((event, index) => (
            <li key={`${event.created_at}-${event.action}-${index}`}>
              {event.action.replaceAll("_", " ")} · {event.to_status.replaceAll("_", " ")} ·{" "}
              {formatDateTime(event.created_at)}
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}

function Amount({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] p-2.5">
      <p className="text-[9px] text-gray-600">{label}</p>
      <p className={`mt-1 text-xs font-bold ${highlight ? "text-[#00ff41]" : "text-gray-200"}`}>
        {formatAdminUsdtSix(value)} USDT
      </p>
    </div>
  );
}

function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[#242424] p-2.5 text-[11px] text-gray-300">
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}

function ActionDialog({
  kind,
  withdrawal,
  busy,
  reason,
  setReason,
  transactionHash,
  setTransactionHash,
  liquidityConfirmed,
  setLiquidityConfirmed,
  destinationConfirmed,
  setDestinationConfirmed,
  irreversibleConfirmed,
  setIrreversibleConfirmed,
  transactionSuccess,
  setTransactionSuccess,
  singleTransferConfirmed,
  setSingleTransferConfirmed,
  blockNumber,
  setBlockNumber,
  transferLogIndex,
  setTransferLogIndex,
  confirmations,
  setConfirmations,
  verifiedAt,
  setVerifiedAt,
  onCancel,
  onSubmit,
}: {
  kind: DialogKind;
  withdrawal: NowpaymentsAdminWithdrawal;
  busy: boolean;
  reason: string;
  setReason: (value: string) => void;
  transactionHash: string;
  setTransactionHash: (value: string) => void;
  liquidityConfirmed: boolean;
  setLiquidityConfirmed: (value: boolean) => void;
  destinationConfirmed: boolean;
  setDestinationConfirmed: (value: boolean) => void;
  irreversibleConfirmed: boolean;
  setIrreversibleConfirmed: (value: boolean) => void;
  transactionSuccess: boolean;
  setTransactionSuccess: (value: boolean) => void;
  singleTransferConfirmed: boolean;
  setSingleTransferConfirmed: (value: boolean) => void;
  blockNumber: string;
  setBlockNumber: (value: string) => void;
  transferLogIndex: string;
  setTransferLogIndex: (value: string) => void;
  confirmations: string;
  setConfirmations: (value: string) => void;
  verifiedAt: string;
  setVerifiedAt: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const title = {
    reject: "Reject before sending",
    send_lock: "Confirm irreversible send-lock",
    broadcast: "Record external BSC broadcast",
    correct: "Append corrected broadcast evidence",
    complete: "Verify and complete withdrawal",
  }[kind];
  const broadcast = currentBroadcast(withdrawal);
  const dialogRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    const dialogElement = dialogRef.current;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = dialogElement?.querySelector<HTMLElement>(focusableSelector);
    (focusable ?? dialogElement)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialogElement) return;
      const controls = [...dialogElement.querySelectorAll<HTMLElement>(focusableSelector)]
        .filter((element) => !element.hasAttribute("disabled"));
      if (controls.length === 0) {
        event.preventDefault();
        dialogElement.focus();
        return;
      }
      const first = controls[0];
      const last = controls.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="usdt-withdrawal-action-title"
        aria-describedby="usdt-withdrawal-action-description"
        tabIndex={-1}
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[#2a2a2a] bg-[#101010] p-4 shadow-2xl"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-red-400" />
          <div>
            <h2 id="usdt-withdrawal-action-title" className="text-sm font-bold text-gray-100">
              {title}
            </h2>
            <p
              id="usdt-withdrawal-action-description"
              className="mt-1 text-[10px] text-gray-500"
            >
              USDT on BNB Smart Chain (BEP20 only)
            </p>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <Amount label="Gross reserved" value={withdrawal.gross_amount_usdt} />
          <Amount label="QHash fee (5%)" value={withdrawal.fee_amount_usdt} />
          <Amount label="Recipient must receive" value={withdrawal.net_amount_usdt} highlight />
        </div>
        <div className="mt-2 break-all rounded-lg border border-[#242424] bg-[#090909] p-2.5 font-mono text-[10px] text-gray-300">
          {withdrawal.destination_address}
        </div>

        {kind === "reject" && (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] text-red-300">
              Rejection returns the entire {formatAdminUsdtSix(withdrawal.gross_amount_usdt)} USDT
              gross reservation. No QHash fee is retained.
            </p>
            <label className="block text-xs font-medium text-gray-300" htmlFor="usdt-reject-reason">
              Concise administrator reason
            </label>
            <textarea
              id="usdt-reject-reason"
              autoFocus
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="min-h-24 w-full rounded-lg border border-[#2a2a2a] bg-[#111] p-3 text-sm text-gray-100 focus:border-red-500/60 focus:outline-none"
            />
          </div>
        )}

        {kind === "send_lock" && (
          <div className="mt-3 space-y-2">
            <p className="rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-[11px] font-semibold text-red-300">
              Send-lock is irreversible inside QHash. After this point, rejection and release are
              forbidden.
            </p>
            <Check checked={liquidityConfirmed} onChange={setLiquidityConfirmed}>
              I confirmed sufficient external USDT liquidity, including external fees, so the
              recipient receives exactly {formatAdminUsdtSix(withdrawal.net_amount_usdt)} USDT.
            </Check>
            <Check checked={destinationConfirmed} onChange={setDestinationConfirmed}>
              I manually verified the exact BEP20 destination shown above.
            </Check>
            <Check checked={irreversibleConfirmed} onChange={setIrreversibleConfirmed}>
              I understand this QHash send-lock cannot be reversed or rejected.
            </Check>
          </div>
        )}

        {(kind === "broadcast" || kind === "correct") && (
          <div className="mt-3 space-y-3">
            <p className="text-[11px] text-gray-400">
              Record only the public transaction hash after the exact net amount was sent
              manually outside QHash.
            </p>
            <Input
              label="Normalized lowercase BSC transaction hash"
              value={transactionHash}
              onChange={(event) => setTransactionHash(event.target.value.trim())}
              placeholder="0x…"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            {kind === "correct" && (
              <>
                <p className="text-[10px] text-yellow-300">
                  The existing broadcast remains immutable. This appends a new audited correction.
                </p>
                <label
                  className="block text-xs font-medium text-gray-300"
                  htmlFor="usdt-correction-reason"
                >
                  Concise correction reason
                </label>
                <textarea
                  id="usdt-correction-reason"
                  maxLength={500}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="min-h-20 w-full rounded-lg border border-[#2a2a2a] bg-[#111] p-3 text-sm text-gray-100 focus:border-yellow-500/60 focus:outline-none"
                />
              </>
            )}
          </div>
        )}

        {kind === "complete" && (
          <div className="mt-3 space-y-3">
            <p className="rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-[11px] font-semibold text-red-300">
              Completion permanently consumes the full gross reservation. Verify every field
              independently on BscScan first; a transaction hash alone is never sufficient.
            </p>
            <Evidence label="Current transaction hash" value={broadcast?.transaction_hash ?? ""} />
            <Evidence label="BSC mainnet chain ID" value="56" />
            <Evidence label="Approved USDT contract" value={TOKEN_CONTRACT} />
            <Evidence label="Exact destination" value={withdrawal.destination_address} />
            <Evidence
              label="Exact Transfer amount"
              value={`${formatAdminUsdtSix(withdrawal.net_amount_usdt)} USDT`}
            />
            <Check checked={transactionSuccess} onChange={setTransactionSuccess}>
              BscScan shows a successful transaction on BSC mainnet.
            </Check>
            <Check checked={singleTransferConfirmed} onChange={setSingleTransferConfirmed}>
              Exactly one unambiguous approved-contract Transfer matches the destination and exact
              net amount.
            </Check>
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Block number"
                inputMode="numeric"
                value={blockNumber}
                onChange={(event) => setBlockNumber(event.target.value)}
              />
              <Input
                label="Transfer log index"
                inputMode="numeric"
                value={transferLogIndex}
                onChange={(event) => setTransferLogIndex(event.target.value)}
              />
              <Input
                label="Confirmations"
                inputMode="numeric"
                value={confirmations}
                onChange={(event) => setConfirmations(event.target.value)}
                hint="Minimum 120"
              />
            </div>
            <Input
              label="Verification timestamp (ISO 8601)"
              value={verifiedAt}
              onChange={(event) => setVerifiedAt(event.target.value.trim())}
              placeholder="2026-07-23T12:34:56.000Z"
              autoComplete="off"
            />
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={kind === "broadcast" || kind === "correct" ? "primary" : "danger"}
            loading={busy}
            onClick={onSubmit}
          >
            {kind === "reject"
              ? "Reject and release full gross"
              : kind === "send_lock"
                ? "Apply irreversible send-lock"
                : kind === "broadcast"
                  ? "Record broadcast"
                  : kind === "correct"
                    ? "Append correction"
                    : "Complete verified withdrawal"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Evidence({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#242424] bg-[#090909] p-2.5">
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.12em] text-gray-600">
        <CheckCircle size={10} />
        {label}
      </div>
      <p className="mt-1 break-all font-mono text-[10px] text-gray-300">{value}</p>
    </div>
  );
}

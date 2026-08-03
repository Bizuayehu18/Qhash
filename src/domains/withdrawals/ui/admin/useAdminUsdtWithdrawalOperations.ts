import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  createAdminWithdrawalActionLifecycle,
  createLatestAdminWithdrawalRequestGuard,
} from "../../application/admin-usdt-withdrawal-action-lifecycle.js";
import {
  fetchNowpaymentsAdminWithdrawalOverview,
  NowpaymentsAdminWithdrawalError,
  submitNowpaymentsAdminWithdrawalAction,
  type NowpaymentsAdminActionInput,
  type NowpaymentsAdminWithdrawal,
  type NowpaymentsAdminWithdrawalOverview,
  type NowpaymentsAdminWithdrawalStatus,
} from "../../application/admin-usdt-withdrawal-browser-service.js";
import { normalizeOptionalAdminUsdtTransactionHash } from "./admin-usdt-withdrawal-presentation.js";

export type AdminUsdtWithdrawalDialogKind = "complete" | "reject";

type AdminUsdtWithdrawalOverviewState = {
  identity: object | null;
  overview: NowpaymentsAdminWithdrawalOverview | null;
  loading: boolean;
  loadError: boolean;
};

export function useAdminUsdtWithdrawalOperations(
  accessToken: string | null | undefined,
  userId: string | null | undefined,
) {
  const authIdentity = useMemo(
    () => (accessToken && userId ? { userId } : null),
    [accessToken, userId],
  );
  const [overviewState, setOverviewState] =
    useState<AdminUsdtWithdrawalOverviewState>({
      identity: null,
      overview: null,
      loading: true,
      loadError: false,
    });
  const [filter, setFilter] =
    useState<"all" | NowpaymentsAdminWithdrawalStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] =
    useState<AdminUsdtWithdrawalDialogKind | null>(null);
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
  const selected = overview?.withdrawals.find(
    (withdrawal) => withdrawal.id === selectedId,
  ) ?? null;
  const visibleWithdrawals = overview?.withdrawals.filter(
    (withdrawal) => filter === "all" || withdrawal.status === filter,
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
            const messages: Record<
              NowpaymentsAdminWithdrawalError["kind"],
              string
            > = {
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

  const openDialog = (
    kind: AdminUsdtWithdrawalDialogKind,
    withdrawal: NowpaymentsAdminWithdrawal,
  ) => {
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

    const normalizedHash = normalizeOptionalAdminUsdtTransactionHash(
      transactionHash,
    );
    if (normalizedHash === null) {
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

  return {
    actionBusy,
    dialog,
    filter,
    loadError,
    loading,
    openDialog,
    overview,
    refreshOverview: loadOverview,
    resetDialog,
    selected,
    setFilter,
    setTransactionHash,
    submitDialog,
    transactionHash,
    visibleWithdrawals,
  };
}

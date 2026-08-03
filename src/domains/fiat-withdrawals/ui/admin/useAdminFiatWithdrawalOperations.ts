import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createAdminFiatWithdrawalAuthIdentity,
  createAdminFiatWithdrawalScopedValue,
  readAdminFiatWithdrawalScopedValue,
  type AdminFiatWithdrawalScopedValue,
  type AdminFiatWithdrawalStatusFilter,
} from "../../application/admin-fiat-withdrawal-operations-auth-lifecycle.js";
import type {
  AdminFiatWithdrawal,
  AdminFiatWithdrawalReviewAction,
} from "../../application/admin-fiat-withdrawal-operations-browser-service.js";
import { useAdminFiatWithdrawalCatalog } from "./useAdminFiatWithdrawalCatalog.js";
import { useAdminFiatWithdrawalReview } from "./useAdminFiatWithdrawalReview.js";

type AdminFiatWithdrawalEditor = Readonly<{
  adminNote: string;
  withdrawalId: string;
}>;

export function useAdminFiatWithdrawalOperations(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
) {
  const identity = useMemo(
    () => createAdminFiatWithdrawalAuthIdentity(userId, accessToken),
    [accessToken, userId],
  );
  const [statusFilter, setStatusFilterState] =
    useState<AdminFiatWithdrawalStatusFilter>("pending");
  const [editorState, setEditorState] = useState<
    AdminFiatWithdrawalScopedValue<AdminFiatWithdrawalEditor> | null
  >(null);

  const catalog = useAdminFiatWithdrawalCatalog(
    userId,
    accessToken,
    statusFilter,
  );
  const { refreshWithdrawals } = catalog;

  const clearEditor = useCallback(() => setEditorState(null), []);
  const handleReviewAccepted = useCallback(() => {
    clearEditor();
    void refreshWithdrawals({
      forceNewFlight: true,
      resetRetryCount: true,
    });
  }, [clearEditor, refreshWithdrawals]);
  const review = useAdminFiatWithdrawalReview(
    userId,
    accessToken,
    handleReviewAccepted,
  );

  const editor = readAdminFiatWithdrawalScopedValue(editorState, identity);
  const selectedWithdrawal = editor
    ? catalog.withdrawals.find(
      (withdrawal) => withdrawal.id === editor.withdrawalId,
    ) ?? null
    : null;

  useEffect(() => {
    setEditorState(null);
  }, [identity]);

  useEffect(() => {
    if (catalog.withdrawalsLoaded && editor && !selectedWithdrawal) {
      setEditorState(null);
    }
  }, [catalog.withdrawalsLoaded, editor, selectedWithdrawal]);

  const setStatusFilter = useCallback((
    filter: AdminFiatWithdrawalStatusFilter,
  ) => {
    clearEditor();
    setStatusFilterState(filter);
  }, [clearEditor]);

  const selectWithdrawal = useCallback((withdrawal: AdminFiatWithdrawal) => {
    if (!identity) return;
    setEditorState(createAdminFiatWithdrawalScopedValue(identity, {
      adminNote: withdrawal.admin_note ?? "",
      withdrawalId: withdrawal.id,
    }));
  }, [identity]);

  const setAdminNote = useCallback((adminNote: string) => {
    setEditorState((current) => {
      const visible = readAdminFiatWithdrawalScopedValue(current, identity);
      return identity && visible
        ? createAdminFiatWithdrawalScopedValue(identity, {
          ...visible,
          adminNote,
        })
        : null;
    });
  }, [identity]);

  const submitReview = useCallback(async (
    action: AdminFiatWithdrawalReviewAction,
  ) => {
    if (!editor || !selectedWithdrawal) return false;

    const confirmed = window.confirm(
      action === "approve"
        ? "Approve this withdrawal request?"
        : "Reject this withdrawal request and refund the full amount to the user wallet?",
    );
    if (!confirmed) return false;

    return review.reviewWithdrawal({
      action,
      adminNote: editor.adminNote.trim() || null,
      withdrawalId: selectedWithdrawal.id,
    });
  }, [editor, review, selectedWithdrawal]);

  return {
    ...catalog,
    ...review,
    adminNote: editor?.adminNote ?? "",
    clearEditor,
    pendingCount: catalog.withdrawals.filter(
      (withdrawal) => withdrawal.status === "pending",
    ).length,
    selectWithdrawal,
    selectedWithdrawal,
    setAdminNote,
    setStatusFilter,
    statusFilter,
    submitReview,
  };
}

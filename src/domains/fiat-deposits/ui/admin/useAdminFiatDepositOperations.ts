import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  createAdminFiatDepositAuthIdentity,
  createAdminFiatDepositScopedValue,
  readAdminFiatDepositScopedValue,
  type AdminFiatDepositScopedValue,
  type AdminFiatDepositStatusFilter,
} from "../../application/admin-fiat-deposit-operations-auth-lifecycle.js";
import type {
  AdminFiatDeposit,
  AdminFiatDepositReviewAction,
} from "../../application/admin-fiat-deposit-operations-browser-service.js";
import { parseAdminFiatDepositVerifiedAmount } from "./admin-fiat-deposit-operations-presentation.js";
import { useAdminFiatDepositCatalog } from "./useAdminFiatDepositCatalog.js";
import { useAdminFiatDepositReview } from "./useAdminFiatDepositReview.js";

type AdminFiatDepositEditor = Readonly<{
  adminNote: string;
  approvalAmount: string;
  depositId: string;
}>;

export function useAdminFiatDepositOperations(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
) {
  const identity = useMemo(
    () => createAdminFiatDepositAuthIdentity(userId, accessToken),
    [accessToken, userId],
  );
  const [statusFilter, setStatusFilterState] =
    useState<AdminFiatDepositStatusFilter>("all");
  const [editorState, setEditorState] = useState<
    AdminFiatDepositScopedValue<AdminFiatDepositEditor> | null
  >(null);

  const catalog = useAdminFiatDepositCatalog(
    userId,
    accessToken,
    statusFilter,
  );

  const clearEditor = useCallback(() => setEditorState(null), []);
  const handleReviewAccepted = useCallback(() => {
    clearEditor();
    void catalog.refreshDeposits({
      forceNewFlight: true,
      resetRetryCount: true,
    });
  }, [catalog, clearEditor]);
  const review = useAdminFiatDepositReview(
    userId,
    accessToken,
    handleReviewAccepted,
  );

  const editor = readAdminFiatDepositScopedValue(editorState, identity);
  const selectedDeposit = editor
    ? catalog.deposits.find((deposit) => deposit.id === editor.depositId) ?? null
    : null;

  useEffect(() => {
    setEditorState(null);
  }, [identity]);

  useEffect(() => {
    if (catalog.depositsLoaded && editor && !selectedDeposit) {
      setEditorState(null);
    }
  }, [catalog.depositsLoaded, editor, selectedDeposit]);

  const setStatusFilter = useCallback((filter: AdminFiatDepositStatusFilter) => {
    clearEditor();
    setStatusFilterState(filter);
  }, [clearEditor]);

  const selectDeposit = useCallback((deposit: AdminFiatDeposit) => {
    if (!identity) return;
    setEditorState(createAdminFiatDepositScopedValue(identity, {
      adminNote: "",
      approvalAmount: "",
      depositId: deposit.id,
    }));
  }, [identity]);

  const updateEditor = useCallback((update: Partial<Pick<
    AdminFiatDepositEditor,
    "adminNote" | "approvalAmount"
  >>) => {
    setEditorState((current) => {
      const visible = readAdminFiatDepositScopedValue(current, identity);
      return identity && visible
        ? createAdminFiatDepositScopedValue(identity, {
          ...visible,
          ...update,
        })
        : null;
    });
  }, [identity]);

  const submitReview = useCallback(async (
    action: AdminFiatDepositReviewAction,
  ) => {
    if (!editor || !selectedDeposit) return false;

    const verifiedAmount = action === "approve"
      ? parseAdminFiatDepositVerifiedAmount(editor.approvalAmount)
      : undefined;
    if (action === "approve" && verifiedAmount === null) {
      toast.error("Enter the verified receipt amount before approving.");
      return false;
    }

    return review.reviewDeposit({
      action,
      adminNote: editor.adminNote || null,
      depositId: selectedDeposit.id,
      ...(action === "approve" ? { verifiedAmount: verifiedAmount! } : {}),
    });
  }, [editor, review, selectedDeposit]);

  return {
    ...catalog,
    ...review,
    adminNote: editor?.adminNote ?? "",
    approvalAmount: editor?.approvalAmount ?? "",
    clearEditor,
    pendingCount: catalog.deposits.filter(
      (deposit) => deposit.status === "pending",
    ).length,
    selectDeposit,
    selectedDeposit,
    setAdminNote: (adminNote: string) => updateEditor({ adminNote }),
    setApprovalAmount: (approvalAmount: string) => updateEditor({
      approvalAmount,
    }),
    setStatusFilter,
    statusFilter,
    submitReview,
  };
}

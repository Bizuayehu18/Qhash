import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { PaymentMethodType } from "@/lib/database.types.js";
import {
  createAdminPaymentMethodsAuthIdentity,
  isSameAdminPaymentMethodsAuthIdentity,
  type AdminPaymentMethodsArchiveFilter,
} from "../../application/admin-payment-methods-auth-lifecycle.js";
import type {
  AdminPaymentMethod,
} from "../../application/admin-payment-methods-browser-service.js";
import {
  createAdminPaymentMethodsEditorState,
  type AdminPaymentMethodsEditorState,
} from "./admin-payment-methods-editor-state.js";
import { useAdminPaymentMethodEditorActions } from "./useAdminPaymentMethodEditorActions.js";
import { useAdminPaymentMethodRowActions } from "./useAdminPaymentMethodRowActions.js";
import { useAdminPaymentMethodsCatalog } from "./useAdminPaymentMethodsCatalog.js";

export function useAdminPaymentMethods(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
) {
  const identity = useMemo(
    () => createAdminPaymentMethodsAuthIdentity(userId, accessToken),
    [accessToken, userId],
  );
  const identityRef = useRef(identity);
  const userIdRef = useRef(userId ?? null);
  identityRef.current = identity;
  userIdRef.current = userId ?? null;

  const [archiveFilter, setArchiveFilterState] =
    useState<AdminPaymentMethodsArchiveFilter>("visible");
  const [editorState, setEditorState] = useState<
    AdminPaymentMethodsEditorState | null
  >(() => (identity ? createAdminPaymentMethodsEditorState(identity) : null));
  const editorStateRef = useRef(editorState);
  editorStateRef.current = editorState;
  const mountedRef = useRef(false);
  const catalog = useAdminPaymentMethodsCatalog(
    userId,
    accessToken,
    archiveFilter,
  );

  const updateEditor = useCallback((
    update: (
      current: AdminPaymentMethodsEditorState,
    ) => AdminPaymentMethodsEditorState,
  ) => {
    const currentIdentity = identityRef.current;
    if (!currentIdentity) return;
    setEditorState((current) => {
      const scopedCurrent = current
        && isSameAdminPaymentMethodsAuthIdentity(
          current.identity,
          currentIdentity,
        )
        ? current
        : createAdminPaymentMethodsEditorState(currentIdentity);
      const next = update(scopedCurrent);
      editorStateRef.current = next;
      return next;
    });
  }, []);

  const requireIdentity = useCallback(() => {
    const requestIdentity = identityRef.current;
    if (!requestIdentity && userIdRef.current) {
      toast.error("Session expired. Please sign in again.");
    }
    return requestIdentity;
  }, []);

  const reloadCurrentCatalog = useCallback(() => {
    void catalog.reload({ forceNewFlight: true, resetRetryCount: true });
  }, [catalog.reload]);

  const setArchiveFilter = useCallback((
    value: AdminPaymentMethodsArchiveFilter,
  ) => {
    setArchiveFilterState(value);
    updateEditor((current) => ({ ...current, editingMethod: null }));
  }, [updateEditor]);
  const restoreVisibleFilter = useCallback(() => {
    setArchiveFilter("visible");
  }, [setArchiveFilter]);

  const editorActions = useAdminPaymentMethodEditorActions({
    editorStateRef,
    identity,
    identityRef,
    mountedRef,
    reloadCurrentCatalog,
    requireIdentity,
    updateEditor,
  });
  const rowActions = useAdminPaymentMethodRowActions({
    identity,
    identityRef,
    mountedRef,
    reloadCurrentCatalog,
    requireIdentity,
    restoreVisibleFilter,
    userIdRef,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const nextEditor = identity
      ? createAdminPaymentMethodsEditorState(identity)
      : null;
    editorStateRef.current = nextEditor;
    setEditorState(nextEditor);
  }, [identity]);

  const visibleEditor = editorState
    && isSameAdminPaymentMethodsAuthIdentity(editorState.identity, identity)
    ? editorState
    : null;

  return {
    ...catalog,
    ...editorActions,
    ...rowActions,
    archiveFilter,
    cancelEdit: () => updateEditor((current) => ({
      ...current,
      editingMethod: null,
    })),
    editInstructions: visibleEditor?.editInstructions ?? "",
    editName: visibleEditor?.editName ?? "",
    editNumber: visibleEditor?.editNumber ?? "",
    editingMethod: visibleEditor?.editingMethod ?? null,
    newInstructions: visibleEditor?.newInstructions ?? "",
    newName: visibleEditor?.newName ?? "",
    newNumber: visibleEditor?.newNumber ?? "",
    newType: visibleEditor?.newType ?? "cbe",
    setArchiveFilter,
    setEditInstructions: (value: string) => updateEditor((current) => ({
      ...current,
      editInstructions: value,
    })),
    setEditName: (value: string) => updateEditor((current) => ({
      ...current,
      editName: value,
    })),
    setEditNumber: (value: string) => updateEditor((current) => ({
      ...current,
      editNumber: value,
    })),
    setNewInstructions: (value: string) => updateEditor((current) => ({
      ...current,
      newInstructions: value,
    })),
    setNewName: (value: string) => updateEditor((current) => ({
      ...current,
      newName: value,
    })),
    setNewNumber: (value: string) => updateEditor((current) => ({
      ...current,
      newNumber: value,
    })),
    setNewType: (value: PaymentMethodType) => updateEditor((current) => ({
      ...current,
      newType: value,
    })),
    setShowAdd: (value: boolean) => updateEditor((current) => ({
      ...current,
      showAdd: value,
    })),
    showAdd: visibleEditor?.showAdd ?? false,
    startEdit: (method: AdminPaymentMethod) => updateEditor((current) => ({
      ...current,
      editInstructions: method.instructions ?? "",
      editName: method.account_name,
      editNumber: method.account_number,
      editingMethod: method,
    })),
  };
}

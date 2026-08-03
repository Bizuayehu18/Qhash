import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import {
  adminPaymentMethodsGlobalMutationFlights,
  createAdminPaymentMethodsScopedValue,
  createLatestAdminPaymentMethodsRequestGuard,
  isSameAdminPaymentMethodsAuthIdentity,
  readAdminPaymentMethodsScopedValue,
  type AdminPaymentMethodsAuthIdentity,
  type AdminPaymentMethodsScopedValue,
} from "../../application/admin-payment-methods-auth-lifecycle.js";
import {
  createAdminPaymentMethod,
  updateAdminPaymentMethod,
} from "../../application/admin-payment-methods-browser-service.js";
import type {
  AdminPaymentMethodsEditorState,
  AdminPaymentMethodsEditorUpdater,
} from "./admin-payment-methods-editor-state.js";

type EditorActionsInput = Readonly<{
  editorStateRef: Readonly<{
    current: AdminPaymentMethodsEditorState | null;
  }>;
  identity: AdminPaymentMethodsAuthIdentity | null;
  identityRef: Readonly<{
    current: AdminPaymentMethodsAuthIdentity | null;
  }>;
  mountedRef: Readonly<{ current: boolean }>;
  reloadCurrentCatalog: () => void;
  requireIdentity: () => AdminPaymentMethodsAuthIdentity | null;
  updateEditor: AdminPaymentMethodsEditorUpdater;
}>;

export function useAdminPaymentMethodEditorActions({
  editorStateRef,
  identity,
  identityRef,
  mountedRef,
  reloadCurrentCatalog,
  requireIdentity,
  updateEditor,
}: EditorActionsInput) {
  const [savingState, setSavingState] =
    useState<AdminPaymentMethodsScopedValue<boolean> | null>(null);
  const [editSavingState, setEditSavingState] =
    useState<AdminPaymentMethodsScopedValue<boolean> | null>(null);
  const createGuardRef = useRef(createLatestAdminPaymentMethodsRequestGuard());
  const editGuardRef = useRef(createLatestAdminPaymentMethodsRequestGuard());

  const addMethod = useCallback(async () => {
    const requestIdentity = requireIdentity();
    const draft = editorStateRef.current;
    if (
      !requestIdentity
      || !draft
      || !isSameAdminPaymentMethodsAuthIdentity(draft.identity, requestIdentity)
      || !draft.newName.trim()
      || !draft.newNumber.trim()
    ) return false;

    const input = {
      accountName: draft.newName.trim(),
      accountNumber: draft.newNumber.trim(),
      instructions: draft.newInstructions.trim() || null,
      type: draft.newType,
    } as const;
    const accepted = await adminPaymentMethodsGlobalMutationFlights.run(
      {
        identity: requestIdentity,
        fingerprint: JSON.stringify(["create", input]),
      },
      async () => {
        const request = createGuardRef.current.begin(requestIdentity);
        setSavingState(
          createAdminPaymentMethodsScopedValue(requestIdentity, true),
        );
        try {
          await createAdminPaymentMethod(requestIdentity.accessToken, input);
          if (mountedRef.current && request.isCurrent(identityRef.current)) {
            updateEditor((current) => ({
              ...current,
              newInstructions: "",
              newName: "",
              newNumber: "",
              showAdd: false,
            }));
            toast.success("Payment method created.");
          }
          return true;
        } catch (error) {
          if (mountedRef.current && request.isCurrent(identityRef.current)) {
            toast.error(getSafeErrorMessage(error, "PAYMENT").message);
          }
          return false;
        } finally {
          if (mountedRef.current && request.isCurrent(identityRef.current)) {
            setSavingState(
              createAdminPaymentMethodsScopedValue(requestIdentity, false),
            );
          }
        }
      },
    );
    if (
      accepted
      && mountedRef.current
      && isSameAdminPaymentMethodsAuthIdentity(identityRef.current, requestIdentity)
    ) reloadCurrentCatalog();
    return accepted;
  }, [editorStateRef, identityRef, mountedRef, reloadCurrentCatalog, requireIdentity, updateEditor]);

  const saveEdit = useCallback(async () => {
    const requestIdentity = requireIdentity();
    const draft = editorStateRef.current;
    if (
      !requestIdentity
      || !draft?.editingMethod
      || !isSameAdminPaymentMethodsAuthIdentity(draft.identity, requestIdentity)
      || !draft.editName.trim()
      || !draft.editNumber.trim()
    ) return false;

    const input = {
      accountName: draft.editName.trim(),
      accountNumber: draft.editNumber.trim(),
      instructions: draft.editInstructions.trim() || null,
      methodId: draft.editingMethod.id,
    };
    const accepted = await adminPaymentMethodsGlobalMutationFlights.run(
      {
        identity: requestIdentity,
        fingerprint: JSON.stringify(["edit", input]),
      },
      async () => {
        const request = editGuardRef.current.begin(requestIdentity);
        setEditSavingState(
          createAdminPaymentMethodsScopedValue(requestIdentity, true),
        );
        try {
          await updateAdminPaymentMethod(requestIdentity.accessToken, input);
          if (mountedRef.current && request.isCurrent(identityRef.current)) {
            updateEditor((current) => ({ ...current, editingMethod: null }));
            toast.success("Payment method updated.");
          }
          return true;
        } catch (error) {
          if (mountedRef.current && request.isCurrent(identityRef.current)) {
            toast.error(getSafeErrorMessage(error, "PAYMENT").message);
          }
          return false;
        } finally {
          if (mountedRef.current && request.isCurrent(identityRef.current)) {
            setEditSavingState(
              createAdminPaymentMethodsScopedValue(requestIdentity, false),
            );
          }
        }
      },
    );
    if (
      accepted
      && mountedRef.current
      && isSameAdminPaymentMethodsAuthIdentity(identityRef.current, requestIdentity)
    ) reloadCurrentCatalog();
    return accepted;
  }, [editorStateRef, identityRef, mountedRef, reloadCurrentCatalog, requireIdentity, updateEditor]);

  useEffect(() => {
    createGuardRef.current.invalidate();
    editGuardRef.current.invalidate();
    setSavingState(null);
    setEditSavingState(null);
  }, [identity]);

  useEffect(() => () => {
    createGuardRef.current.invalidate();
    editGuardRef.current.invalidate();
  }, []);

  return {
    addMethod,
    editSaving: readAdminPaymentMethodsScopedValue(
      editSavingState,
      identity,
    ) ?? false,
    saveEdit,
    saving: readAdminPaymentMethodsScopedValue(savingState, identity) ?? false,
  };
}

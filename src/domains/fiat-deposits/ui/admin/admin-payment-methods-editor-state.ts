import type { PaymentMethodType } from "@/lib/database.types.js";
import type {
  AdminPaymentMethodsAuthIdentity,
} from "../../application/admin-payment-methods-auth-lifecycle.js";
import type {
  AdminPaymentMethod,
} from "../../application/admin-payment-methods-browser-service.js";

export type AdminPaymentMethodsEditorState = Readonly<{
  editInstructions: string;
  editName: string;
  editNumber: string;
  editingMethod: AdminPaymentMethod | null;
  identity: AdminPaymentMethodsAuthIdentity;
  newInstructions: string;
  newName: string;
  newNumber: string;
  newType: PaymentMethodType;
  showAdd: boolean;
}>;

export type AdminPaymentMethodsEditorUpdater = (
  update: (
    current: AdminPaymentMethodsEditorState,
  ) => AdminPaymentMethodsEditorState,
) => void;

export function createAdminPaymentMethodsEditorState(
  identity: AdminPaymentMethodsAuthIdentity,
): AdminPaymentMethodsEditorState {
  return {
    editInstructions: "",
    editName: "",
    editNumber: "",
    editingMethod: null,
    identity,
    newInstructions: "",
    newName: "",
    newNumber: "",
    newType: "cbe",
    showAdd: false,
  };
}

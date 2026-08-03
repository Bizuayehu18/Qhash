import {
  archivePaymentMethodFn,
  createPaymentMethodFn,
  getPaymentMethodsFn,
  updatePaymentMethodFn,
  type PaymentMethodRow,
} from "@/lib/server/payment-methods.js";
import type { PaymentMethodType } from "@/lib/database.types.js";
import type { AdminPaymentMethodsArchiveFilter } from "./admin-payment-methods-auth-lifecycle.js";

export type AdminPaymentMethod = PaymentMethodRow;

export type CreateAdminPaymentMethodInput = Readonly<{
  accountName: string;
  accountNumber: string;
  instructions: string | null;
  type: PaymentMethodType;
}>;

export type UpdateAdminPaymentMethodInput = Readonly<{
  accountName: string;
  accountNumber: string;
  instructions: string | null;
  methodId: string;
}>;

export function loadAdminPaymentMethods(
  accessToken: string,
  archiveFilter: AdminPaymentMethodsArchiveFilter,
): Promise<AdminPaymentMethod[]> {
  return getPaymentMethodsFn({
    data: {
      activeOnly: false,
      accessToken,
      archiveFilter,
    },
  });
}

export function createAdminPaymentMethod(
  accessToken: string,
  input: CreateAdminPaymentMethodInput,
) {
  return createPaymentMethodFn({
    data: {
      accessToken,
      type: input.type,
      accountName: input.accountName,
      accountNumber: input.accountNumber,
      instructions: input.instructions,
    },
  });
}

export function updateAdminPaymentMethod(
  accessToken: string,
  input: UpdateAdminPaymentMethodInput,
) {
  return updatePaymentMethodFn({
    data: {
      accessToken,
      methodId: input.methodId,
      accountName: input.accountName,
      accountNumber: input.accountNumber,
      instructions: input.instructions,
    },
  });
}

export function setAdminPaymentMethodActive(
  accessToken: string,
  methodId: string,
  isActive: boolean,
) {
  return updatePaymentMethodFn({
    data: { accessToken, methodId, isActive },
  });
}

export function setAdminPaymentMethodArchived(
  accessToken: string,
  methodId: string,
  archived: boolean,
) {
  return archivePaymentMethodFn({
    data: { accessToken, methodId, archived },
  });
}

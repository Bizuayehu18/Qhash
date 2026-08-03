import {
  approveWithdrawalFn,
  getAdminWithdrawalsFn,
  rejectWithdrawalFn,
} from "@/lib/server/withdrawals.js";
import type { AdminFiatWithdrawalStatusFilter } from "./admin-fiat-withdrawal-operations-auth-lifecycle.js";

export type AdminFiatWithdrawal = Awaited<
  ReturnType<typeof getAdminWithdrawalsFn>
>[number];

export type AdminFiatWithdrawalReviewAction = "approve" | "reject";

export type AdminFiatWithdrawalReviewInput = Readonly<{
  action: AdminFiatWithdrawalReviewAction;
  adminNote: string | null;
  withdrawalId: string;
}>;

export function loadAdminFiatWithdrawals(
  accessToken: string,
  statusFilter: AdminFiatWithdrawalStatusFilter,
): Promise<AdminFiatWithdrawal[]> {
  return getAdminWithdrawalsFn({
    data: {
      accessToken,
      statusFilter,
    },
  });
}

export async function reviewAdminFiatWithdrawal(
  accessToken: string,
  input: AdminFiatWithdrawalReviewInput,
) {
  const request = input.action === "approve"
    ? approveWithdrawalFn
    : rejectWithdrawalFn;

  return request({
    data: {
      accessToken,
      withdrawalId: input.withdrawalId,
      adminNote: input.adminNote,
    },
  });
}

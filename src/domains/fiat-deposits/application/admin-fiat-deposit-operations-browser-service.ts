import { getAdminDepositsFn } from "@/lib/server/deposits.js";
import type { AdminFiatDepositStatusFilter } from "./admin-fiat-deposit-operations-auth-lifecycle.js";

export type AdminFiatDeposit = Awaited<
  ReturnType<typeof getAdminDepositsFn>
>[number];

export type AdminFiatDepositReviewAction = "approve" | "reject";

export type AdminFiatDepositReviewInput = Readonly<{
  action: AdminFiatDepositReviewAction;
  adminNote: string | null;
  depositId: string;
  verifiedAmount?: number;
}>;

type AdminFiatDepositReviewResponse = Readonly<{
  message?: string;
  success?: boolean;
}>;

type AdminFiatDepositReviewRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function loadAdminFiatDeposits(
  accessToken: string,
  statusFilter: AdminFiatDepositStatusFilter,
): Promise<AdminFiatDeposit[]> {
  return getAdminDepositsFn({
    data: {
      accessToken,
      statusFilter,
    },
  });
}

export async function reviewAdminFiatDeposit(
  accessToken: string,
  input: AdminFiatDepositReviewInput,
  request: AdminFiatDepositReviewRequest = fetch,
): Promise<AdminFiatDepositReviewResponse> {
  const response = await request("/api/admin/approve-deposit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      depositId: input.depositId,
      action: input.action,
      adminNote: input.adminNote,
      ...(input.action === "approve"
        ? { verifiedAmount: input.verifiedAmount }
        : {}),
    }),
  });

  const result = await response.json() as AdminFiatDepositReviewResponse;
  if (!response.ok || result.success !== true) {
    throw new Error(result.message || "Failed to review deposit.");
  }

  return result;
}

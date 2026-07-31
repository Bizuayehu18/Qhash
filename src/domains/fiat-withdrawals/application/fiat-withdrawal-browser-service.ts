import { getSecurityStatusFn } from "@/lib/server/security.js";
import {
  getUserWithdrawalsFn,
  submitWithdrawalFn,
} from "@/lib/server/withdrawals.js";
import type { FiatWithdrawalMethod } from "../domain/fiat-withdrawal-method.js";

export function loadFiatWithdrawalSecurityStatus(accessToken: string) {
  return getSecurityStatusFn({ data: { accessToken } });
}

export function loadUserFiatWithdrawals(accessToken: string) {
  return getUserWithdrawalsFn({ data: { accessToken } });
}

export function submitFiatWithdrawal(input: {
  accessToken: string;
  amount: number;
  method: FiatWithdrawalMethod;
  accountName: string;
  accountNumber: string;
  fundPassword: string;
}) {
  return submitWithdrawalFn({ data: input });
}

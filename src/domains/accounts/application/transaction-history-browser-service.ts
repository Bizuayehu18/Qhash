import { getTransactionsFn } from "@/lib/server/transactions.js";
import type { TransactionHistoryFilter } from "../domain/transaction-history.js";

export type TransactionHistoryRow = Awaited<ReturnType<typeof getTransactionsFn>>[number];

export function loadTransactionHistory(
  accessToken: string,
  filter: TransactionHistoryFilter,
) {
  return getTransactionsFn({ data: { accessToken, type: filter } });
}

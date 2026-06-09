import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

type WithdrawalMethod = "cbe" | "telebirr";
type WithdrawalStatus = "pending" | "approved" | "rejected";

type DbError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: unknown;
};

type SubmitWithdrawalInput = {
  accessToken: string;
  amount: number;
  method: WithdrawalMethod;
  accountName: string;
  accountNumber: string;
};

type GetUserWithdrawalsInput = {
  accessToken: string;
};

type RequestWithdrawalRpcArgs = {
  p_user_id: string;
  p_amount: number;
  p_method: WithdrawalMethod;
  p_account_name: string;
  p_account_number: string;
};

type RequestWithdrawalRpcResult = {
  success?: boolean;
  withdrawal_id?: string;
  amount?: number;
  fee_percent?: number;
  fee_amount?: number;
  net_amount?: number;
  balance_before?: number;
  balance_after?: number;
  status?: WithdrawalStatus | string;
  processing_hours?: number;
  [key: string]: unknown;
};

type RpcClient = {
  rpc(
    fn: "request_withdrawal_tx",
    args: RequestWithdrawalRpcArgs,
  ): Promise<{
    data: RequestWithdrawalRpcResult | null;
    error: DbError | null;
  }>;
};

type WithdrawalRowFull = {
  id: string;
  amount: number;
  method: WithdrawalMethod;
  account_name: string;
  account_number: string | null;
  status: WithdrawalStatus;
  created_at: string;
  reviewed_at: string | null;
  updated_at: string;
  fee_percent?: number | null;
  fee_amount?: number | null;
  net_amount?: number | null;
};

type SafeWithdrawalRow = {
  id: string;
  amount: number;
  method: WithdrawalMethod;
  account_name: string;
  account_last4: string;
  status: WithdrawalStatus;
  created_at: string;
  reviewed_at: string | null;
  updated_at: string;
  fee_percent: number | null;
  fee_amount: number | null;
  net_amount: number | null;
};

type WithdrawalSelectQuery = {
  eq(column: "user_id", value: string): WithdrawalSelectQuery;
  order(
    column: "created_at",
    options: { ascending: false },
  ): WithdrawalSelectQuery;
  limit(count: number): Promise<{
    data: WithdrawalRowFull[] | null;
    error: DbError | null;
  }>;
};

type WithdrawalTableClient = {
  from(table: "withdrawals"): {
    select(columns: string): WithdrawalSelectQuery;
  };
};

function maskLast4(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  return raw.slice(-4);
}

function parseAmount(value: unknown): number {
  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return Number.NaN;
    return Number(trimmed);
  }

  return Number.NaN;
}

function validateSubmitWithdrawalInput(data: unknown): SubmitWithdrawalInput {
  if (!data || typeof data !== "object") {
    throwSafe("WITHDRAWAL", "Withdrawal request failed. Please try again.", "Invalid request data");
  }

  const {
    accessToken,
    amount,
    method,
    accountName,
    accountNumber,
  } = data as Record<string, unknown>;

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throwSafe("WITHDRAWAL", "Your session has expired. Please log in again.", "Missing access token");
  }

  const parsedAmount = parseAmount(amount);

  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throwSafe("WITHDRAWAL", "Please enter a valid withdrawal amount.", "Invalid withdrawal amount");
  }

  if (parsedAmount < 200) {
    throwSafe("WITHDRAWAL", "Minimum withdrawal amount is 200 ETB.", "Withdrawal amount below minimum");
  }

  if (method !== "cbe" && method !== "telebirr") {
    throwSafe("WITHDRAWAL", "Please select a valid withdrawal method.", "Invalid withdrawal method");
  }

  if (typeof accountName !== "string" || accountName.trim().length < 2) {
    throwSafe("WITHDRAWAL", "Please enter a valid account name.", "Invalid account name");
  }

  if (typeof accountNumber !== "string" || accountNumber.trim().length < 5) {
    throwSafe("WITHDRAWAL", "Please enter a valid account number.", "Invalid account number");
  }

  return {
    accessToken: accessToken.trim(),
    amount: parsedAmount,
    method,
    accountName: accountName.trim(),
    accountNumber: accountNumber.trim(),
  };
}

function validateAccessTokenInput(data: unknown): GetUserWithdrawalsInput {
  if (!data || typeof data !== "object") {
    throwSafe("WITHDRAWAL", "Unable to load withdrawals.", "Invalid request data");
  }

  const { accessToken } = data as Record<string, unknown>;

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throwSafe("WITHDRAWAL", "Your session has expired. Please log in again.", "Missing access token");
  }

  return { accessToken: accessToken.trim() };
}

function safeDbMessage(error: DbError | null): string {
  if (!error) return "Unknown database error";

  return [
    error.message,
    error.code && `code=${error.code}`,
    error.details && `details=${error.details}`,
  ]
    .filter(Boolean)
    .join(" | ");
}

export const submitWithdrawalFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateSubmitWithdrawalInput(data))
  .handler(async ({ data }) => {
    const admin = getAdminClient();

    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(data.accessToken);

    if (authError || !authUser) {
      throwSafe("WITHDRAWAL", "Your session has expired. Please log in again.", "Invalid or expired access token");
    }

    try {
      const { data: result, error } = await (admin as unknown as RpcClient).rpc(
        "request_withdrawal_tx",
        {
          p_user_id: authUser.id,
          p_amount: data.amount,
          p_method: data.method,
          p_account_name: data.accountName,
          p_account_number: data.accountNumber,
        },
      );

      if (error) {
        console.error(
          "[QHash] Withdrawal submit RPC error:",
          JSON.stringify({
            user_id: authUser.id,
            amount: data.amount,
            method: data.method,
            account_last4: maskLast4(data.accountNumber),
            error: safeDbMessage(error),
          }),
        );

        throwSafe(
          "WITHDRAWAL",
          "Withdrawal request failed. Please try again.",
          `request_withdrawal_tx failed: ${safeDbMessage(error)}`,
        );
      }

      return result ?? { success: false };
    } catch (err) {
      console.error(
        "[QHash] Withdrawal submit error:",
        JSON.stringify({
          user_id: authUser.id,
          amount: data.amount,
          method: data.method,
          account_last4: maskLast4(data.accountNumber),
          error: err instanceof Error ? err.message : String(err),
        }),
      );

      throwSafe(
        "WITHDRAWAL",
        "Withdrawal request failed. Please try again.",
        `Withdrawal submit failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

export const getUserWithdrawalsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateAccessTokenInput(data))
  .handler(async ({ data }) => {
    const admin = getAdminClient();

    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(data.accessToken);

    if (authError || !authUser) {
      throwSafe("WITHDRAWAL", "Your session has expired. Please log in again.", "Invalid or expired access token");
    }

    try {
      const { data: rows, error } = await (admin as unknown as WithdrawalTableClient)
        .from("withdrawals")
        .select(
          [
            "id",
            "amount",
            "method",
            "account_name",
            "account_number",
            "status",
            "created_at",
            "reviewed_at",
            "updated_at",
            "fee_percent",
            "fee_amount",
            "net_amount",
          ].join(", "),
        )
        .eq("user_id", authUser.id)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) {
        console.error(
          "[QHash] Withdrawal history load DB error:",
          JSON.stringify({
            user_id: authUser.id,
            error: safeDbMessage(error),
          }),
        );

        throwSafe(
          "WITHDRAWAL",
          "Unable to load withdrawals.",
          `Withdrawal history query failed: ${safeDbMessage(error)}`,
        );
      }

      return (rows ?? []).map(
        (row): SafeWithdrawalRow => ({
          id: row.id,
          amount: row.amount,
          method: row.method,
          account_name: row.account_name,
          account_last4: maskLast4(row.account_number),
          status: row.status,
          created_at: row.created_at,
          reviewed_at: row.reviewed_at,
          updated_at: row.updated_at,
          fee_percent: row.fee_percent ?? null,
          fee_amount: row.fee_amount ?? null,
          net_amount: row.net_amount ?? null,
        }),
      );
    } catch (err) {
      console.error(
        "[QHash] Withdrawal history load error:",
        JSON.stringify({
          user_id: authUser.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );

      throwSafe(
        "WITHDRAWAL",
        "Unable to load withdrawals.",
        `Withdrawal history load failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { verifyFundPasswordForUser } from "./security.js";
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
  fundPassword: string;
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

type DailyWithdrawalLimitRow = {
  id: string;
};

type DailyWithdrawalLimitQuery = {
  eq(column: "user_id", value: string): DailyWithdrawalLimitQuery;
  gte(column: "created_at", value: string): DailyWithdrawalLimitQuery;
  lt(column: "created_at", value: string): DailyWithdrawalLimitQuery;
  limit(count: number): Promise<{
    data: DailyWithdrawalLimitRow[] | null;
    error: DbError | null;
  }>;
};

type DailyWithdrawalLimitClient = {
  from(table: "withdrawals"): {
    select(columns: string): DailyWithdrawalLimitQuery;
  };
};

type EthiopiaDayUtcRange = {
  startIso: string;
  endIso: string;
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

function getEthiopiaDayUtcRange(now = new Date()): EthiopiaDayUtcRange {
  const ethiopiaOffsetMs = 3 * 60 * 60 * 1000;
  const ethiopiaNow = new Date(now.getTime() + ethiopiaOffsetMs);

  const year = ethiopiaNow.getUTCFullYear();
  const month = ethiopiaNow.getUTCMonth();
  const day = ethiopiaNow.getUTCDate();

  const startUtcMs = Date.UTC(year, month, day) - ethiopiaOffsetMs;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;

  return {
    startIso: new Date(startUtcMs).toISOString(),
    endIso: new Date(endUtcMs).toISOString(),
  };
}

async function assertNoWithdrawalToday(
  admin: DailyWithdrawalLimitClient,
  userId: string,
): Promise<void> {
  const { startIso, endIso } = getEthiopiaDayUtcRange();

  let existingWithdrawals: DailyWithdrawalLimitRow[] | null = null;
  let queryError: DbError | null = null;

  try {
    const { data, error } = await admin
      .from("withdrawals")
      .select("id")
      .eq("user_id", userId)
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .limit(1);

    existingWithdrawals = data;
    queryError = error;
  } catch (err) {
    console.error(
      "[QHash] Withdrawal daily limit check error:",
      JSON.stringify({
        user_id: userId,
        ethiopia_day_start: startIso,
        ethiopia_day_end: endIso,
        error: err instanceof Error ? err.message : String(err),
      }),
    );

    throwSafe(
      "WITHDRAWAL",
      "Withdrawal request failed. Please try again.",
      `Withdrawal daily limit check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (queryError) {
    console.error(
      "[QHash] Withdrawal daily limit check DB error:",
      JSON.stringify({
        user_id: userId,
        ethiopia_day_start: startIso,
        ethiopia_day_end: endIso,
        error: safeDbMessage(queryError),
      }),
    );

    throwSafe(
      "WITHDRAWAL",
      "Withdrawal request failed. Please try again.",
      `Withdrawal daily limit check failed: ${safeDbMessage(queryError)}`,
    );
  }

  if ((existingWithdrawals ?? []).length > 0) {
    throwSafe(
      "WITHDRAWAL",
      "You can only submit one withdrawal request per day. Please try again tomorrow.",
      "Daily withdrawal limit reached",
    );
  }
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
    fundPassword,
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

  if (typeof fundPassword !== "string" || !/^[0-9]{4}$/.test(fundPassword.trim())) {
    throwSafe("WITHDRAWAL", "Enter your 4-digit fund password.", "Invalid fund password format");
  }

  return {
    accessToken: accessToken.trim(),
    amount: parsedAmount,
    method,
    accountName: accountName.trim(),
    accountNumber: accountNumber.trim(),
    fundPassword: fundPassword.trim(),
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

    await verifyFundPasswordForUser(authUser.id, data.fundPassword);

    await assertNoWithdrawalToday(
      admin as unknown as DailyWithdrawalLimitClient,
      authUser.id,
    );

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

type AdminWithdrawalStatusFilter = "all" | "pending" | "approved" | "rejected";

type AdminWithdrawalInput = {
  accessToken: string;
  statusFilter?: AdminWithdrawalStatusFilter;
};

type AdminWithdrawalActionInput = {
  accessToken: string;
  withdrawalId: string;
  adminNote: string | null;
};

type AdminWithdrawalRow = {
  id: string;
  user_id: string;
  amount: number;
  method: WithdrawalMethod;
  account_name: string;
  account_number: string | null;
  status: WithdrawalStatus;
  created_at: string;
  reviewed_at: string | null;
  updated_at: string;
  fee_percent: number | null;
  fee_amount: number | null;
  net_amount: number | null;
  admin_note: string | null;
};

type AdminWithdrawalProfile = {
  id: string;
  username: string | null;
  phone: string | null;
};

type AdminWithdrawalSafeRow = {
  id: string;
  user_id: string;
  username: string;
  phone: string;
  amount: number;
  method: WithdrawalMethod;
  account_name: string;
  account_number: string;
  account_last4: string;
  status: WithdrawalStatus;
  created_at: string;
  reviewed_at: string | null;
  updated_at: string;
  fee_percent: number | null;
  fee_amount: number | null;
  net_amount: number | null;
  admin_note: string | null;
};

type WithdrawalActionRpcArgs = {
  p_admin_id: string;
  p_withdrawal_id: string;
  p_admin_note: string | null;
};

type WithdrawalActionRpcResult = {
  success?: boolean;
  withdrawal_id?: string;
  status?: WithdrawalStatus | string;
  amount?: number;
  fee_amount?: number;
  net_amount?: number;
  balance_before?: number;
  balance_after?: number;
  refunded_amount?: number;
  [key: string]: unknown;
};

type ApproveWithdrawalRpcClient = {
  rpc(
    fn: "approve_withdrawal_tx",
    args: WithdrawalActionRpcArgs,
  ): Promise<{
    data: WithdrawalActionRpcResult | null;
    error: DbError | null;
  }>;
};

type RejectWithdrawalRpcClient = {
  rpc(
    fn: "reject_withdrawal_tx",
    args: WithdrawalActionRpcArgs,
  ): Promise<{
    data: WithdrawalActionRpcResult | null;
    error: DbError | null;
  }>;
};

function validateAdminWithdrawalsInput(data: unknown): AdminWithdrawalInput {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Failed to load withdrawals.", "Invalid request data");
  }

  const { accessToken, statusFilter } = data as Record<string, unknown>;

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throwSafe("ADMIN", "Unauthorized.", "Missing access token");
  }

  const normalizedStatus =
    typeof statusFilter === "string" ? statusFilter : "all";

  if (
    normalizedStatus !== "all" &&
    normalizedStatus !== "pending" &&
    normalizedStatus !== "approved" &&
    normalizedStatus !== "rejected"
  ) {
    throwSafe("ADMIN", "Failed to load withdrawals.", `Invalid withdrawal status filter: ${normalizedStatus}`);
  }

  return {
    accessToken: accessToken.trim(),
    statusFilter: normalizedStatus,
  };
}

function validateAdminWithdrawalActionInput(data: unknown): AdminWithdrawalActionInput {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Withdrawal review failed.", "Invalid request data");
  }

  const { accessToken, withdrawalId, adminNote } = data as Record<string, unknown>;

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throwSafe("ADMIN", "Unauthorized.", "Missing access token");
  }

  if (typeof withdrawalId !== "string" || withdrawalId.trim().length === 0) {
    throwSafe("ADMIN", "Withdrawal review failed.", "Missing withdrawal id");
  }

  return {
    accessToken: accessToken.trim(),
    withdrawalId: withdrawalId.trim(),
    adminNote: typeof adminNote === "string" && adminNote.trim().length > 0
      ? adminNote.trim()
      : null,
  };
}

async function requireActiveAdmin(accessToken: string): Promise<string> {
  const admin = getAdminClient();

  const {
    data: { user: authUser },
    error: authError,
  } = await admin.auth.getUser(accessToken);

  if (authError || !authUser) {
    throwSafe("ADMIN", "Unauthorized.", "Invalid or expired access token");
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, is_admin, is_frozen")
    .eq("id", authUser.id)
    .single();

  if (profileError || !profile || profile.is_admin !== true || profile.is_frozen === true) {
    throwSafe("ADMIN", "Unauthorized.", "Non-admin or frozen admin attempted withdrawal access");
  }

  return authUser.id;
}

export const getAdminWithdrawalsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateAdminWithdrawalsInput(data))
  .handler(async ({ data }) => {
    const admin = getAdminClient();
    await requireActiveAdmin(data.accessToken);

    try {
      let query = (admin as any)
        .from("withdrawals")
        .select(
          [
            "id",
            "user_id",
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
            "admin_note",
          ].join(", "),
        )
        .order("created_at", { ascending: false })
        .limit(100);

      if (data.statusFilter && data.statusFilter !== "all") {
        query = query.eq("status", data.statusFilter);
      }

      const { data: rows, error } = await query;

      if (error) {
        console.error(
          "[QHash] Admin withdrawal list DB error:",
          JSON.stringify({ error: safeDbMessage(error) }),
        );

        throwSafe(
          "ADMIN",
          "Failed to load withdrawals.",
          `Admin withdrawal list query failed: ${safeDbMessage(error)}`,
        );
      }

      const withdrawals = (rows ?? []) as AdminWithdrawalRow[];
      const userIds = [...new Set(withdrawals.map((row) => row.user_id))];

      let profiles: AdminWithdrawalProfile[] = [];

      if (userIds.length > 0) {
        const { data: profileRows, error: profileError } = await (admin as any)
          .from("profiles")
          .select("id, username, phone")
          .in("id", userIds);

        if (profileError) {
          console.error(
            "[QHash] Admin withdrawal profiles DB error:",
            JSON.stringify({ error: safeDbMessage(profileError) }),
          );
        } else {
          profiles = (profileRows ?? []) as AdminWithdrawalProfile[];
        }
      }

      return withdrawals.map((row): AdminWithdrawalSafeRow => {
        const profile = profiles.find((p) => p.id === row.user_id);

        return {
          id: row.id,
          user_id: row.user_id,
          username: profile?.username ?? "Unknown",
          phone: profile?.phone ?? "",
          amount: row.amount,
          method: row.method,
          account_name: row.account_name,
          account_number: row.account_number ?? "",
          account_last4: maskLast4(row.account_number),
          status: row.status,
          created_at: row.created_at,
          reviewed_at: row.reviewed_at,
          updated_at: row.updated_at,
          fee_percent: row.fee_percent ?? null,
          fee_amount: row.fee_amount ?? null,
          net_amount: row.net_amount ?? null,
          admin_note: row.admin_note ?? null,
        };
      });
    } catch (err) {
      console.error(
        "[QHash] Admin withdrawal list error:",
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      );

      throwSafe(
        "ADMIN",
        "Failed to load withdrawals.",
        `Admin withdrawal list failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

export const approveWithdrawalFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateAdminWithdrawalActionInput(data))
  .handler(async ({ data }) => {
    const admin = getAdminClient();
    const adminId = await requireActiveAdmin(data.accessToken);

    try {
      const { data: result, error } = await (admin as unknown as ApproveWithdrawalRpcClient).rpc(
        "approve_withdrawal_tx",
        {
          p_admin_id: adminId,
          p_withdrawal_id: data.withdrawalId,
          p_admin_note: data.adminNote,
        },
      );

      if (error) {
        console.error(
          "[QHash] Approve withdrawal RPC error:",
          JSON.stringify({
            admin_id: adminId,
            withdrawal_id: data.withdrawalId,
            error: safeDbMessage(error),
          }),
        );

        throwSafe(
          "ADMIN",
          "Withdrawal approval failed.",
          `approve_withdrawal_tx failed: ${safeDbMessage(error)}`,
        );
      }

      return result ?? { success: false };
    } catch (err) {
      console.error(
        "[QHash] Approve withdrawal error:",
        JSON.stringify({
          admin_id: adminId,
          withdrawal_id: data.withdrawalId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );

      throwSafe(
        "ADMIN",
        "Withdrawal approval failed.",
        `Withdrawal approval failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

export const rejectWithdrawalFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateAdminWithdrawalActionInput(data))
  .handler(async ({ data }) => {
    const admin = getAdminClient();
    const adminId = await requireActiveAdmin(data.accessToken);

    try {
      const { data: result, error } = await (admin as unknown as RejectWithdrawalRpcClient).rpc(
        "reject_withdrawal_tx",
        {
          p_admin_id: adminId,
          p_withdrawal_id: data.withdrawalId,
          p_admin_note: data.adminNote,
        },
      );

      if (error) {
        console.error(
          "[QHash] Reject withdrawal RPC error:",
          JSON.stringify({
            admin_id: adminId,
            withdrawal_id: data.withdrawalId,
            error: safeDbMessage(error),
          }),
        );

        throwSafe(
          "ADMIN",
          "Withdrawal rejection failed.",
          `reject_withdrawal_tx failed: ${safeDbMessage(error)}`,
        );
      }

      return result ?? { success: false };
    } catch (err) {
      console.error(
        "[QHash] Reject withdrawal error:",
        JSON.stringify({
          admin_id: adminId,
          withdrawal_id: data.withdrawalId,
          error: err instanceof Error ? err.message : String(err),
        }),
      );

      throwSafe(
        "ADMIN",
        "Withdrawal rejection failed.",
        `Withdrawal rejection failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

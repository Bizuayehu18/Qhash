import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

type DbError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: unknown;
};

type SecurityStatusInput = {
  accessToken: string;
};

type SetFundPasswordInput = {
  accessToken: string;
  fundPassword: string;
  confirmFundPassword: string;
};

type ChangeFundPasswordInput = {
  accessToken: string;
  currentFundPassword: string;
  newFundPassword: string;
  confirmNewFundPassword: string;
};

export type SecurityStatus = {
  hasFundPassword: boolean;
  fundPasswordLockedUntil: string | null;
  fundPasswordFailedAttempts: number;
  isFundPasswordLocked: boolean;
};

type FundPasswordRpcResult = {
  success?: boolean;
  code?: string;
  message?: string;
  has_fund_password?: boolean;
  locked_until?: string | null;
  failed_attempts?: number;
  remaining_attempts?: number;
  [key: string]: unknown;
};

type SecurityRpcClient = {
  rpc(
    fn: "get_fund_password_status_tx",
    args: { p_user_id: string },
  ): Promise<{
    data: FundPasswordRpcResult | null;
    error: DbError | null;
  }>;
  rpc(
    fn: "set_fund_password_tx",
    args: { p_user_id: string; p_fund_password: string },
  ): Promise<{
    data: FundPasswordRpcResult | null;
    error: DbError | null;
  }>;
  rpc(
    fn: "verify_fund_password_tx",
    args: { p_user_id: string; p_fund_password: string },
  ): Promise<{
    data: FundPasswordRpcResult | null;
    error: DbError | null;
  }>;
  rpc(
    fn: "change_fund_password_tx",
    args: {
      p_user_id: string;
      p_current_fund_password: string;
      p_new_fund_password: string;
    },
  ): Promise<{
    data: FundPasswordRpcResult | null;
    error: DbError | null;
  }>;
};

function normalizeAccessToken(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throwSafe("AUTH", "Your session has expired. Please log in again.", "Missing access token");
  }

  return value.trim();
}

function normalizeFundPassword(
  value: unknown,
  userMessage = "Fund password must be exactly 4 digits.",
): string {
  if (typeof value !== "string") {
    throwSafe("AUTH", userMessage, "Fund password must be a string");
  }

  const trimmed = value.trim();

  if (!/^[0-9]{4}$/.test(trimmed)) {
    throwSafe("AUTH", userMessage, "Fund password failed 4-digit validation");
  }

  return trimmed;
}

function validateSecurityStatusInput(data: unknown): SecurityStatusInput {
  if (!data || typeof data !== "object") {
    throwSafe("AUTH", "Unable to load security settings.", "Invalid security status request data");
  }

  const { accessToken } = data as Record<string, unknown>;

  return {
    accessToken: normalizeAccessToken(accessToken),
  };
}

function validateSetFundPasswordInput(data: unknown): SetFundPasswordInput {
  if (!data || typeof data !== "object") {
    throwSafe("AUTH", "Unable to create fund password.", "Invalid set fund password request data");
  }

  const {
    accessToken,
    fundPassword,
    confirmFundPassword,
  } = data as Record<string, unknown>;

  const normalizedFundPassword = normalizeFundPassword(fundPassword);
  const normalizedConfirmFundPassword = normalizeFundPassword(confirmFundPassword);

  if (normalizedFundPassword !== normalizedConfirmFundPassword) {
    throwSafe("AUTH", "Fund passwords do not match.", "Fund password confirmation mismatch");
  }

  return {
    accessToken: normalizeAccessToken(accessToken),
    fundPassword: normalizedFundPassword,
    confirmFundPassword: normalizedConfirmFundPassword,
  };
}

function validateChangeFundPasswordInput(data: unknown): ChangeFundPasswordInput {
  if (!data || typeof data !== "object") {
    throwSafe("AUTH", "Unable to update fund password.", "Invalid change fund password request data");
  }

  const {
    accessToken,
    currentFundPassword,
    newFundPassword,
    confirmNewFundPassword,
  } = data as Record<string, unknown>;

  const normalizedCurrentFundPassword = normalizeFundPassword(
    currentFundPassword,
    "Current fund password must be exactly 4 digits.",
  );
  const normalizedNewFundPassword = normalizeFundPassword(
    newFundPassword,
    "New fund password must be exactly 4 digits.",
  );
  const normalizedConfirmNewFundPassword = normalizeFundPassword(
    confirmNewFundPassword,
    "Confirm fund password must be exactly 4 digits.",
  );

  if (normalizedNewFundPassword !== normalizedConfirmNewFundPassword) {
    throwSafe("AUTH", "New fund passwords do not match.", "New fund password confirmation mismatch");
  }

  if (normalizedCurrentFundPassword === normalizedNewFundPassword) {
    throwSafe("AUTH", "New fund password must be different from the current one.", "Fund password unchanged");
  }

  return {
    accessToken: normalizeAccessToken(accessToken),
    currentFundPassword: normalizedCurrentFundPassword,
    newFundPassword: normalizedNewFundPassword,
    confirmNewFundPassword: normalizedConfirmNewFundPassword,
  };
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

function isLockedUntilActive(value: string | null): boolean {
  if (!value) return false;

  const lockedUntilMs = new Date(value).getTime();

  return Number.isFinite(lockedUntilMs) && lockedUntilMs > Date.now();
}

function buildSecurityStatus(result: FundPasswordRpcResult | null): SecurityStatus {
  const hasFundPassword = result?.has_fund_password === true;
  const fundPasswordLockedUntil =
    typeof result?.locked_until === "string" && result.locked_until.length > 0
      ? result.locked_until
      : null;
  const fundPasswordFailedAttempts =
    typeof result?.failed_attempts === "number" && Number.isFinite(result.failed_attempts)
      ? result.failed_attempts
      : 0;

  return {
    hasFundPassword,
    fundPasswordLockedUntil,
    fundPasswordFailedAttempts,
    isFundPasswordLocked: isLockedUntilActive(fundPasswordLockedUntil),
  };
}

function getFundPasswordUserMessage(result: FundPasswordRpcResult | null, fallback: string): string {
  if (typeof result?.message === "string" && result.message.trim().length > 0) {
    return result.message.trim();
  }

  return fallback;
}

function throwFundPasswordRpcFailure(result: FundPasswordRpcResult | null, fallback: string): never {
  const code = typeof result?.code === "string" ? result.code : "unknown_fund_password_error";
  throwSafe(
    "AUTH",
    getFundPasswordUserMessage(result, fallback),
    `Fund password RPC failed: ${code}`,
  );
}

async function getAuthenticatedUserId(accessToken: string): Promise<string> {
  const admin = getAdminClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await admin.auth.getUser(accessToken);

  if (authError || !authUser) {
    throwSafe("AUTH", "Your session has expired. Please log in again.", "Invalid or expired access token");
  }

  return authUser.id;
}

export const getSecurityStatusFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateSecurityStatusInput(data))
  .handler(async ({ data }) => {
    const userId = await getAuthenticatedUserId(data.accessToken);
    const admin = getAdminClient();

    const { data: result, error } = await (admin as unknown as SecurityRpcClient).rpc(
      "get_fund_password_status_tx",
      { p_user_id: userId },
    );

    if (error) {
      throwSafe("AUTH", "Unable to load security settings.", `get_fund_password_status_tx failed: ${safeDbMessage(error)}`);
    }

    if (result?.success === false) {
      throwFundPasswordRpcFailure(result, "Unable to load security settings.");
    }

    return buildSecurityStatus(result);
  });

export const setFundPasswordFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateSetFundPasswordInput(data))
  .handler(async ({ data }) => {
    const userId = await getAuthenticatedUserId(data.accessToken);
    const admin = getAdminClient();

    const { data: result, error } = await (admin as unknown as SecurityRpcClient).rpc(
      "set_fund_password_tx",
      {
        p_user_id: userId,
        p_fund_password: data.fundPassword,
      },
    );

    if (error) {
      throwSafe("AUTH", "Unable to create fund password.", `set_fund_password_tx failed: ${safeDbMessage(error)}`);
    }

    if (result?.success !== true) {
      throwFundPasswordRpcFailure(result, "Unable to create fund password.");
    }

    return buildSecurityStatus(result);
  });

export const changeFundPasswordFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateChangeFundPasswordInput(data))
  .handler(async ({ data }) => {
    const userId = await getAuthenticatedUserId(data.accessToken);
    const admin = getAdminClient();

    const { data: result, error } = await (admin as unknown as SecurityRpcClient).rpc(
      "change_fund_password_tx",
      {
        p_user_id: userId,
        p_current_fund_password: data.currentFundPassword,
        p_new_fund_password: data.newFundPassword,
      },
    );

    if (error) {
      throwSafe("AUTH", "Unable to update fund password.", `change_fund_password_tx failed: ${safeDbMessage(error)}`);
    }

    if (result?.success !== true) {
      throwFundPasswordRpcFailure(result, "Unable to update fund password.");
    }

    return buildSecurityStatus(result);
  });

export async function verifyFundPasswordForUser(
  userId: string,
  fundPassword: string,
): Promise<void> {
  const normalizedFundPassword = normalizeFundPassword(fundPassword);
  const admin = getAdminClient();

  const { data: result, error } = await (admin as unknown as SecurityRpcClient).rpc(
    "verify_fund_password_tx",
    {
      p_user_id: userId,
      p_fund_password: normalizedFundPassword,
    },
  );

  if (error) {
    throwSafe("WITHDRAWAL", "Unable to verify fund password.", `verify_fund_password_tx failed: ${safeDbMessage(error)}`);
  }

  if (result?.success !== true) {
    throwSafe(
      "WITHDRAWAL",
      getFundPasswordUserMessage(result, "Unable to verify fund password."),
      `Fund password verification failed: ${typeof result?.code === "string" ? result.code : "unknown_fund_password_error"}`,
    );
  }
}

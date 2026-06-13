import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

type DbError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: unknown;
};

type ResetUserFundPasswordInput = {
  accessToken: string;
  targetUserId: string;
  reason: string;
};

export type ResetUserFundPasswordResult = {
  success: true;
  message: string;
  oldHadFundPassword: boolean;
};

type ResetFundPasswordRpcResult = {
  success?: boolean;
  code?: string;
  message?: string;
  old_had_fund_password?: boolean;
  [key: string]: unknown;
};

type AdminSecurityResetRpcClient = {
  rpc(
    fn: "reset_user_fund_password_tx",
    args: {
      p_admin_user_id: string;
      p_target_user_id: string;
      p_reason: string;
    },
  ): Promise<{
    data: ResetFundPasswordRpcResult | null;
    error: DbError | null;
  }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function normalizeAccessToken(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throwSafe("ADMIN", "Session expired. Please sign in again.", "Missing access token");
  }

  return value.trim();
}

function normalizeTargetUserId(value: unknown): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throwSafe("ADMIN", "Please select a valid user.", "Invalid target user id");
  }

  return value.trim();
}

function normalizeReason(value: unknown): string {
  if (typeof value !== "string") {
    throwSafe("ADMIN", "Please enter a reset reason.", "Reset reason must be a string");
  }

  const reason = value.trim();

  if (reason.length < 5) {
    throwSafe("ADMIN", "Please enter a reset reason.", "Reset reason too short");
  }

  if (reason.length > 300) {
    throwSafe("ADMIN", "Reset reason is too long.", "Reset reason too long");
  }

  return reason;
}

function validateResetUserFundPasswordInput(data: unknown): ResetUserFundPasswordInput {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Unable to reset fund password.", "Invalid reset fund password request data");
  }

  const { accessToken, targetUserId, reason } = data as Record<string, unknown>;

  return {
    accessToken: normalizeAccessToken(accessToken),
    targetUserId: normalizeTargetUserId(targetUserId),
    reason: normalizeReason(reason),
  };
}

async function getAuthenticatedAdminUserId(accessToken: string): Promise<string> {
  const admin = getAdminClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await admin.auth.getUser(accessToken);

  if (authError || !authUser) {
    throwSafe("ADMIN", "Unauthorized.", "Invalid or expired access token");
  }

  const { data: adminProfile, error: profileError } = await admin
    .from("profiles")
    .select("is_admin, is_frozen")
    .eq("id", authUser.id)
    .single();

  if (
    profileError ||
    !adminProfile ||
    adminProfile.is_admin !== true ||
    adminProfile.is_frozen === true
  ) {
    throwSafe("ADMIN", "Unauthorized.", "Non-admin or frozen admin attempted security reset");
  }

  return authUser.id;
}

export const resetUserFundPasswordFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateResetUserFundPasswordInput(data))
  .handler(async ({ data }): Promise<ResetUserFundPasswordResult> => {
    const adminUserId = await getAuthenticatedAdminUserId(data.accessToken);
    const admin = getAdminClient();

    const { data: result, error } = await (admin as unknown as AdminSecurityResetRpcClient).rpc(
      "reset_user_fund_password_tx",
      {
        p_admin_user_id: adminUserId,
        p_target_user_id: data.targetUserId,
        p_reason: data.reason,
      },
    );

    if (error) {
      throwSafe(
        "ADMIN",
        "Unable to reset fund password.",
        `reset_user_fund_password_tx failed: ${safeDbMessage(error)}`,
      );
    }

    if (result?.success !== true) {
      const code = typeof result?.code === "string" ? result.code : "unknown_reset_error";
      const message =
        typeof result?.message === "string" && result.message.trim().length > 0
          ? result.message.trim()
          : "Unable to reset fund password.";

      throwSafe("ADMIN", message, `Fund password reset RPC failed: ${code}`);
    }

    return {
      success: true,
      message:
        typeof result?.message === "string" && result.message.trim().length > 0
          ? result.message.trim()
          : "Fund password reset. The user must create a new fund password.",
      oldHadFundPassword: result?.old_had_fund_password === true,
    };
  });

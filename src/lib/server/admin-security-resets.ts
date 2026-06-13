import { createServerFn } from "@tanstack/react-start";
import { randomInt } from "node:crypto";
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

type ResetUserLoginPasswordInput = {
  accessToken: string;
  targetUserId: string;
  reason: string;
};

export type ResetUserFundPasswordResult = {
  success: true;
  message: string;
  oldHadFundPassword: boolean;
};

export type ResetUserLoginPasswordResult = {
  success: true;
  message: string;
  temporaryPassword: string;
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

function validateResetUserLoginPasswordInput(data: unknown): ResetUserLoginPasswordInput {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Unable to reset login password.", "Invalid reset login password request data");
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


type GetAdminSecurityUsersInput = {
  accessToken: string;
  searchQuery: string;
};

export type AdminSecurityUser = {
  id: string;
  username: string;
  phone: string | null;
  isAdmin: boolean;
  isFrozen: boolean;
  hasFundPassword: boolean;
  fundPasswordLockedUntil: string | null;
  fundPasswordFailedAttempts: number;
  isFundPasswordLocked: boolean;
  createdAt: string | null;
};

type ProfileSecurityRow = {
  id?: unknown;
  username?: unknown;
  phone?: unknown;
  is_admin?: unknown;
  is_frozen?: unknown;
  created_at?: unknown;
};

type FundPasswordSecurityRow = {
  user_id?: unknown;
  fund_password_locked_until?: unknown;
  fund_password_failed_attempts?: unknown;
};

function normalizeSearchQuery(value: unknown): string {
  if (value === undefined || value === null) return "";

  if (typeof value !== "string") {
    throwSafe("ADMIN", "Invalid user search.", "Security user search query must be a string");
  }

  return value
    .trim()
    .replace(/[,%]/g, "")
    .slice(0, 60);
}

function validateGetAdminSecurityUsersInput(data: unknown): GetAdminSecurityUsersInput {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Unable to load users.", "Invalid admin security users request data");
  }

  const { accessToken, searchQuery } = data as Record<string, unknown>;

  return {
    accessToken: normalizeAccessToken(accessToken),
    searchQuery: normalizeSearchQuery(searchQuery),
  };
}

function isFutureTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;

  const timestampMs = new Date(value).getTime();

  return Number.isFinite(timestampMs) && timestampMs > Date.now();
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function toFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function pickRandomCharacter(characters: string): string {
  return characters[randomInt(0, characters.length)] ?? characters[0] ?? "x";
}

function shuffleCharacters(characters: string[]): string[] {
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex]!, characters[index]!];
  }

  return characters;
}

function generateTemporaryPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%";
  const all = `${upper}${lower}${digits}${symbols}`;

  const characters = [
    pickRandomCharacter(upper),
    pickRandomCharacter(lower),
    pickRandomCharacter(digits),
    pickRandomCharacter(symbols),
  ];

  while (characters.length < 14) {
    characters.push(pickRandomCharacter(all));
  }

  return shuffleCharacters(characters).join("");
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

export const getAdminSecurityUsersFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateGetAdminSecurityUsersInput(data))
  .handler(async ({ data }): Promise<AdminSecurityUser[]> => {
    await getAuthenticatedAdminUserId(data.accessToken);

    const admin = getAdminClient();
    let query = admin
      .from("profiles")
      .select("id, username, phone, is_admin, is_frozen, created_at")
      .order("created_at", { ascending: false })
      .limit(30);

    if (data.searchQuery.length > 0) {
      const pattern = `%${data.searchQuery}%`;
      query = query.or(`username.ilike.${pattern},phone.ilike.${pattern}`);
    }

    const { data: profiles, error: profilesError } = await query;

    if (profilesError) {
      throwSafe(
        "ADMIN",
        "Unable to load users.",
        `profiles security search failed: ${safeDbMessage(profilesError)}`,
      );
    }

    const profileRows = (profiles ?? []) as ProfileSecurityRow[];
    const userIds = profileRows
      .map((profile) => toStringOrNull(profile.id))
      .filter((id): id is string => typeof id === "string");

    const securityByUserId = new Map<string, FundPasswordSecurityRow>();

    if (userIds.length > 0) {
      const { data: securityRows, error: securityError } = await admin
        .from("user_security_settings")
        .select("user_id, fund_password_locked_until, fund_password_failed_attempts")
        .in("user_id", userIds);

      if (securityError) {
        throwSafe(
          "ADMIN",
          "Unable to load user security status.",
          `user_security_settings admin lookup failed: ${safeDbMessage(securityError)}`,
        );
      }

      for (const row of (securityRows ?? []) as FundPasswordSecurityRow[]) {
        const userId = toStringOrNull(row.user_id);
        if (userId) securityByUserId.set(userId, row);
      }
    }

    return profileRows
      .map((profile): AdminSecurityUser | null => {
        const id = toStringOrNull(profile.id);
        if (!id) return null;

        const security = securityByUserId.get(id) ?? null;
        const fundPasswordLockedUntil = toStringOrNull(security?.fund_password_locked_until);

        return {
          id,
          username: toStringOrNull(profile.username) ?? "Unknown",
          phone: toStringOrNull(profile.phone),
          isAdmin: toBoolean(profile.is_admin),
          isFrozen: toBoolean(profile.is_frozen),
          hasFundPassword: security !== null,
          fundPasswordLockedUntil,
          fundPasswordFailedAttempts: toFiniteNumber(security?.fund_password_failed_attempts),
          isFundPasswordLocked: isFutureTimestamp(fundPasswordLockedUntil),
          createdAt: toStringOrNull(profile.created_at),
        };
      })
      .filter((user): user is AdminSecurityUser => user !== null);
  });

export const resetUserLoginPasswordFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateResetUserLoginPasswordInput(data))
  .handler(async ({ data }): Promise<ResetUserLoginPasswordResult> => {
    const adminUserId = await getAuthenticatedAdminUserId(data.accessToken);
    const admin = getAdminClient();

    if (adminUserId === data.targetUserId) {
      throwSafe("ADMIN", "Admins cannot reset their own login password from the admin panel.", "Self login password reset attempted");
    }

    const { data: targetProfile, error: targetProfileError } = await admin
      .from("profiles")
      .select("id, username, phone, is_admin")
      .eq("id", data.targetUserId)
      .single();

    if (targetProfileError || !targetProfile) {
      throwSafe("ADMIN", "Target user not found.", `Target profile lookup failed: ${safeDbMessage(targetProfileError)}`);
    }

    const targetProfileRow = targetProfile as ProfileSecurityRow;

    if (targetProfileRow.is_admin === true) {
      throwSafe("ADMIN", "Admin account security resets are not allowed from this panel.", "Admin target login password reset blocked");
    }

    const { error: auditError } = await admin
      .from("admin_security_reset_audit")
      .insert({
        admin_user_id: adminUserId,
        target_user_id: data.targetUserId,
        action: "login_password_reset",
        reason: data.reason,
        old_had_fund_password: null,
        metadata: {
          target_username: toStringOrNull(targetProfileRow.username),
          target_phone_present: toStringOrNull(targetProfileRow.phone) !== null,
          temporary_password_generated: false,
          temporary_password_stored: false,
          auth_password_update_pending: true,
        },
      });

    if (auditError) {
      throwSafe("ADMIN", "Unable to reset login password.", `Login password reset audit insert failed before password update: ${safeDbMessage(auditError)}`);
    }

    const temporaryPassword = generateTemporaryPassword();

    const { error: updateError } = await admin.auth.admin.updateUserById(data.targetUserId, {
      password: temporaryPassword,
    });

    if (updateError) {
      throwSafe("ADMIN", "Unable to reset login password.", `Supabase auth password reset failed after audit insert: ${updateError.message}`);
    }

    return {
      success: true,
      message: "Temporary login password generated. Copy it now; it will not be shown again.",
      temporaryPassword,
    };
  });

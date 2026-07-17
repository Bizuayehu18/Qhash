import { createServerFn } from "@tanstack/react-start";
import type { Json } from "../database.types.js";
import { logServerError, throwSafe } from "../errors.js";
import { getAdminClient } from "./supabase-admin.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BSC_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

type RotationRpcResult = {
  success: boolean;
  code: string;
  userId: string | null;
  previousAddressId: string | null;
  previousAddress: string | null;
  newAddressId: string | null;
  newAddress: string | null;
};

export type RotateAdminBscDepositAddressResult = {
  success: true;
  code: "rotated";
  userId: string;
  previousAddressId: string;
  previousAddress: string;
  newAddressId: string;
  newAddress: string;
};

function normalizeUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value.trim())) {
    throwSafe("ADMIN", "Invalid BSC address selection.", `${label} must be a UUID`);
  }

  return value.trim().toLowerCase();
}

function normalizeAddress(value: unknown, label: string): string {
  if (typeof value !== "string" || !BSC_ADDRESS_PATTERN.test(value.trim())) {
    throwSafe("ADMIN", "Enter a valid BSC public address.", `${label} must be a 0x-prefixed 40 character hex address`);
  }

  return value.trim().toLowerCase();
}

function validateInput(data: unknown): {
  accessToken: string;
  userId: string;
  currentAddressId: string;
  expectedCurrentAddress: string;
  newAddress: string;
} {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Unable to replace the BSC address.", "Invalid request data");
  }

  const {
    accessToken,
    userId,
    currentAddressId,
    expectedCurrentAddress,
    newAddress,
  } = data as Record<string, unknown>;

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throwSafe("ADMIN", "Unauthorized.", "Missing access token for BSC address rotation");
  }

  const normalizedCurrentAddress = normalizeAddress(expectedCurrentAddress, "Current address");
  const normalizedNewAddress = normalizeAddress(newAddress, "New address");
  if (normalizedCurrentAddress === normalizedNewAddress) {
    throwSafe("ADMIN", "Enter a different BSC address.", "Replacement address matches the current address");
  }

  return {
    accessToken: accessToken.trim(),
    userId: normalizeUuid(userId, "User ID"),
    currentAddressId: normalizeUuid(currentAddressId, "Current address ID"),
    expectedCurrentAddress: normalizedCurrentAddress,
    newAddress: normalizedNewAddress,
  };
}

async function assertAdmin(accessToken: string): Promise<string> {
  const admin = getAdminClient();
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(accessToken);

  if (error || !user) {
    throwSafe("ADMIN", "Unauthorized.", "Invalid or expired access token");
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("is_admin, is_frozen")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || profile.is_admin !== true || profile.is_frozen === true) {
    throwSafe("ADMIN", "Unauthorized.", "Admin permission required for BSC address rotation");
  }

  return user.id;
}

function toObject(value: Json): Record<string, Json | undefined> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, Json | undefined>;
}

function toStringOrNull(value: Json | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseRpcResult(value: Json): RotationRpcResult | null {
  const result = toObject(value);
  if (!result || typeof result.success !== "boolean" || typeof result.code !== "string") return null;

  return {
    success: result.success,
    code: result.code,
    userId: toStringOrNull(result.user_id),
    previousAddressId: toStringOrNull(result.previous_address_id),
    previousAddress: toStringOrNull(result.previous_address),
    newAddressId: toStringOrNull(result.new_address_id),
    newAddress: toStringOrNull(result.new_address),
  };
}

function rpcFailureMessage(code: string): string {
  if (code === "exposure_must_be_disabled") {
    return "Disable BSC user deposits before replacing an address.";
  }
  if (code === "watcher_stale") {
    return "The BSC watcher is not current. Restore watcher health before replacing an address.";
  }
  if (code === "unsettled_deposits") {
    return "This address still has a detected or confirmed deposit. Finish its review and credit first.";
  }
  if (code === "stale_current_address") {
    return "The selected address changed. Refresh the inventory before retrying.";
  }
  if (code === "address_conflict") {
    return "That BSC address is already assigned or another active address exists for this user.";
  }
  if (code === "user_not_found") {
    return "The target user no longer exists.";
  }
  if (code === "admin_not_found" || code === "not_admin" || code === "admin_frozen") {
    return "Admin authorization changed. Sign in again before retrying.";
  }
  return "The database rejected the BSC address replacement. No address was changed.";
}

export const rotateAdminBscDepositAddressFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateInput(data))
  .handler(async ({ data }): Promise<RotateAdminBscDepositAddressResult> => {
    const adminId = await assertAdmin(data.accessToken);
    const admin = getAdminClient();

    const { data: rpcData, error } = await admin.rpc("rotate_bsc_crypto_deposit_address", {
      p_user_id: data.userId,
      p_admin_id: adminId,
      p_expected_current_address_id: data.currentAddressId,
      p_expected_current_address: data.expectedCurrentAddress,
      p_new_address: data.newAddress,
    });

    if (error) {
      logServerError("bsc-address-rotation-rpc", error, { currentAddressId: data.currentAddressId });
      throwSafe("ADMIN", "The atomic BSC address replacement failed. No successful change was reported.", `Rotation RPC failed: ${error.message}`);
    }

    const result = parseRpcResult(rpcData);
    if (!result) {
      logServerError("bsc-address-rotation-invalid-result", new Error("Invalid BSC address rotation RPC result"), {
        currentAddressId: data.currentAddressId,
      });
      throwSafe("ADMIN", "The BSC address replacement returned an invalid result.", "Invalid rotation RPC response");
    }

    if (!result.success) {
      throwSafe("ADMIN", rpcFailureMessage(result.code), `Rotation RPC rejected with ${result.code}`);
    }

    if (
      result.code !== "rotated"
      || !result.userId
      || !result.previousAddressId
      || !result.previousAddress
      || !result.newAddressId
      || !result.newAddress
    ) {
      throwSafe("ADMIN", "The BSC address replacement returned an incomplete result.", "Incomplete successful rotation RPC response");
    }

    return {
      success: true,
      code: "rotated",
      userId: result.userId,
      previousAddressId: result.previousAddressId,
      previousAddress: result.previousAddress,
      newAddressId: result.newAddressId,
      newAddress: result.newAddress,
    };
  });

import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";
import type { AdminCryptoAddressInventoryRow } from "./crypto-admin-addresses.js";

const TRON_ADDRESS_VERSION_BYTE = 0x41;
const TRON_DECODED_ADDRESS_LENGTH = 25;
const TRON_PAYLOAD_LENGTH = 21;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_ALPHABET_INDEXES = new Map<string, number>();

for (let index = 0; index < BASE58_ALPHABET.length; index += 1) {
  BASE58_ALPHABET_INDEXES.set(BASE58_ALPHABET.charAt(index), index);
}

type CryptoNetwork = "TRON" | "BSC";
type TronActivationStatus = "inactive" | "active";

type ProfileRow = {
  id?: unknown;
  username?: unknown;
  phone?: unknown;
  is_admin?: unknown;
  is_frozen?: unknown;
};

type CryptoAddressInsertRow = {
  id?: unknown;
  user_id?: unknown;
  network?: unknown;
  asset?: unknown;
  address?: unknown;
  derivation_index?: unknown;
  activation_status?: unknown;
  status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

export type AssignAdminCryptoDepositAddressResult = {
  row: AdminCryptoAddressInventoryRow;
};

function normalizeAccessToken(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throwSafe("ADMIN", "Unauthorized.", "Missing access token for crypto address assignment");
  }

  return value.trim();
}

function normalizeTargetUserRef(value: unknown): string {
  if (typeof value !== "string") {
    throwSafe("ADMIN", "Invalid target user.", "Target user reference must be a string");
  }

  const normalized = value.trim().replace(/[,%]/g, "").slice(0, 90);
  if (normalized.length < 2) {
    throwSafe("ADMIN", "Invalid target user.", "Target user reference is too short");
  }

  return normalized;
}

function normalizeNetwork(value: unknown): CryptoNetwork {
  if (value === "TRON" || value === "BSC") return value;
  throwSafe("ADMIN", "Invalid crypto network.", "Manual address assignment network must be TRON or BSC");
}

function decodeBase58(value: string): Uint8Array | null {
  let decodedValue = 0n;

  for (const char of value) {
    const digit = BASE58_ALPHABET_INDEXES.get(char);
    if (digit === undefined) return null;
    decodedValue = decodedValue * 58n + BigInt(digit);
  }

  const bytes: number[] = [];
  while (decodedValue > 0n) {
    bytes.unshift(Number(decodedValue & 0xffn));
    decodedValue >>= 8n;
  }

  let leadingZeroes = 0;
  for (const char of value) {
    if (char !== "1") break;
    leadingZeroes += 1;
  }

  return new Uint8Array([...new Array<number>(leadingZeroes).fill(0), ...bytes]);
}

function sha256(value: Uint8Array): Uint8Array {
  return createHash("sha256").update(value).digest();
}

function hasValidTronBase58Check(address: string): boolean {
  const decoded = decodeBase58(address);
  if (!decoded || decoded.length !== TRON_DECODED_ADDRESS_LENGTH) return false;

  const payload = decoded.slice(0, TRON_PAYLOAD_LENGTH);
  const checksum = decoded.slice(TRON_PAYLOAD_LENGTH);

  if (payload[0] !== TRON_ADDRESS_VERSION_BYTE) return false;

  const expectedChecksum = sha256(sha256(payload)).slice(0, checksum.length);
  return checksum.every((byte, index) => byte === expectedChecksum[index]);
}

function normalizeAddress(network: CryptoNetwork, value: unknown): string {
  if (typeof value !== "string") {
    throwSafe("ADMIN", "Invalid crypto address.", "Crypto address must be a string");
  }

  const address = value.trim();

  if (network === "TRON") {
    if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address) || !hasValidTronBase58Check(address)) {
      throwSafe("ADMIN", "Invalid TRON address.", "TRON address must be a valid Base58Check address starting with T");
    }

    return address;
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throwSafe("ADMIN", "Invalid BSC address.", "BSC address must be a 0x-prefixed 40 character hex address");
  }

  return address.toLowerCase();
}

function normalizeTronActivationStatus(network: CryptoNetwork, value: unknown): "inactive" | "active" | "not_required" {
  if (network === "BSC") return "not_required";
  if (value === undefined || value === null || value === "") return "inactive";
  if (value === "inactive" || value === "active") return value;
  throwSafe("ADMIN", "Invalid TRON activation status.", "TRON activation status must be inactive or active");
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function assertAdminToken(accessToken: string): Promise<void> {
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
    .select("is_admin, is_frozen")
    .eq("id", authUser.id)
    .single();

  if (profileError || !profile || profile.is_admin !== true || profile.is_frozen === true) {
    throwSafe("ADMIN", "Unauthorized.", "Non-admin or frozen admin attempted crypto address assignment");
  }
}

function validateInput(data: unknown): {
  accessToken: string;
  targetUserRef: string;
  network: CryptoNetwork;
  address: string;
  activationStatus: "inactive" | "active" | "not_required";
} {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Unable to assign crypto address.", "Invalid request data");
  }

  const { accessToken, targetUserRef, network, address, activationStatus } = data as Record<string, unknown>;
  const normalizedNetwork = normalizeNetwork(network);

  return {
    accessToken: normalizeAccessToken(accessToken),
    targetUserRef: normalizeTargetUserRef(targetUserRef),
    network: normalizedNetwork,
    address: normalizeAddress(normalizedNetwork, address),
    activationStatus: normalizeTronActivationStatus(normalizedNetwork, activationStatus),
  };
}

async function findTargetProfile(targetUserRef: string): Promise<Required<Pick<ProfileRow, "id">> & ProfileRow> {
  const admin = getAdminClient();
  const searchColumns = ["id", "username", "phone"] as const;

  for (const column of searchColumns) {
    const { data, error } = await admin
      .from("profiles")
      .select("id, username, phone")
      .eq(column, targetUserRef)
      .limit(2);

    if (error) {
      throwSafe("ADMIN", "Unable to find target user.", `DB error: ${error.message}`);
    }

    const rows = (data ?? []) as ProfileRow[];
    if (rows.length > 1) {
      throwSafe("ADMIN", "Target user is ambiguous.", `Multiple profiles matched ${column}`);
    }

    const id = toStringOrNull(rows[0]?.id);
    if (id) {
      return { ...rows[0], id };
    }
  }

  throwSafe("ADMIN", "Target user not found.", "No profile matched target user reference");
}

function buildInventoryRow(addressRow: CryptoAddressInsertRow, profile: ProfileRow): AdminCryptoAddressInventoryRow {
  const id = toStringOrNull(addressRow.id);
  const userId = toStringOrNull(addressRow.user_id);
  const network = addressRow.network === "TRON" || addressRow.network === "BSC" ? addressRow.network : null;
  const asset = toStringOrNull(addressRow.asset);
  const address = toStringOrNull(addressRow.address);

  if (!id || !userId || !network || asset !== "USDT" || !address) {
    throwSafe("ADMIN", "Unable to assign crypto address.", "Inserted crypto address row was malformed");
  }

  return {
    id,
    userId,
    username: toStringOrNull(profile.username) ?? "Unknown",
    phone: toStringOrNull(profile.phone),
    network,
    asset: "USDT",
    address,
    derivationIndex: toNumberOrNull(addressRow.derivation_index),
    activationStatus: toStringOrNull(addressRow.activation_status) ?? "unknown",
    status: toStringOrNull(addressRow.status) ?? "unknown",
    createdAt: toStringOrNull(addressRow.created_at),
    updatedAt: toStringOrNull(addressRow.updated_at),
  };
}

export const assignAdminCryptoDepositAddressFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateInput(data))
  .handler(async ({ data }): Promise<AssignAdminCryptoDepositAddressResult> => {
    await assertAdminToken(data.accessToken);

    const admin = getAdminClient();
    const targetProfile = await findTargetProfile(data.targetUserRef);

    const { data: inserted, error: insertError } = await admin
      .from("crypto_deposit_addresses")
      .insert({
        user_id: targetProfile.id,
        network: data.network,
        asset: "USDT",
        address: data.address,
        activation_status: data.activationStatus,
        status: "active",
      })
      .select("id, user_id, network, asset, address, derivation_index, activation_status, status, created_at, updated_at")
      .single();

    if (insertError) {
      const message = insertError.message.toLowerCase();
      if (message.includes("duplicate") || message.includes("unique")) {
        throwSafe(
          "ADMIN",
          "Crypto address already exists for this user, network, or address.",
          `DB unique constraint error: ${insertError.message}`,
        );
      }

      throwSafe("ADMIN", "Unable to assign crypto address.", `DB error: ${insertError.message}`);
    }

    return {
      row: buildInventoryRow(inserted as CryptoAddressInsertRow, targetProfile),
    };
  });
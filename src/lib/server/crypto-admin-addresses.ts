import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

const ADDRESS_LIMIT = 200;
const NETWORK_FILTERS = ["all", "TRON", "BSC"] as const;

type NetworkFilter = (typeof NETWORK_FILTERS)[number];

type CryptoNetwork = "TRON" | "BSC";

type CryptoAddressRow = {
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

type ProfileRow = {
  id?: unknown;
  username?: unknown;
  phone?: unknown;
};

export type AdminCryptoAddressInventoryRow = {
  id: string;
  userId: string;
  username: string;
  phone: string | null;
  network: CryptoNetwork;
  asset: "USDT";
  address: string;
  derivationIndex: number | null;
  activationStatus: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminCryptoAddressInventoryResult = {
  rows: AdminCryptoAddressInventoryRow[];
  totalShown: number;
  limit: number;
};

function normalizeAccessToken(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throwSafe("ADMIN", "Unauthorized.", "Missing access token for crypto address inventory");
  }

  return value.trim();
}

function normalizeSearchQuery(value: unknown): string {
  if (value === undefined || value === null) return "";

  if (typeof value !== "string") {
    throwSafe("ADMIN", "Invalid crypto address search.", "Crypto address search query must be a string");
  }

  return value
    .trim()
    .replace(/[,%]/g, "")
    .slice(0, 90);
}

function normalizeNetworkFilter(value: unknown): NetworkFilter {
  if (value === undefined || value === null || value === "") return "all";

  if (value === "all" || value === "TRON" || value === "BSC") {
    return value;
  }

  throwSafe("ADMIN", "Invalid crypto network filter.", "Invalid crypto address inventory network filter");
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeNetwork(value: unknown): CryptoNetwork | null {
  if (value === "TRON" || value === "BSC") return value;
  return null;
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
    throwSafe("ADMIN", "Unauthorized.", "Non-admin or frozen admin attempted crypto address inventory access");
  }
}

function validateInput(data: unknown): {
  accessToken: string;
  searchQuery: string;
  networkFilter: NetworkFilter;
} {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Unable to load crypto address inventory.", "Invalid request data");
  }

  const { accessToken, searchQuery, networkFilter } = data as Record<string, unknown>;

  return {
    accessToken: normalizeAccessToken(accessToken),
    searchQuery: normalizeSearchQuery(searchQuery),
    networkFilter: normalizeNetworkFilter(networkFilter),
  };
}

function matchesSearch(row: AdminCryptoAddressInventoryRow, searchQuery: string): boolean {
  if (!searchQuery) return true;

  const needle = searchQuery.toLowerCase();
  return [
    row.username,
    row.phone ?? "",
    row.address,
    row.userId,
    row.network,
    row.status,
    row.activationStatus,
  ].some((value) => value.toLowerCase().includes(needle));
}

export const getAdminCryptoAddressInventoryFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateInput(data))
  .handler(async ({ data }): Promise<AdminCryptoAddressInventoryResult> => {
    await assertAdminToken(data.accessToken);

    const admin = getAdminClient();

    let addressQuery = admin
      .from("crypto_deposit_addresses")
      .select("id, user_id, network, asset, address, derivation_index, activation_status, status, created_at, updated_at")
      .eq("asset", "USDT")
      .order("created_at", { ascending: false })
      .limit(ADDRESS_LIMIT);

    if (data.networkFilter !== "all") {
      addressQuery = addressQuery.eq("network", data.networkFilter);
    }

    const { data: rawAddresses, error: addressError } = await addressQuery;

    if (addressError) {
      throwSafe("ADMIN", "Unable to load crypto address inventory.", `DB error: ${addressError.message}`);
    }

    const addressRows = (rawAddresses ?? []) as CryptoAddressRow[];
    const userIds = Array.from(
      new Set(
        addressRows
          .map((row) => toStringOrNull(row.user_id))
          .filter((id): id is string => id !== null),
      ),
    );

    const profilesById = new Map<string, ProfileRow>();

    if (userIds.length > 0) {
      const { data: rawProfiles, error: profileError } = await admin
        .from("profiles")
        .select("id, username, phone")
        .in("id", userIds);

      if (profileError) {
        throwSafe("ADMIN", "Unable to load crypto address users.", `DB error: ${profileError.message}`);
      }

      for (const profile of (rawProfiles ?? []) as ProfileRow[]) {
        const id = toStringOrNull(profile.id);
        if (id) profilesById.set(id, profile);
      }
    }

    const rows = addressRows
      .map((addressRow): AdminCryptoAddressInventoryRow | null => {
        const id = toStringOrNull(addressRow.id);
        const userId = toStringOrNull(addressRow.user_id);
        const network = normalizeNetwork(addressRow.network);
        const asset = toStringOrNull(addressRow.asset);
        const address = toStringOrNull(addressRow.address);

        if (!id || !userId || !network || asset !== "USDT" || !address) {
          return null;
        }

        const profile = profilesById.get(userId);

        return {
          id,
          userId,
          username: toStringOrNull(profile?.username) ?? "Unknown",
          phone: toStringOrNull(profile?.phone),
          network,
          asset: "USDT",
          address,
          derivationIndex: toNumberOrNull(addressRow.derivation_index),
          activationStatus: toStringOrNull(addressRow.activation_status) ?? "unknown",
          status: toStringOrNull(addressRow.status) ?? "unknown",
          createdAt: toStringOrNull(addressRow.created_at),
          updatedAt: toStringOrNull(addressRow.updated_at),
        };
      })
      .filter((row): row is AdminCryptoAddressInventoryRow => row !== null)
      .filter((row) => matchesSearch(row, data.searchQuery));

    return {
      rows,
      totalShown: rows.length,
      limit: ADDRESS_LIMIT,
    };
  });

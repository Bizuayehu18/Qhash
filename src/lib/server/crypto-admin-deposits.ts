import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

const DEPOSIT_LIMIT = 100;
const NETWORK_FILTERS = ["all", "TRON", "BSC"] as const;
const STATUS_FILTERS = ["all", "detected", "confirmed", "credited", "swept", "failed"] as const;

type NetworkFilter = (typeof NETWORK_FILTERS)[number];
type StatusFilter = (typeof STATUS_FILTERS)[number];
type CryptoNetwork = "TRON" | "BSC";
type CryptoDepositStatus = "detected" | "confirmed" | "credited" | "swept" | "failed";

type CryptoDepositRow = {
  id?: unknown;
  user_id?: unknown;
  address_id?: unknown;
  network?: unknown;
  asset?: unknown;
  tx_hash?: unknown;
  event_index?: unknown;
  from_address?: unknown;
  to_address?: unknown;
  amount_raw?: unknown;
  amount_usdt?: unknown;
  block_number?: unknown;
  confirmations?: unknown;
  status?: unknown;
  exchange_rate_etb?: unknown;
  credited_amount_etb?: unknown;
  detected_at?: unknown;
  confirmed_at?: unknown;
  credited_at?: unknown;
  swept_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

type ProfileRow = {
  id?: unknown;
  username?: unknown;
  phone?: unknown;
};

type AddressRow = {
  id?: unknown;
  address?: unknown;
};

export type AdminCryptoDepositAuditRow = {
  id: string;
  userId: string;
  username: string;
  phone: string | null;
  addressId: string | null;
  assignedAddress: string | null;
  network: CryptoNetwork;
  asset: "USDT";
  txHash: string;
  eventIndex: number;
  fromAddress: string | null;
  toAddress: string;
  amountRaw: string;
  amountUsdt: string;
  blockNumber: number | null;
  confirmations: number;
  status: CryptoDepositStatus;
  exchangeRateEtb: string | null;
  creditedAmountEtb: string | null;
  detectedAt: string | null;
  confirmedAt: string | null;
  creditedAt: string | null;
  sweptAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type AdminCryptoDepositAuditResult = {
  rows: AdminCryptoDepositAuditRow[];
  totalShown: number;
  limit: number;
};

function normalizeAccessToken(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throwSafe("ADMIN", "Unauthorized.", "Missing access token for crypto deposit audit");
  }

  return value.trim();
}

function normalizeSearchQuery(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throwSafe("ADMIN", "Invalid crypto deposit search.", "Crypto deposit search query must be a string");
  }

  return value.trim().replace(/[,%]/g, "").slice(0, 90);
}

function normalizeNetworkFilter(value: unknown): NetworkFilter {
  if (value === undefined || value === null || value === "") return "all";
  if (value === "all" || value === "TRON" || value === "BSC") return value;
  throwSafe("ADMIN", "Invalid crypto network filter.", "Invalid crypto deposit audit network filter");
}

function normalizeStatusFilter(value: unknown): StatusFilter {
  if (value === undefined || value === null || value === "") return "detected";
  if (value === "all" || value === "detected" || value === "confirmed" || value === "credited" || value === "swept" || value === "failed") return value;
  throwSafe("ADMIN", "Invalid crypto deposit status filter.", "Invalid crypto deposit audit status filter");
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function normalizeNetwork(value: unknown): CryptoNetwork | null {
  if (value === "TRON" || value === "BSC") return value;
  return null;
}

function normalizeStatus(value: unknown): CryptoDepositStatus | null {
  if (value === "detected" || value === "confirmed" || value === "credited" || value === "swept" || value === "failed") return value;
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
    throwSafe("ADMIN", "Unauthorized.", "Non-admin or frozen admin attempted crypto deposit audit access");
  }
}

function validateInput(data: unknown): {
  accessToken: string;
  searchQuery: string;
  networkFilter: NetworkFilter;
  statusFilter: StatusFilter;
} {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Unable to load crypto deposit audit.", "Invalid request data");
  }

  const { accessToken, searchQuery, networkFilter, statusFilter } = data as Record<string, unknown>;

  return {
    accessToken: normalizeAccessToken(accessToken),
    searchQuery: normalizeSearchQuery(searchQuery),
    networkFilter: normalizeNetworkFilter(networkFilter),
    statusFilter: normalizeStatusFilter(statusFilter),
  };
}

function matchesSearch(row: AdminCryptoDepositAuditRow, searchQuery: string): boolean {
  if (!searchQuery) return true;
  const needle = searchQuery.toLowerCase();

  return [
    row.username,
    row.phone ?? "",
    row.userId,
    row.assignedAddress ?? "",
    row.txHash,
    row.fromAddress ?? "",
    row.toAddress,
    row.network,
    row.status,
  ].some((value) => value.toLowerCase().includes(needle));
}

export const getAdminCryptoDepositAuditFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateInput(data))
  .handler(async ({ data }): Promise<AdminCryptoDepositAuditResult> => {
    await assertAdminToken(data.accessToken);

    const admin = getAdminClient();

    let depositQuery = admin
      .from("crypto_deposits")
      .select(
        "id, user_id, address_id, network, asset, tx_hash, event_index, from_address, to_address, amount_raw, amount_usdt, block_number, confirmations, status, exchange_rate_etb, credited_amount_etb, detected_at, confirmed_at, credited_at, swept_at, created_at, updated_at",
      )
      .eq("asset", "USDT")
      .order("detected_at", { ascending: false })
      .limit(DEPOSIT_LIMIT);

    if (data.networkFilter !== "all") depositQuery = depositQuery.eq("network", data.networkFilter);
    if (data.statusFilter !== "all") depositQuery = depositQuery.eq("status", data.statusFilter);

    const { data: rawDeposits, error: depositError } = await depositQuery;

    if (depositError) {
      throwSafe("ADMIN", "Unable to load crypto deposit audit.", `DB error: ${depositError.message}`);
    }

    const depositRows = (rawDeposits ?? []) as CryptoDepositRow[];
    const userIds = Array.from(new Set(depositRows.map((row) => toStringOrNull(row.user_id)).filter((id): id is string => id !== null)));
    const addressIds = Array.from(new Set(depositRows.map((row) => toStringOrNull(row.address_id)).filter((id): id is string => id !== null)));

    const profilesById = new Map<string, ProfileRow>();
    if (userIds.length > 0) {
      const { data: rawProfiles, error: profileError } = await admin
        .from("profiles")
        .select("id, username, phone")
        .in("id", userIds);

      if (profileError) {
        throwSafe("ADMIN", "Unable to load crypto deposit users.", `DB error: ${profileError.message}`);
      }

      for (const profile of (rawProfiles ?? []) as ProfileRow[]) {
        const id = toStringOrNull(profile.id);
        if (id) profilesById.set(id, profile);
      }
    }

    const addressesById = new Map<string, AddressRow>();
    if (addressIds.length > 0) {
      const { data: rawAddresses, error: addressError } = await admin
        .from("crypto_deposit_addresses")
        .select("id, address")
        .in("id", addressIds);

      if (addressError) {
        throwSafe("ADMIN", "Unable to load crypto deposit addresses.", `DB error: ${addressError.message}`);
      }

      for (const address of (rawAddresses ?? []) as AddressRow[]) {
        const id = toStringOrNull(address.id);
        if (id) addressesById.set(id, address);
      }
    }

    const rows = depositRows
      .map((deposit): AdminCryptoDepositAuditRow | null => {
        const id = toStringOrNull(deposit.id);
        const userId = toStringOrNull(deposit.user_id);
        const network = normalizeNetwork(deposit.network);
        const asset = toStringOrNull(deposit.asset);
        const txHash = toStringOrNull(deposit.tx_hash);
        const eventIndex = toNumberOrNull(deposit.event_index);
        const toAddress = toStringOrNull(deposit.to_address);
        const amountRaw = toStringOrNull(deposit.amount_raw);
        const amountUsdt = toStringOrNull(deposit.amount_usdt);
        const confirmations = toNumberOrNull(deposit.confirmations);
        const status = normalizeStatus(deposit.status);

        if (!id || !userId || !network || asset !== "USDT" || !txHash || eventIndex === null || !toAddress || !amountRaw || !amountUsdt || confirmations === null || !status) {
          return null;
        }

        const addressId = toStringOrNull(deposit.address_id);
        const profile = profilesById.get(userId);
        const assignedAddress = addressId ? toStringOrNull(addressesById.get(addressId)?.address) : null;

        return {
          id,
          userId,
          username: toStringOrNull(profile?.username) ?? "Unknown",
          phone: toStringOrNull(profile?.phone),
          addressId,
          assignedAddress,
          network,
          asset: "USDT",
          txHash,
          eventIndex,
          fromAddress: toStringOrNull(deposit.from_address),
          toAddress,
          amountRaw,
          amountUsdt,
          blockNumber: toNumberOrNull(deposit.block_number),
          confirmations,
          status,
          exchangeRateEtb: toStringOrNull(deposit.exchange_rate_etb),
          creditedAmountEtb: toStringOrNull(deposit.credited_amount_etb),
          detectedAt: toStringOrNull(deposit.detected_at),
          confirmedAt: toStringOrNull(deposit.confirmed_at),
          creditedAt: toStringOrNull(deposit.credited_at),
          sweptAt: toStringOrNull(deposit.swept_at),
          createdAt: toStringOrNull(deposit.created_at),
          updatedAt: toStringOrNull(deposit.updated_at),
        };
      })
      .filter((row): row is AdminCryptoDepositAuditRow => row !== null)
      .filter((row) => matchesSearch(row, data.searchQuery));

    return {
      rows,
      totalShown: rows.length,
      limit: DEPOSIT_LIMIT,
    };
  });

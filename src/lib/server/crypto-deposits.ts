import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

const SETTINGS_KEYS = [
  "usdt_etb_rate",
  "crypto_tron_min_usdt",
  "crypto_bsc_min_usdt",
  "crypto_auto_credit_enabled",
] as const;

const DEFAULT_SETTINGS = {
  usdt_etb_rate: 160,
  crypto_tron_min_usdt: 10,
  crypto_bsc_min_usdt: 5,
  crypto_auto_credit_enabled: false,
};

type CryptoNetwork = "TRON" | "BSC";

type CryptoAddressWithNetwork = {
  network: CryptoNetwork;
  status: string;
  activation_status: string;
};

type CryptoDepositWithNetwork = {
  network: CryptoNetwork;
};

function parseNumberSetting(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanSetting(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

function normalizeNetwork(value: string): CryptoNetwork | null {
  if (value === "TRON" || value === "BSC") return value;
  return null;
}

function isUsableDepositAddress(address: CryptoAddressWithNetwork): boolean {
  if (address.status !== "active") return false;
  if (address.network === "BSC") return address.activation_status === "not_required";
  return address.activation_status === "active";
}

export const getCryptoDepositOverviewFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") {
      throwSafe("DEPOSIT", "Unable to load crypto deposits.", "Invalid request data");
    }

    const { accessToken } = data as Record<string, unknown>;
    if (typeof accessToken !== "string" || !accessToken) {
      throwSafe("DEPOSIT", "Unable to load crypto deposits.", "Missing access token");
    }

    return { accessToken };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();

    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(data.accessToken);

    if (authError || !authUser) {
      throwSafe("DEPOSIT", "Unable to load crypto deposits.", "Invalid or expired access token");
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("is_frozen")
      .eq("id", authUser.id)
      .single();

    if (profileError || !profile || profile.is_frozen === true) {
      throwSafe("DEPOSIT", "Unable to load crypto deposits.", "Account is frozen or unavailable");
    }

    const { data: settingsRows, error: settingsError } = await admin
      .from("app_settings")
      .select("key, value")
      .in("key", [...SETTINGS_KEYS]);

    if (settingsError) {
      throwSafe("DEPOSIT", "Unable to load crypto settings.", `DB error: ${settingsError.message}`);
    }

    const settingsMap = new Map((settingsRows ?? []).map((row) => [row.key, row.value]));
    const settings = {
      usdtEtbRate: parseNumberSetting(settingsMap.get("usdt_etb_rate"), DEFAULT_SETTINGS.usdt_etb_rate),
      tronMinUsdt: parseNumberSetting(settingsMap.get("crypto_tron_min_usdt"), DEFAULT_SETTINGS.crypto_tron_min_usdt),
      bscMinUsdt: parseNumberSetting(settingsMap.get("crypto_bsc_min_usdt"), DEFAULT_SETTINGS.crypto_bsc_min_usdt),
      autoCreditEnabled: parseBooleanSetting(
        settingsMap.get("crypto_auto_credit_enabled"),
        DEFAULT_SETTINGS.crypto_auto_credit_enabled,
      ),
    };

    const { data: rawAddresses, error: addressError } = await admin
      .from("crypto_deposit_addresses")
      .select("id, user_id, network, asset, address, derivation_index, activation_status, status, created_at, updated_at")
      .eq("user_id", authUser.id)
      .eq("asset", "USDT")
      .order("network", { ascending: true });

    if (addressError) {
      throwSafe("DEPOSIT", "Unable to load crypto addresses.", `DB error: ${addressError.message}`);
    }

    const addresses = settings.autoCreditEnabled
      ? (rawAddresses ?? [])
          .map((address) => ({
            ...address,
            network: normalizeNetwork(address.network),
          }))
          .filter((address): address is typeof address & { network: CryptoNetwork } => address.network !== null)
          .filter(isUsableDepositAddress)
      : [];

    let deposits: Array<CryptoDepositWithNetwork> = [];

    if (settings.autoCreditEnabled) {
      const { data: rawDeposits, error: depositError } = await admin
        .from("crypto_deposits")
        .select(
          "id, user_id, address_id, network, asset, tx_hash, event_index, from_address, to_address, amount_raw, amount_usdt, block_number, confirmations, status, exchange_rate_etb, credited_amount_etb, detected_at, confirmed_at, credited_at, swept_at, created_at, updated_at",
        )
        .eq("user_id", authUser.id)
        .eq("asset", "USDT")
        .order("detected_at", { ascending: false })
        .limit(50);

      if (depositError) {
        throwSafe("DEPOSIT", "Unable to load crypto deposit history.", `DB error: ${depositError.message}`);
      }

      deposits = (rawDeposits ?? [])
        .map((deposit) => ({
          ...deposit,
          network: normalizeNetwork(deposit.network),
        }))
        .filter((deposit): deposit is typeof deposit & { network: CryptoNetwork } => deposit.network !== null);
    }

    return {
      settings,
      addresses,
      deposits,
    };
  });

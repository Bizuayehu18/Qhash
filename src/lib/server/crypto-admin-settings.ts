import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

const NUMERIC_CRYPTO_SETTING_KEYS = [
  "usdt_etb_rate",
  "crypto_tron_min_usdt",
  "crypto_bsc_min_usdt",
] as const;

const BSC_USER_DEPOSITS_SETTING_KEY = "crypto_bsc_user_deposits_enabled" as const;
const CRYPTO_SETTING_KEYS = [
  ...NUMERIC_CRYPTO_SETTING_KEYS,
  BSC_USER_DEPOSITS_SETTING_KEY,
] as const;

const DEFAULT_CRYPTO_SETTINGS = {
  usdt_etb_rate: 160,
  crypto_tron_min_usdt: 10,
  crypto_bsc_min_usdt: 5,
  crypto_bsc_user_deposits_enabled: false,
};

const SETTING_LIMITS = {
  usdt_etb_rate: { min: 1, max: 1_000_000 },
  crypto_tron_min_usdt: { min: 0.01, max: 1_000_000 },
  crypto_bsc_min_usdt: { min: 0.01, max: 1_000_000 },
};

type NumericCryptoSettingKey = (typeof NUMERIC_CRYPTO_SETTING_KEYS)[number];

export type AdminCryptoSettings = {
  usdtEtbRate: number;
  tronMinUsdt: number;
  bscMinUsdt: number;
  bscUserDepositsEnabled: boolean;
};

function parseNumberSetting(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanSetting(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function serializeNumberSetting(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function validateNumberSetting(key: NumericCryptoSettingKey, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throwSafe("ADMIN", "Enter a valid crypto setting value.", `Invalid numeric value for ${key}`);
  }

  const limits = SETTING_LIMITS[key];
  if (value < limits.min || value > limits.max) {
    throwSafe(
      "ADMIN",
      `Crypto setting must be between ${limits.min} and ${limits.max}.`,
      `Out-of-range value for ${key}`,
    );
  }

  return value;
}

function validateBooleanSetting(key: string, value: unknown): boolean {
  if (typeof value !== "boolean") {
    throwSafe("ADMIN", "Choose whether BSC user deposits are enabled.", `Invalid boolean value for ${key}`);
  }

  return value;
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
    throwSafe("ADMIN", "Unauthorized.", "Non-admin or frozen admin attempted crypto settings access");
  }
}

function buildSettings(rows: Array<{ key: string; value: string }> | null): AdminCryptoSettings {
  const settingsMap = new Map((rows ?? []).map((row) => [row.key, row.value]));

  return {
    usdtEtbRate: parseNumberSetting(settingsMap.get("usdt_etb_rate"), DEFAULT_CRYPTO_SETTINGS.usdt_etb_rate),
    tronMinUsdt: parseNumberSetting(
      settingsMap.get("crypto_tron_min_usdt"),
      DEFAULT_CRYPTO_SETTINGS.crypto_tron_min_usdt,
    ),
    bscMinUsdt: parseNumberSetting(
      settingsMap.get("crypto_bsc_min_usdt"),
      DEFAULT_CRYPTO_SETTINGS.crypto_bsc_min_usdt,
    ),
    bscUserDepositsEnabled: parseBooleanSetting(
      settingsMap.get(BSC_USER_DEPOSITS_SETTING_KEY),
      DEFAULT_CRYPTO_SETTINGS.crypto_bsc_user_deposits_enabled,
    ),
  };
}

export const getAdminCryptoSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") {
      throwSafe("ADMIN", "Failed to load crypto settings.", "Invalid request data");
    }

    const { accessToken } = data as Record<string, unknown>;
    if (typeof accessToken !== "string" || !accessToken) {
      throwSafe("ADMIN", "Unauthorized.", "Missing access token for crypto settings load");
    }

    return { accessToken };
  })
  .handler(async ({ data }) => {
    await assertAdminToken(data.accessToken);

    const admin = getAdminClient();
    const { data: rows, error } = await admin
      .from("app_settings")
      .select("key, value")
      .in("key", [...CRYPTO_SETTING_KEYS]);

    if (error) {
      throwSafe("ADMIN", "Failed to load crypto settings.", `DB error: ${error.message}`);
    }

    return buildSettings(rows);
  });

export const updateAdminCryptoSettingsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") {
      throwSafe("ADMIN", "Failed to update crypto settings.", "Invalid request data");
    }

    const {
      accessToken,
      usdtEtbRate,
      tronMinUsdt,
      bscMinUsdt,
      bscUserDepositsEnabled,
    } = data as Record<string, unknown>;

    if (typeof accessToken !== "string" || !accessToken) {
      throwSafe("ADMIN", "Unauthorized.", "Missing access token for crypto settings update");
    }

    return {
      accessToken,
      settings: {
        usdt_etb_rate: validateNumberSetting("usdt_etb_rate", usdtEtbRate),
        crypto_tron_min_usdt: validateNumberSetting("crypto_tron_min_usdt", tronMinUsdt),
        crypto_bsc_min_usdt: validateNumberSetting("crypto_bsc_min_usdt", bscMinUsdt),
        crypto_bsc_user_deposits_enabled: validateBooleanSetting(
          BSC_USER_DEPOSITS_SETTING_KEY,
          bscUserDepositsEnabled,
        ),
      },
    };
  })
  .handler(async ({ data }) => {
    await assertAdminToken(data.accessToken);

    const admin = getAdminClient();
    const updatedAt = new Date().toISOString();
    const rows = [
      ...NUMERIC_CRYPTO_SETTING_KEYS.map((key) => ({
        key,
        value: serializeNumberSetting(data.settings[key]),
        updated_at: updatedAt,
      })),
      {
        key: BSC_USER_DEPOSITS_SETTING_KEY,
        value: String(data.settings.crypto_bsc_user_deposits_enabled),
        updated_at: updatedAt,
      },
    ];

    const { error } = await admin
      .from("app_settings")
      .upsert(rows, { onConflict: "key" });

    if (error) {
      throwSafe("ADMIN", "Failed to update crypto settings.", `DB error: ${error.message}`);
    }

    return buildSettings(rows);
  });

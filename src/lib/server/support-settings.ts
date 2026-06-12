import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

const SUPPORT_TELEGRAM_USERNAME_KEY = "support_telegram_username";

export type SupportSettings = {
  telegramUsername: string | null;
  telegramDisplay: string | null;
  telegramUrl: string | null;
  isConfigured: boolean;
};

function buildSupportSettings(username: string | null): SupportSettings {
  return {
    telegramUsername: username,
    telegramDisplay: username ? `@${username}` : null,
    telegramUrl: username ? `https://t.me/${username}` : null,
    isConfigured: Boolean(username),
  };
}

function normalizeTelegramUsername(value: unknown): string {
  if (typeof value !== "string") {
    throwSafe("SUPPORT", "Enter a valid Telegram username.", "Telegram username must be a string");
  }

  const trimmed = value.trim();

  if (!trimmed) {
    throwSafe("SUPPORT", "Telegram username is required.", "Missing Telegram username");
  }

  if (/^https?:\/\//i.test(trimmed) || trimmed.includes("/") || trimmed.includes("?")) {
    throwSafe(
      "SUPPORT",
      "Enter only the Telegram username, not a full link.",
      "Telegram username contains URL-like characters",
    );
  }

  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;

  if (!/^[A-Za-z0-9_]{5,32}$/.test(withoutAt)) {
    throwSafe(
      "SUPPORT",
      "Telegram username must be 5–32 letters, numbers, or underscores.",
      "Telegram username failed validation",
    );
  }

  return withoutAt;
}

async function assertAdminToken(accessToken: string): Promise<void> {
  const admin = getAdminClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await admin.auth.getUser(accessToken);

  if (authError || !authUser) {
    throwSafe("SUPPORT", "Unauthorized.", "Invalid or expired access token");
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin, is_frozen")
    .eq("id", authUser.id)
    .single();

  if (!profile || profile.is_admin !== true || profile.is_frozen === true) {
    throwSafe("SUPPORT", "Unauthorized.", "Non-admin or frozen admin attempted support settings update");
  }
}

export const getSupportSettingsFn = createServerFn({ method: "POST" })
  .inputValidator(() => ({}))
  .handler(async () => {
    const admin = getAdminClient();

    const { data, error } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", SUPPORT_TELEGRAM_USERNAME_KEY)
      .maybeSingle();

    if (error) {
      throwSafe("SUPPORT", "Failed to load support settings.", `DB error: ${error.message}`);
    }

    if (!data?.value) {
      return buildSupportSettings(null);
    }

    try {
      return buildSupportSettings(normalizeTelegramUsername(data.value));
    } catch (err) {
      console.error(
        "[QHash] Invalid stored support Telegram username:",
        JSON.stringify({ key: SUPPORT_TELEGRAM_USERNAME_KEY, error: err instanceof Error ? err.message : String(err) }),
      );
      return buildSupportSettings(null);
    }
  });

export const updateSupportTelegramUsernameFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") {
      throwSafe("SUPPORT", "Failed to update support settings.", "Invalid request data");
    }

    const { accessToken, telegramUsername } = data as Record<string, unknown>;

    if (typeof accessToken !== "string" || !accessToken) {
      throwSafe("SUPPORT", "Unauthorized.", "Missing access token for support settings update");
    }

    return {
      accessToken,
      telegramUsername: normalizeTelegramUsername(telegramUsername),
    };
  })
  .handler(async ({ data }) => {
    await assertAdminToken(data.accessToken);

    const admin = getAdminClient();
    const { error } = await admin
      .from("app_settings")
      .upsert(
        {
          key: SUPPORT_TELEGRAM_USERNAME_KEY,
          value: data.telegramUsername,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );

    if (error) {
      throwSafe("SUPPORT", "Failed to update support settings.", `DB error: ${error.message}`);
    }

    return buildSupportSettings(data.telegramUsername);
  });

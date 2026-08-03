import {
  getSupportSettingsFn,
  updateSupportTelegramUsernameFn,
  type SupportSettings,
} from "@/lib/server/support-settings.js";

export type AdminSupportSettings = SupportSettings;

export function loadAdminSupportSettings(): Promise<AdminSupportSettings> {
  return getSupportSettingsFn({ data: {} });
}

export function saveAdminSupportTelegramUsername(
  accessToken: string,
  telegramUsername: string,
): Promise<AdminSupportSettings> {
  return updateSupportTelegramUsernameFn({
    data: {
      accessToken,
      telegramUsername,
    },
  });
}

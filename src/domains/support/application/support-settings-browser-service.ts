import { getSupportSettingsFn } from "@/lib/server/support-settings.js";

export async function loadSupportDestination() {
  const settings = await getSupportSettingsFn({ data: {} });
  return settings.isConfigured ? settings.telegramUrl : null;
}

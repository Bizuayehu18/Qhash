import { getAdminStatsFn } from "@/lib/server/admin.js";

export type AdminOverviewStats = Awaited<ReturnType<typeof getAdminStatsFn>>;

export function loadAdminOverview(
  accessToken: string,
): Promise<AdminOverviewStats> {
  return getAdminStatsFn({ data: { accessToken } });
}

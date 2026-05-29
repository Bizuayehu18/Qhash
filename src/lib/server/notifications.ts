import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

export const getNotificationsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throwSafe("SERVER", "Failed to load notifications.", "Invalid request data");
    const { userId } = data as Record<string, unknown>;
    if (typeof userId !== "string" || !userId)
      throwSafe("SERVER", "Failed to load notifications.", "Missing user ID");
    return { userId };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();
    const { data: rows, error } = await admin
      .from("notifications")
      .select("*")
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throwSafe("SERVER", "Failed to load notifications.", `DB error: ${error.message}`);
    return rows ?? [];
  });

export const getUnreadCountFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throwSafe("SERVER", "Failed to load notifications.", "Invalid request data");
    const { userId } = data as Record<string, unknown>;
    if (typeof userId !== "string" || !userId)
      throwSafe("SERVER", "Failed to load notifications.", "Missing user ID");
    return { userId };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();
    const { count, error } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", data.userId)
      .eq("is_read", false);

    if (error) return { count: 0 };
    return { count: count ?? 0 };
  });

export const markNotificationsReadFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throwSafe("SERVER", "Failed to update notifications.", "Invalid request data");
    const { userId, notificationIds } = data as Record<string, unknown>;
    if (typeof userId !== "string" || !userId)
      throwSafe("SERVER", "Failed to update notifications.", "Missing user ID");
    return {
      userId,
      notificationIds: Array.isArray(notificationIds)
        ? (notificationIds as string[])
        : undefined,
    };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();
    if (data.notificationIds && data.notificationIds.length > 0) {
      await admin
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", data.userId)
        .in("id", data.notificationIds);
    } else {
      await admin
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", data.userId)
        .eq("is_read", false);
    }
    return { success: true };
  });

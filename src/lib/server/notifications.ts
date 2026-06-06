import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

export const getNotificationsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throwSafe("SERVER", "Failed to load notifications.", "Invalid request data");
    const { accessToken } = data as Record<string, unknown>;
    if (typeof accessToken !== "string" || accessToken.length === 0)
      throwSafe("SERVER", "Failed to load notifications.", "Missing access token");
    return { accessToken };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();

    // Derive the caller identity from the session access token. The client
    // never supplies the user id used for the notifications query below.
    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(data.accessToken);
    if (authError || !authUser)
      throwSafe("SERVER", "Failed to load notifications.", "Invalid or expired access token");

    const { data: rows, error } = await admin
      .from("notifications")
      .select("*")
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throwSafe("SERVER", "Failed to load notifications.", `DB error: ${error.message}`);
    return rows ?? [];
  });

export const getUnreadCountFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throwSafe("SERVER", "Failed to load notifications.", "Invalid request data");
    const { accessToken } = data as Record<string, unknown>;
    if (typeof accessToken !== "string" || accessToken.length === 0)
      throwSafe("SERVER", "Failed to load notifications.", "Missing access token");
    return { accessToken };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();

    // Derive the caller identity from the session access token. The client
    // never supplies the user id used for the unread-count query below. Keep
    // the badge stable by returning { count: 0 } on auth failure.
    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(data.accessToken);
    if (authError || !authUser) return { count: 0 };

    const { count, error } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authUser.id)
      .eq("is_read", false);

    if (error) return { count: 0 };
    return { count: count ?? 0 };
  });

export const markNotificationsReadFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throwSafe("SERVER", "Failed to update notifications.", "Invalid request data");
    const { accessToken, notificationIds } = data as Record<string, unknown>;
    if (typeof accessToken !== "string" || accessToken.length === 0)
      throwSafe("SERVER", "Failed to update notifications.", "Missing access token");
    return {
      accessToken,
      notificationIds: Array.isArray(notificationIds)
        ? (notificationIds as string[])
        : undefined,
    };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();

    // Derive the caller identity from the session access token. The client
    // never supplies the user id used for the notifications update below.
    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(data.accessToken);
    if (authError || !authUser)
      throwSafe("SERVER", "Failed to update notifications.", "Invalid or expired access token");

    if (data.notificationIds && data.notificationIds.length > 0) {
      await admin
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", authUser.id)
        .in("id", data.notificationIds);
    } else {
      await admin
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", authUser.id)
        .eq("is_read", false);
    }
    return { success: true };
  });

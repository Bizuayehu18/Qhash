import { createClient } from "@supabase/supabase-js";
import type { Config } from "@netlify/functions";
import { processAllEarnings } from "./lib/process-all-earnings.mts";

function logError(step: string, data: Record<string, unknown>) {
  console.error(
    JSON.stringify({
      fn: "trigger-daily-earnings",
      step,
      ts: new Date().toISOString(),
      ...data,
    })
  );
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json(
      { error: "method_not_allowed", message: "POST only." },
      { status: 405 }
    );
  }

  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL") ??
    Netlify.env.get("SUPABASE_URL") ??
    "";
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    logError("config", { error: "Missing Supabase configuration" });
    return Response.json(
      { error: "server_config", message: "Server is not configured." },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    return Response.json(
      { error: "missing_token", message: "Authentication required." },
      { status: 401 }
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);

  if (userError || !userData?.user) {
    logError("auth", { error: userError?.message ?? "no user" });
    return Response.json(
      { error: "invalid_token", message: "Invalid or expired session." },
      { status: 401 }
    );
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin, is_frozen")
    .eq("id", userData.user.id)
    .single();

  if (!profile?.is_admin) {
    logError("auth", {
      error: "not_admin",
      user_id: userData.user.id,
    });
    return Response.json(
      { error: "forbidden", message: "Admin access required." },
      { status: 403 }
    );
  }

  if (profile.is_frozen === true) {
    logError("auth", {
      error: "admin_frozen",
      user_id: userData.user.id,
    });
    return Response.json(
      { error: "admin_frozen", message: "Admin account is frozen." },
      { status: 403 }
    );
  }

  const result = await processAllEarnings(admin, "manual");

  return Response.json({ success: true, ...result });
};

export const config: Config = {
  path: "/api/admin/trigger-daily-earnings",
  method: "POST",
};

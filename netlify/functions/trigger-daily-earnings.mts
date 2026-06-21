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

function createAdminClient() {
  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL") ??
    Netlify.env.get("SUPABASE_URL") ??
    "";
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      admin: null,
      response: Response.json(
        { error: "server_config", message: "Server is not configured." },
        { status: 500 }
      ),
    };
  }

  return {
    admin: createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    response: null,
  };
}

async function requireAdmin(req: Request) {
  const { admin, response } = createAdminClient();

  if (!admin) {
    logError("config", { error: "Missing Supabase configuration" });
    return { admin: null, response };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    return {
      admin: null,
      response: Response.json(
        { error: "missing_token", message: "Authentication required." },
        { status: 401 }
      ),
    };
  }

  const { data: userData, error: userError } = await admin.auth.getUser(token);

  if (userError || !userData?.user) {
    logError("auth", { error: userError?.message ?? "no user" });
    return {
      admin: null,
      response: Response.json(
        { error: "invalid_token", message: "Invalid or expired session." },
        { status: 401 }
      ),
    };
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
    return {
      admin: null,
      response: Response.json(
        { error: "forbidden", message: "Admin access required." },
        { status: 403 }
      ),
    };
  }

  if (profile.is_frozen === true) {
    logError("auth", {
      error: "admin_frozen",
      user_id: userData.user.id,
    });
    return {
      admin: null,
      response: Response.json(
        { error: "admin_frozen", message: "Admin account is frozen." },
        { status: 403 }
      ),
    };
  }

  return { admin, response: null };
}

export default async (req: Request) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return Response.json(
      { error: "method_not_allowed", message: "GET or POST only." },
      { status: 405 }
    );
  }

  const { admin, response } = await requireAdmin(req);
  if (!admin) return response;

  if (req.method === "GET") {
    const { data, error } = await admin
      .from("earning_run_logs")
      .select(
        "run_id, trigger_type, started_at, completed_at, status, total_active_investments, total_users_processed, total_investments_processed, total_earnings_credited, total_errors, total_transactions_created, error_details, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(15);

    if (error) {
      logError("history", { error: error.message, code: error.code });
      return Response.json(
        { error: "history_failed", message: "Unable to load earning run history." },
        { status: 500 }
      );
    }

    return Response.json({ success: true, runs: data ?? [] });
  }

  const result = await processAllEarnings(admin, "manual");

  return Response.json({ success: true, ...result });
};

export const config: Config = {
  path: "/api/admin/trigger-daily-earnings",
};

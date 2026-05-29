import { createClient } from "@supabase/supabase-js";
import type { Config } from "@netlify/functions";
import { verifyVerifierRequest } from "./lib/verifier-auth.mts";

function log(step: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: "verifier-pending-telebirr", step, ts: new Date().toISOString(), ...data }));
}

function logError(step: string, data: Record<string, unknown>) {
  console.error(JSON.stringify({ fn: "verifier-pending-telebirr", step, ts: new Date().toISOString(), ...data }));
}

export default async (req: Request) => {
  const auth = verifyVerifierRequest(req, logError);
  if (!auth.ok) return auth.response;

  log("verifier_pending_requested", {});

  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") ?? Netlify.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    logError("config", { error: "Missing Supabase configuration" });
    return Response.json({ error: "server_config", message: "Server is not configured." }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: telebirrMethods, error: methodError } = await admin
    .from("payment_methods")
    .select("id, account_name")
    .eq("type", "telebirr")
    .eq("is_active", true);

  if (methodError) {
    logError("method_query_error", { error: methodError.message });
    return Response.json({ error: "query_failed", message: "Failed to fetch payment methods." }, { status: 500 });
  }

  if (!telebirrMethods || telebirrMethods.length === 0) {
    log("verifier_pending_returned", { count: 0, reason: "no_telebirr_methods" });
    return Response.json({ deposits: [] });
  }

  const methodIds = telebirrMethods.map((m) => m.id);
  const methodMap = new Map(telebirrMethods.map((m) => [m.id, m.account_name]));

  const { data: deposits, error: depositError } = await admin
    .from("deposits")
    .select("id, transaction_reference, receipt_url, created_at, payment_method_id")
    .eq("status", "pending")
    .in("payment_method_id", methodIds)
    .or("admin_note.is.null,admin_note.not.like.Verifier review:*")
    .order("created_at", { ascending: true })
    .limit(10);

  if (depositError) {
    logError("deposit_query_error", { error: depositError.message });
    return Response.json({ error: "query_failed", message: "Failed to fetch deposits." }, { status: 500 });
  }

  const result = (deposits ?? []).map((d) => ({
    deposit_id: d.id,
    transaction_reference: d.transaction_reference,
    receipt_url: d.receipt_url,
    expected_receiver_name: methodMap.get(d.payment_method_id) ?? null,
    created_at: d.created_at,
  }));

  log("verifier_pending_returned", { count: result.length });
  return Response.json({ deposits: result });
};

export const config: Config = {
  path: "/api/verifier/pending-telebirr",
  method: "GET",
};

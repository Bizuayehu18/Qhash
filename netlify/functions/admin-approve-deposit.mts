import { createClient } from "@supabase/supabase-js";
import type { Config } from "@netlify/functions";

function log(step: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: "admin-approve-deposit", step, ts: new Date().toISOString(), ...data }));
}

function logError(step: string, data: Record<string, unknown>) {
  console.error(JSON.stringify({ fn: "admin-approve-deposit", step, ts: new Date().toISOString(), ...data }));
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method_not_allowed", message: "POST only." }, { status: 405 });
  }

  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") ?? Netlify.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    logError("config", { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    return Response.json({ error: "server_config", message: "Server is not configured." }, { status: 500 });
  }

  // Step 1: Admin authentication
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (!token) {
    logError("admin_auth", { error: "No auth token provided" });
    return Response.json({ error: "missing_token", message: "Authentication required." }, { status: 401 });
  }

  let body: { depositId?: string; action?: string; adminNote?: string | null; verifiedAmount?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_body", message: "Invalid JSON body." }, { status: 400 });
  }

  const { depositId, action, adminNote, verifiedAmount } = body;

  if (!depositId || typeof depositId !== "string") {
    return Response.json({ error: "missing_deposit_id", message: "depositId is required." }, { status: 400 });
  }
  if (action !== "approve" && action !== "reject") {
    return Response.json({ error: "invalid_action", message: "action must be 'approve' or 'reject'." }, { status: 400 });
  }

  let parsedAmount: number | null = null;
  if (action === "approve") {
    if (verifiedAmount === undefined || verifiedAmount === null || typeof verifiedAmount !== "number" || !Number.isFinite(verifiedAmount) || verifiedAmount <= 0) {
      return Response.json(
        { error: "invalid_amount", message: "verifiedAmount must be a positive number for approval." },
        { status: 400 },
      );
    }
    parsedAmount = verifiedAmount;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);

  if (userError || !userData?.user) {
    logError("admin_auth", { error: userError?.message ?? "no user", code: userError?.status });
    return Response.json({ error: "invalid_token", message: "Invalid or expired session." }, { status: 401 });
  }

  const adminUserId = userData.user.id;
  log("admin_auth", { adminId: adminUserId, action, depositId });

  // Step 2: Call the atomic RPC with admin-verified amount
  log("rpc_call", { depositId, action, hasNote: !!adminNote, hasAmount: parsedAmount !== null });

  const { data: result, error: rpcError } = await admin.rpc("approve_deposit_tx", {
    p_deposit_id: depositId,
    p_admin_id: adminUserId,
    p_action: action,
    p_admin_note: typeof adminNote === "string" && adminNote.trim() ? adminNote.trim() : null,
    p_amount: parsedAmount,
  });

  if (rpcError) {
    logError("rpc_error", {
      message: rpcError.message,
      code: rpcError.code,
      details: rpcError.details,
      hint: (rpcError as Record<string, unknown>).hint,
      depositId,
      action,
    });
    return Response.json(
      { error: "rpc_failed", message: "Failed to review deposit. Please try again." },
      { status: 500 },
    );
  }

  if (!result || typeof result !== "object") {
    logError("rpc_unexpected", { result, depositId });
    return Response.json({ error: "unexpected_result", message: "Unexpected response from database." }, { status: 500 });
  }

  const txResult = result as Record<string, unknown>;

  if (!txResult.success) {
    const errorCode = (txResult.error as string) ?? "unknown";
    const internalMessage = (txResult.message as string) ?? "Deposit review failed.";
    const failedStep = (txResult.step as string) ?? "unknown";
    const pgError = (txResult.pg_error as string) ?? null;
    const pgCode = (txResult.pg_code as string) ?? null;

    logError("rpc_business_error", {
      errorCode,
      internalMessage,
      failedStep,
      pgError,
      pgCode,
      depositId,
      action,
    });

    const userMessages: Record<string, string> = {
      admin_not_found: "Authorization failed.",
      not_admin: "Authorization failed.",
      admin_frozen: "Your admin account is frozen.",
      invalid_action: "Invalid review action.",
      deposit_not_found: "Deposit not found.",
      already_reviewed: "This deposit has already been reviewed.",
      invalid_amount: "Invalid deposit amount.",
      internal_error: "An internal error occurred. Please try again.",
    };

    const statusMap: Record<string, number> = {
      admin_not_found: 403,
      not_admin: 403,
      admin_frozen: 403,
      invalid_action: 400,
      deposit_not_found: 404,
      already_reviewed: 409,
      invalid_amount: 400,
      internal_error: 500,
    };

    return Response.json(
      { error: errorCode, message: userMessages[errorCode] ?? "Failed to review deposit." },
      { status: statusMap[errorCode] ?? 500 },
    );
  }

  log("rpc_success", {
    depositId,
    status: txResult.status,
    amount: txResult.amount,
    balanceBefore: txResult.balance_before,
    balanceAfter: txResult.balance_after,
    transactionId: txResult.transaction_id,
  });

  try {
    const { data: deposit, error: depositError } = await admin
      .from("deposits")
      .select("user_id, amount, status, auto_verified")
      .eq("id", depositId)
      .single();

    if (depositError || !deposit) {
      logError("deposit_fetch_for_notification", {
        depositId,
        error: depositError?.message ?? "no deposit row",
      });
    } else if (deposit.status === "approved") {
      const { error: notifError } = await admin.from("notifications").insert({
        user_id: deposit.user_id,
        title: "Deposit Approved",
        message: `Your deposit of ${deposit.amount} ETB has been approved and credited to your wallet.`,
        metadata: {
          type: "deposit_approved",
          deposit_id: depositId,
          amount: deposit.amount,
          auto_verified: deposit.auto_verified ?? false,
        },
      });
      if (notifError) {
        logError("approval_notification_failed", {
          depositId,
          error: notifError.message,
          code: notifError.code,
        });
      } else {
        log("approval_notification_created", { depositId });
      }
    } else if (deposit.status === "rejected") {
      const { error: notifError } = await admin.from("notifications").insert({
        user_id: deposit.user_id,
        title: "Deposit Rejected",
        message: `Your deposit of ${deposit.amount} ETB was rejected. Please check the details and submit again.`,
        metadata: {
          type: "deposit_rejected",
          deposit_id: depositId,
          amount: deposit.amount,
        },
      });
      if (notifError) {
        logError("rejection_notification_failed", {
          depositId,
          error: notifError.message,
          code: notifError.code,
        });
      } else {
        log("rejection_notification_created", { depositId });
      }
    }
  } catch (notifEx) {
    logError("notification_exception", {
      depositId,
      error: notifEx instanceof Error ? notifEx.message : "unknown",
    });
  }

  return Response.json({ success: true, ...txResult });
};

export const config: Config = {
  path: "/api/admin/approve-deposit",
  method: "POST",
};

import { createClient } from "@supabase/supabase-js";
import type { Config } from "@netlify/functions";
import { verifyVerifierRequest } from "./lib/verifier-auth.mts";
import {
  recordDepositVerificationLog,
  type DepositVerificationFreshness,
} from "../../src/lib/server/deposit-verification-audit.js";

function log(step: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: "verifier-submit-telebirr-result", step, ts: new Date().toISOString(), ...data }));
}

function logError(step: string, data: Record<string, unknown>) {
  console.error(JSON.stringify({ fn: "verifier-submit-telebirr-result", step, ts: new Date().toISOString(), ...data }));
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitize(value: unknown, maxLen = 200): string {
  const str = String(value ?? "").replace(/[\x00-\x1f]/g, "");
  return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
}

// Mask a transaction reference for safe logging: never log the full reference,
// only the last 4 characters (rule 8 logging safety).
function maskRef(ref: string): string {
  if (!ref) return "";
  return ref.length <= 4 ? "****" : `****${ref.slice(-4)}`;
}

// Canonical TeleBirr receipt URL base. The canonical receipt URL is always
// derived from the EXTRACTED receipt transaction ID, never the submitted one.
const TELEBIRR_RECEIPT_BASE = "https://transactioninfo.ethiotelecom.et/receipt";

// Static, sanitised messages for the audit trail, keyed by reason code. These
// are intentionally generic and NEVER contain receiver/account names, full
// references, receipt text, or receipt URLs — only the safe equivalent of each
// final-outcome reason. The raw, human-readable reasons (which may embed
// sanitised receiver names) are kept out of the audit row entirely.
const SAFE_REASON_MESSAGES: Record<string, string> = {
  telebirr_receipt_verified: "TeleBirr receipt verified; deposit auto-approved.",
  receiver_mismatch: "Receiver name did not match the expected account.",
  unreadable_receipt: "Receipt unreadable: no amount, receiver, or date extracted.",
  amount_invalid_or_missing: "Receipt amount was invalid or missing.",
  payment_date_missing: "Payment date was missing from the receipt.",
  payment_date_unparseable: "Payment date could not be parsed.",
  payment_date_too_old: "Payment date was too old.",
  payment_date_future: "Payment date was in the future.",
  telebirr_transaction_id_missing: "TeleBirr receipt transaction ID was missing.",
  duplicate_telebirr_receipt_transaction_id: "Duplicate TeleBirr receipt transaction ID.",
  duplicate_extracted_reference: "Duplicate extracted TeleBirr reference.",
  duplicate_check_failed: "Duplicate reference check could not be completed.",
  canonical_reference_update_failed: "Canonical reference update could not be confirmed.",
  duplicate_reject_rpc_failed: "Duplicate auto-reject could not be completed.",
  rejection_rpc_failed: "Auto-reject could not be completed.",
  approval_rpc_failed: "Auto-approval could not be completed.",
  verifier_fetch_failed: "Receipt fetch failed.",
  no_admin_available: "No admin account available to action the decision.",
};

interface SubmitBody {
  deposit_id?: unknown;
  transaction_reference?: unknown;
  receipt_fetch_status?: unknown;
  extracted_transaction_id?: unknown;
  extracted_amount?: unknown;
  extracted_receiver_name?: unknown;
  extracted_status?: unknown;
  extracted_payment_date?: unknown;
  verifier_note?: unknown;
}

function parseEthiopiaPaymentDate(raw: string): Date | null {
  const m = raw.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+03:00`;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;
  return date;
}

async function saveForManualReview(
  admin: ReturnType<typeof createClient>,
  depositId: string,
  reason: string,
) {
  const { error } = await admin
    .from("deposits")
    .update({ admin_note: reason })
    .eq("id", depositId);

  if (error) {
    logError("manual_review_update_failed", { depositId, error: error.message });
  }

  log("verifier_manual_review_saved", { depositId, reason });
}

export default async (req: Request) => {
  const auth = verifyVerifierRequest(req, logError);
  if (!auth.ok) return auth.response;

  let body: SubmitBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_body", message: "Invalid JSON body." }, { status: 400 });
  }

  const depositId = typeof body.deposit_id === "string" ? body.deposit_id.trim() : "";
  const transactionReference = typeof body.transaction_reference === "string" ? body.transaction_reference.trim() : "";
  const receiptFetchStatus = typeof body.receipt_fetch_status === "string" ? body.receipt_fetch_status.trim() : "";
  const extractedTransactionId = typeof body.extracted_transaction_id === "string" ? body.extracted_transaction_id.trim() : "";
  // Canonical receipt transaction reference extracted from the TeleBirr receipt
  // body by the Android verifier. TeleBirr invoice numbers are uppercase
  // alphanumeric, so canonicalisation is trim (above) + uppercase. All
  // duplicate protection and the canonical deposit row use THIS value, never the
  // user-submitted transaction_reference.
  const canonicalTransactionReference = extractedTransactionId.toUpperCase();
  const extractedReceiverName = typeof body.extracted_receiver_name === "string" ? body.extracted_receiver_name.trim() : "";
  const extractedStatus = typeof body.extracted_status === "string" ? body.extracted_status.trim() : "";
  const verifierNote = typeof body.verifier_note === "string" ? body.verifier_note.trim() : "";
  const extractedPaymentDate = typeof body.extracted_payment_date === "string" ? body.extracted_payment_date.trim() : "";
  const extractedAmount =
    typeof body.extracted_amount === "number"
      ? body.extracted_amount
      : typeof body.extracted_amount === "string"
        ? parseFloat(body.extracted_amount)
        : NaN;

  if (!depositId) {
    return Response.json({ error: "missing_field", message: "deposit_id is required." }, { status: 400 });
  }
  if (!transactionReference) {
    return Response.json({ error: "missing_field", message: "transaction_reference is required." }, { status: 400 });
  }
  if (!receiptFetchStatus) {
    return Response.json({ error: "missing_field", message: "receipt_fetch_status is required." }, { status: 400 });
  }
  if (receiptFetchStatus !== "success" && receiptFetchStatus !== "fetch_failed") {
    return Response.json({ error: "invalid_field", message: "receipt_fetch_status must be 'success' or 'fetch_failed'." }, { status: 400 });
  }

  log("verifier_result_received", {
    depositId,
    // Never log full transaction references (rule 8 logging safety): only masked
    // last-4 values for both the submitted reference and the extracted receipt ID.
    submittedRefLast4: maskRef(transactionReference),
    receiptFetchStatus,
    extractedRefLast4: maskRef(extractedTransactionId),
    extractedAmount,
    extractedStatus,
    extractedPaymentDate,
  });

  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") ?? Netlify.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    logError("config", { error: "Missing Supabase configuration" });
    return Response.json({ error: "server_config", message: "Server is not configured." }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Load deposit
  const { data: deposit, error: depositError } = await admin
    .from("deposits")
    .select("id, user_id, amount, status, transaction_reference, payment_method_id")
    .eq("id", depositId)
    .single();

  if (depositError || !deposit) {
    logError("verifier_deposit_loaded", { depositId, error: depositError?.message ?? "not_found" });
    return Response.json({ error: "deposit_not_found", message: "Deposit not found." }, { status: 404 });
  }

  log("verifier_deposit_loaded", { depositId, status: deposit.status, paymentMethodId: deposit.payment_method_id });

  if (deposit.status !== "pending") {
    log("verifier_result_failed", { depositId, reason: "not_pending", currentStatus: deposit.status });
    return Response.json(
      { error: "not_pending", message: "Deposit is no longer pending.", action: "skipped" },
      { status: 409 },
    );
  }

  // Load payment method and verify it's telebirr
  const { data: method, error: methodError } = await admin
    .from("payment_methods")
    .select("id, type, account_name")
    .eq("id", deposit.payment_method_id)
    .single();

  if (methodError || !method) {
    logError("verifier_result_failed", { depositId, error: "payment_method_not_found" });
    return Response.json({ error: "method_not_found", message: "Payment method not found." }, { status: 400 });
  }

  if (method.type !== "telebirr") {
    log("verifier_result_failed", { depositId, reason: "not_telebirr", methodType: method.type });
    return Response.json({ error: "not_telebirr", message: "Deposit is not a TeleBirr payment." }, { status: 400 });
  }

  // --- Audit setup (non-blocking) ---
  // Safe, masked values reused by every final-outcome audit row. The extracted
  // amount is only recorded when it is a usable positive number; references are
  // reduced to their last 4 characters HERE, so the full reference is never
  // passed to the audit helper.
  const safeAmount = !isNaN(extractedAmount) && extractedAmount > 0 ? extractedAmount : null;
  const refForLast4 = canonicalTransactionReference || transactionReference;
  const refLast4ForAudit = refForLast4 ? refForLast4.slice(-4) : null;
  const submittedReferenceMismatch = canonicalTransactionReference
    ? transactionReference !== canonicalTransactionReference
    : null;

  // Verification signals captured during the decision logic below and read at
  // call-time by recordOutcome (the closure binds the variables, not their
  // values, so later assignments are visible to it).
  let receiverMatched: boolean | null = null;
  let freshnessDecision: DepositVerificationFreshness | null = null;
  let ageMinutes: number | null = null;

  // Write a single audit row for the authoritative final outcome. This NEVER
  // blocks or alters approval/rejection/manual-review: the helper is already
  // non-throwing, and the call is additionally wrapped in try/catch. Only safe
  // fields are passed — last-4 references, the extracted amount, booleans /
  // enums / counts — never full references, receipt URLs, receipt text, raw
  // receiver/account names, or secrets.
  const recordOutcome = async (outcome: {
    event:
      | "telebirr_auto_approved"
      | "telebirr_auto_rejected"
      | "telebirr_manual_review";
    action: "approve" | "reject" | "manual_review";
    reasonCode: string;
    metadata?: Record<string, unknown>;
  }) => {
    try {
      await recordDepositVerificationLog({
        deposit_id: depositId,
        user_id: deposit.user_id,
        payment_type: "telebirr",
        event: outcome.event,
        action: outcome.action,
        reason_code: outcome.reasonCode,
        reason_message_safe: SAFE_REASON_MESSAGES[outcome.reasonCode] ?? null,
        amount: safeAmount,
        tx_ref_last4: refLast4ForAudit,
        receiver_matched: receiverMatched,
        freshness_decision: freshnessDecision,
        age_minutes: ageMinutes,
        actor_type: "verifier",
        source: "telebirr_verifier",
        metadata: {
          receipt_fetch_status: receiptFetchStatus,
          submitted_reference_mismatch: submittedReferenceMismatch,
          ...outcome.metadata,
        },
      });
    } catch (auditErr) {
      logError("audit_log_exception", {
        depositId,
        error: auditErr instanceof Error ? auditErr.message : "unknown",
      });
    }
  };

  // --- Decision logic ---
  const rejectReasons: string[] = [];
  const manualReviewReasons: string[] = [];
  // Machine-readable reason codes mirroring the human-readable reasons above,
  // used only for the audit trail. Receiver-mismatch and unreadable-receipt are
  // mutually exclusive branches, so a single reject reason code is sufficient.
  const manualReviewReasonCodes: string[] = [];
  let rejectReasonCode: string | null = null;

  if (receiptFetchStatus === "fetch_failed") {
    manualReviewReasons.push("Receipt fetch failed");
    manualReviewReasonCodes.push("verifier_fetch_failed");
  } else {
    const hasAmount = !isNaN(extractedAmount) && extractedAmount > 0;
    const hasReceiver = extractedReceiverName !== "";
    const hasDate = extractedPaymentDate !== "";

    if (!hasAmount && !hasReceiver && !hasDate) {
      rejectReasons.push("Unreadable receipt: no amount, receiver, or date could be extracted");
      rejectReasonCode = "unreadable_receipt";
    } else {
      if (hasReceiver) {
        receiverMatched =
          normalizeName(extractedReceiverName) === normalizeName(method.account_name);
        if (!receiverMatched) {
          rejectReasons.push(
            `Receiver name mismatch (expected: ${sanitize(method.account_name, 60)}, got: ${sanitize(extractedReceiverName, 60)})`,
          );
          rejectReasonCode = "receiver_mismatch";
        }
      }

      if (!hasAmount) {
        manualReviewReasons.push(`Invalid or missing amount: ${sanitize(String(body.extracted_amount ?? ""), 40)}`);
        manualReviewReasonCodes.push("amount_invalid_or_missing");
      }

      if (!hasDate) {
        manualReviewReasons.push("Payment date missing from receipt");
        manualReviewReasonCodes.push("payment_date_missing");
        freshnessDecision = "missing";
      } else {
        const paymentDateParsed = parseEthiopiaPaymentDate(extractedPaymentDate);
        if (!paymentDateParsed) {
          manualReviewReasons.push(`Payment date invalid format: ${sanitize(extractedPaymentDate, 40)}`);
          manualReviewReasonCodes.push("payment_date_unparseable");
          freshnessDecision = "unparseable";
        } else {
          const ageMs = Date.now() - paymentDateParsed.getTime();
          ageMinutes = Math.round(ageMs / 60000);
          if (ageMs > 60 * 60 * 1000) {
            manualReviewReasons.push(`Payment date too old: ${sanitize(extractedPaymentDate, 40)} (${Math.round(ageMs / 60000)} min ago)`);
            manualReviewReasonCodes.push("payment_date_too_old");
            freshnessDecision = "too_old";
          } else if (ageMs < -5 * 60 * 1000) {
            manualReviewReasons.push(`Payment date is in the future: ${sanitize(extractedPaymentDate, 40)}`);
            manualReviewReasonCodes.push("payment_date_future");
            freshnessDecision = "future";
          } else {
            freshnessDecision = "fresh";
          }
        }
      }
    }
  }

  // Find admin profile (needed for reject + approve paths)
  const { data: adminUser } = await admin
    .from("profiles")
    .select("id")
    .eq("is_admin", true)
    .eq("is_frozen", false)
    .limit(1)
    .single();

  // --- REJECT ---
  if (rejectReasons.length > 0) {
    log("verifier_auto_reject", { depositId, rejectReasons });

    if (!adminUser) {
      logError("no_admin_found", { depositId });
      const reason = `Verifier review: Auto-reject attempted but no admin available. Reasons: ${rejectReasons.join("; ")}`;
      await saveForManualReview(admin, depositId, reason);
      await recordOutcome({
        event: "telebirr_manual_review",
        action: "manual_review",
        reasonCode: "no_admin_available",
        metadata: { decision_path: "auto_reject_no_admin", reject_reason_code: rejectReasonCode },
      });
      return Response.json(
        { action: "manual_review", deposit_id: depositId, failures: ["no_admin_available", ...rejectReasons] },
        { status: 500 },
      );
    }

    const rejectNote = `Verifier rejected: ${rejectReasons.join("; ")}`;
    const { data: rejectRpcResult, error: rejectRpcError } = await admin.rpc("approve_deposit_tx", {
      p_deposit_id: depositId,
      p_admin_id: adminUser.id,
      p_action: "reject",
      p_admin_note: rejectNote,
    });

    if (rejectRpcError) {
      logError("reject_rpc_error", { depositId, message: rejectRpcError.message, code: rejectRpcError.code });
      await saveForManualReview(
        admin,
        depositId,
        `Verifier review: Auto-reject failed (RPC error). Reasons: ${rejectReasons.join("; ")}`,
      );
      await recordOutcome({
        event: "telebirr_manual_review",
        action: "manual_review",
        reasonCode: "rejection_rpc_failed",
        metadata: { decision_path: "auto_reject_rpc_error", reject_reason_code: rejectReasonCode },
      });
      return Response.json(
        { action: "manual_review", deposit_id: depositId, failures: ["rpc_failed", ...rejectReasons] },
        { status: 500 },
      );
    }

    const rejectTxResult = rejectRpcResult as Record<string, unknown> | null;
    if (!rejectTxResult?.success) {
      const errorCode = (rejectTxResult?.error as string) ?? "unknown";
      if (errorCode === "already_reviewed") {
        return Response.json(
          { action: "skipped", deposit_id: depositId, reason: "already_reviewed" },
          { status: 409 },
        );
      }
      await saveForManualReview(
        admin,
        depositId,
        `Verifier review: Auto-reject RPC error: ${errorCode}. Reasons: ${rejectReasons.join("; ")}`,
      );
      await recordOutcome({
        event: "telebirr_manual_review",
        action: "manual_review",
        reasonCode: "rejection_rpc_failed",
        metadata: {
          decision_path: "auto_reject_rpc_business_error",
          reject_reason_code: rejectReasonCode,
          rpc_error_code: errorCode,
        },
      });
      return Response.json(
        { action: "manual_review", deposit_id: depositId, failures: [errorCode, ...rejectReasons] },
        { status: 500 },
      );
    }

    try {
      // deposit.amount is the user-submitted amount, which is optional and
      // frequently 0 for TeleBirr (the amount is only confirmed from the
      // receipt). Omit the figure entirely rather than showing "0 ETB" when
      // there is no real amount.
      const rejectedAmount = Number(deposit.amount);
      const hasRejectedAmount = Number.isFinite(rejectedAmount) && rejectedAmount > 0;
      const rejectedMessage = hasRejectedAmount
        ? `Your deposit of ${rejectedAmount} ETB was rejected. Please check the details and submit again.`
        : "Your deposit was rejected. Please check the details and submit again.";

      const { error: notifError } = await admin.from("notifications").insert({
        user_id: deposit.user_id,
        title: "Deposit Rejected",
        message: rejectedMessage,
        metadata: {
          type: "deposit_rejected",
          deposit_id: depositId,
          amount: hasRejectedAmount ? rejectedAmount : null,
          auto_verified: true,
        },
      });

      if (notifError) {
        logError("notification_failed", { depositId, error: notifError.message });
      }
    } catch (notifEx) {
      logError("notification_exception", {
        depositId,
        error: notifEx instanceof Error ? notifEx.message : "unknown",
      });
    }

    await recordOutcome({
      event: "telebirr_auto_rejected",
      action: "reject",
      reasonCode: rejectReasonCode ?? "receiver_mismatch",
      metadata: { decision_path: "auto_rejected" },
    });

    return Response.json({
      action: "rejected",
      deposit_id: depositId,
      reasons: rejectReasons,
    });
  }

  // --- MISSING EXTRACTED TRANSACTION ID ---
  // Rule 2: the receipt was fetched successfully but the receipt transaction ID
  // is missing/empty. Never auto-approve in this case; hold the deposit pending
  // for manual review. Reject paths (wrong receiver / unreadable) above take
  // precedence; fetch failures keep their own manual-review behavior below.
  if (receiptFetchStatus === "success" && canonicalTransactionReference === "") {
    const reason = "Verifier review: TeleBirr receipt transaction ID missing; requires manual review.";
    log("verifier_manual_review", { depositId, reasonCode: "telebirr_transaction_id_missing" });
    await saveForManualReview(admin, depositId, reason);
    await recordOutcome({
      event: "telebirr_manual_review",
      action: "manual_review",
      reasonCode: "telebirr_transaction_id_missing",
      metadata: { decision_path: "transaction_id_missing" },
    });
    return Response.json({
      action: "manual_review",
      deposit_id: depositId,
      failures: ["telebirr_transaction_id_missing"],
    });
  }

  // --- MANUAL REVIEW ---
  if (manualReviewReasons.length > 0) {
    const reason = `Verifier review: ${manualReviewReasons.join("; ")}.${verifierNote ? ` Note: ${sanitize(verifierNote, 100)}` : ""}`;
    log("verifier_manual_review", { depositId, manualReviewReasons });
    await saveForManualReview(admin, depositId, reason);
    await recordOutcome({
      event: "telebirr_manual_review",
      action: "manual_review",
      reasonCode: manualReviewReasonCodes[0] ?? "manual_review",
      metadata: {
        decision_path: "manual_review",
        reasons_count: manualReviewReasonCodes.length,
      },
    });
    return Response.json({
      action: "manual_review",
      deposit_id: depositId,
      failures: manualReviewReasons,
    });
  }

  // --- APPROVE ---
  log("verifier_result_validated", { depositId, extractedAmount, refLast4: maskRef(canonicalTransactionReference) });

  if (!adminUser) {
    logError("no_admin_found", { depositId });
    await saveForManualReview(
      admin,
      depositId,
      `Verifier review: Validation passed (${extractedAmount} ETB) but no admin account available for auto-approval.`,
    );
    await recordOutcome({
      event: "telebirr_manual_review",
      action: "manual_review",
      reasonCode: "no_admin_available",
      metadata: { decision_path: "approve_no_admin" },
    });
    return Response.json(
      { action: "manual_review", deposit_id: depositId, failures: ["no_admin_available"] },
      { status: 500 },
    );
  }

  // adminUser is non-null past this point; capture the id so the closure below
  // does not depend on control-flow narrowing being preserved into the closure.
  const approverId = adminUser.id;

  // Auto-reject a deposit as a duplicate of an already-used canonical TeleBirr
  // receipt transaction ID. approve_deposit_tx is the ONLY rejection path and
  // never credits the wallet. If the reject RPC fails (transport error or
  // success:false), we DO NOT claim the deposit was rejected — we hold it
  // pending for manual review instead.
  const autoRejectDuplicate = async (reasonCode: string): Promise<Response> => {
    log("verifier_auto_reject", { depositId, reasonCode, refLast4: maskRef(canonicalTransactionReference) });

    const rejectNote = `Verifier rejected: duplicate TeleBirr receipt transaction ID (${reasonCode}).`;
    const { data: rejectRpcResult, error: rejectRpcError } = await admin.rpc("approve_deposit_tx", {
      p_deposit_id: depositId,
      p_admin_id: approverId,
      p_action: "reject",
      p_admin_note: rejectNote,
    });

    if (rejectRpcError) {
      logError("reject_rpc_error", { depositId, message: rejectRpcError.message, code: rejectRpcError.code });
      await saveForManualReview(
        admin,
        depositId,
        "Verifier review: duplicate TeleBirr receipt transaction ID detected, but auto-reject failed (RPC error); requires manual review.",
      );
      await recordOutcome({
        event: "telebirr_manual_review",
        action: "manual_review",
        reasonCode: "duplicate_reject_rpc_failed",
        metadata: { decision_path: "duplicate_reject_rpc_error", original_reason_code: reasonCode },
      });
      return Response.json(
        { action: "manual_review", deposit_id: depositId, failures: ["duplicate_reject_rpc_failed"] },
        { status: 500 },
      );
    }

    const rejectTxResult = rejectRpcResult as Record<string, unknown> | null;
    if (!rejectTxResult?.success) {
      const errorCode = (rejectTxResult?.error as string) ?? "unknown";
      if (errorCode === "already_reviewed") {
        return Response.json(
          { action: "skipped", deposit_id: depositId, reason: "already_reviewed" },
          { status: 409 },
        );
      }
      await saveForManualReview(
        admin,
        depositId,
        `Verifier review: duplicate TeleBirr receipt transaction ID detected, but auto-reject returned error: ${errorCode}; requires manual review.`,
      );
      await recordOutcome({
        event: "telebirr_manual_review",
        action: "manual_review",
        reasonCode: "duplicate_reject_rpc_failed",
        metadata: {
          decision_path: "duplicate_reject_rpc_business_error",
          original_reason_code: reasonCode,
          rpc_error_code: errorCode,
        },
      });
      return Response.json(
        { action: "manual_review", deposit_id: depositId, failures: ["duplicate_reject_rpc_failed"] },
        { status: 500 },
      );
    }

    // Reject committed atomically (no wallet credit). Flag auto-verification.
    await admin
      .from("deposits")
      .update({ auto_verified: true, verified_at: new Date().toISOString() })
      .eq("id", depositId);

    try {
      // Same blank-amount guard as the main reject path above.
      const rejectedAmount = Number(deposit.amount);
      const hasRejectedAmount = Number.isFinite(rejectedAmount) && rejectedAmount > 0;
      const rejectedMessage = hasRejectedAmount
        ? `Your deposit of ${rejectedAmount} ETB was rejected. Please check the details and submit again.`
        : "Your deposit was rejected. Please check the details and submit again.";

      const { error: notifError } = await admin.from("notifications").insert({
        user_id: deposit.user_id,
        title: "Deposit Rejected",
        message: rejectedMessage,
        metadata: {
          type: "deposit_rejected",
          deposit_id: depositId,
          amount: hasRejectedAmount ? rejectedAmount : null,
          auto_verified: true,
        },
      });
      if (notifError) {
        logError("notification_failed", { depositId, error: notifError.message });
      }
    } catch (notifEx) {
      logError("notification_exception", {
        depositId,
        error: notifEx instanceof Error ? notifEx.message : "unknown",
      });
    }

    await recordOutcome({
      event: "telebirr_auto_rejected",
      action: "reject",
      reasonCode,
      metadata: { decision_path: "duplicate_auto_rejected" },
    });

    return Response.json({
      action: "rejected",
      deposit_id: depositId,
      reasons: [reasonCode],
    });
  };

  // --- DUPLICATE PROTECTION (rule 3 & 4) ---
  // The duplicate check uses the canonical EXTRACTED receipt transaction ID, not
  // the user-submitted transaction_reference. If another deposit already used
  // this canonical reference, auto-reject through approve_deposit_tx.
  const { data: dupes, error: dupError } = await admin
    .from("deposits")
    .select("id")
    .eq("transaction_reference", canonicalTransactionReference)
    .neq("id", depositId)
    .limit(1);

  if (dupError) {
    logError("duplicate_check_failed", { depositId, message: dupError.message, code: dupError.code });
    await saveForManualReview(
      admin,
      depositId,
      "Verifier review: duplicate reference check failed; requires manual review.",
    );
    await recordOutcome({
      event: "telebirr_manual_review",
      action: "manual_review",
      reasonCode: "duplicate_check_failed",
      metadata: { decision_path: "duplicate_check_failed" },
    });
    return Response.json(
      { action: "manual_review", deposit_id: depositId, failures: ["duplicate_check_failed"] },
      { status: 500 },
    );
  }

  if (dupes && dupes.length > 0) {
    log("verifier_duplicate_detected", { depositId, refLast4: maskRef(canonicalTransactionReference) });
    return await autoRejectDuplicate("duplicate_telebirr_receipt_transaction_id");
  }

  // --- CANONICALIZE PENDING DEPOSIT ROW BEFORE APPROVAL (rule 5) ---
  // When the submitted transaction_reference differs from the canonical
  // extracted reference, update the deposit row so transaction_reference holds
  // the canonical value (and the unique index protects future duplicates).
  // Approval only proceeds after this update succeeds. Never approve on failure.
  if (transactionReference !== canonicalTransactionReference) {
    const canonicalReceiptUrl = `${TELEBIRR_RECEIPT_BASE}/${canonicalTransactionReference}`;

    // Return the updated row id so we can CONFIRM a row was actually updated.
    // Approval must never proceed on an unconfirmed canonical update.
    const { data: canonicalRow, error: canonicalError } = await admin
      .from("deposits")
      .update({
        transaction_reference: canonicalTransactionReference,
        receipt_url: canonicalReceiptUrl,
      })
      .eq("id", depositId)
      .eq("status", "pending")
      .select("id")
      .single();

    if (canonicalError) {
      if (canonicalError.code === "23505") {
        // The canonical reference is already used by another deposit (caught by
        // the unique index in a race). Auto-reject as a duplicate extracted
        // reference — never credit the wallet.
        log("verifier_canonical_update_duplicate", { depositId, refLast4: maskRef(canonicalTransactionReference) });
        return await autoRejectDuplicate("duplicate_extracted_reference");
      }

      // PGRST116 (no row returned / not a single row) or any other failure:
      // the canonical update was NOT confirmed. Hold for manual review and
      // never approve.
      logError("canonical_update_failed", { depositId, code: canonicalError.code });
      await saveForManualReview(
        admin,
        depositId,
        "Verifier review: canonical reference update failed; requires manual review.",
      );
      await recordOutcome({
        event: "telebirr_manual_review",
        action: "manual_review",
        reasonCode: "canonical_reference_update_failed",
        metadata: { decision_path: "canonical_update_failed" },
      });
      return Response.json(
        { action: "manual_review", deposit_id: depositId, failures: ["canonical_reference_update_failed"] },
        { status: 500 },
      );
    }

    if (!canonicalRow?.id) {
      // No error but no row was updated (e.g. deposit no longer pending). The
      // canonical update is unconfirmed — never approve; hold for manual review.
      logError("canonical_update_no_row", { depositId });
      await saveForManualReview(
        admin,
        depositId,
        "Verifier review: canonical reference update failed; requires manual review.",
      );
      await recordOutcome({
        event: "telebirr_manual_review",
        action: "manual_review",
        reasonCode: "canonical_reference_update_failed",
        metadata: { decision_path: "canonical_update_no_row" },
      });
      return Response.json(
        { action: "manual_review", deposit_id: depositId, failures: ["canonical_reference_update_failed"] },
        { status: 500 },
      );
    }

    log("verifier_canonical_update_applied", { depositId, refLast4: maskRef(canonicalTransactionReference) });
  }

  const adminNote = `Auto-approved via TeleBirr receipt verifier. Amount: ${extractedAmount} ETB. TX: ${maskRef(canonicalTransactionReference)}. Receiver: ${sanitize(extractedReceiverName, 60)}.`;

  const { data: rpcResult, error: rpcError } = await admin.rpc("approve_deposit_tx", {
    p_deposit_id: depositId,
    p_admin_id: adminUser.id,
    p_action: "approve",
    p_admin_note: adminNote,
    p_amount: extractedAmount,
  });

  if (rpcError) {
    logError("rpc_error", { depositId, message: rpcError.message, code: rpcError.code });
    await saveForManualReview(
      admin,
      depositId,
      `Verifier review: Validation passed (${extractedAmount} ETB) but RPC approval failed. Requires manual approval.`,
    );
    await recordOutcome({
      event: "telebirr_manual_review",
      action: "manual_review",
      reasonCode: "approval_rpc_failed",
      metadata: { decision_path: "approve_rpc_error" },
    });
    return Response.json(
      { action: "manual_review", deposit_id: depositId, failures: ["rpc_failed"] },
      { status: 500 },
    );
  }

  const txResult = rpcResult as Record<string, unknown> | null;

  if (!txResult?.success) {
    const errorCode = (txResult?.error as string) ?? "unknown";
    logError("rpc_business_error", { depositId, errorCode, message: txResult?.message });

    if (errorCode === "already_reviewed") {
      return Response.json(
        { action: "skipped", deposit_id: depositId, reason: "already_reviewed" },
        { status: 409 },
      );
    }

    await saveForManualReview(
      admin,
      depositId,
      `Verifier review: Validation passed (${extractedAmount} ETB) but approval RPC returned error: ${errorCode}. Requires manual review.`,
    );
    await recordOutcome({
      event: "telebirr_manual_review",
      action: "manual_review",
      reasonCode: "approval_rpc_failed",
      metadata: { decision_path: "approve_rpc_business_error", rpc_error_code: errorCode },
    });
    return Response.json(
      { action: "manual_review", deposit_id: depositId, failures: [errorCode] },
      { status: 500 },
    );
  }

  log("verifier_deposit_approved", {
    depositId,
    amount: txResult.amount,
    balanceBefore: txResult.balance_before,
    balanceAfter: txResult.balance_after,
    transactionId: txResult.transaction_id,
  });

  await admin
    .from("deposits")
    .update({ auto_verified: true, verified_at: new Date().toISOString() })
    .eq("id", depositId);

  try {
    const { error: notifError } = await admin.from("notifications").insert({
      user_id: deposit.user_id,
      title: "Deposit Approved",
      message: `Your deposit of ${extractedAmount} ETB has been approved and credited to your wallet.`,
      metadata: {
        type: "deposit_approved",
        deposit_id: depositId,
        amount: extractedAmount,
        auto_verified: true,
      },
    });

    if (notifError) {
      logError("notification_failed", { depositId, error: notifError.message });
    }
  } catch (notifEx) {
    logError("notification_exception", {
      depositId,
      error: notifEx instanceof Error ? notifEx.message : "unknown",
    });
  }

  await recordOutcome({
    event: "telebirr_auto_approved",
    action: "approve",
    reasonCode: "telebirr_receipt_verified",
    metadata: { decision_path: "auto_approved" },
  });

  return Response.json({
    action: "approved",
    deposit_id: depositId,
    amount: extractedAmount,
    balance_before: txResult.balance_before,
    balance_after: txResult.balance_after,
    transaction_id: txResult.transaction_id,
  });
};

export const config: Config = {
  path: "/api/verifier/submit-telebirr-result",
  method: "POST",
};

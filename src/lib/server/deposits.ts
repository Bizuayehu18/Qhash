import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import type { Database, DepositStatus } from "../database.types.js";
import { throwSafe } from "../errors.js";
import { verifyCBEDeposit } from "./cbe-verify.js";
import {
  recordDepositVerificationLog,
  type RecordDepositVerificationLogInput,
  type DepositVerificationFreshness,
} from "./deposit-verification-audit.js";

const TELEBIRR_RECEIPT_BASE = "https://transactioninfo.ethiotelecom.et/receipt";
const CBE_RECEIPT_BASE = "https://apps.cbe.com.et:100";

function log(event: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      module: "deposit_submit",
      event,
      ts: new Date().toISOString(),
      ...data,
    })
  );
}

// Derive a safe, low-cardinality reason code from a CBE auto-reject admin note.
// The raw admin note for a receiver-name mismatch embeds the receipt's receiver
// name, so it must never be written to production console logs. The raw admin
// note may be stored on the deposit itself via approve_deposit_tx, but the audit
// table must only receive safe static messages and must never store raw receiver
// names — this reason code is for log output only.
function cbeRejectReasonCode(adminNote: string | null): string {
  const note = adminNote ?? "";
  if (note.includes("invalid CBE receipt link")) return "invalid_cbe_link";
  if (note.includes("duplicate CBE receipt transaction reference"))
    return "duplicate_extracted_reference";
  if (note.includes("receiver name mismatch")) return "receiver_mismatch";
  if (note.includes("unreadable CBE receipt")) return "unreadable_receipt";
  return "auto_reject";
}

// --- Audit derivation helpers ----------------------------------------------
// These derive low-cardinality, PII-free audit fields from the CBE verifier
// result for the deposit_verification_logs audit trail. They read only the
// already-computed decision (verified flag, action, generic admin note, parsed
// receipt amount) — they do NOT change any CBE verification business rule.
//
// The hold/fail admin notes are generic and carry no PII. The only admin note
// that embeds a raw receiver name is the auto-reject mismatch note, so audit
// messages are always built from static text keyed by reason_code (below),
// never from the raw admin note.

// Map a CBE manual-review (hold) admin note to a low-cardinality reason code.
function cbeManualReviewReasonCode(note: string | null): string {
  const n = note ?? "";
  if (n.includes("transaction reference missing"))
    return "cbe_transaction_id_missing";
  if (n.includes("duplicate reference check failed"))
    return "duplicate_check_failed";
  if (n.includes("duplicate transaction reference")) return "duplicate_reference";
  if (n.includes("payment date missing")) return "payment_date_missing";
  if (n.includes("payment date unparseable")) return "payment_date_unparseable";
  if (n.includes("payment date too old")) return "payment_date_too_old";
  if (n.includes("payment date is in the future")) return "payment_date_future";
  if (n.includes("could not extract amount")) return "amount_unreadable";
  if (n.includes("could not extract receiver name")) return "receiver_unreadable";
  if (n.includes("unable to fetch") || n.includes("HTTP")) return "fetch_failed";
  if (n.includes("PDF") || n.includes("unable to parse")) return "parse_failed";
  if (n.includes("payment method not found") || n.includes("account_last_8"))
    return "method_unavailable";
  if (n.includes("already reviewed")) return "already_reviewed";
  return "manual_review";
}

// Static, PII-free message for a CBE manual-review reason code.
function safeManualReviewMessage(reasonCode: string): string {
  switch (reasonCode) {
    case "cbe_transaction_id_missing":
      return "Held for review: CBE receipt transaction reference missing.";
    case "canonical_reference_update_failed":
      return "Held for review: CBE canonical reference update failed.";
    case "duplicate_check_failed":
      return "Held for review: CBE duplicate reference check failed.";
    case "duplicate_reject_rpc_failed":
      return "Duplicate CBE receipt reference detected, but auto-reject failed; held for manual review.";
    case "duplicate_reference":
      return "Held for review: duplicate CBE transaction reference.";
    case "payment_date_missing":
      return "Held for review: CBE receipt payment date missing.";
    case "payment_date_unparseable":
      return "Held for review: CBE receipt payment date unparseable.";
    case "payment_date_too_old":
      return "Held for review: CBE receipt payment date too old.";
    case "payment_date_future":
      return "Held for review: CBE receipt payment date is in the future.";
    case "amount_unreadable":
      return "Held for review: could not extract amount from CBE receipt.";
    case "receiver_unreadable":
      return "Held for review: could not extract receiver name from CBE receipt.";
    case "fetch_failed":
      return "Held for review: unable to fetch CBE receipt.";
    case "parse_failed":
      return "Held for review: unable to parse CBE receipt.";
    case "method_unavailable":
      return "Held for review: CBE payment method unavailable.";
    case "already_reviewed":
      return "Held for review: deposit already reviewed.";
    default:
      return "Held for review: CBE auto-verification could not reach a decision.";
  }
}

// Static, PII-free message for a CBE auto-reject reason code. Note the
// receiver-mismatch message here is intentionally name-free (unlike the raw
// admin note, which embeds the receipt receiver name).
function safeRejectMessage(reasonCode: string): string {
  switch (reasonCode) {
    case "invalid_cbe_link":
      return "Auto-rejected: invalid CBE receipt link or transaction reference.";
    case "duplicate_extracted_reference":
      return "Auto-rejected: duplicate CBE receipt transaction reference.";
    case "receiver_mismatch":
      return "Auto-rejected: CBE receipt receiver name did not match.";
    case "unreadable_receipt":
      return "Auto-rejected: unreadable CBE receipt.";
    default:
      return "Auto-rejected: CBE verification failed.";
  }
}

// Derive the freshness decision enum from a CBE hold admin note. Returns null
// when the note is not a freshness hold (e.g. reject, fetch/parse failures).
function cbeFreshnessFromNote(
  note: string | null
): DepositVerificationFreshness | null {
  const n = note ?? "";
  if (n.includes("payment date missing")) return "missing";
  if (n.includes("payment date unparseable")) return "unparseable";
  if (n.includes("payment date too old")) return "too_old";
  if (n.includes("payment date is in the future")) return "future";
  return null;
}

// Extract the receipt age in minutes from a "too old (N min ago)" hold note.
function cbeAgeMinutesFromNote(note: string | null): number | null {
  const m = (note ?? "").match(/\((\d+)\s*min ago\)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// receiver_matched: true once the verifier confirms a match, false on an
// explicit receiver-name mismatch reject, null when the receiver check was
// never reached.
function cbeReceiverMatched(
  verified: boolean,
  note: string | null
): boolean | null {
  if (verified) return true;
  if ((note ?? "").includes("receiver name mismatch")) return false;
  return null;
}

// Receipt-extracted amount, only when a positive value is safely available.
function safeReceiptAmount(
  amount: number | null | undefined,
  receiptAmount: number | null | undefined
): number | null {
  if (typeof amount === "number" && amount > 0) return amount;
  if (typeof receiptAmount === "number" && receiptAmount > 0) return receiptAmount;
  return null;
}

// Mask a receipt URL down to its host only. CBE receipt URLs embed the
// transaction reference + account_last_8 and act as a fetch credential, so the
// full URL must never be written to production logs.
function maskReceiptUrl(url: string | null): string | null {
  if (!url) return url;
  try {
    return new URL(url).host;
  } catch {
    return "invalid_url";
  }
}

function generateReceiptUrl(
  type: string,
  txRef: string,
  accountLast8: string | null
): string | null {
  if (type === "telebirr") {
    return `${TELEBIRR_RECEIPT_BASE}/${txRef}`;
  }
  if (type === "cbe" && accountLast8) {
    return `${CBE_RECEIPT_BASE}/?id=${txRef}${accountLast8}`;
  }
  return null;
}

export const submitDepositFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throwSafe("DEPOSIT", "Unable to process deposit. Please try again.", "Invalid request data");
    const {
      userId,
      amount,
      paymentMethodId,
      transactionReference,
    } = data as Record<string, unknown>;
    if (typeof userId !== "string" || !userId)
      throwSafe("DEPOSIT", "Unable to process deposit. Please try again.", "Missing user ID");
    if (typeof paymentMethodId !== "string" || !paymentMethodId)
      throwSafe("DEPOSIT", "Please select a payment method.", "Missing payment method ID");
    if (typeof transactionReference !== "string" || !transactionReference.trim())
      throwSafe("DEPOSIT", "Transaction ID is required.", "Missing transaction reference");

    const parsedAmount =
      typeof amount === "number" ? amount : typeof amount === "string" ? parseFloat(amount) : NaN;

    if (!isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount < 100)
      throwSafe("DEPOSIT", "Minimum deposit is 100 ETB.", "Amount below minimum: " + parsedAmount);

    return {
      userId,
      amount: !isNaN(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0,
      paymentMethodId,
      transactionReference: transactionReference.trim(),
    };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();

    log("deposit_submit_started", {
      userId: data.userId,
      paymentMethodId: data.paymentMethodId,
      transactionReference: data.transactionReference,
      amount: data.amount,
    });

    const { data: method } = await admin
      .from("payment_methods")
      .select("id, type, account_name, account_number, account_last_8, is_active")
      .eq("id", data.paymentMethodId)
      .single();

    if (!method || !method.is_active)
      throwSafe("DEPOSIT", "Selected payment method is not available.", "Payment method inactive or missing: " + data.paymentMethodId);

    log("deposit_method_loaded", {
      paymentMethodId: method.id,
      type: method.type,
      isActive: method.is_active,
    });

    if (method.type === "cbe") {
      data.transactionReference = data.transactionReference.toUpperCase();
    }

    if (method.type === "cbe" && !data.transactionReference.startsWith("FT"))
      throwSafe("DEPOSIT", 'Please enter a valid CBE transaction ID starting with "FT".', "Invalid CBE tx ref: " + data.transactionReference);
    if (method.type === "telebirr" && !data.transactionReference.startsWith("D"))
      throwSafe("DEPOSIT", 'Please enter a valid TeleBirr transaction ID starting with "D".', "Invalid TeleBirr tx ref: " + data.transactionReference);

    const { data: existing } = await admin
      .from("deposits")
      .select("id")
      .eq("transaction_reference", data.transactionReference)
      .limit(1);

    if (existing && existing.length > 0)
      throwSafe(
        "DEPOSIT",
        "This transaction ID has already been used. Please enter a unique transaction ID.",
        "Duplicate tx ref: " + data.transactionReference,
      );

    const receiptUrl = generateReceiptUrl(
      method.type,
      data.transactionReference,
      method.account_last_8 ?? null
    );

    const { data: deposit, error } = await admin
      .from("deposits")
      .insert({
        user_id: data.userId,
        amount: data.amount,
        payment_method_id: data.paymentMethodId,
        transaction_reference: data.transactionReference,
        receipt_url: receiptUrl,
        status: "pending" as DepositStatus,
      })
      .select()
      .single();

    if (error) {
      console.error("[QHash] Deposit insert error:", JSON.stringify({ message: error.message, code: error.code }));
      if (error.message?.includes("Deposits are currently paused"))
        throwSafe("DEPOSIT", "Deposits are currently paused. Please try again later.", "DB trigger: deposits paused");
      if (error.code === "23505")
        throwSafe("DEPOSIT", "This transaction ID has already been used.", "Unique constraint violation: " + error.message);
      if (error.code === "23503")
        throwSafe("DEPOSIT", "Unable to process deposit. Please try again.", "Foreign key violation: " + error.message);
      throwSafe("DEPOSIT", "Unable to process deposit. Please try again.", `DB error: ${error.message || error.code}`);
    }

    // TeleBirr: manual admin verification only.
    // Receipt URL is geo-blocked outside Ethiopia, so auto-fetch from Netlify
    // is unreliable. Admins can open the receipt URL from within Ethiopia.
    // See src/lib/server/telebirr-verify.ts for future automation via
    // Ethiopian VPS / proxy / Android bridge.
    if (method.type === "telebirr") {
      await admin
        .from("deposits")
        .update({
          auto_verified: false,
          admin_note: "TeleBirr receipt requires manual verification.",
        })
        .eq("id", deposit.id);

      log("telebirr_manual_pending", {
        depositId: deposit.id,
        transactionReference: data.transactionReference,
        receiptHost: maskReceiptUrl(receiptUrl),
      });

      return {
        ...deposit,
        autoVerified: false,
        verificationMessage: null,
      };
    }

    // CBE — attempt automatic receipt verification
    if (method.type === "cbe") {
      // Accumulate a single audit row for the authoritative CBE outcome. It is
      // written once, after the decision is final (see the recordDeposit-
      // VerificationLog call after the try/catch). Audit logging never blocks
      // or alters the deposit decision.
      const auditBase = {
        deposit_id: deposit.id,
        user_id: data.userId,
        payment_type: "cbe" as const,
        tx_ref_last4: data.transactionReference,
        actor_type: "system" as const,
        source: "cbe_auto" as const,
      };
      let auditInput: RecordDepositVerificationLogInput | null = null;

      try {
        const result = await verifyCBEDeposit({
          depositId: deposit.id,
          userId: data.userId,
          transactionReference: data.transactionReference,
          paymentMethodId: data.paymentMethodId,
          admin,
        });

        // Audit must mask the canonical (extracted) reference when one exists,
        // so tx_ref_last4 reflects the receipt's real reference, not the
        // potentially-mutated submitted one.
        if (result.canonicalReference) {
          auditBase.tx_ref_last4 = result.canonicalReference;
        }

        if (result.action === "reject") {
          // Definitive auto-reject (e.g. readable CBE invalid-link response).
          // Reject through the hardened RPC — no direct rejected update, no
          // wallet credit. Resolve an active admin actor for the RPC.
          const { data: adminUser } = await admin
            .from("profiles")
            .select("id")
            .eq("is_admin", true)
            .eq("is_frozen", false)
            .limit(1)
            .single();

          if (!adminUser) {
            await admin
              .from("deposits")
              .update({
                auto_verified: false,
                admin_note:
                  result.adminNote +
                  " (no active admin available for auto-reject; requires manual review)",
              })
              .eq("id", deposit.id)
              .eq("status", "pending");

            log("cbe_auto_reject_no_admin", { depositId: deposit.id });

            auditInput = {
              ...auditBase,
              event: "cbe_manual_review",
              action: "manual_review",
              reason_code: "no_admin_available",
              reason_message_safe:
                "Auto-reject deferred: no active admin available; held for manual review.",
              amount: safeReceiptAmount(result.amount, result.receiptData?.amount),
              receiver_matched: cbeReceiverMatched(result.verified, result.adminNote),
              metadata: { decision_path: "reject_no_admin" },
            };
          } else {
            const { data: rpcResult, error: rpcError } = await admin.rpc(
              "approve_deposit_tx",
              {
                p_deposit_id: deposit.id,
                p_admin_id: adminUser.id,
                p_action: "reject",
                p_admin_note: result.adminNote,
              }
            );

            const txResult = rpcResult as Record<string, unknown> | null;

            if (rpcError || !txResult?.success) {
              const errorCode = rpcError
                ? "rpc_failed"
                : (txResult?.error as string) ?? "unknown";

              if (!rpcError && errorCode === "already_reviewed") {
                log("cbe_auto_reject_already_reviewed", {
                  depositId: deposit.id,
                });

                auditInput = {
                  ...auditBase,
                  event: "cbe_manual_review",
                  action: "manual_review",
                  reason_code: "already_reviewed",
                  reason_message_safe:
                    "CBE auto-reject skipped: deposit already reviewed.",
                  metadata: { decision_path: "reject_already_reviewed" },
                };
              } else {
                await admin
                  .from("deposits")
                  .update({
                    auto_verified: false,
                    admin_note: `CBE auto-reject failed (${errorCode}). Requires manual review.`,
                  })
                  .eq("id", deposit.id)
                  .eq("status", "pending");

                log("cbe_auto_reject_rpc_failed", {
                  depositId: deposit.id,
                  errorCode,
                });

                auditInput = {
                  ...auditBase,
                  event: "cbe_manual_review",
                  action: "manual_review",
                  reason_code: "rpc_failed",
                  reason_message_safe:
                    "CBE auto-reject failed; held for manual review.",
                  amount: safeReceiptAmount(result.amount, result.receiptData?.amount),
                  receiver_matched: cbeReceiverMatched(result.verified, result.adminNote),
                  metadata: {
                    decision_path: "reject_rpc_failed",
                    rpc_error_code: errorCode,
                  },
                };
              }
            } else {
              // RPC set status/admin_note/reviewed_at atomically (no wallet
              // credit on reject). Flag auto-verification and stamp verified_at.
              await admin
                .from("deposits")
                .update({
                  auto_verified: true,
                  verified_at: new Date().toISOString(),
                })
                .eq("id", deposit.id);

              log("cbe_auto_reject_succeeded", {
                depositId: deposit.id,
                reasonCode: cbeRejectReasonCode(result.adminNote),
              });

              {
                const reasonCode = cbeRejectReasonCode(result.adminNote);
                auditInput = {
                  ...auditBase,
                  event: "cbe_auto_rejected",
                  action: "reject",
                  reason_code: reasonCode,
                  reason_message_safe: safeRejectMessage(reasonCode),
                  amount: safeReceiptAmount(result.amount, result.receiptData?.amount),
                  receiver_matched: cbeReceiverMatched(result.verified, result.adminNote),
                  metadata: { decision_path: "auto_rejected" },
                };
              }

              // Notification must not block rejection.
              try {
                const { error: notifError } = await admin
                  .from("notifications")
                  .insert({
                    user_id: data.userId,
                    title: "Deposit Rejected",
                    message: `Your deposit of ${deposit.amount} ETB was rejected. Please check the details and submit again.`,
                    metadata: {
                      type: "deposit_rejected",
                      deposit_id: deposit.id,
                      auto_verified: false,
                      reason: result.adminNote,
                    },
                  });
                if (notifError) {
                  log("cbe_reject_notification_failed", {
                    depositId: deposit.id,
                    error: notifError.message,
                  });
                }
              } catch (notifEx) {
                log("cbe_reject_notification_exception", {
                  depositId: deposit.id,
                  error: notifEx instanceof Error ? notifEx.message : "unknown",
                });
              }
            }
          }
        } else if (!result.verified) {
          await admin
            .from("deposits")
            .update({
              auto_verified: false,
              admin_note: result.adminNote,
            })
            .eq("id", deposit.id)
            .eq("status", "pending");

          log("cbe_auto_verification_failed", {
            depositId: deposit.id,
            reason: result.adminNote,
          });

          {
            const reasonCode = cbeManualReviewReasonCode(result.adminNote);
            auditInput = {
              ...auditBase,
              event: "cbe_manual_review",
              action: "manual_review",
              reason_code: reasonCode,
              reason_message_safe: safeManualReviewMessage(reasonCode),
              amount: safeReceiptAmount(result.amount, result.receiptData?.amount),
              receiver_matched: cbeReceiverMatched(result.verified, result.adminNote),
              freshness_decision: cbeFreshnessFromNote(result.adminNote),
              age_minutes: cbeAgeMinutesFromNote(result.adminNote),
              metadata: { decision_path: "held" },
            };
          }
        } else if (typeof result.amount !== "number" || result.amount <= 0) {
          // Verified but no usable amount — never credit without a positive amount.
          await admin
            .from("deposits")
            .update({
              auto_verified: false,
              admin_note:
                "CBE auto-verification passed but extracted amount was invalid. Requires manual review.",
            })
            .eq("id", deposit.id)
            .eq("status", "pending");

          log("cbe_auto_approval_invalid_amount", {
            depositId: deposit.id,
            amount: result.amount,
          });

          auditInput = {
            ...auditBase,
            event: "cbe_manual_review",
            action: "manual_review",
            reason_code: "invalid_amount",
            reason_message_safe:
              "CBE auto-verification passed but extracted amount was invalid; held for manual review.",
            amount: safeReceiptAmount(result.amount, result.receiptData?.amount),
            receiver_matched: true,
            freshness_decision: "fresh",
            metadata: { decision_path: "invalid_amount" },
          };
        } else {
          // Resolve an active admin actor for the hardened RPC.
          // Mirrors the TeleBirr verifier: first profile with
          // is_admin = true and is_frozen = false.
          const { data: adminUser } = await admin
            .from("profiles")
            .select("id")
            .eq("is_admin", true)
            .eq("is_frozen", false)
            .limit(1)
            .single();

          if (!adminUser) {
            await admin
              .from("deposits")
              .update({
                auto_verified: false,
                admin_note:
                  "CBE auto-verification passed but no active admin available for auto-approval. Requires manual review.",
              })
              .eq("id", deposit.id)
              .eq("status", "pending");

            log("cbe_auto_approval_no_admin", { depositId: deposit.id });

            auditInput = {
              ...auditBase,
              event: "cbe_manual_review",
              action: "manual_review",
              reason_code: "no_admin_available",
              reason_message_safe:
                "Auto-approve deferred: no active admin available; held for manual review.",
              amount: safeReceiptAmount(result.amount, result.receiptData?.amount),
              receiver_matched: true,
              freshness_decision: "fresh",
              metadata: { decision_path: "approve_no_admin" },
            };
          } else {
            // Canonicalize the pending deposit row before approval so that
            // deposits.transaction_reference holds the EXTRACTED CBE receipt
            // reference and the unique index protects against future duplicates.
            // Only needed when the submitted reference differs from the
            // extracted canonical reference (otherwise the row is already
            // canonical). On any failure we never approve and never write the
            // wallet directly.
            let approveBlocked = false;

            if (result.submittedReferenceMismatch && result.canonicalReference) {
              const canonicalReceiptUrl = generateReceiptUrl(
                "cbe",
                result.canonicalReference,
                method.account_last_8 ?? null
              );

              // transaction_reference exists on the deposits row but is absent
              // from the generated Update stub type, so the canonical payload is
              // built and cast at this boundary only. The column is still sent
              // at runtime; the cast just satisfies the incomplete stub.
              const canonicalUpdate = {
                transaction_reference: result.canonicalReference,
                receipt_url: canonicalReceiptUrl,
              } as Database["public"]["Tables"]["deposits"]["Update"];

              const { error: canonicalError } = await admin
                .from("deposits")
                .update(canonicalUpdate)
                .eq("id", deposit.id)
                .eq("status", "pending");

              if (canonicalError) {
                approveBlocked = true;

                if (canonicalError.code === "23505") {
                  // The extracted canonical reference is already used by another
                  // deposit (caught by the unique index). Auto-reject as a
                  // duplicate extracted reference through the hardened RPC —
                  // never credit the wallet.
                  const { data: rejectRpcResult, error: rejectRpcError } =
                    await admin.rpc("approve_deposit_tx", {
                      p_deposit_id: deposit.id,
                      p_admin_id: adminUser.id,
                      p_action: "reject",
                      p_admin_note:
                        "Auto-rejected: duplicate CBE receipt transaction reference.",
                    });
                  const rejectTx =
                    rejectRpcResult as Record<string, unknown> | null;

                  if (!rejectRpcError && rejectTx?.success) {
                    // Reject committed atomically (no wallet credit). Flag
                    // auto-verification and audit as a definitive auto-reject.
                    await admin
                      .from("deposits")
                      .update({
                        auto_verified: true,
                        verified_at: new Date().toISOString(),
                      })
                      .eq("id", deposit.id);

                    log("cbe_canonical_update_duplicate", {
                      depositId: deposit.id,
                    });

                    auditInput = {
                      ...auditBase,
                      event: "cbe_auto_rejected",
                      action: "reject",
                      reason_code: "duplicate_extracted_reference",
                      reason_message_safe: safeRejectMessage(
                        "duplicate_extracted_reference"
                      ),
                      amount: safeReceiptAmount(
                        result.amount,
                        result.receiptData?.amount
                      ),
                      receiver_matched: true,
                      metadata: {
                        decision_path: "canonical_update_duplicate",
                        submitted_reference_mismatch: true,
                      },
                    };
                  } else {
                    // The duplicate was detected, but the auto-reject RPC failed
                    // or returned success:false. We must NOT audit this as a
                    // rejection — the deposit was never actually rejected. Hold
                    // it pending for manual review instead, and never credit the
                    // wallet. approve_deposit_tx remains the only approve/reject
                    // path; we simply leave the row pending here.
                    const rpcErrorCode = rejectRpcError
                      ? "rpc_failed"
                      : (rejectTx?.error as string) ?? "unknown";

                    await admin
                      .from("deposits")
                      .update({
                        auto_verified: false,
                        admin_note:
                          "Duplicate CBE receipt reference detected, but auto-reject failed; held for manual review.",
                      })
                      .eq("id", deposit.id)
                      .eq("status", "pending");

                    log("cbe_canonical_update_duplicate_reject_failed", {
                      depositId: deposit.id,
                      errorCode: rpcErrorCode,
                    });

                    auditInput = {
                      ...auditBase,
                      event: "cbe_manual_review",
                      action: "manual_review",
                      reason_code: "duplicate_reject_rpc_failed",
                      reason_message_safe: safeManualReviewMessage(
                        "duplicate_reject_rpc_failed"
                      ),
                      amount: safeReceiptAmount(
                        result.amount,
                        result.receiptData?.amount
                      ),
                      receiver_matched: true,
                      metadata: {
                        decision_path: "canonical_update_duplicate_reject_failed",
                        rpc_error_code: rpcErrorCode,
                      },
                    };
                  }
                } else {
                  // Non-duplicate update failure — hold for manual review.
                  await admin
                    .from("deposits")
                    .update({
                      auto_verified: false,
                      admin_note:
                        "CBE auto-verification passed but canonical reference update failed. Requires manual review.",
                    })
                    .eq("id", deposit.id)
                    .eq("status", "pending");

                  log("cbe_canonical_update_failed", {
                    depositId: deposit.id,
                    errorCode: canonicalError.code,
                  });

                  auditInput = {
                    ...auditBase,
                    event: "cbe_manual_review",
                    action: "manual_review",
                    reason_code: "canonical_reference_update_failed",
                    reason_message_safe: safeManualReviewMessage(
                      "canonical_reference_update_failed"
                    ),
                    amount: safeReceiptAmount(
                      result.amount,
                      result.receiptData?.amount
                    ),
                    receiver_matched: true,
                    freshness_decision: "fresh",
                    metadata: {
                      decision_path: "canonical_update_failed",
                      submitted_reference_mismatch: true,
                    },
                  };
                }
              }
            }

            if (!approveBlocked) {
            const { data: rpcResult, error: rpcError } = await admin.rpc(
              "approve_deposit_tx",
              {
                p_deposit_id: deposit.id,
                p_admin_id: adminUser.id,
                p_action: "approve",
                p_admin_note: "Auto-approved via CBE receipt verification",
                p_amount: result.amount,
              }
            );

            const txResult = rpcResult as Record<string, unknown> | null;

            if (rpcError || !txResult?.success) {
              const errorCode = rpcError
                ? "rpc_failed"
                : (txResult?.error as string) ?? "unknown";

              if (!rpcError && errorCode === "already_reviewed") {
                // Deposit already approved/rejected elsewhere — do not double-credit.
                log("cbe_auto_approval_already_reviewed", {
                  depositId: deposit.id,
                });

                auditInput = {
                  ...auditBase,
                  event: "cbe_manual_review",
                  action: "manual_review",
                  reason_code: "already_reviewed",
                  reason_message_safe:
                    "CBE auto-approve skipped: deposit already reviewed.",
                  metadata: { decision_path: "approve_already_reviewed" },
                };
              } else {
                // Do NOT fall back to direct wallet writes — leave for manual review.
                await admin
                  .from("deposits")
                  .update({
                    auto_verified: false,
                    admin_note: `CBE auto-verification passed but RPC approval failed (${errorCode}). Requires manual review.`,
                  })
                  .eq("id", deposit.id)
                  .eq("status", "pending");

                log("cbe_auto_approval_rpc_failed", {
                  depositId: deposit.id,
                  errorCode,
                });

                auditInput = {
                  ...auditBase,
                  event: "cbe_manual_review",
                  action: "manual_review",
                  reason_code: "rpc_failed",
                  reason_message_safe:
                    "CBE auto-approve failed; held for manual review.",
                  amount: safeReceiptAmount(result.amount, result.receiptData?.amount),
                  receiver_matched: true,
                  freshness_decision: "fresh",
                  metadata: {
                    decision_path: "approve_rpc_failed",
                    rpc_error_code: errorCode,
                  },
                };
              }
            } else {
              // RPC already set status/amount/admin_note/reviewed_at atomically.
              // Flag auto-verification and stamp verified_at.
              await admin
                .from("deposits")
                .update({
                  auto_verified: true,
                  verified_at: new Date().toISOString(),
                })
                .eq("id", deposit.id);

              log("cbe_auto_approval_succeeded", {
                depositId: deposit.id,
                amount: result.amount,
                balanceBefore: txResult.balance_before,
                balanceAfter: txResult.balance_after,
                transactionId: txResult.transaction_id,
              });

              auditInput = {
                ...auditBase,
                event: "cbe_auto_approved",
                action: "approve",
                reason_code: "cbe_receipt_verified",
                reason_message_safe: "Auto-approved via CBE receipt verification.",
                amount: safeReceiptAmount(result.amount, result.receiptData?.amount),
                receiver_matched: true,
                freshness_decision: "fresh",
                metadata: {
                  decision_path: "auto_approved",
                  submitted_reference_mismatch:
                    result.submittedReferenceMismatch === true,
                },
              };

              // Notification must not block approval.
              try {
                const { error: notifError } = await admin
                  .from("notifications")
                  .insert({
                    user_id: data.userId,
                    title: "Deposit Approved",
                    message: `Your deposit of ${result.amount} ETB has been approved and credited to your wallet.`,
                    metadata: {
                      type: "deposit_approved",
                      deposit_id: deposit.id,
                      amount: result.amount,
                      auto_verified: true,
                    },
                  });
                if (notifError) {
                  log("cbe_notification_failed", {
                    depositId: deposit.id,
                    error: notifError.message,
                  });
                }
              } catch (notifEx) {
                log("cbe_notification_exception", {
                  depositId: deposit.id,
                  error: notifEx instanceof Error ? notifEx.message : "unknown",
                });
              }
            }
            }
          }
        }
      } catch (err) {
        log("cbe_auto_verification_error", {
          depositId: deposit.id,
          error: err instanceof Error ? err.message : "unknown",
        });

        await admin
          .from("deposits")
          .update({
            auto_verified: false,
            admin_note:
              "Auto-verification failed: unexpected error. Requires manual review.",
          })
          .eq("id", deposit.id)
          .eq("status", "pending");

        auditInput = {
          ...auditBase,
          event: "cbe_manual_review",
          action: "manual_review",
          reason_code: "unexpected_error",
          reason_message_safe:
            "CBE auto-verification error; held for manual review.",
          metadata: { decision_path: "error" },
        };
      }

      // Write the audit row for the now-final CBE outcome. This runs after the
      // authoritative decision is known and must never block or alter it:
      // recordDepositVerificationLog never throws, and the extra try/catch is a
      // belt-and-suspenders guard so a logging fault cannot break the deposit.
      if (auditInput) {
        try {
          const auditResult = await recordDepositVerificationLog(auditInput);
          if (!auditResult.ok) {
            log("cbe_audit_log_failed", {
              depositId: deposit.id,
              error: auditResult.error,
            });
          }
        } catch (auditErr) {
          log("cbe_audit_log_exception", {
            depositId: deposit.id,
            error: auditErr instanceof Error ? auditErr.message : "unknown",
          });
        }
      }

      return {
        ...deposit,
        autoVerified: false,
        verificationMessage: null,
      };
    }

    // Other payment types — generic pending flow
    return {
      ...deposit,
      autoVerified: false,
      verificationMessage: null,
    };
  });

export const getUserDepositsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throwSafe("DEPOSIT", "Unable to load deposits.", "Invalid request data");
    const { userId } = data as Record<string, unknown>;
    if (typeof userId !== "string" || !userId)
      throwSafe("DEPOSIT", "Unable to load deposits.", "Missing user ID");
    return { userId };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();
    const { data: deposits, error } = await admin
      .from("deposits")
      .select(
        "id, amount, status, transaction_reference, receipt_url, created_at, payment_method_id"
      )
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throwSafe("DEPOSIT", "Failed to load deposits.", `DB error: ${error.message}`);

    const methodIds = [...new Set((deposits ?? []).map((d) => d.payment_method_id))];
    let methods: Array<{ id: string; type: string; account_name: string }> = [];
    if (methodIds.length > 0) {
      const { data: m } = await admin
        .from("payment_methods")
        .select("id, type, account_name")
        .in("id", methodIds);
      methods = m ?? [];
    }

    return (deposits ?? []).map((d) => {
      const method = methods.find((m) => m.id === d.payment_method_id);
      return {
        ...d,
        method_type: method?.type ?? "unknown",
        method_name: method?.account_name ?? "Unknown",
      };
    });
  });

export const getAdminDepositsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throwSafe("ADMIN", "Failed to load deposits.", "Invalid request data");
    const { userId, statusFilter } = data as Record<string, unknown>;
    if (typeof userId !== "string" || !userId)
      throwSafe("ADMIN", "Failed to load deposits.", "Missing user ID");
    return {
      userId,
      statusFilter:
        typeof statusFilter === "string" ? statusFilter : undefined,
    };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", data.userId)
      .single();
    if (!profile?.is_admin) throwSafe("ADMIN", "Unauthorized.", "Non-admin user attempted admin deposits access");

    let query = admin
      .from("deposits")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (data.statusFilter && data.statusFilter !== "all") {
      query = query.eq("status", data.statusFilter as DepositStatus);
    }

    const { data: deposits, error } = await query;
    if (error) throwSafe("ADMIN", "Failed to load deposits.", `DB error: ${error.message}`);

    const userIds = [...new Set((deposits ?? []).map((d) => d.user_id))];
    const methodIds = [
      ...new Set((deposits ?? []).map((d) => d.payment_method_id)),
    ];

    let profiles: Array<{ id: string; username: string; phone: string }> = [];
    if (userIds.length > 0) {
      const { data: p } = await admin
        .from("profiles")
        .select("id, username, phone")
        .in("id", userIds);
      profiles = p ?? [];
    }

    let methods: Array<{
      id: string;
      type: string;
      account_name: string;
      account_number: string;
      account_last_8: string | null;
    }> = [];
    if (methodIds.length > 0) {
      const { data: m } = await admin
        .from("payment_methods")
        .select("id, type, account_name, account_number, account_last_8")
        .in("id", methodIds);
      methods = (m ?? []) as typeof methods;
    }

    return (deposits ?? []).map((d) => {
      const prof = profiles.find((p) => p.id === d.user_id);
      const method = methods.find((m) => m.id === d.payment_method_id);

      const receiptUrl =
        d.receipt_url ??
        (method
          ? generateReceiptUrl(
              method.type,
              d.transaction_reference,
              method.account_last_8
            )
          : null);

      return {
        ...d,
        receipt_url: receiptUrl,
        username: prof?.username ?? "Unknown",
        phone: prof?.phone ?? "",
        method_type: method?.type ?? "unknown",
        method_account: method?.account_name ?? "Unknown",
        method_number: method?.account_number ?? "",
      };
    });
  });


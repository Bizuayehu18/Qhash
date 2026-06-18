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

function maskTransactionReference(ref: string | null | undefined): string | null {
  if (!ref) return null;
  return "****" + ref.slice(-4);
}

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

function parseOptionalDepositAmount(amount: unknown): number {
  if (amount === undefined || amount === null || amount === "") return 0;

  if (typeof amount === "number") {
    if (!Number.isFinite(amount) || amount < 0) {
      throwSafe(
        "DEPOSIT",
        "Enter a deposit amount above 0 ETB, or leave it blank.",
        "Invalid deposit amount: " + String(amount),
      );
    }
    return amount;
  }

  if (typeof amount === "string") {
    const trimmedAmount = amount.trim();
    if (trimmedAmount.length === 0) return 0;

    const amountValue = Number(trimmedAmount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      throwSafe(
        "DEPOSIT",
        "Enter a deposit amount above 0 ETB, or leave it blank.",
        "Invalid deposit amount: " + trimmedAmount,
      );
    }

    return amountValue;
  }

  throwSafe(
    "DEPOSIT",
    "Enter a valid deposit amount, or leave it blank.",
    "Invalid deposit amount type: " + typeof amount,
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

async function getActiveAdminId(admin: ReturnType<typeof getAdminClient>): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("is_admin", true)
    .eq("is_frozen", false)
    .limit(1)
    .single();

  return data?.id ?? null;
}

async function recordAudit(input: RecordDepositVerificationLogInput | null) {
  if (!input) return;

  try {
    const result = await recordDepositVerificationLog(input);
    if (!result.ok) {
      log("deposit_audit_log_failed", {
        depositId: input.deposit_id,
        error: result.error,
      });
    }
  } catch (err) {
    log("deposit_audit_log_exception", {
      depositId: input.deposit_id,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

async function notifyDepositApproved(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  depositId: string,
  amount: number,
  autoVerified: boolean,
) {
  try {
    const { error } = await admin.from("notifications").insert({
      user_id: userId,
      title: "Deposit Approved",
      message: `Your deposit of ${amount} ETB has been approved and credited to your wallet.`,
      metadata: {
        type: "deposit_approved",
        deposit_id: depositId,
        amount,
        auto_verified: autoVerified,
      },
    });

    if (error) {
      log("deposit_approval_notification_failed", { depositId, error: error.message });
    }
  } catch (err) {
    log("deposit_approval_notification_exception", {
      depositId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

// amount here is the user-submitted deposit amount (deposit.amount), which is
// optional and frequently 0 — CBE auto-rejects never carry a verified receipt
// amount, since the receipt was never accepted. When amount is not a positive
// number, the message omits the figure entirely instead of showing "0 ETB".
async function notifyDepositRejected(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  depositId: string,
  amount: number,
  reason: string | null,
) {
  try {
    const hasAmount = typeof amount === "number" && Number.isFinite(amount) && amount > 0;
    const message = hasAmount
      ? `Your deposit of ${amount} ETB was rejected. Please check the details and submit again.`
      : "Your deposit was rejected. Please check the details and submit again.";

    const { error } = await admin.from("notifications").insert({
      user_id: userId,
      title: "Deposit Rejected",
      message,
      metadata: {
        type: "deposit_rejected",
        deposit_id: depositId,
        auto_verified: true,
        amount: hasAmount ? amount : null,
        reason,
      },
    });

    if (error) {
      log("deposit_rejection_notification_failed", { depositId, error: error.message });
    }
  } catch (err) {
    log("deposit_rejection_notification_exception", {
      depositId,
      error: err instanceof Error ? err.message : "unknown",
    });
  }
}

export const submitDepositFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") {
      throwSafe(
        "DEPOSIT",
        "Unable to process deposit. Please try again.",
        "Invalid request data",
      );
    }

    const {
      accessToken,
      amount,
      paymentMethodId,
      transactionReference,
    } = data as Record<string, unknown>;

    if (typeof accessToken !== "string" || !accessToken) {
      throwSafe("DEPOSIT", "Unable to submit deposit.", "Missing access token");
    }

    if (typeof paymentMethodId !== "string" || !paymentMethodId) {
      throwSafe("DEPOSIT", "Please select a payment method.", "Missing payment method ID");
    }

    if (typeof transactionReference !== "string" || !transactionReference.trim()) {
      throwSafe("DEPOSIT", "Transaction ID is required.", "Missing transaction reference");
    }

    return {
      accessToken,
      amount: parseOptionalDepositAmount(amount),
      paymentMethodId,
      transactionReference: transactionReference.trim(),
    };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();

    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(data.accessToken);
    if (authError || !authUser) {
      throwSafe("DEPOSIT", "Unable to submit deposit.", "Invalid or expired access token");
    }

    const authUserId = authUser.id;

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("is_frozen")
      .eq("id", authUserId)
      .single();

    if (profileError || !profile || profile.is_frozen === true) {
      throwSafe("DEPOSIT", "Unable to submit deposit.", "Account is frozen or unavailable");
    }

    log("deposit_submit_started", {
      userId: authUserId,
      paymentMethodId: data.paymentMethodId,
      transactionReferenceLast4: maskTransactionReference(data.transactionReference),
      amount: data.amount,
    });

    const { data: method } = await admin
      .from("payment_methods")
      .select("id, type, account_name, account_number, account_last_8, is_active")
      .eq("id", data.paymentMethodId)
      .single();

    if (!method || !method.is_active) {
      throwSafe(
        "DEPOSIT",
        "Selected payment method is not available.",
        "Payment method inactive or missing: " + data.paymentMethodId,
      );
    }

    if (method.type === "cbe") {
      data.transactionReference = data.transactionReference.toUpperCase();
    }

    if (method.type === "cbe" && !data.transactionReference.startsWith("FT")) {
      throwSafe(
        "DEPOSIT",
        'Please enter a valid CBE transaction ID starting with "FT".',
        "Invalid CBE tx ref last4: " + maskTransactionReference(data.transactionReference),
      );
    }

    if (method.type === "telebirr" && !data.transactionReference.startsWith("D")) {
      throwSafe(
        "DEPOSIT",
        'Please enter a valid TeleBirr transaction ID starting with "D".',
        "Invalid TeleBirr tx ref last4: " + maskTransactionReference(data.transactionReference),
      );
    }

    const { data: existing } = await admin
      .from("deposits")
      .select("id")
      .eq("transaction_reference", data.transactionReference)
      .limit(1);

    if (existing && existing.length > 0) {
      throwSafe(
        "DEPOSIT",
        "This transaction ID has already been used. Please enter a unique transaction ID.",
        "Duplicate tx ref last4: " + maskTransactionReference(data.transactionReference),
      );
    }

    const receiptUrl = generateReceiptUrl(
      method.type,
      data.transactionReference,
      method.account_last_8 ?? null,
    );

    const { data: deposit, error } = await admin
      .from("deposits")
      .insert({
        user_id: authUserId,
        amount: data.amount,
        payment_method_id: data.paymentMethodId,
        transaction_reference: data.transactionReference,
        receipt_url: receiptUrl,
        status: "pending" as DepositStatus,
      })
      .select()
      .single();

    if (error) {
      console.error(
        "[QHash] Deposit insert error:",
        JSON.stringify({ message: error.message, code: error.code }),
      );

      if (error.message?.includes("Deposits are currently paused")) {
        throwSafe(
          "DEPOSIT",
          "Deposits are currently paused. Please try again later.",
          "DB trigger: deposits paused",
        );
      }

      if (error.code === "23505") {
        throwSafe(
          "DEPOSIT",
          "This transaction ID has already been used.",
          "Unique constraint violation: " + error.message,
        );
      }

      if (error.code === "23503") {
        throwSafe(
          "DEPOSIT",
          "Unable to process deposit. Please try again.",
          "Foreign key violation: " + error.message,
        );
      }

      throwSafe(
        "DEPOSIT",
        "Unable to process deposit. Please try again.",
        `DB error: ${error.message || error.code}`,
      );
    }

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
        transactionReferenceLast4: maskTransactionReference(data.transactionReference),
        receiptHost: maskReceiptUrl(receiptUrl),
      });

      return {
        ...deposit,
        autoVerified: false,
        verificationMessage: null,
      };
    }

    if (method.type === "cbe") {
      const auditBase = {
        deposit_id: deposit.id,
        user_id: authUserId,
        payment_type: "cbe" as const,
        tx_ref_last4: data.transactionReference,
        actor_type: "system" as const,
        source: "cbe_auto" as const,
      };

      let auditInput: RecordDepositVerificationLogInput | null = null;

      try {
        const result = await verifyCBEDeposit({
          depositId: deposit.id,
          userId: authUserId,
          transactionReference: data.transactionReference,
          paymentMethodId: data.paymentMethodId,
          admin,
        });

        if (result.canonicalReference) {
          auditBase.tx_ref_last4 = result.canonicalReference;
        }

        if (result.action === "reject") {
          // Definitive auto-reject (e.g. readable CBE invalid-link response).
          // Reject through the hardened RPC — no direct rejected update, no
          // wallet credit. Resolve an active admin actor for the RPC.
          const adminId = await getActiveAdminId(admin);

          if (!adminId) {
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
                p_admin_id: adminId,
                p_action: "reject",
                p_admin_note: result.adminNote,
              },
            );

            const txResult = rpcResult as Record<string, unknown> | null;

            if (rpcError || !txResult?.success) {
              const errorCode = rpcError
                ? "rpc_failed"
                : (txResult?.error as string) ?? "unknown";

              if (!rpcError && errorCode === "already_reviewed") {
                // Deposit already reviewed elsewhere — never overwrite its
                // final state, and never report this as a generic RPC
                // failure in the audit trail.
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

              const reasonCode = cbeRejectReasonCode(result.adminNote);

              log("cbe_auto_reject_succeeded", {
                depositId: deposit.id,
                reasonCode,
              });

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

              // Notification must not block rejection.
              await notifyDepositRejected(
                admin,
                authUserId,
                deposit.id,
                Number(deposit.amount),
                result.adminNote,
              );
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
          const adminId = await getActiveAdminId(admin);

          if (!adminId) {
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
            let approveBlocked = false;

            if (result.submittedReferenceMismatch && result.canonicalReference) {
              const canonicalReceiptUrl = generateReceiptUrl(
                "cbe",
                result.canonicalReference,
                method.account_last_8 ?? null,
              );

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
                      p_admin_id: adminId,
                      p_action: "reject",
                      p_admin_note:
                        "Auto-rejected: duplicate CBE receipt transaction reference.",
                    });

                  const rejectTx = rejectRpcResult as Record<string, unknown> | null;

                  if (!rejectRpcError && rejectTx?.success) {
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
                        "duplicate_extracted_reference",
                      ),
                      amount: safeReceiptAmount(result.amount, result.receiptData?.amount),
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
                    // wallet.
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
                        "duplicate_reject_rpc_failed",
                      ),
                      amount: safeReceiptAmount(result.amount, result.receiptData?.amount),
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
                      "canonical_reference_update_failed",
                    ),
                    amount: safeReceiptAmount(result.amount, result.receiptData?.amount),
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
                  p_admin_id: adminId,
                  p_action: "approve",
                  p_admin_note: "Auto-approved via CBE receipt verification",
                  p_amount: result.amount,
                },
              );

              const txResult = rpcResult as Record<string, unknown> | null;

              if (rpcError || !txResult?.success) {
                const errorCode = rpcError
                  ? "rpc_failed"
                  : (txResult?.error as string) ?? "unknown";

                if (!rpcError && errorCode === "already_reviewed") {
                  // Deposit already approved/rejected elsewhere — do not
                  // double-credit, and never report this as a generic RPC
                  // failure in the audit trail.
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
                await notifyDepositApproved(
                  admin,
                  authUserId,
                  deposit.id,
                  result.amount,
                  true,
                );
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

      await recordAudit(auditInput);

      return {
        ...deposit,
        autoVerified: false,
        verificationMessage: null,
      };
    }

    return {
      ...deposit,
      autoVerified: false,
      verificationMessage: null,
    };
  });

export const getUserDepositsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") {
      throwSafe("DEPOSIT", "Unable to load deposits.", "Invalid request data");
    }

    const { accessToken } = data as Record<string, unknown>;
    if (typeof accessToken !== "string" || !accessToken) {
      throwSafe("DEPOSIT", "Unable to load deposits.", "Missing access token");
    }

    return { accessToken };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();

    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(data.accessToken);
    if (authError || !authUser) {
      throwSafe("DEPOSIT", "Unable to load deposits.", "Invalid or expired access token");
    }

    const { data: deposits, error } = await admin
      .from("deposits")
      .select(
        "id, amount, status, transaction_reference, receipt_url, created_at, payment_method_id"
      )
      .eq("user_id", authUser.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      throwSafe("DEPOSIT", "Failed to load deposits.", `DB error: ${error.message}`);
    }

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
    if (!data || typeof data !== "object") {
      throwSafe("ADMIN", "Failed to load deposits.", "Invalid request data");
    }

    const { accessToken, statusFilter } = data as Record<string, unknown>;
    if (typeof accessToken !== "string" || !accessToken) {
      throwSafe("ADMIN", "Unauthorized.", "Missing access token");
    }

    return {
      accessToken,
      statusFilter:
        typeof statusFilter === "string" ? statusFilter : undefined,
    };
  })
  .handler(async ({ data }) => {
    const admin = getAdminClient();

    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(data.accessToken);
    if (authError || !authUser) {
      throwSafe("ADMIN", "Unauthorized.", "Invalid or expired access token");
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("is_admin, is_frozen")
      .eq("id", authUser.id)
      .single();

    if (!profile || profile.is_admin !== true || profile.is_frozen === true) {
      throwSafe("ADMIN", "Unauthorized.", "Non-admin or frozen admin attempted admin deposits access");
    }

    let query = admin
      .from("deposits")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (data.statusFilter && data.statusFilter !== "all") {
      query = query.eq("status", data.statusFilter as DepositStatus);
    }

    const { data: deposits, error } = await query;
    if (error) {
      throwSafe("ADMIN", "Failed to load deposits.", `DB error: ${error.message}`);
    }

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
              method.account_last_8,
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

import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import type { Database, DepositStatus } from "../database.types.js";
import { throwSafe } from "../errors.js";
import { verifyCBEDeposit } from "./cbe-verify.js";
import {
  recordDepositVerificationLog,
  type RecordDepositVerificationLogInput,
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

async function notifyDepositRejected(
  admin: ReturnType<typeof getAdminClient>,
  userId: string,
  depositId: string,
  amount: number,
  reason: string | null,
) {
  try {
    const { error } = await admin.from("notifications").insert({
      user_id: userId,
      title: "Deposit Rejected",
      message: `Your deposit of ${amount} ETB was rejected. Please check the details and submit again.`,
      metadata: {
        type: "deposit_rejected",
        deposit_id: depositId,
        auto_verified: true,
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

            auditInput = {
              ...auditBase,
              event: "cbe_manual_review",
              action: "manual_review",
              reason_code: "no_admin_available",
              reason_message_safe:
                "Auto-reject deferred: no active admin available; held for manual review.",
              amount: result.amount ?? result.receiptData?.amount ?? null,
              receiver_matched: result.verified ? true : null,
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

              await admin
                .from("deposits")
                .update({
                  auto_verified: false,
                  admin_note: `CBE auto-reject failed (${errorCode}). Requires manual review.`,
                })
                .eq("id", deposit.id)
                .eq("status", "pending");

              auditInput = {
                ...auditBase,
                event: "cbe_manual_review",
                action: "manual_review",
                reason_code: "rpc_failed",
                reason_message_safe: "CBE auto-reject failed; held for manual review.",
                amount: result.amount ?? result.receiptData?.amount ?? null,
                receiver_matched: result.verified ? true : null,
                metadata: {
                  decision_path: "reject_rpc_failed",
                  rpc_error_code: errorCode,
                },
              };
            } else {
              await admin
                .from("deposits")
                .update({
                  auto_verified: true,
                  verified_at: new Date().toISOString(),
                })
                .eq("id", deposit.id);

              auditInput = {
                ...auditBase,
                event: "cbe_auto_rejected",
                action: "reject",
                reason_code: "cbe_receipt_rejected",
                reason_message_safe: "Auto-rejected via CBE receipt verification.",
                amount: result.amount ?? result.receiptData?.amount ?? null,
                receiver_matched: result.verified ? true : null,
                metadata: { decision_path: "auto_rejected" },
              };

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

          auditInput = {
            ...auditBase,
            event: "cbe_manual_review",
            action: "manual_review",
            reason_code: "verification_failed",
            reason_message_safe:
              "Held for review: CBE auto-verification could not approve the receipt.",
            amount: result.amount ?? result.receiptData?.amount ?? null,
            receiver_matched: null,
            metadata: { decision_path: "held" },
          };
        } else if (typeof result.amount !== "number" || result.amount <= 0) {
          await admin
            .from("deposits")
            .update({
              auto_verified: false,
              admin_note:
                "CBE auto-verification passed but extracted amount was invalid. Requires manual review.",
            })
            .eq("id", deposit.id)
            .eq("status", "pending");

          auditInput = {
            ...auditBase,
            event: "cbe_manual_review",
            action: "manual_review",
            reason_code: "invalid_amount",
            reason_message_safe:
              "CBE auto-verification passed but extracted amount was invalid; held for manual review.",
            amount: result.amount ?? result.receiptData?.amount ?? null,
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

            auditInput = {
              ...auditBase,
              event: "cbe_manual_review",
              action: "manual_review",
              reason_code: "no_admin_available",
              reason_message_safe:
                "Auto-approve deferred: no active admin available; held for manual review.",
              amount: result.amount,
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

                    auditInput = {
                      ...auditBase,
                      event: "cbe_auto_rejected",
                      action: "reject",
                      reason_code: "duplicate_extracted_reference",
                      reason_message_safe:
                        "Auto-rejected: duplicate CBE receipt transaction reference.",
                      amount: result.amount,
                      receiver_matched: true,
                      metadata: {
                        decision_path: "canonical_update_duplicate",
                        submitted_reference_mismatch: true,
                      },
                    };
                  } else {
                    await admin
                      .from("deposits")
                      .update({
                        auto_verified: false,
                        admin_note:
                          "Duplicate CBE receipt reference detected, but auto-reject failed; held for manual review.",
                      })
                      .eq("id", deposit.id)
                      .eq("status", "pending");

                    auditInput = {
                      ...auditBase,
                      event: "cbe_manual_review",
                      action: "manual_review",
                      reason_code: "duplicate_reject_rpc_failed",
                      reason_message_safe:
                        "Duplicate CBE receipt reference detected, but auto-reject failed; held for manual review.",
                      amount: result.amount,
                      receiver_matched: true,
                      metadata: {
                        decision_path: "canonical_update_duplicate_reject_failed",
                      },
                    };
                  }
                } else {
                  await admin
                    .from("deposits")
                    .update({
                      auto_verified: false,
                      admin_note:
                        "CBE auto-verification passed but canonical reference update failed. Requires manual review.",
                    })
                    .eq("id", deposit.id)
                    .eq("status", "pending");

                  auditInput = {
                    ...auditBase,
                    event: "cbe_manual_review",
                    action: "manual_review",
                    reason_code: "canonical_reference_update_failed",
                    reason_message_safe:
                      "Held for review: CBE canonical reference update failed.",
                    amount: result.amount,
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

                await admin
                  .from("deposits")
                  .update({
                    auto_verified: false,
                    admin_note: `CBE auto-verification passed but RPC approval failed (${errorCode}). Requires manual review.`,
                  })
                  .eq("id", deposit.id)
                  .eq("status", "pending");

                auditInput = {
                  ...auditBase,
                  event: "cbe_manual_review",
                  action: "manual_review",
                  reason_code: "rpc_failed",
                  reason_message_safe:
                    "CBE auto-approve failed; held for manual review.",
                  amount: result.amount,
                  receiver_matched: true,
                  freshness_decision: "fresh",
                  metadata: {
                    decision_path: "approve_rpc_failed",
                    rpc_error_code: errorCode,
                  },
                };
              } else {
                await admin
                  .from("deposits")
                  .update({
                    auto_verified: true,
                    verified_at: new Date().toISOString(),
                  })
                  .eq("id", deposit.id);

                auditInput = {
                  ...auditBase,
                  event: "cbe_auto_approved",
                  action: "approve",
                  reason_code: "cbe_receipt_verified",
                  reason_message_safe: "Auto-approved via CBE receipt verification.",
                  amount: result.amount,
                  receiver_matched: true,
                  freshness_decision: "fresh",
                  metadata: {
                    decision_path: "auto_approved",
                    submitted_reference_mismatch:
                      result.submittedReferenceMismatch === true,
                  },
                };

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

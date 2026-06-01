import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import type { DepositStatus } from "../database.types.js";
import { throwSafe } from "../errors.js";
import { verifyCBEDeposit } from "./cbe-verify.js";

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
// name, so it must never be written to production console logs. The full note is
// still stored on the deposit / audit trail via approve_deposit_tx — this is for
// log output only.
function cbeRejectReasonCode(adminNote: string | null): string {
  const note = adminNote ?? "";
  if (note.includes("invalid CBE receipt link")) return "invalid_cbe_link";
  if (note.includes("receiver name mismatch")) return "receiver_mismatch";
  if (note.includes("unreadable CBE receipt")) return "unreadable_receipt";
  return "auto_reject";
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
    // TEMPORARY DIAGNOSTIC — Netlify logging smoke test (QHASH_LOG_SMOKE_20260601).
    // Proves the SSR server handler emits stdout for a real deposit, before any
    // DB work or CBE fetch. Remove in a follow-up cleanup PR.
    console.log(
      JSON.stringify({
        marker: "QHASH_LOG_SMOKE_20260601",
        source: "submitDepositFn",
        event: "handler_entered",
        ts: new Date().toISOString(),
      })
    );

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
      try {
        const result = await verifyCBEDeposit({
          depositId: deposit.id,
          userId: data.userId,
          transactionReference: data.transactionReference,
          paymentMethodId: data.paymentMethodId,
          admin,
        });

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
          } else {
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


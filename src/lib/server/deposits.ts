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
        receiptUrl,
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

        if (!result.verified) {
          await admin
            .from("deposits")
            .update({
              auto_verified: false,
              admin_note: result.adminNote,
            })
            .eq("id", deposit.id);

          log("cbe_auto_verification_failed", {
            depositId: deposit.id,
            reason: result.adminNote,
          });
        } else {
          const now = new Date().toISOString();
          await admin
            .from("deposits")
            .update({
              amount: result.amount ?? deposit.amount,
              status: "approved" as DepositStatus,
              auto_verified: true,
              verified_at: now,
              reviewed_at: now,
              admin_note: "Auto-approved via CBE receipt verification",
            })
            .eq("id", deposit.id);

          log("cbe_auto_approval_deposit_updated", {
            depositId: deposit.id,
            amount: result.amount,
          });
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
          .eq("id", deposit.id);
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


/**
 * TeleBirr Receipt Verification — ISOLATED, NOT CALLED AUTOMATICALLY.
 *
 * TeleBirr receipt URLs (transactioninfo.ethiotelecom.et) are geo-blocked
 * outside Ethiopia, so Netlify functions cannot reliably fetch them.
 * All TeleBirr deposits currently go through manual admin approval only.
 *
 * This module is preserved for future automation via:
 *   - Ethiopian VPS running a verification microservice
 *   - HTTP proxy routed through an Ethiopian IP
 *   - Android bridge / local verifier on an Ethiopian device
 *
 * To re-enable, call verifyAndApproveTeleBirrDeposit() from a service
 * that can reach ethiotelecom.et (e.g. an external verifier endpoint).
 * Do NOT call it from Netlify Functions or TanStack server functions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types.js";

const TELEBIRR_RECEIPT_BASE =
  "https://transactioninfo.ethiotelecom.et/receipt";
const RECEIPT_FETCH_TIMEOUT_MS = 15_000;

interface ReceiptData {
  transactionId: string | null;
  amount: number | null;
  receiverName: string | null;
  status: string | null;
}

export interface TeleBirrVerificationResult {
  verified: boolean;
  receiptData: ReceiptData | null;
  adminNote: string;
  receiptUrl: string;
  amount: number | null;
}

function log(event: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      module: "telebirr_verification",
      event,
      ts: new Date().toISOString(),
      ...data,
    })
  );
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "").replace(/birr$/i, "").replace(/etb$/i, "").trim();
  const m = cleaned.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (m) {
    const val = parseFloat(m[1]);
    if (!isNaN(val) && val > 0) return val;
  }
  return null;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLabelValuePairs(html: string): Map<string, string> {
  const pairs = new Map<string, string>();

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    let cellMatch;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(stripTags(cellMatch[1]));
    }
    for (let i = 0; i < cells.length - 1; i++) {
      const label = cells[i];
      const value = cells[i + 1];
      if (label && value) pairs.set(label.toLowerCase(), value);
    }
  }

  const divPairRe = /<(?:div|span|p|dt|dd|label)[^>]*>([\s\S]*?)<\/(?:div|span|p|dt|dd|label)>\s*<(?:div|span|p|dt|dd|label)[^>]*>([\s\S]*?)<\/(?:div|span|p|dt|dd|label)>/gi;
  let divMatch;
  while ((divMatch = divPairRe.exec(html)) !== null) {
    const label = stripTags(divMatch[1]);
    const value = stripTags(divMatch[2]);
    if (label && value && !pairs.has(label.toLowerCase())) {
      pairs.set(label.toLowerCase(), value);
    }
  }

  return pairs;
}

function findByLabels(pairs: Map<string, string>, labels: string[]): string | null {
  for (const label of labels) {
    const val = pairs.get(label.toLowerCase());
    if (val) return val;
  }
  return null;
}

const TX_LABELS = [
  "invoice no.", "invoice no", "invoice number",
  "transaction id", "transaction ref", "transaction reference",
  "reference", "reference no", "reference no.", "reference number",
  "tx id", "trans id",
];

const RECEIVER_LABELS = [
  "credited party name", "credited party", "credit party name", "credit party",
  "receiver name", "receiver", "recipient name", "recipient",
  "to name", "to", "credited to", "beneficiary name", "beneficiary",
  "paid to",
];

const AMOUNT_LABELS = [
  "settled amount", "amount", "total amount",
  "transaction amount", "transfer amount", "total",
  "paid amount",
];

const STATUS_LABELS = [
  "transaction status", "status", "payment status", "state",
];

function parseReceiptHtml(html: string): ReceiptData {
  const data: ReceiptData = {
    transactionId: null,
    amount: null,
    receiverName: null,
    status: null,
  };

  try {
    const json = JSON.parse(html);
    if (typeof json === "object" && json !== null) {
      data.transactionId =
        json.transactionId ??
        json.transaction_id ??
        json.txId ??
        json.reference ??
        null;
      data.receiverName =
        json.receiverName ??
        json.receiver_name ??
        json.receiver ??
        json.to ??
        json.toName ??
        json.creditParty ??
        null;
      data.status =
        json.status ?? json.transactionStatus ?? null;
      const raw =
        json.amount ?? json.transactionAmount ?? json.totalAmount ?? null;
      if (raw !== null)
        data.amount =
          typeof raw === "number" ? raw : parseAmount(String(raw));
      if (data.receiverName || data.amount) return data;
    }
  } catch {
    // Not JSON — continue with HTML parsing
  }

  const pairs = extractLabelValuePairs(html);

  data.transactionId = findByLabels(pairs, TX_LABELS);
  data.receiverName = findByLabels(pairs, RECEIVER_LABELS);
  data.status = findByLabels(pairs, STATUS_LABELS);

  const rawAmount = findByLabels(pairs, AMOUNT_LABELS);
  if (rawAmount) {
    data.amount = parseAmount(rawAmount);
  }

  if (data.transactionId || data.amount || data.receiverName || data.status) {
    return data;
  }

  const stripped = stripTags(
    html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
  );
  const kvRe = /([A-Za-z][A-Za-z\s.]{1,30}?)\s*[:：]\s*([^\n:]+)/g;
  let kvMatch;
  while ((kvMatch = kvRe.exec(stripped)) !== null) {
    const key = kvMatch[1].trim().toLowerCase();
    const value = kvMatch[2].trim();
    if (key && value && !pairs.has(key)) pairs.set(key, value);
  }

  if (!data.transactionId) data.transactionId = findByLabels(pairs, TX_LABELS);
  if (!data.receiverName) data.receiverName = findByLabels(pairs, RECEIVER_LABELS);
  if (!data.status) data.status = findByLabels(pairs, STATUS_LABELS);

  if (!data.amount) {
    const rawFallback = findByLabels(pairs, AMOUNT_LABELS);
    if (rawFallback) data.amount = parseAmount(rawFallback);
  }

  if (!data.amount) {
    const amountPatterns = [
      /(?:amount|total|settled)\s*[:：]?\s*(?:ETB\s*)?([0-9,]+(?:\.[0-9]+)?)/i,
      /(?:ETB|birr)\s+([0-9,]+(?:\.[0-9]+)?)/i,
      /([0-9,]+(?:\.[0-9]+)?)\s*(?:ETB|birr)/i,
    ];
    for (const p of amountPatterns) {
      const m = stripped.match(p);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ""));
        if (!isNaN(val) && val > 0) {
          data.amount = val;
          break;
        }
      }
    }
  }

  if (!data.receiverName) {
    const receiverPatterns = [
      /(?:credited\s+party|receiver|to|recipient|credited\s+to|beneficiary)\s*(?:name)?\s*[:：]\s*([A-Za-zሀ-፿\s]+?)(?:\n|$)/i,
    ];
    for (const p of receiverPatterns) {
      const m = stripped.match(p);
      if (m && m[1].trim().length > 1) {
        data.receiverName = m[1].trim();
        break;
      }
    }
  }

  return data;
}

function fail(
  adminNote: string,
  receiptUrl: string,
  receiptData: ReceiptData | null = null
): TeleBirrVerificationResult {
  return { verified: false, receiptData, adminNote, receiptUrl, amount: null };
}

export async function verifyAndApproveTeleBirrDeposit(params: {
  depositId: string;
  userId: string;
  transactionReference: string;
  paymentMethodId: string;
  admin: SupabaseClient<Database>;
}): Promise<TeleBirrVerificationResult> {
  const { depositId, userId, transactionReference, paymentMethodId, admin } =
    params;
  const receiptUrl = `${TELEBIRR_RECEIPT_BASE}/${transactionReference}`;

  log("telebirr_verification_started", { depositId, transactionReference });
  log("receipt_url_generated", { depositId, receiptUrl });

  // --- Fetch receipt ---
  let html: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      RECEIPT_FETCH_TIMEOUT_MS
    );
    const res = await fetch(receiptUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,am;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      log("receipt_fetch_failed", {
        depositId,
        status: res.status,
        statusText: res.statusText,
        errorCategory: "http_error",
      });
      return fail(
        `Auto-verification failed: receipt fetch returned HTTP ${res.status}`,
        receiptUrl
      );
    }
    html = await res.text();
    log("receipt_fetch_success", { depositId, contentLength: html.length });
  } catch (err) {
    const isError = err instanceof Error;
    const errName = isError ? err.name : "UnknownError";
    const errMessage = isError ? err.message : String(err);
    const errCause = isError && err.cause ? String(err.cause) : undefined;

    let errorCategory = "network_error";
    if (errName === "AbortError" || errMessage.includes("aborted")) {
      errorCategory = "timeout";
    } else if (
      errMessage.includes("ENOTFOUND") ||
      errMessage.includes("getaddrinfo") ||
      errCause?.includes("ENOTFOUND")
    ) {
      errorCategory = "dns_error";
    } else if (
      errMessage.includes("ECONNREFUSED") ||
      errMessage.includes("ECONNRESET") ||
      errMessage.includes("EPIPE") ||
      errCause?.includes("ECONNREFUSED") ||
      errCause?.includes("ECONNRESET")
    ) {
      errorCategory = "connection_error";
    } else if (
      errMessage.includes("SSL") ||
      errMessage.includes("TLS") ||
      errMessage.includes("certificate") ||
      errMessage.includes("CERT_") ||
      errCause?.includes("SSL") ||
      errCause?.includes("certificate")
    ) {
      errorCategory = "tls_error";
    }

    log("receipt_fetch_failed", {
      depositId,
      errorName: errName,
      errorMessage: errMessage,
      errorCause: errCause,
      errorCategory,
    });
    return fail(
      "Auto-verification failed: unable to fetch TeleBirr receipt from server",
      receiptUrl
    );
  }

  // --- Parse receipt ---
  let receiptData: ReceiptData;
  try {
    receiptData = parseReceiptHtml(html);
    log("receipt_parse_success", { depositId, parsed: receiptData });
  } catch (err) {
    log("receipt_parse_failed", {
      depositId,
      error: err instanceof Error ? err.message : "unknown",
    });
    return fail(
      "Auto-verification failed: unable to parse TeleBirr receipt",
      receiptUrl
    );
  }

  if (!receiptData.amount || receiptData.amount <= 0) {
    log("receipt_parse_failed", {
      depositId,
      reason: "amount missing or invalid",
      parsed: receiptData,
    });
    return fail(
      "Auto-verification failed: could not extract amount from receipt",
      receiptUrl,
      receiptData
    );
  }

  if (!receiptData.receiverName) {
    log("receipt_parse_failed", {
      depositId,
      reason: "receiver name missing",
      parsed: receiptData,
    });
    return fail(
      "Auto-verification failed: could not extract receiver name from receipt",
      receiptUrl,
      receiptData
    );
  }

  // --- Verify receiver name ---
  const { data: method } = await admin
    .from("payment_methods")
    .select("account_name")
    .eq("id", paymentMethodId)
    .eq("type", "telebirr")
    .eq("is_active", true)
    .single();

  if (!method) {
    log("receiver_mismatch", {
      depositId,
      reason: "payment method not found or inactive",
    });
    return fail(
      "Auto-verification failed: TeleBirr payment method not found or inactive",
      receiptUrl,
      receiptData
    );
  }

  const normalizedReceipt = normalizeName(receiptData.receiverName);
  const normalizedExpected = normalizeName(method.account_name);

  if (normalizedReceipt !== normalizedExpected) {
    log("receiver_mismatch", {
      depositId,
      receiptReceiver: receiptData.receiverName,
      expectedReceiver: method.account_name,
      normalizedReceipt,
      normalizedExpected,
    });
    return fail(
      `Auto-verification failed: receiver name mismatch (receipt: "${receiptData.receiverName}")`,
      receiptUrl,
      receiptData
    );
  }

  log("receiver_verified", {
    depositId,
    receiverName: receiptData.receiverName,
  });

  // --- Check duplicate ---
  const { data: dupes } = await admin
    .from("deposits")
    .select("id")
    .eq("transaction_reference", transactionReference)
    .neq("id", depositId)
    .limit(1);

  if (dupes && dupes.length > 0) {
    log("duplicate_checked", { depositId, isDuplicate: true });
    return fail(
      "Auto-verification failed: duplicate transaction reference detected",
      receiptUrl,
      receiptData
    );
  }
  log("duplicate_checked", { depositId, isDuplicate: false });

  // --- Confirm deposit is still pending (prevent race with manual admin approval) ---
  const { data: freshDeposit } = await admin
    .from("deposits")
    .select("status")
    .eq("id", depositId)
    .single();

  if (freshDeposit?.status !== "pending") {
    log("auto_verification_failed", {
      depositId,
      step: "status_check",
      currentStatus: freshDeposit?.status,
    });
    return fail(
      "Auto-verification skipped: deposit already reviewed",
      receiptUrl,
      receiptData
    );
  }

  // --- Credit wallet ---
  const receiptAmount = receiptData.amount;

  const { data: wallet, error: walletFetchError } = await admin
    .from("wallets")
    .select("balance")
    .eq("user_id", userId)
    .single();

  if (walletFetchError || !wallet) {
    log("auto_verification_failed", {
      depositId,
      step: "wallet_fetch",
      error: walletFetchError?.message,
    });
    return fail(
      "Auto-verification failed: unable to credit wallet",
      receiptUrl,
      receiptData
    );
  }

  const balance_before = Number(wallet.balance);
  const balance_after = balance_before + receiptAmount;

  const { error: walletUpdateError } = await admin
    .from("wallets")
    .update({ balance: balance_after })
    .eq("user_id", userId);

  if (walletUpdateError) {
    log("auto_verification_failed", {
      depositId,
      step: "wallet_credit",
      error: walletUpdateError.message,
    });
    return fail(
      "Auto-verification failed: unable to credit wallet",
      receiptUrl,
      receiptData
    );
  }

  log("wallet_credited", {
    depositId,
    userId,
    receiptAmount,
    balance_before,
    balance_after,
  });

  // --- Create transaction record ---
  const { error: txnError } = await admin.from("transactions").insert({
    user_id: userId,
    type: "deposit",
    amount: receiptAmount,
    status: "completed",
    balance_before,
    balance_after,
    description: `TeleBirr deposit auto-verified — ${transactionReference}`,
    reference_id: depositId,
    metadata: {
      deposit_id: depositId,
      transaction_reference: transactionReference,
      auto_verified: true,
      receipt_url: receiptUrl,
    },
  });

  if (txnError) {
    log("auto_verification_failed", {
      depositId,
      step: "transaction_create",
      error: txnError.message,
    });
    return fail(
      `Auto-verification partial: wallet credited ${receiptAmount} ETB but transaction record failed — manual review needed`,
      receiptUrl,
      receiptData
    );
  }
  log("transaction_created", { depositId });

  // --- Create notification ---
  const { error: notifError } = await admin.from("notifications").insert({
    user_id: userId,
    title: "Deposit Approved",
    message: `Your TeleBirr deposit of ${receiptAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ETB has been verified and credited to your wallet.`,
    metadata: {
      type: "deposit_approved",
      deposit_id: depositId,
      amount: receiptAmount,
      auto_verified: true,
    },
  });

  if (notifError) {
    log("notification_created", {
      depositId,
      success: false,
      error: notifError.message,
    });
  } else {
    log("notification_created", { depositId, success: true });
  }

  // --- Update deposit record ---
  const now = new Date().toISOString();
  const depositUpdatePayload = {
    amount: receiptAmount,
    status: "approved" as const,
    auto_verified: true,
    verified_at: now,
    reviewed_at: now,
    admin_note: `Auto-verified: TeleBirr receipt confirmed. Receiver: ${receiptData.receiverName}, Amount: ${receiptAmount} ETB`,
  };
  log("deposit_update_payload", { depositId, payload: depositUpdatePayload });

  const { data: depositUpdateData, error: depositUpdateError } = await admin
    .from("deposits")
    .update(depositUpdatePayload)
    .eq("id", depositId)
    .eq("status", "pending")
    .select();

  if (depositUpdateError) {
    log("deposit_update_failed", {
      depositId,
      error: depositUpdateError.message,
      code: depositUpdateError.code,
      details: depositUpdateError.details,
      hint: depositUpdateError.hint,
    });
  } else {
    log("deposit_updated", {
      depositId,
      rowsReturned: depositUpdateData?.length ?? 0,
      updatedRow: depositUpdateData?.[0] ?? null,
    });
  }

  log("auto_approved", {
    depositId,
    amount: receiptAmount,
    transactionReference,
  });

  return {
    verified: true,
    receiptData,
    adminNote: `Auto-verified: receipt confirmed. Amount: ${receiptAmount} ETB`,
    receiptUrl,
    amount: receiptAmount,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types.js";

const CBE_RECEIPT_BASE = "https://apps.cbe.com.et:100";
const RECEIPT_FETCH_TIMEOUT_MS = 15_000;

interface ReceiptData {
  transactionId: string | null;
  amount: number | null;
  receiverName: string | null;
  status: string | null;
  paymentDate: string | null;
}

export interface CBEVerificationResult {
  verified: boolean;
  // Set to "reject" only for definitive negative signals (e.g. a readable
  // CBE invalid-link response). When absent, a verified:false result means
  // "hold for manual review", not "reject".
  action?: "reject";
  receiptData: ReceiptData | null;
  adminNote: string;
  receiptUrl: string;
  amount: number | null;
}

function log(event: string, data: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      module: "cbe_verification",
      event,
      ts: new Date().toISOString(),
      ...data,
    })
  );
}

// --- Production-safe logging helpers ---------------------------------------
// These keep structured events searchable while avoiding sensitive output
// (full receipt text, unmasked receipt URLs that embed account_last_8, and
// raw receiver names). depositId remains the primary correlation key.

// Mask a transaction reference to its last 4 characters for logging.
function maskTxRef(ref: string): string {
  if (!ref) return "";
  return ref.length <= 4 ? "****" : `****${ref.slice(-4)}`;
}

// Mask a receipt URL down to its host only. The full CBE URL embeds the
// transaction reference + account_last_8 and is effectively a fetch
// credential, so it must never be logged in full.
function maskReceiptUrl(url: string): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "invalid_url";
  }
}

// Boolean/numeric summary of a parsed receipt — logged instead of the full
// ReceiptData object so receiver names and other raw fields stay out of logs.
function receiptSummary(d: ReceiptData): Record<string, unknown> {
  return {
    hasTransactionId: d.transactionId !== null,
    hasAmount: d.amount !== null && d.amount > 0,
    amount: d.amount,
    hasReceiverName: d.receiverName !== null,
    hasStatus: d.status !== null,
    hasPaymentDate: d.paymentDate !== null,
  };
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(text: string): number | null {
  const m = text.match(/([0-9]{1,3}(?:,?[0-9]{3})*(?:\.[0-9]{1,2})?)/);
  if (m) {
    const val = parseFloat(m[1].replace(/,/g, ""));
    if (!isNaN(val) && val > 0) return val;
  }
  return null;
}

// Parse a CBE-style payment date/time string into a Date.
// CBE prints local Addis Ababa time with no timezone, e.g.:
//   "5/31/2026, 8:35:00 PM"  /  "05/31/2026 20:35:00"
// Accepts M/D/YYYY or MM/DD/YYYY, an optional comma after the date, an
// HH:mm:ss time, and either 12-hour (AM/PM) or 24-hour notation. The parsed
// instant is anchored to Ethiopia's +03:00 offset. Returns null on any
// malformed/out-of-range input.
function parseCBEPaymentDate(raw: string): Date | null {
  if (!raw) return null;

  const m = raw
    .trim()
    .match(
      /^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4}),?\s+([0-9]{1,2}):([0-9]{2}):([0-9]{2})\s*([AaPp][Mm])?$/
    );
  if (!m) return null;

  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let hour = parseInt(m[4], 10);
  const minute = parseInt(m[5], 10);
  const second = parseInt(m[6], 10);
  const meridiem = m[7] ? m[7].toUpperCase() : null;

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  if (minute > 59 || second > 59) return null;

  if (meridiem) {
    // 12-hour clock: valid hours are 1..12. Handle 12 AM (= 00) and 12 PM (= 12).
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "AM") {
      if (hour === 12) hour = 0;
    } else {
      if (hour !== 12) hour += 12;
    }
  } else {
    // 24-hour clock: valid hours are 0..23.
    if (hour > 23) return null;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = `${m[3]}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+03:00`;
  const date = new Date(iso);
  if (isNaN(date.getTime())) return null;

  return date;
}

// CBE-specific regex to pull the payment date/time substring out of a larger
// block of receipt text. The known label is "Payment Date & Time".
const CBE_PAYMENT_DATE_REGEX =
  /payment\s*date(?:\s*(?:&|and|\/)\s*time)?\s*[:：]?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4},?\s+[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:\s*[AaPp][Mm])?)/i;

function extractPaymentDateFromText(text: string): string | null {
  const m = text.match(CBE_PAYMENT_DATE_REGEX);
  if (m && m[1]) return m[1].trim();
  return null;
}

function extractKeyValuePairs(text: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  const regex = /([A-Za-z][A-Za-z\s]{1,30}?)\s*[:：]\s*([^\n:]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key && value) pairs[key] = value;
  }
  return pairs;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

// Parser/debug events are noisy and can expose raw receipt content, so they
// are off by default and only emitted when CBE_PARSER_DEBUG=true is set in the
// environment. Normal production requires no env variable.
const CBE_PARSER_DEBUG = process.env.CBE_PARSER_DEBUG === "true";

const TX_LABELS = [
  "transaction id",
  "transaction ref",
  "transaction reference",
  "reference",
  "reference no",
  "reference number",
  "ft reference",
  "ft ref",
  "tx id",
  "trans id",
];

const RECEIVER_LABELS = [
  "credited account name",
  "credited account",
  "credit account name",
  "credit account",
  "receiver name",
  "receiver",
  "beneficiary name",
  "beneficiary",
  "credited to",
  "recipient name",
  "recipient",
  "to name",
  "credit party",
];

const AMOUNT_LABELS = [
  "amount",
  "total amount",
  "transaction amount",
  "transfer amount",
  "total",
  "debit amount",
  "amount birr",
  "amount etb",
];

const STATUS_LABELS = ["status", "transaction status", "state"];

const PAYMENT_DATE_LABELS = [
  "payment date & time",
  "payment date and time",
  "payment date/time",
  "payment date",
  "date & time",
  "transaction date",
  "date",
];

// Freshness policy for CBE receipts. A receipt must be recent to auto-credit;
// otherwise the deposit stays pending for manual review (no wallet credit).
const CBE_FRESHNESS_MAX_AGE_MS = 60 * 60 * 1000;
const CBE_FUTURE_SKEW_MS = 5 * 60 * 1000;

function extractFromTableRows(html: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells: string[] = [];
    let cellMatch;
    cellRegex.lastIndex = 0;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      const text = cellMatch[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&#?\w+;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text) cells.push(text);
    }
    if (cells.length >= 2) {
      const key = cells[0].replace(/[:：\s]+$/, "").toLowerCase().trim();
      const value = cells[cells.length - 1].trim();
      if (key && value && key !== value.toLowerCase()) pairs[key] = value;
    }
  }
  return pairs;
}

function extractEmbeddedJson(html: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    const block = match[1];
    const jsonPatterns = [
      /(?:window\.__\w+__|window\.\w+Data|var\s+\w+)\s*=\s*(\{[\s\S]*?\});/g,
      /JSON\.parse\s*\(\s*'(\{.*?\})'\s*\)/g,
    ];
    for (const jp of jsonPatterns) {
      let jm;
      jp.lastIndex = 0;
      while ((jm = jp.exec(block)) !== null) {
        try {
          const obj = JSON.parse(jm[1]);
          if (typeof obj === "object" && obj !== null) {
            for (const [k, v] of Object.entries(obj)) {
              if (typeof v === "string" || typeof v === "number") {
                pairs[k.toLowerCase().replace(/_/g, " ")] = String(v);
              }
            }
          }
        } catch {
          // not valid JSON
        }
      }
    }
  }
  return pairs;
}

function extractByLineProximity(stripped: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  const lines = stripped.split("\n").map((l) => l.trim()).filter(Boolean);
  const allLabels = [...TX_LABELS, ...RECEIVER_LABELS, ...AMOUNT_LABELS, ...STATUS_LABELS];

  for (let i = 0; i < lines.length - 1; i++) {
    const lineLower = lines[i].toLowerCase().replace(/[:：\s]+$/, "").trim();
    for (const label of allLabels) {
      if (lineLower === label || lineLower.endsWith(label)) {
        const nextLine = lines[i + 1];
        if (nextLine && !allLabels.includes(nextLine.toLowerCase().replace(/[:：\s]+$/, "").trim())) {
          if (!pairs[label]) pairs[label] = nextLine;
        }
        break;
      }
    }
  }
  return pairs;
}

function resolveFromPairs(
  data: ReceiptData,
  pairs: Record<string, string>,
  source: string
): void {
  if (!data.transactionId) {
    for (const key of TX_LABELS) {
      if (pairs[key]) {
        data.transactionId = pairs[key];
        if (CBE_PARSER_DEBUG) log("parser_match", { source, field: "transactionId", key, value: pairs[key] });
        break;
      }
    }
  }

  if (!data.receiverName) {
    for (const key of RECEIVER_LABELS) {
      if (pairs[key]) {
        data.receiverName = pairs[key];
        if (CBE_PARSER_DEBUG) log("parser_match", { source, field: "receiverName", key, value: pairs[key] });
        break;
      }
    }
  }

  if (!data.amount) {
    for (const key of AMOUNT_LABELS) {
      if (pairs[key]) {
        const parsed = parseAmount(pairs[key]);
        if (parsed !== null) {
          data.amount = parsed;
          if (CBE_PARSER_DEBUG) log("parser_match", { source, field: "amount", key, raw: pairs[key], parsed });
          break;
        }
      }
    }
  }

  if (!data.status) {
    for (const key of STATUS_LABELS) {
      if (pairs[key]) {
        data.status = pairs[key];
        break;
      }
    }
  }

  if (!data.paymentDate) {
    for (const key of PAYMENT_DATE_LABELS) {
      if (pairs[key]) {
        data.paymentDate = pairs[key];
        if (CBE_PARSER_DEBUG) log("parser_match", { source, field: "paymentDate", key, value: pairs[key] });
        break;
      }
    }
  }
}

function parseCBEReceiptFromText(text: string): ReceiptData {
  const data: ReceiptData = {
    transactionId: null,
    amount: null,
    receiverName: null,
    status: null,
    paymentDate: null,
  };

  if (CBE_PARSER_DEBUG) {
    const allLabels = [...RECEIVER_LABELS, ...AMOUNT_LABELS, ...TX_LABELS];
    const found: string[] = [];
    for (const label of allLabels) {
      if (text.toLowerCase().includes(label)) found.push(label);
    }
    log("pdf_parser_labels_found", { labels: found });
  }

  // Strategy 1: Colon-separated key:value pairs
  const colonPairs = extractKeyValuePairs(text);
  if (CBE_PARSER_DEBUG && Object.keys(colonPairs).length > 0) {
    log("pdf_parser_debug_colon", { keys: Object.keys(colonPairs).slice(0, 20) });
  }
  resolveFromPairs(data, colonPairs, "pdf_colon_kv");

  // Strategy 2: Line-proximity matching
  if (!data.amount || !data.receiverName) {
    const linePairs = extractByLineProximity(text);
    if (CBE_PARSER_DEBUG && Object.keys(linePairs).length > 0) {
      log("pdf_parser_debug_lineprox", { keys: Object.keys(linePairs).slice(0, 20) });
    }
    resolveFromPairs(data, linePairs, "pdf_line_proximity");
  }

  // Strategy 3: Regex fallbacks for amount
  if (!data.amount) {
    const amountPatterns = [
      /(?:amount|total)\s*[:：]?\s*(?:ETB\s*)?([0-9,]+(?:\.[0-9]+)?)/i,
      /(?:ETB|birr)\s+([0-9,]+(?:\.[0-9]+)?)/i,
      /([0-9,]+(?:\.[0-9]+)?)\s*(?:ETB|birr)/i,
    ];
    for (const p of amountPatterns) {
      const m = text.match(p);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ""));
        if (!isNaN(val) && val > 0) {
          data.amount = val;
          if (CBE_PARSER_DEBUG) log("parser_match", { source: "pdf_regex_amount", pattern: p.source, raw: m[0], parsed: val });
          break;
        }
      }
    }
  }

  // Strategy 4: Regex fallbacks for receiver name
  if (!data.receiverName) {
    const receiverPatterns = [
      /(?:credited?\s*account\s*name|receiver\s*name|beneficiary\s*name|recipient\s*name|credited?\s*to)\s*[:：]?\s*([A-Za-zሀ-፿][A-Za-zሀ-፿ ]*?[A-Za-zሀ-፿])(?=\s*(?:Account|A\/C|\d|\n|$))/i,
      /(?:receiver|beneficiary|recipient)\s*[:：]?\s*([A-Za-zሀ-፿][A-Za-zሀ-፿ ]*?[A-Za-zሀ-፿])(?=\s*(?:Account|A\/C|\d|\n|$))/i,
    ];
    for (const p of receiverPatterns) {
      const m = text.match(p);
      if (m && m[1].trim().length > 1) {
        data.receiverName = m[1].trim();
        if (CBE_PARSER_DEBUG) log("parser_match", { source: "pdf_regex_receiver", pattern: p.source, value: data.receiverName });
        break;
      }
    }
  }

  // Strategy 5: CBE-specific regex fallback for payment date/time
  if (!data.paymentDate) {
    const pd = extractPaymentDateFromText(text);
    if (pd) {
      data.paymentDate = pd;
      if (CBE_PARSER_DEBUG) log("parser_match", { source: "pdf_regex_payment_date", value: pd });
    }
  }

  return data;
}

function parseCBEReceipt(html: string): ReceiptData {
  const data: ReceiptData = {
    transactionId: null,
    amount: null,
    receiverName: null,
    status: null,
    paymentDate: null,
  };

  // --- Strategy 0: Try raw JSON response ---
  try {
    const json = JSON.parse(html);
    if (typeof json === "object" && json !== null) {
      data.transactionId =
        json.transactionId ??
        json.transaction_id ??
        json.txId ??
        json.reference ??
        json.ft_reference ??
        null;
      data.receiverName =
        json.receiverName ??
        json.receiver_name ??
        json.receiver ??
        json.to ??
        json.toName ??
        json.creditParty ??
        json.credit_account_name ??
        json.beneficiary ??
        json.beneficiary_name ??
        null;
      data.status =
        json.status ?? json.transactionStatus ?? json.transaction_status ?? null;
      data.paymentDate =
        json.paymentDate ??
        json.payment_date ??
        json.paymentDateTime ??
        json.payment_date_time ??
        json.transactionDate ??
        json.transaction_date ??
        json.date ??
        null;
      const raw =
        json.amount ?? json.transactionAmount ?? json.totalAmount ?? json.transfer_amount ?? null;
      if (raw !== null)
        data.amount =
          typeof raw === "number" ? raw : parseAmount(String(raw));
      // The JSON gave us the core fields, but paymentDate is frequently not a
      // JSON field (it lives in the receipt body as "Payment Date & Time ...").
      // Only short-circuit when there is nothing left to find; otherwise fall
      // through so the text/regex fallbacks below can still extract the date.
      // The `if (!data.X)` guards in the remaining strategies prevent the
      // already-extracted amount/receiver/status/date from being overwritten.
      if ((data.receiverName || data.amount) && data.paymentDate) return data;
    }
  } catch {
    // Not JSON — continue with HTML parsing
  }

  // --- Strategy 1: Extract from HTML table rows (<tr>/<td> pairs) ---
  const tablePairs = extractFromTableRows(html);
  if (CBE_PARSER_DEBUG) {
    const tableKeys = Object.keys(tablePairs);
    log("parser_debug_table", { keyCount: tableKeys.length, keys: tableKeys.slice(0, 30) });
  }
  resolveFromPairs(data, tablePairs, "table");

  // --- Strategy 2: Extract embedded JSON from <script> tags ---
  if (!data.amount || !data.receiverName) {
    const embeddedPairs = extractEmbeddedJson(html);
    if (CBE_PARSER_DEBUG && Object.keys(embeddedPairs).length > 0) {
      log("parser_debug_embedded", { keys: Object.keys(embeddedPairs).slice(0, 20) });
    }
    resolveFromPairs(data, embeddedPairs, "embedded_json");
  }

  // --- Strategy 3: Colon-separated key:value pairs from stripped text ---
  const stripped = stripHtml(html);

  if (CBE_PARSER_DEBUG) {
    log("parser_debug_stripped", { first1000: stripped.substring(0, 1000) });
    const allLabels = [...RECEIVER_LABELS, ...AMOUNT_LABELS];
    const found: string[] = [];
    for (const label of allLabels) {
      if (stripped.toLowerCase().includes(label)) found.push(label);
    }
    log("parser_debug_labels_found", { labels: found });
  }

  if (!data.amount || !data.receiverName) {
    const colonPairs = extractKeyValuePairs(stripped);
    if (CBE_PARSER_DEBUG && Object.keys(colonPairs).length > 0) {
      log("parser_debug_colon", { keys: Object.keys(colonPairs).slice(0, 20) });
    }
    resolveFromPairs(data, colonPairs, "colon_kv");
  }

  // --- Strategy 4: Line-proximity matching (label on one line, value on next) ---
  if (!data.amount || !data.receiverName) {
    const linePairs = extractByLineProximity(stripped);
    if (CBE_PARSER_DEBUG && Object.keys(linePairs).length > 0) {
      log("parser_debug_lineprox", { keys: Object.keys(linePairs).slice(0, 20) });
    }
    resolveFromPairs(data, linePairs, "line_proximity");
  }

  // --- Strategy 5: Regex fallbacks for amount ---
  if (!data.amount) {
    const amountPatterns = [
      /(?:amount|total)\s*[:：]?\s*(?:ETB\s*)?([0-9,]+(?:\.[0-9]+)?)/i,
      /(?:ETB|birr)\s+([0-9,]+(?:\.[0-9]+)?)/i,
      /([0-9,]+(?:\.[0-9]+)?)\s*(?:ETB|birr)/i,
    ];
    for (const p of amountPatterns) {
      const m = stripped.match(p);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ""));
        if (!isNaN(val) && val > 0) {
          data.amount = val;
          if (CBE_PARSER_DEBUG) log("parser_match", { source: "regex_amount", pattern: p.source, raw: m[0], parsed: val });
          break;
        }
      }
    }
  }

  // --- Strategy 6: Regex fallbacks for receiver name ---
  if (!data.receiverName) {
    const receiverPatterns = [
      /(?:credited?\s*account\s*name|receiver\s*name|beneficiary\s*name|recipient\s*name|credited?\s*to)\s*[:：]?\s*([A-Za-zሀ-፿][A-Za-zሀ-፿ ]*?[A-Za-zሀ-፿])(?=\s*(?:Account|A\/C|\d|\n|$))/i,
      /(?:receiver|beneficiary|recipient)\s*[:：]?\s*([A-Za-zሀ-፿][A-Za-zሀ-፿ ]*?[A-Za-zሀ-፿])(?=\s*(?:Account|A\/C|\d|\n|$))/i,
    ];
    for (const p of receiverPatterns) {
      const m = stripped.match(p);
      if (m && m[1].trim().length > 1) {
        data.receiverName = m[1].trim();
        if (CBE_PARSER_DEBUG) log("parser_match", { source: "regex_receiver", pattern: p.source, value: data.receiverName });
        break;
      }
    }
  }

  // --- Strategy 7: CBE-specific regex fallback for payment date/time ---
  if (!data.paymentDate) {
    const pd = extractPaymentDateFromText(stripped) ?? extractPaymentDateFromText(html);
    if (pd) {
      data.paymentDate = pd;
      if (CBE_PARSER_DEBUG) log("parser_match", { source: "regex_payment_date", value: pd });
    }
  }

  return data;
}

function fail(
  adminNote: string,
  receiptUrl: string,
  receiptData: ReceiptData | null = null
): CBEVerificationResult {
  return { verified: false, receiptData, adminNote, receiptUrl, amount: null };
}

// Definitive auto-reject result. Unlike fail(), this carries action:"reject"
// so the caller rejects the deposit (no wallet credit) instead of holding it
// for manual review.
function reject(
  adminNote: string,
  receiptUrl: string,
  receiptData: ReceiptData | null = null
): CBEVerificationResult {
  return { verified: false, action: "reject", receiptData, adminNote, receiptUrl, amount: null };
}

// CBE returns a short, human-readable error — instead of a receipt — when the
// receipt link / transaction reference is not valid. Two known shapes:
//
//   Plain text / HTML:
//     "You Are Not Allowed to See This Data, Please Check your Link"
//   JSON:
//     {"status":"failed","message":"Receipt link is not correct. Please Check Your Link."}
//
// These are a definitive negative signal (the reference does not resolve to a
// real receipt) and auto-reject. Note: this only covers readable responses on
// a successful (HTTP 200) fetch — HTTP/network/DNS/TLS/timeout failures are
// transient and handled separately, staying in manual review.
function isInvalidCBELinkResponse(body: string): boolean {
  // JSON shape: status "failed" + "Receipt link is not correct" message.
  try {
    const json = JSON.parse(body);
    if (json && typeof json === "object") {
      const status = String((json as Record<string, unknown>).status ?? "").toLowerCase();
      const message = String((json as Record<string, unknown>).message ?? "").toLowerCase();
      if (status === "failed" && message.includes("receipt link is not correct")) {
        return true;
      }
    }
  } catch {
    // Not JSON — fall through to the plain text / HTML checks below.
  }

  // Plain text / HTML shape.
  const text = body.toLowerCase();
  if (
    text.includes("you are not allowed to see this data") ||
    text.includes("please check your link")
  ) {
    return true;
  }

  return false;
}

export async function verifyCBEDeposit(params: {
  depositId: string;
  userId: string;
  transactionReference: string;
  paymentMethodId: string;
  admin: SupabaseClient<Database>;
}): Promise<CBEVerificationResult> {
  const { depositId, transactionReference: rawTxRef, paymentMethodId, admin } =
    params;
  const transactionReference = rawTxRef.trim().toUpperCase();

  log("verification_started", { depositId, txRefLast4: maskTxRef(transactionReference) });

  const { data: method } = await admin
    .from("payment_methods")
    .select("account_name, account_last_8")
    .eq("id", paymentMethodId)
    .eq("type", "cbe")
    .eq("is_active", true)
    .single();

  if (!method) {
    log("verification_failed", {
      depositId,
      reason: "payment method not found or inactive",
    });
    return fail(
      "Auto-verification failed: CBE payment method not found or inactive",
      ""
    );
  }

  if (!method.account_last_8) {
    log("verification_failed", {
      depositId,
      reason: "account_last_8 missing on payment method",
    });
    return fail(
      "Auto-verification failed: CBE payment method missing account_last_8",
      ""
    );
  }

  const receiptUrl = `${CBE_RECEIPT_BASE}/?id=${transactionReference}${method.account_last_8}`;
  log("receipt_url_generated", {
    depositId,
    receiptHost: maskReceiptUrl(receiptUrl),
    txRefLast4: maskTxRef(transactionReference),
  });

  // --- Fetch receipt ---
  let responseBuffer: Buffer;
  let contentType: string;
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
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf,application/json,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,am;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) {
      // A non-200 response can still carry a readable CBE invalid-link body
      // (live testing shows references like FT26149H5 / FT26149H5HZD return
      // the "Please Check your Link" message under a non-200 status). Safely
      // read the body and, if it matches a known invalid-link message,
      // auto-reject. Otherwise — including when the body cannot be read — keep
      // the existing manual-review fail behavior. Transient HTTP failures must
      // never auto-reject on their own.
      const errContentType = res.headers.get("content-type") || "";
      let errBody: string | null = null;
      try {
        errBody = Buffer.from(await res.arrayBuffer()).toString("utf-8");
      } catch {
        errBody = null;
      }

      if (errBody !== null && isInvalidCBELinkResponse(errBody)) {
        log("invalid_link_detected", {
          depositId,
          status: res.status,
          contentType: errContentType,
        });
        return reject(
          "Auto-rejected: invalid CBE receipt link or transaction reference.",
          receiptUrl
        );
      }

      log("receipt_fetch_failed", {
        depositId,
        status: res.status,
        statusText: res.statusText,
        errorCategory: "http_error",
      });
      return fail(
        `Auto-verification failed: CBE receipt fetch returned HTTP ${res.status}`,
        receiptUrl
      );
    }
    contentType = res.headers.get("content-type") || "";
    responseBuffer = Buffer.from(await res.arrayBuffer());
    log("receipt_fetch_success", { depositId, contentLength: responseBuffer.length, contentType });
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
      "Auto-verification failed: unable to fetch CBE receipt from server",
      receiptUrl
    );
  }

  // --- Detect PDF vs HTML/JSON ---
  const isPdf =
    contentType.includes("application/pdf") ||
    responseBuffer.subarray(0, 5).toString("ascii").startsWith("%PDF");

  // --- Parse receipt ---
  let receiptData: ReceiptData;

  if (isPdf) {
    log("pdf_detected", { depositId, contentType, bufferLength: responseBuffer.length });

    let extractedText: string;
    try {
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(responseBuffer), { mergePages: true });

      if (CBE_PARSER_DEBUG) {
        log("pdf_text_extract_raw_shape", {
          depositId,
          typeofText: typeof result.text,
          isArray: Array.isArray(result.text),
          topLevelKeys: Object.keys(result),
        });
      }

      extractedText = result.text;

      log("pdf_text_extract_success", {
        depositId,
        textLength: extractedText.length,
      });
    } catch (err) {
      log("pdf_text_extract_failed", {
        depositId,
        error: err instanceof Error ? err.message : "unknown",
      });
      return fail(
        "Auto-verification failed: unable to extract text from PDF receipt",
        receiptUrl
      );
    }

    if (!extractedText.trim()) {
      log("pdf_text_extract_failed", { depositId, reason: "empty text after extraction" });
      return fail(
        "Auto-verification failed: PDF receipt contained no extractable text",
        receiptUrl
      );
    }

    try {
      receiptData = parseCBEReceiptFromText(extractedText);
      log("receipt_parse_success", { depositId, strategy: "pdf", parsed: receiptSummary(receiptData) });
    } catch (err) {
      log("receipt_parse_failed", {
        depositId,
        strategy: "pdf",
        error: err instanceof Error ? err.message : "unknown",
      });
      return fail(
        "Auto-verification failed: unable to parse PDF receipt text",
        receiptUrl
      );
    }
  } else {
    // Fallback: HTML/JSON parsing
    const html = responseBuffer.toString("utf-8");
    log("html_detected", { depositId, contentType, contentLength: html.length });

    // Detect readable CBE invalid-link responses before attempting to parse a
    // receipt. These mean the link/reference does not resolve to a real
    // receipt and are auto-rejected (vs. transient fetch failures, which are
    // never auto-rejected).
    if (isInvalidCBELinkResponse(html)) {
      log("invalid_link_detected", {
        depositId,
        contentType,
      });
      return reject(
        "Auto-rejected: invalid CBE receipt link or transaction reference.",
        receiptUrl
      );
    }

    try {
      receiptData = parseCBEReceipt(html);
      log("receipt_parse_success", { depositId, strategy: "html", parsed: receiptSummary(receiptData) });
    } catch (err) {
      log("receipt_parse_failed", {
        depositId,
        strategy: "html",
        error: err instanceof Error ? err.message : "unknown",
      });
      return fail(
        "Auto-verification failed: unable to parse CBE receipt",
        receiptUrl
      );
    }
  }

  // Grouped readable-but-empty check. The receipt was successfully fetched,
  // read, and parsed into ReceiptData, yet none of the three core fields could
  // be extracted — a definitive signal that this is not a usable receipt, so
  // auto-reject. This runs before the individual amount/receiver/date failure
  // handling below (each of which stays in manual review on its own). It does
  // NOT cover PDF extraction failures, empty PDF text, parse exceptions, or
  // HTTP/network errors — those return earlier as manual-review fail()s.
  if (
    !receiptData.amount &&
    !receiptData.receiverName &&
    !receiptData.paymentDate
  ) {
    log("receipt_unreadable", {
      depositId,
      reason: "no amount, receiver, or payment date extracted",
      parsed: receiptSummary(receiptData),
    });
    return reject(
      "Auto-rejected: unreadable CBE receipt; no amount, receiver, or payment date could be extracted.",
      receiptUrl,
      receiptData
    );
  }

  if (!receiptData.amount || receiptData.amount <= 0) {
    log("receipt_parse_failed", {
      depositId,
      reason: "amount missing or invalid",
      parsed: receiptSummary(receiptData),
    });
    return fail(
      "Auto-verification failed: could not extract amount from CBE receipt",
      receiptUrl,
      receiptData
    );
  }

  if (!receiptData.receiverName) {
    log("receipt_parse_failed", {
      depositId,
      reason: "receiver name missing",
      parsed: receiptSummary(receiptData),
    });
    return fail(
      "Auto-verification failed: could not extract receiver name from CBE receipt",
      receiptUrl,
      receiptData
    );
  }

  // --- Verify receiver name matches payment method ---
  const normalizedReceipt = normalizeName(receiptData.receiverName);
  const normalizedExpected = normalizeName(method.account_name);

  if (normalizedReceipt !== normalizedExpected) {
    log("receiver_mismatch", {
      depositId,
      receiverMatched: false,
    });
    return reject(
      `Auto-rejected: receiver name mismatch (receipt: "${receiptData.receiverName}").`,
      receiptUrl,
      receiptData
    );
  }

  log("receiver_verified", {
    depositId,
    receiverMatched: true,
  });

  // --- Check duplicate transaction reference ---
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
    log("verification_skipped", {
      depositId,
      reason: "deposit already reviewed",
      currentStatus: freshDeposit?.status,
    });
    return fail(
      "Auto-verification skipped: deposit already reviewed",
      receiptUrl,
      receiptData
    );
  }

  // --- Freshness gate: require a recent payment date before auto-crediting ---
  // A missing/unparseable/stale/future-dated receipt is not auto-rejected; it
  // returns verified:false so the deposit stays pending for manual review.
  if (!receiptData.paymentDate) {
    log("freshness_check", {
      depositId,
      decision: "missing",
      rawPaymentDate: null,
    });
    return fail(
      "Held for review: CBE receipt payment date missing.",
      receiptUrl,
      receiptData
    );
  }

  const parsedPaymentDate = parseCBEPaymentDate(receiptData.paymentDate);

  if (!parsedPaymentDate) {
    log("freshness_check", {
      depositId,
      decision: "unparseable",
      rawPaymentDate: receiptData.paymentDate,
    });
    return fail(
      "Held for review: CBE receipt payment date unparseable.",
      receiptUrl,
      receiptData
    );
  }

  const ageMs = Date.now() - parsedPaymentDate.getTime();
  const ageMinutes = Math.round(ageMs / 60000);

  log("payment_date_extracted", {
    depositId,
    rawPaymentDate: receiptData.paymentDate,
    ageMinutes,
  });

  if (ageMs > CBE_FRESHNESS_MAX_AGE_MS) {
    log("freshness_check", {
      depositId,
      decision: "too_old",
      rawPaymentDate: receiptData.paymentDate,
      ageMinutes,
    });
    return fail(
      `Held for review: CBE receipt payment date too old (${ageMinutes} min ago).`,
      receiptUrl,
      receiptData
    );
  }

  if (ageMs < -CBE_FUTURE_SKEW_MS) {
    log("freshness_check", {
      depositId,
      decision: "future",
      rawPaymentDate: receiptData.paymentDate,
      ageMinutes,
    });
    return fail(
      "Held for review: CBE receipt payment date is in the future.",
      receiptUrl,
      receiptData
    );
  }

  log("freshness_check", {
    depositId,
    decision: "fresh",
    rawPaymentDate: receiptData.paymentDate,
    ageMinutes,
  });

  // --- Verification passed: return extracted data only ---
  // Crediting is performed by the caller through the hardened
  // approve_deposit_tx RPC (atomic, row-locked). This function no longer
  // touches wallets/transactions/deposits/notifications directly.
  const receiptAmount = receiptData.amount;

  log("verification_succeeded", {
    depositId,
    amount: receiptAmount,
    txRefLast4: maskTxRef(transactionReference),
  });

  return {
    verified: true,
    receiptData,
    adminNote: `Auto-verified: CBE receipt confirmed. Amount: ${receiptAmount} ETB`,
    receiptUrl,
    amount: receiptAmount,
  };
}

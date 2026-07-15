import { createServerFn } from "@tanstack/react-start";
import { throwSafe } from "../errors.js";
import { getAdminClient } from "./supabase-admin.js";

const BSC_NETWORK = "BSC" as const;
const BSC_USDT_CONTRACT_ADDRESS = "0x55d398326f99059ff775485246999027b3197955";
const TRANSFER_EVENT_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const RPC_TIMEOUT_MS = 10_000;
const CANDIDATE_LIMIT = 100;
const DEFAULT_CONFIRMATION_THRESHOLD = 20;
const MAX_CONFIRMATION_THRESHOLD = 5_000;

type CandidateDepositRow = {
  id?: unknown;
  user_id?: unknown;
  address_id?: unknown;
  tx_hash?: unknown;
  event_index?: unknown;
  from_address?: unknown;
  to_address?: unknown;
  amount_raw?: unknown;
  amount_raw_text?: unknown;
  amount_usdt?: unknown;
  amount_usdt_text?: unknown;
  block_number?: unknown;
  confirmations?: unknown;
  status?: unknown;
  detected_at?: unknown;
};

type BscReceiptLog = {
  address?: unknown;
  topics?: unknown;
  data?: unknown;
  logIndex?: unknown;
  transactionHash?: unknown;
  blockNumber?: unknown;
  removed?: unknown;
};

type BscReceipt = {
  transactionHash?: unknown;
  blockNumber?: unknown;
  status?: unknown;
  logs?: unknown;
};

type BscRpcResponse = {
  result?: unknown;
  error?: { message?: unknown };
};

type ConfirmationVerificationStatus =
  | "canonical_verified"
  | "malformed_row"
  | "receipt_missing"
  | "receipt_not_successful"
  | "log_missing"
  | "log_removed"
  | "log_mismatch"
  | "block_mismatch"
  | "rpc_error";

type CandidateStatus = "detected" | "confirmed";

export type AdminBscConfirmationDryRunRow = {
  depositId: string | null;
  userId: string | null;
  addressId: string | null;
  txHash: string | null;
  eventIndex: number | null;
  storedBlockNumber: number | null;
  canonicalBlockNumber: number | null;
  storedConfirmations: number | null;
  calculatedConfirmations: number | null;
  confirmationThreshold: number;
  status: CandidateStatus | null;
  verificationStatus: ConfirmationVerificationStatus;
  wouldMarkConfirmed: boolean;
  alreadyConfirmed: boolean;
  fromAddress: string | null;
  toAddress: string | null;
  amountRaw: string | null;
  amountUsdt: string | null;
  reason: string;
};

export type AdminBscConfirmationDryRunResult = {
  dryRun: true;
  network: typeof BSC_NETWORK;
  contract: string;
  latestBlockNumber: number;
  confirmationThreshold: number;
  candidateLimit: number;
  candidateCount: number;
  resultsTruncated: boolean;
  canonicalVerifiedCount: number;
  wouldMarkConfirmedCount: number;
  alreadyConfirmedCount: number;
  belowThresholdCount: number;
  malformedRowCount: number;
  receiptMissingCount: number;
  receiptNotSuccessfulCount: number;
  logMissingCount: number;
  logRemovedCount: number;
  logMismatchCount: number;
  blockMismatchCount: number;
  rpcErrorCount: number;
  rows: AdminBscConfirmationDryRunRow[];
};

function validateInput(data: unknown): { accessToken: string; confirmationThreshold: number } {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Invalid request.", "Missing request body");
  }

  const { accessToken, confirmationThreshold } = data as Record<string, unknown>;
  const threshold = confirmationThreshold === undefined || confirmationThreshold === null || confirmationThreshold === ""
    ? DEFAULT_CONFIRMATION_THRESHOLD
    : Number(confirmationThreshold);

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throwSafe("ADMIN", "Unauthorized.", "Missing access token");
  }

  if (!Number.isSafeInteger(threshold) || threshold <= 0 || threshold > MAX_CONFIRMATION_THRESHOLD) {
    throwSafe("ADMIN", "Invalid confirmation threshold.", "BSC confirmation threshold is invalid");
  }

  return { accessToken: accessToken.trim(), confirmationThreshold: threshold };
}

async function assertAdmin(accessToken: string): Promise<void> {
  const admin = getAdminClient();
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(accessToken);

  if (error || !user) {
    throwSafe("ADMIN", "Unauthorized.", "Invalid access token");
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("is_admin, is_frozen")
    .eq("id", user.id)
    .single();

  if (profileError || !profile || profile.is_admin !== true || profile.is_frozen === true) {
    throwSafe("ADMIN", "Unauthorized.", "Admin permission required");
  }
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function toExactIntegerTextOrNull(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function toDecimalTextOrNull(value: unknown): string | null {
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function amountRawText(row: CandidateDepositRow): string | null {
  return toExactIntegerTextOrNull(row.amount_raw_text) ?? toExactIntegerTextOrNull(row.amount_raw);
}

function amountUsdtText(row: CandidateDepositRow): string | null {
  return toDecimalTextOrNull(row.amount_usdt_text) ?? toDecimalTextOrNull(row.amount_usdt);
}

function normalizeBscAddress(value: unknown): string | null {
  const address = toStringOrNull(value)?.toLowerCase() ?? null;
  return address && /^0x[a-f0-9]{40}$/.test(address) ? address : null;
}

function topicAddress(topic: unknown): string | null {
  if (typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return `0x${topic.slice(-40).toLowerCase()}`;
}

function parseHexBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function hexToSafeNumber(value: unknown): number | null {
  const parsed = parseHexBigInt(value);
  if (parsed === null) return null;
  const numberValue = Number(parsed);
  return Number.isSafeInteger(numberValue) ? numberValue : null;
}

function parseRawAmountText(value: string | null): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function normalizeStatus(value: unknown): CandidateStatus | null {
  return value === "detected" || value === "confirmed" ? value : null;
}

function rpcErrorMessage(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "RPC returned an error";
  return value.trim().slice(0, 180);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function fetchBscRpcResult<T>(rpcUrl: string, method: string, params: unknown[], requestId: number): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throwSafe("ADMIN", "BSC confirmation dry-run timed out.", "BSC RPC request timed out");
    }
    throwSafe("ADMIN", "BSC confirmation dry-run failed.", error instanceof Error ? error.message : "RPC request failed");
  } finally {
    clearTimeout(timeoutId);
  }

  let json: BscRpcResponse;
  try {
    json = (await response.json()) as BscRpcResponse;
  } catch {
    throwSafe("ADMIN", "BSC confirmation dry-run failed.", "RPC returned a non-JSON response");
  }

  if (!response.ok || json.error) {
    throwSafe("ADMIN", "BSC confirmation dry-run failed.", rpcErrorMessage(json.error?.message));
  }

  return json.result as T;
}

async function fetchLatestBlockNumber(rpcUrl: string): Promise<number> {
  const result = await fetchBscRpcResult<unknown>(rpcUrl, "eth_blockNumber", [], 1);
  const blockNumber = hexToSafeNumber(result);
  if (blockNumber === null) {
    throwSafe("ADMIN", "BSC confirmation dry-run failed.", "RPC returned invalid latest block number");
  }
  return blockNumber;
}

async function fetchReceipt(rpcUrl: string, txHash: string, requestId: number): Promise<BscReceipt | null> {
  const result = await fetchBscRpcResult<unknown>(rpcUrl, "eth_getTransactionReceipt", [txHash], requestId);
  if (result === null) return null;
  if (!result || typeof result !== "object") return null;
  return result as BscReceipt;
}

function buildMalformedRow(row: CandidateDepositRow, confirmationThreshold: number, reason: string): AdminBscConfirmationDryRunRow {
  return {
    depositId: toStringOrNull(row.id),
    userId: toStringOrNull(row.user_id),
    addressId: toStringOrNull(row.address_id),
    txHash: toStringOrNull(row.tx_hash)?.toLowerCase() ?? null,
    eventIndex: toNumberOrNull(row.event_index),
    storedBlockNumber: toNumberOrNull(row.block_number),
    canonicalBlockNumber: null,
    storedConfirmations: toNumberOrNull(row.confirmations),
    calculatedConfirmations: null,
    confirmationThreshold,
    status: normalizeStatus(row.status),
    verificationStatus: "malformed_row",
    wouldMarkConfirmed: false,
    alreadyConfirmed: false,
    fromAddress: normalizeBscAddress(row.from_address),
    toAddress: normalizeBscAddress(row.to_address),
    amountRaw: amountRawText(row),
    amountUsdt: amountUsdtText(row),
    reason,
  };
}

function verifyReceiptLog(
  row: CandidateDepositRow,
  receipt: BscReceipt | null,
  latestBlockNumber: number,
  confirmationThreshold: number,
): AdminBscConfirmationDryRunRow {
  const depositId = toStringOrNull(row.id);
  const userId = toStringOrNull(row.user_id);
  const addressId = toStringOrNull(row.address_id);
  const txHash = toStringOrNull(row.tx_hash)?.toLowerCase() ?? null;
  const eventIndex = toNumberOrNull(row.event_index);
  const fromAddress = normalizeBscAddress(row.from_address);
  const toAddress = normalizeBscAddress(row.to_address);
  const amountRaw = amountRawText(row);
  const amountRawBigInt = parseRawAmountText(amountRaw);
  const amountUsdt = amountUsdtText(row);
  const storedBlockNumber = toNumberOrNull(row.block_number);
  const storedConfirmations = toNumberOrNull(row.confirmations);
  const status = normalizeStatus(row.status);

  const baseRow: Omit<AdminBscConfirmationDryRunRow, "verificationStatus" | "reason"> = {
    depositId,
    userId,
    addressId,
    txHash,
    eventIndex,
    storedBlockNumber,
    canonicalBlockNumber: null,
    storedConfirmations,
    calculatedConfirmations: null,
    confirmationThreshold,
    status,
    wouldMarkConfirmed: false,
    alreadyConfirmed: false,
    fromAddress,
    toAddress,
    amountRaw,
    amountUsdt,
  };

  if (!depositId || !userId || !txHash || !/^0x[0-9a-f]{64}$/.test(txHash) || eventIndex === null || !fromAddress || !toAddress || !amountRaw || amountRawBigInt === null || storedBlockNumber === null || storedConfirmations === null || !status) {
    return { ...baseRow, verificationStatus: "malformed_row", reason: "Stored deposit row is missing required exact audit fields." };
  }

  if (!receipt) {
    return { ...baseRow, verificationStatus: "receipt_missing", reason: "Canonical transaction receipt was not found." };
  }

  const receiptTxHash = toStringOrNull(receipt.transactionHash)?.toLowerCase() ?? null;
  const receiptBlockNumber = hexToSafeNumber(receipt.blockNumber);
  const receiptStatus = toStringOrNull(receipt.status)?.toLowerCase() ?? null;

  if (receiptTxHash !== txHash || receiptBlockNumber === null) {
    return { ...baseRow, verificationStatus: "receipt_missing", reason: "Receipt did not match the stored transaction hash or block number." };
  }

  if (receiptStatus !== "0x1") {
    return { ...baseRow, canonicalBlockNumber: receiptBlockNumber, verificationStatus: "receipt_not_successful", reason: "Receipt was not successful." };
  }

  const logs = Array.isArray(receipt.logs) ? (receipt.logs as BscReceiptLog[]) : [];
  const matchingLog = logs.find((log) => hexToSafeNumber(log.logIndex) === eventIndex) ?? null;

  if (!matchingLog) {
    return { ...baseRow, canonicalBlockNumber: receiptBlockNumber, verificationStatus: "log_missing", reason: "Stored event index was not found in the canonical receipt." };
  }

  if (matchingLog.removed === true) {
    return { ...baseRow, canonicalBlockNumber: receiptBlockNumber, verificationStatus: "log_removed", reason: "Receipt log is marked removed." };
  }

  const topics = Array.isArray(matchingLog.topics) ? matchingLog.topics : [];
  const logContract = normalizeBscAddress(matchingLog.address);
  const logTopic0 = toStringOrNull(topics[0])?.toLowerCase() ?? null;
  const logFromAddress = topicAddress(topics[1]);
  const logToAddress = topicAddress(topics[2]);
  const logAmount = parseHexBigInt(matchingLog.data);
  const logTxHash = toStringOrNull(matchingLog.transactionHash)?.toLowerCase() ?? receiptTxHash;
  const logBlockNumber = hexToSafeNumber(matchingLog.blockNumber) ?? receiptBlockNumber;

  const logMatches =
    logContract === BSC_USDT_CONTRACT_ADDRESS &&
    logTopic0 === TRANSFER_EVENT_TOPIC &&
    logTxHash === txHash &&
    logFromAddress === fromAddress &&
    logToAddress === toAddress &&
    logAmount !== null &&
    logAmount === amountRawBigInt;

  if (!logMatches) {
    return { ...baseRow, canonicalBlockNumber: receiptBlockNumber, verificationStatus: "log_mismatch", reason: "Canonical log did not match contract, topic, sender, recipient, or raw amount." };
  }

  if (logBlockNumber !== storedBlockNumber || receiptBlockNumber !== storedBlockNumber) {
    return { ...baseRow, canonicalBlockNumber: receiptBlockNumber, verificationStatus: "block_mismatch", reason: "Canonical block number differs from the stored deposit row." };
  }

  const calculatedConfirmations = Math.max(0, latestBlockNumber - receiptBlockNumber + 1);
  const wouldMarkConfirmed = status === "detected" && calculatedConfirmations >= confirmationThreshold;
  const alreadyConfirmed = status === "confirmed";

  return {
    ...baseRow,
    canonicalBlockNumber: receiptBlockNumber,
    calculatedConfirmations,
    verificationStatus: "canonical_verified",
    wouldMarkConfirmed,
    alreadyConfirmed,
    reason: wouldMarkConfirmed
      ? "Canonical log verified and threshold reached."
      : alreadyConfirmed
        ? "Canonical log verified for an already confirmed row."
        : "Canonical log verified, but threshold is not reached yet.",
  };
}

function countRows(rows: AdminBscConfirmationDryRunRow[]): Omit<AdminBscConfirmationDryRunResult, "dryRun" | "network" | "contract" | "latestBlockNumber" | "confirmationThreshold" | "candidateLimit" | "candidateCount" | "resultsTruncated" | "rows"> {
  return {
    canonicalVerifiedCount: rows.filter((row) => row.verificationStatus === "canonical_verified").length,
    wouldMarkConfirmedCount: rows.filter((row) => row.wouldMarkConfirmed).length,
    alreadyConfirmedCount: rows.filter((row) => row.alreadyConfirmed).length,
    belowThresholdCount: rows.filter((row) => row.verificationStatus === "canonical_verified" && !row.wouldMarkConfirmed && !row.alreadyConfirmed).length,
    malformedRowCount: rows.filter((row) => row.verificationStatus === "malformed_row").length,
    receiptMissingCount: rows.filter((row) => row.verificationStatus === "receipt_missing").length,
    receiptNotSuccessfulCount: rows.filter((row) => row.verificationStatus === "receipt_not_successful").length,
    logMissingCount: rows.filter((row) => row.verificationStatus === "log_missing").length,
    logRemovedCount: rows.filter((row) => row.verificationStatus === "log_removed").length,
    logMismatchCount: rows.filter((row) => row.verificationStatus === "log_mismatch").length,
    blockMismatchCount: rows.filter((row) => row.verificationStatus === "block_mismatch").length,
    rpcErrorCount: rows.filter((row) => row.verificationStatus === "rpc_error").length,
  };
}

export const runAdminBscConfirmationDryRunFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateInput(data))
  .handler(async ({ data }): Promise<AdminBscConfirmationDryRunResult> => {
    await assertAdmin(data.accessToken);

    const rpcUrl = (process.env.BSC_RPC_URL ?? "").trim();
    if (!rpcUrl) {
      throwSafe("ADMIN", "BSC confirmation dry-run is not configured.", "Missing BSC_RPC_URL");
    }

    const admin = getAdminClient();
    const latestBlockNumber = await fetchLatestBlockNumber(rpcUrl);

    const { data: rawDeposits, error: depositError } = await admin
      .from("crypto_deposits")
      .select("id, user_id, address_id, tx_hash, event_index, from_address, to_address, amount_raw, amount_raw_text:amount_raw::text, amount_usdt, amount_usdt_text:amount_usdt::text, block_number, confirmations, status, detected_at")
      .eq("network", BSC_NETWORK)
      .eq("asset", "USDT")
      .in("status", ["detected", "confirmed"])
      .order("detected_at", { ascending: false })
      .limit(CANDIDATE_LIMIT);

    if (depositError) {
      throwSafe("ADMIN", "Unable to load BSC deposit candidates.", `DB error: ${depositError.message}`);
    }

    const candidates = (rawDeposits ?? []) as CandidateDepositRow[];
    const rows: AdminBscConfirmationDryRunRow[] = [];

    for (const [index, candidate] of candidates.entries()) {
      const txHash = toStringOrNull(candidate.tx_hash)?.toLowerCase() ?? null;
      if (!txHash || !/^0x[0-9a-f]{64}$/.test(txHash)) {
        rows.push(buildMalformedRow(candidate, data.confirmationThreshold, "Stored deposit row has an invalid transaction hash."));
        continue;
      }

      try {
        const receipt = await fetchReceipt(rpcUrl, txHash, index + 2);
        rows.push(verifyReceiptLog(candidate, receipt, latestBlockNumber, data.confirmationThreshold));
      } catch (error) {
        rows.push({
          depositId: toStringOrNull(candidate.id),
          userId: toStringOrNull(candidate.user_id),
          addressId: toStringOrNull(candidate.address_id),
          txHash,
          eventIndex: toNumberOrNull(candidate.event_index),
          storedBlockNumber: toNumberOrNull(candidate.block_number),
          canonicalBlockNumber: null,
          storedConfirmations: toNumberOrNull(candidate.confirmations),
          calculatedConfirmations: null,
          confirmationThreshold: data.confirmationThreshold,
          status: normalizeStatus(candidate.status),
          verificationStatus: "rpc_error",
          wouldMarkConfirmed: false,
          alreadyConfirmed: false,
          fromAddress: normalizeBscAddress(candidate.from_address),
          toAddress: normalizeBscAddress(candidate.to_address),
          amountRaw: amountRawText(candidate),
          amountUsdt: amountUsdtText(candidate),
          reason: error instanceof Error ? error.message : "Unable to verify canonical receipt/log.",
        });
      }
    }

    const counts = countRows(rows);

    return {
      dryRun: true,
      network: BSC_NETWORK,
      contract: BSC_USDT_CONTRACT_ADDRESS,
      latestBlockNumber,
      confirmationThreshold: data.confirmationThreshold,
      candidateLimit: CANDIDATE_LIMIT,
      candidateCount: candidates.length,
      resultsTruncated: candidates.length === CANDIDATE_LIMIT,
      ...counts,
      rows,
    };
  });

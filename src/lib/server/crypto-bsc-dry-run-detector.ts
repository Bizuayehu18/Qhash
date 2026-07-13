import { createServerFn } from "@tanstack/react-start";
import { throwSafe } from "../errors.js";
import { getAdminClient } from "./supabase-admin.js";

const BSC_NETWORK = "BSC" as const;
const BSC_USDT_CONTRACT_ADDRESS = "0x55d398326f99059ff775485246999027b3197955";
const BSC_USDT_DECIMALS = 18;
const BSC_USDT_STORAGE_DECIMALS = 6;
const TRANSFER_EVENT_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MAX_BLOCK_RANGE = 2_000;
const ADDRESS_PAGE_SIZE = 1_000;
const RECIPIENT_TOPIC_BATCH_SIZE = 200;
const MATCHED_EVENT_LIMIT = 200;
const STORAGE_PREVIEW_EVENT_LIMIT = 200;
const STORAGE_INSERT_BATCH_SIZE = 200;
const RPC_TIMEOUT_MS = 10_000;

type AdminClient = ReturnType<typeof getAdminClient>;

type BscAddressRow = {
  id?: unknown;
  user_id?: unknown;
  address?: unknown;
};

type AssignedBscAddress = {
  id: string;
  userId: string;
  address: string;
  recipientTopic: string;
};

type BscRpcLog = {
  topics?: unknown;
  data?: unknown;
  transactionHash?: unknown;
  logIndex?: unknown;
  blockNumber?: unknown;
};

type BscRpcLogsResponse = {
  result?: unknown;
  error?: {
    message?: unknown;
  };
};

type BscMatchedTransferEvent = {
  network: typeof BSC_NETWORK;
  contract: string;
  txHash: string;
  eventIndex: number;
  blockNumber: number;
  fromAddress: string;
  recipient: string;
  userId: string;
  addressId: string;
  amountRaw: string;
  amountRawBigInt: bigint;
  amountUsdt: string;
};

type BscDetectionScanResult = {
  network: typeof BSC_NETWORK;
  contract: string;
  decimals: number;
  fromBlock: number;
  toBlock: number;
  assignedAddressCount: number;
  addressPageCount: number;
  recipientTopicBatchSize: number;
  rpcBatchCount: number;
  scannedLogCount: number;
  totalMatchedEvents: number;
  matchedEventLimit: number;
  resultsTruncated: boolean;
  skippedMalformedLogs: number;
  skippedUnassignedLogs: number;
  skippedZeroAmountLogs: number;
  invalidAssignedAddressCount: number;
  matchedEvents: BscMatchedTransferEvent[];
};

type CryptoDepositInsertRow = {
  user_id: string;
  address_id: string;
  network: typeof BSC_NETWORK;
  asset: "USDT";
  tx_hash: string;
  event_index: number;
  from_address: string;
  to_address: string;
  amount_raw: string;
  amount_usdt: string;
  block_number: number;
  confirmations: 0;
  status: "detected";
  exchange_rate_etb: null;
  credited_amount_etb: null;
  confirmed_at: null;
  credited_at: null;
  swept_at: null;
};

type InsertedDepositRow = {
  tx_hash?: unknown;
  event_index?: unknown;
};

type StorableDetectedEvent = {
  event: BscMatchedTransferEvent;
  row: CryptoDepositInsertRow;
  amountUsdtStored: string;
};

export type AdminBscDryRunMatchedEvent = {
  dryRun: true;
  network: typeof BSC_NETWORK;
  contract: string;
  txHash: string;
  eventIndex: number;
  blockNumber: number;
  fromAddress: string;
  recipient: string;
  userId: string;
  addressId: string;
  amountRaw: string;
  amountUsdt: string;
};

export type AdminBscDryRunDetectorResult = {
  dryRun: true;
  network: typeof BSC_NETWORK;
  contract: string;
  decimals: number;
  fromBlock: number;
  toBlock: number;
  assignedAddressCount: number;
  addressPageCount: number;
  recipientTopicBatchSize: number;
  rpcBatchCount: number;
  scannedLogCount: number;
  totalMatchedEvents: number;
  matchedEventLimit: number;
  resultsTruncated: boolean;
  skippedMalformedLogs: number;
  skippedUnassignedLogs: number;
  skippedZeroAmountLogs: number;
  invalidAssignedAddressCount: number;
  matchedEvents: AdminBscDryRunMatchedEvent[];
};

export type AdminBscDetectedStoragePreviewEvent = {
  network: typeof BSC_NETWORK;
  contract: string;
  txHash: string;
  eventIndex: number;
  blockNumber: number;
  fromAddress: string;
  recipient: string;
  userId: string;
  addressId: string;
  amountRaw: string;
  amountUsdtDetected: string;
  amountUsdtStored: string;
  storageStatus: "inserted" | "already_seen";
};

export type AdminBscDetectedStorageResult = {
  dryRun: false;
  network: typeof BSC_NETWORK;
  contract: string;
  decimals: number;
  storageDecimals: number;
  fromBlock: number;
  toBlock: number;
  assignedAddressCount: number;
  addressPageCount: number;
  recipientTopicBatchSize: number;
  rpcBatchCount: number;
  scannedLogCount: number;
  totalMatchedEvents: number;
  attemptedInsertCount: number;
  insertedDetectedCount: number;
  duplicateDetectedCount: number;
  storagePreviewEventLimit: number;
  storagePreviewEvents: AdminBscDetectedStoragePreviewEvent[];
  skippedMalformedLogs: number;
  skippedUnassignedLogs: number;
  skippedZeroAmountLogs: number;
  skippedBelowStorageScaleLogs: number;
  invalidAssignedAddressCount: number;
};

function validateInput(data: unknown): {
  accessToken: string;
  fromBlock: number;
  toBlock: number;
} {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Invalid request.", "Missing request body");
  }

  const { accessToken, fromBlock, toBlock } = data as Record<string, unknown>;
  const start = Number(fromBlock);
  const end = Number(toBlock);

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throwSafe("ADMIN", "Unauthorized.", "Missing access token");
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end - start > MAX_BLOCK_RANGE) {
    throwSafe("ADMIN", "Invalid block range.", "BSC range is invalid");
  }

  return { accessToken: accessToken.trim(), fromBlock: start, toBlock: end };
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

function normalizeBscAddress(value: unknown): string | null {
  const address = toStringOrNull(value)?.toLowerCase() ?? null;
  return address && /^0x[a-f0-9]{40}$/.test(address) ? address : null;
}

function recipientTopic(address: string): string {
  return `0x${address.slice(2).padStart(64, "0")}`;
}

function topicAddress(topic: unknown): string | null {
  if (typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return `0x${topic.slice(-40).toLowerCase()}`;
}

function quantity(value: number): string {
  return `0x${value.toString(16)}`;
}

function parseHexBigInt(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;

  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function toSafeNumber(value: bigint): number | null {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : null;
}

function formatUnits(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function formatUnitsForStorageScale(value: bigint, tokenDecimals: number, storageDecimals: number): string | null {
  if (tokenDecimals < storageDecimals) return formatUnits(value, tokenDecimals);

  const scaleDivisor = 10n ** BigInt(tokenDecimals - storageDecimals);
  const storageBaseUnits = value / scaleDivisor;

  if (storageBaseUnits <= 0n) return null;

  return formatUnits(storageBaseUnits, storageDecimals);
}

function rpcErrorMessage(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "RPC returned an error";
  return value.trim().slice(0, 180);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function eventKey(txHash: string, eventIndex: number): string {
  return `${txHash}:${eventIndex}`;
}

function emptyScanResult(
  data: { fromBlock: number; toBlock: number },
  addressPageCount: number,
  invalidAssignedAddressCount: number,
  matchedEventLimit: number,
): BscDetectionScanResult {
  return {
    network: BSC_NETWORK,
    contract: BSC_USDT_CONTRACT_ADDRESS,
    decimals: BSC_USDT_DECIMALS,
    fromBlock: data.fromBlock,
    toBlock: data.toBlock,
    assignedAddressCount: 0,
    addressPageCount,
    recipientTopicBatchSize: RECIPIENT_TOPIC_BATCH_SIZE,
    rpcBatchCount: 0,
    scannedLogCount: 0,
    totalMatchedEvents: 0,
    matchedEventLimit,
    resultsTruncated: false,
    skippedMalformedLogs: 0,
    skippedUnassignedLogs: 0,
    skippedZeroAmountLogs: 0,
    invalidAssignedAddressCount,
    matchedEvents: [],
  };
}

function toDryRunEvent(event: BscMatchedTransferEvent): AdminBscDryRunMatchedEvent {
  return {
    dryRun: true,
    network: event.network,
    contract: event.contract,
    txHash: event.txHash,
    eventIndex: event.eventIndex,
    blockNumber: event.blockNumber,
    fromAddress: event.fromAddress,
    recipient: event.recipient,
    userId: event.userId,
    addressId: event.addressId,
    amountRaw: event.amountRaw,
    amountUsdt: event.amountUsdt,
  };
}

async function loadAssignedBscAddresses(admin: AdminClient): Promise<{
  addresses: AssignedBscAddress[];
  pageCount: number;
  invalidAssignedAddressCount: number;
}> {
  const addresses = new Map<string, AssignedBscAddress>();
  let pageCount = 0;
  let invalidAssignedAddressCount = 0;

  for (let offset = 0; ; offset += ADDRESS_PAGE_SIZE) {
    const { data, error } = await admin
      .from("crypto_deposit_addresses")
      .select("id, user_id, address")
      .eq("network", BSC_NETWORK)
      .eq("asset", "USDT")
      .eq("status", "active")
      .eq("activation_status", "not_required")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + ADDRESS_PAGE_SIZE - 1);

    if (error) {
      throwSafe("ADMIN", "Unable to load crypto addresses.", error.message);
    }

    const rows = (data ?? []) as BscAddressRow[];
    pageCount += 1;

    for (const row of rows) {
      const id = toStringOrNull(row.id);
      const userId = toStringOrNull(row.user_id);
      const address = normalizeBscAddress(row.address);

      if (!id || !userId || !address) {
        invalidAssignedAddressCount += 1;
        continue;
      }

      addresses.set(address, {
        id,
        userId,
        address,
        recipientTopic: recipientTopic(address),
      });
    }

    if (rows.length < ADDRESS_PAGE_SIZE) break;
  }

  return {
    addresses: Array.from(addresses.values()),
    pageCount,
    invalidAssignedAddressCount,
  };
}

async function fetchBscLogs(
  rpcUrl: string,
  data: { fromBlock: number; toBlock: number },
  recipientTopics: string[],
  requestId: number,
): Promise<unknown[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: requestId,
        method: "eth_getLogs",
        params: [
          {
            address: BSC_USDT_CONTRACT_ADDRESS,
            fromBlock: quantity(data.fromBlock),
            toBlock: quantity(data.toBlock),
            topics: [TRANSFER_EVENT_TOPIC, null, recipientTopics],
          },
        ],
      }),
    });
  } catch (error) {
    if (isAbortError(error)) {
      throwSafe("ADMIN", "BSC detector timed out.", "BSC RPC request timed out");
    }

    throwSafe("ADMIN", "BSC detector failed.", error instanceof Error ? error.message : "RPC request failed");
  } finally {
    clearTimeout(timeoutId);
  }

  let json: BscRpcLogsResponse;

  try {
    json = (await response.json()) as BscRpcLogsResponse;
  } catch {
    throwSafe("ADMIN", "BSC detector failed.", "RPC returned a non-JSON response");
  }

  if (!response.ok || json.error || !Array.isArray(json.result)) {
    throwSafe("ADMIN", "BSC detector failed.", rpcErrorMessage(json.error?.message));
  }

  return json.result;
}

async function scanAssignedBscTransfers(
  admin: AdminClient,
  data: { fromBlock: number; toBlock: number },
  matchedEventLimit: number,
): Promise<BscDetectionScanResult> {
  const rpcUrl = (process.env.BSC_RPC_URL ?? "").trim();
  if (!rpcUrl) {
    throwSafe("ADMIN", "BSC detector is not configured.", "Missing BSC_RPC_URL");
  }

  const addressLoad = await loadAssignedBscAddresses(admin);
  const assignedByAddress = new Map(addressLoad.addresses.map((address) => [address.address, address]));

  if (addressLoad.addresses.length === 0) {
    return emptyScanResult(data, addressLoad.pageCount, addressLoad.invalidAssignedAddressCount, matchedEventLimit);
  }

  const matchedEvents: BscMatchedTransferEvent[] = [];
  let rpcBatchCount = 0;
  let scannedLogCount = 0;
  let totalMatchedEvents = 0;
  let skippedMalformedLogs = 0;
  let skippedUnassignedLogs = 0;
  let skippedZeroAmountLogs = 0;

  for (let index = 0; index < addressLoad.addresses.length; index += RECIPIENT_TOPIC_BATCH_SIZE) {
    const recipientTopics = addressLoad.addresses
      .slice(index, index + RECIPIENT_TOPIC_BATCH_SIZE)
      .map((address) => address.recipientTopic);

    rpcBatchCount += 1;
    const logs = await fetchBscLogs(rpcUrl, data, recipientTopics, rpcBatchCount);
    scannedLogCount += logs.length;

    for (const log of logs) {
      const item = log as BscRpcLog;
      const topics = Array.isArray(item.topics) ? item.topics : null;
      const fromAddress = topicAddress(topics?.[1]);
      const recipient = topicAddress(topics?.[2]);
      const amountRawBigInt = parseHexBigInt(item.data);
      const eventIndexBigInt = parseHexBigInt(item.logIndex);
      const blockNumberBigInt = parseHexBigInt(item.blockNumber);
      const txHash = toStringOrNull(item.transactionHash)?.toLowerCase() ?? null;

      if (
        !fromAddress ||
        !recipient ||
        amountRawBigInt === null ||
        eventIndexBigInt === null ||
        blockNumberBigInt === null ||
        !txHash ||
        !/^0x[0-9a-f]{64}$/.test(txHash)
      ) {
        skippedMalformedLogs += 1;
        continue;
      }

      const assignedAddress = assignedByAddress.get(recipient);
      if (!assignedAddress) {
        skippedUnassignedLogs += 1;
        continue;
      }

      if (amountRawBigInt <= 0n) {
        skippedZeroAmountLogs += 1;
        continue;
      }

      const eventIndex = toSafeNumber(eventIndexBigInt);
      const blockNumber = toSafeNumber(blockNumberBigInt);

      if (eventIndex === null || blockNumber === null) {
        skippedMalformedLogs += 1;
        continue;
      }

      totalMatchedEvents += 1;

      if (matchedEvents.length < matchedEventLimit) {
        const amountRaw = amountRawBigInt.toString();

        matchedEvents.push({
          network: BSC_NETWORK,
          contract: BSC_USDT_CONTRACT_ADDRESS,
          txHash,
          eventIndex,
          blockNumber,
          fromAddress,
          recipient,
          userId: assignedAddress.userId,
          addressId: assignedAddress.id,
          amountRaw,
          amountRawBigInt,
          amountUsdt: formatUnits(amountRawBigInt, BSC_USDT_DECIMALS),
        });
      }
    }
  }

  return {
    network: BSC_NETWORK,
    contract: BSC_USDT_CONTRACT_ADDRESS,
    decimals: BSC_USDT_DECIMALS,
    fromBlock: data.fromBlock,
    toBlock: data.toBlock,
    assignedAddressCount: addressLoad.addresses.length,
    addressPageCount: addressLoad.pageCount,
    recipientTopicBatchSize: RECIPIENT_TOPIC_BATCH_SIZE,
    rpcBatchCount,
    scannedLogCount,
    totalMatchedEvents,
    matchedEventLimit,
    resultsTruncated: totalMatchedEvents > matchedEvents.length,
    skippedMalformedLogs,
    skippedUnassignedLogs,
    skippedZeroAmountLogs,
    invalidAssignedAddressCount: addressLoad.invalidAssignedAddressCount,
    matchedEvents,
  };
}

function buildDetectedStorageRows(scan: BscDetectionScanResult): {
  storableEvents: StorableDetectedEvent[];
  skippedBelowStorageScaleLogs: number;
} {
  const storableEvents: StorableDetectedEvent[] = [];
  let skippedBelowStorageScaleLogs = 0;

  for (const event of scan.matchedEvents) {
    const amountUsdtStored = formatUnitsForStorageScale(event.amountRawBigInt, BSC_USDT_DECIMALS, BSC_USDT_STORAGE_DECIMALS);

    if (!amountUsdtStored) {
      skippedBelowStorageScaleLogs += 1;
      continue;
    }

    storableEvents.push({
      event,
      amountUsdtStored,
      row: {
        user_id: event.userId,
        address_id: event.addressId,
        network: BSC_NETWORK,
        asset: "USDT",
        tx_hash: event.txHash,
        event_index: event.eventIndex,
        from_address: event.fromAddress,
        to_address: event.recipient,
        amount_raw: event.amountRaw,
        amount_usdt: amountUsdtStored,
        block_number: event.blockNumber,
        confirmations: 0,
        status: "detected",
        exchange_rate_etb: null,
        credited_amount_etb: null,
        confirmed_at: null,
        credited_at: null,
        swept_at: null,
      },
    });
  }

  return { storableEvents, skippedBelowStorageScaleLogs };
}

async function insertDetectedRows(admin: AdminClient, storableEvents: StorableDetectedEvent[]): Promise<Set<string>> {
  const insertedKeys = new Set<string>();

  for (let index = 0; index < storableEvents.length; index += STORAGE_INSERT_BATCH_SIZE) {
    const batch = storableEvents.slice(index, index + STORAGE_INSERT_BATCH_SIZE);

    const { data, error } = await admin
      .from("crypto_deposits")
      .upsert(batch.map((item) => item.row), {
        onConflict: "network,tx_hash,event_index",
        ignoreDuplicates: true,
      })
      .select("tx_hash, event_index");

    if (error) {
      throwSafe(
        "ADMIN",
        "Unable to store detected BSC deposits.",
        `DB error after ${insertedKeys.size} inserted row(s): ${error.message}`,
      );
    }

    for (const row of (data ?? []) as InsertedDepositRow[]) {
      const txHash = toStringOrNull(row.tx_hash)?.toLowerCase() ?? null;
      const eventIndex = Number(row.event_index);

      if (txHash && Number.isSafeInteger(eventIndex)) {
        insertedKeys.add(eventKey(txHash, eventIndex));
      }
    }
  }

  return insertedKeys;
}

export const runAdminBscDryRunDetectorFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateInput(data))
  .handler(async ({ data }): Promise<AdminBscDryRunDetectorResult> => {
    await assertAdmin(data.accessToken);

    const admin = getAdminClient();
    const scan = await scanAssignedBscTransfers(admin, data, MATCHED_EVENT_LIMIT);

    return {
      dryRun: true,
      network: scan.network,
      contract: scan.contract,
      decimals: scan.decimals,
      fromBlock: scan.fromBlock,
      toBlock: scan.toBlock,
      assignedAddressCount: scan.assignedAddressCount,
      addressPageCount: scan.addressPageCount,
      recipientTopicBatchSize: scan.recipientTopicBatchSize,
      rpcBatchCount: scan.rpcBatchCount,
      scannedLogCount: scan.scannedLogCount,
      totalMatchedEvents: scan.totalMatchedEvents,
      matchedEventLimit: scan.matchedEventLimit,
      resultsTruncated: scan.resultsTruncated,
      skippedMalformedLogs: scan.skippedMalformedLogs,
      skippedUnassignedLogs: scan.skippedUnassignedLogs,
      skippedZeroAmountLogs: scan.skippedZeroAmountLogs,
      invalidAssignedAddressCount: scan.invalidAssignedAddressCount,
      matchedEvents: scan.matchedEvents.map(toDryRunEvent),
    };
  });

export const runAdminBscDetectedStorageFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateInput(data))
  .handler(async ({ data }): Promise<AdminBscDetectedStorageResult> => {
    await assertAdmin(data.accessToken);

    const admin = getAdminClient();
    const scan = await scanAssignedBscTransfers(admin, data, Number.MAX_SAFE_INTEGER);
    const { storableEvents, skippedBelowStorageScaleLogs } = buildDetectedStorageRows(scan);
    const insertedKeys = await insertDetectedRows(admin, storableEvents);

    const storagePreviewEvents = storableEvents.slice(0, STORAGE_PREVIEW_EVENT_LIMIT).map(({ event, amountUsdtStored }) => ({
      network: BSC_NETWORK,
      contract: BSC_USDT_CONTRACT_ADDRESS,
      txHash: event.txHash,
      eventIndex: event.eventIndex,
      blockNumber: event.blockNumber,
      fromAddress: event.fromAddress,
      recipient: event.recipient,
      userId: event.userId,
      addressId: event.addressId,
      amountRaw: event.amountRaw,
      amountUsdtDetected: event.amountUsdt,
      amountUsdtStored,
      storageStatus: insertedKeys.has(eventKey(event.txHash, event.eventIndex)) ? "inserted" : "already_seen",
    }));

    return {
      dryRun: false,
      network: BSC_NETWORK,
      contract: BSC_USDT_CONTRACT_ADDRESS,
      decimals: BSC_USDT_DECIMALS,
      storageDecimals: BSC_USDT_STORAGE_DECIMALS,
      fromBlock: data.fromBlock,
      toBlock: data.toBlock,
      assignedAddressCount: scan.assignedAddressCount,
      addressPageCount: scan.addressPageCount,
      recipientTopicBatchSize: RECIPIENT_TOPIC_BATCH_SIZE,
      rpcBatchCount: scan.rpcBatchCount,
      scannedLogCount: scan.scannedLogCount,
      totalMatchedEvents: scan.totalMatchedEvents,
      attemptedInsertCount: storableEvents.length,
      insertedDetectedCount: insertedKeys.size,
      duplicateDetectedCount: storableEvents.length - insertedKeys.size,
      storagePreviewEventLimit: STORAGE_PREVIEW_EVENT_LIMIT,
      storagePreviewEvents,
      skippedMalformedLogs: scan.skippedMalformedLogs,
      skippedUnassignedLogs: scan.skippedUnassignedLogs,
      skippedZeroAmountLogs: scan.skippedZeroAmountLogs,
      skippedBelowStorageScaleLogs,
      invalidAssignedAddressCount: scan.invalidAssignedAddressCount,
    };
  });

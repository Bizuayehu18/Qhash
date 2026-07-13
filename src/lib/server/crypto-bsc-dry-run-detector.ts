import { createServerFn } from "@tanstack/react-start";
import { throwSafe } from "../errors.js";
import { getAdminClient } from "./supabase-admin.js";

const BSC_NETWORK = "BSC" as const;
const BSC_USDT_CONTRACT_ADDRESS = "0x55d398326f99059ff775485246999027b3197955";
const BSC_USDT_DECIMALS = 18;
const TRANSFER_EVENT_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MAX_BLOCK_RANGE = 2_000;
const ADDRESS_PAGE_SIZE = 1_000;
const RECIPIENT_TOPIC_BATCH_SIZE = 200;
const MATCHED_EVENT_LIMIT = 200;
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
    throwSafe("ADMIN", "Invalid block range.", "Dry-run range is invalid");
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

function rpcErrorMessage(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "RPC returned an error";
  return value.trim().slice(0, 180);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function emptyResult(data: { fromBlock: number; toBlock: number }, addressPageCount: number, invalidAssignedAddressCount: number): AdminBscDryRunDetectorResult {
  return {
    dryRun: true,
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
    matchedEventLimit: MATCHED_EVENT_LIMIT,
    resultsTruncated: false,
    skippedMalformedLogs: 0,
    skippedUnassignedLogs: 0,
    skippedZeroAmountLogs: 0,
    invalidAssignedAddressCount,
    matchedEvents: [],
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

async function fetchBscLogs(rpcUrl: string, data: { fromBlock: number; toBlock: number }, recipientTopics: string[], requestId: number): Promise<unknown[]> {
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
      throwSafe("ADMIN", "BSC dry-run timed out.", "BSC RPC request timed out");
    }

    throwSafe("ADMIN", "BSC dry-run failed.", error instanceof Error ? error.message : "RPC request failed");
  } finally {
    clearTimeout(timeoutId);
  }

  let json: BscRpcLogsResponse;

  try {
    json = (await response.json()) as BscRpcLogsResponse;
  } catch {
    throwSafe("ADMIN", "BSC dry-run failed.", "RPC returned a non-JSON response");
  }

  if (!response.ok || json.error || !Array.isArray(json.result)) {
    throwSafe("ADMIN", "BSC dry-run failed.", rpcErrorMessage(json.error?.message));
  }

  return json.result;
}

export const runAdminBscDryRunDetectorFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateInput(data))
  .handler(async ({ data }): Promise<AdminBscDryRunDetectorResult> => {
    await assertAdmin(data.accessToken);

    const rpcUrl = (process.env.BSC_RPC_URL ?? "").trim();
    if (!rpcUrl) {
      throwSafe("ADMIN", "BSC dry-run is not configured.", "Missing BSC_RPC_URL");
    }

    const admin = getAdminClient();
    const addressLoad = await loadAssignedBscAddresses(admin);
    const assignedByAddress = new Map(addressLoad.addresses.map((address) => [address.address, address]));

    if (addressLoad.addresses.length === 0) {
      return emptyResult(data, addressLoad.pageCount, addressLoad.invalidAssignedAddressCount);
    }

    const matchedEvents: AdminBscDryRunMatchedEvent[] = [];
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

        if (matchedEvents.length < MATCHED_EVENT_LIMIT) {
          const amountRaw = amountRawBigInt.toString();

          matchedEvents.push({
            dryRun: true,
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
            amountUsdt: formatUnits(amountRawBigInt, BSC_USDT_DECIMALS),
          });
        }
      }
    }

    return {
      dryRun: true,
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
      matchedEventLimit: MATCHED_EVENT_LIMIT,
      resultsTruncated: totalMatchedEvents > matchedEvents.length,
      skippedMalformedLogs,
      skippedUnassignedLogs,
      skippedZeroAmountLogs,
      invalidAssignedAddressCount: addressLoad.invalidAssignedAddressCount,
      matchedEvents,
    };
  });

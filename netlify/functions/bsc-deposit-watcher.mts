import { createClient } from "@supabase/supabase-js";
import type { Config } from "@netlify/functions";
import type { Database } from "../../src/lib/database.types.ts";
import { planBscWatcherRanges } from "../../src/lib/server/bsc-watcher-range-plan.ts";
import { storeBscDetectedTransfersForRange } from "../../src/lib/server/crypto-bsc-dry-run-detector.ts";

const BSC_NETWORK = "BSC" as const;
const SAFE_HEAD_CONFIRMATIONS = 20;
const INITIAL_LOOKBACK_BLOCKS = 2_000;
const BLOCKS_PER_RPC_BATCH = 100;
const MAX_RPC_BATCHES_PER_RUN = 3;
const MAX_MATCHED_EVENTS_PER_BATCH = 2_000;
const SCHEDULED_RPC_TIMEOUT_MS = 5_000;

// Netlify scheduled functions have a 30-second execution limit. One latest-
// block request plus three sequential log requests can therefore spend at
// most 20 seconds waiting on the RPC provider, leaving 10 seconds for address
// loading, deposit storage, checkpoint updates, and logging.
const MAX_SEQUENTIAL_RPC_WAIT_MS = (MAX_RPC_BATCHES_PER_RUN + 1) * SCHEDULED_RPC_TIMEOUT_MS;
const NETLIFY_SCHEDULED_FUNCTION_LIMIT_MS = 30_000;

if (MAX_SEQUENTIAL_RPC_WAIT_MS >= NETLIFY_SCHEDULED_FUNCTION_LIMIT_MS) {
  throw new Error("BSC watcher RPC wait budget must stay below the Netlify scheduled-function limit");
}

type BscBlockNumberResponse = {
  result?: unknown;
  error?: {
    message?: unknown;
  };
};

function log(step: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({
    fn: "bsc-deposit-watcher",
    step,
    ts: new Date().toISOString(),
    ...data,
  }));
}

function logError(step: string, error: unknown, data: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({
    fn: "bsc-deposit-watcher",
    step,
    ts: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
    ...data,
  }));
}

function parseHexBlockNumber(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;

  try {
    const parsed = Number(BigInt(value));
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  } catch {
    return null;
  }
}

function rpcErrorMessage(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) return "RPC returned an error";
  return value.trim().slice(0, 180);
}

async function fetchLatestBscBlock(rpcUrl: string): Promise<number> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SCHEDULED_RPC_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_blockNumber",
        params: [],
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("BSC latest-block request timed out");
    }

    throw new Error(error instanceof Error ? error.message : "BSC latest-block request failed");
  } finally {
    clearTimeout(timeoutId);
  }

  let json: BscBlockNumberResponse;

  try {
    json = (await response.json()) as BscBlockNumberResponse;
  } catch {
    throw new Error("BSC latest-block RPC returned non-JSON data");
  }

  if (!response.ok || json.error) {
    throw new Error(rpcErrorMessage(json.error?.message));
  }

  const latestBlock = parseHexBlockNumber(json.result);
  if (latestBlock === null) {
    throw new Error("BSC latest-block RPC returned an invalid block number");
  }

  return latestBlock;
}

export default async (): Promise<void> => {
  const supabaseUrl = (
    Netlify.env.get("VITE_SUPABASE_URL") ?? Netlify.env.get("SUPABASE_URL") ?? ""
  ).trim();
  const serviceRoleKey = (Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
  const rpcUrl = (Netlify.env.get("BSC_RPC_URL") ?? "").trim();

  if (!supabaseUrl || !serviceRoleKey || !rpcUrl) {
    const error = new Error("Missing required server configuration");
    logError("config_error", error, {
      has_supabase_url: Boolean(supabaseUrl),
      has_service_role_key: Boolean(serviceRoleKey),
      has_bsc_rpc_url: Boolean(rpcUrl),
    });
    throw error;
  }

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const [latestBlock, watcherState] = await Promise.all([
      fetchLatestBscBlock(rpcUrl),
      admin
        .from("crypto_watcher_state")
        .select("last_scanned_block")
        .eq("network", BSC_NETWORK)
        .single(),
    ]);

    if (watcherState.error || !watcherState.data) {
      throw new Error(`Unable to load BSC watcher state: ${watcherState.error?.message ?? "missing row"}`);
    }

    const checkpoint = Number(watcherState.data.last_scanned_block);
    if (!Number.isSafeInteger(checkpoint) || checkpoint < 0) {
      throw new Error("Stored BSC watcher checkpoint is invalid");
    }

    const safeHead = latestBlock - SAFE_HEAD_CONFIRMATIONS;
    if (safeHead < 0 || checkpoint >= safeHead) {
      log("no_safe_blocks", {
        latest_block: latestBlock,
        safe_head: Math.max(safeHead, 0),
        checkpoint,
      });
      return;
    }

    const ranges = planBscWatcherRanges({
      checkpoint,
      safeHead,
      initialLookbackBlocks: INITIAL_LOOKBACK_BLOCKS,
      blocksPerBatch: BLOCKS_PER_RPC_BATCH,
      maxBatches: MAX_RPC_BATCHES_PER_RUN,
    });

    if (ranges.length === 0) {
      log("no_safe_blocks", {
        latest_block: latestBlock,
        safe_head: safeHead,
        checkpoint,
      });
      return;
    }

    const firstRange = ranges[0];
    const lastRange = ranges[ranges.length - 1];

    log("scan_started", {
      latest_block: latestBlock,
      safe_head: safeHead,
      checkpoint,
      from_block: firstRange.fromBlock,
      to_block: lastRange.toBlock,
      batches_planned: ranges.length,
      blocks_planned: lastRange.toBlock - firstRange.fromBlock + 1,
      rpc_timeout_ms: SCHEDULED_RPC_TIMEOUT_MS,
      max_sequential_rpc_wait_ms: MAX_SEQUENTIAL_RPC_WAIT_MS,
    });

    const totals = {
      assignedAddressCount: 0,
      rpcBatchCount: 0,
      scannedLogCount: 0,
      totalMatchedEvents: 0,
      insertedDetectedCount: 0,
      duplicateDetectedCount: 0,
      invalidAssignedAddressCount: 0,
      skippedMalformedLogs: 0,
      skippedZeroAmountLogs: 0,
      skippedBelowStorageScaleLogs: 0,
    };
    let expectedCheckpoint = checkpoint;
    let completedBatches = 0;

    for (const range of ranges) {
      const result = await storeBscDetectedTransfersForRange({
        admin,
        rpcUrl,
        fromBlock: range.fromBlock,
        toBlock: range.toBlock,
        matchedEventLimit: MAX_MATCHED_EVENTS_PER_BATCH,
        // One unfiltered Transfer query per 100-block batch keeps runtime
        // independent of assigned-address count without relying on a provider's
        // larger-range response cap. Matching remains server-side.
        scanAllRecipients: true,
        rpcTimeoutMs: SCHEDULED_RPC_TIMEOUT_MS,
      });

      const { data: advancedState, error: advanceError } = await admin
        .from("crypto_watcher_state")
        .update({ last_scanned_block: range.toBlock })
        .eq("network", BSC_NETWORK)
        .eq("last_scanned_block", expectedCheckpoint)
        .select("last_scanned_block")
        .maybeSingle();

      if (advanceError) {
        throw new Error(`Unable to advance BSC watcher checkpoint: ${advanceError.message}`);
      }

      if (!advancedState) {
        const { data: currentState, error: currentStateError } = await admin
          .from("crypto_watcher_state")
          .select("last_scanned_block")
          .eq("network", BSC_NETWORK)
          .single();

        if (
          currentStateError ||
          !currentState ||
          Number(currentState.last_scanned_block) < range.toBlock
        ) {
          throw new Error(
            `BSC watcher checkpoint changed unexpectedly: ${currentStateError?.message ?? "stale state"}`,
          );
        }

        log("checkpoint_already_advanced", {
          from_block: range.fromBlock,
          to_block: range.toBlock,
          current_checkpoint: currentState.last_scanned_block,
          batches_completed: completedBatches,
          inserted_detected: totals.insertedDetectedCount + result.insertedDetectedCount,
          duplicate_detected: totals.duplicateDetectedCount + result.duplicateDetectedCount,
        });
        return;
      }

      expectedCheckpoint = range.toBlock;
      completedBatches += 1;
      totals.assignedAddressCount = Math.max(totals.assignedAddressCount, result.assignedAddressCount);
      totals.rpcBatchCount += result.rpcBatchCount;
      totals.scannedLogCount += result.scannedLogCount;
      totals.totalMatchedEvents += result.totalMatchedEvents;
      totals.insertedDetectedCount += result.insertedDetectedCount;
      totals.duplicateDetectedCount += result.duplicateDetectedCount;
      totals.invalidAssignedAddressCount = Math.max(
        totals.invalidAssignedAddressCount,
        result.invalidAssignedAddressCount,
      );
      totals.skippedMalformedLogs += result.skippedMalformedLogs;
      totals.skippedZeroAmountLogs += result.skippedZeroAmountLogs;
      totals.skippedBelowStorageScaleLogs += result.skippedBelowStorageScaleLogs;

      log("batch_completed", {
        batch: completedBatches,
        from_block: range.fromBlock,
        to_block: range.toBlock,
        assigned_addresses: result.assignedAddressCount,
        rpc_batches: result.rpcBatchCount,
        matched_events: result.totalMatchedEvents,
        inserted_detected: result.insertedDetectedCount,
        duplicate_detected: result.duplicateDetectedCount,
        checkpoint: advancedState.last_scanned_block,
      });
    }

    log("scan_completed", {
      from_block: firstRange.fromBlock,
      to_block: expectedCheckpoint,
      batches_completed: completedBatches,
      assigned_addresses: totals.assignedAddressCount,
      rpc_batches: totals.rpcBatchCount,
      scanned_logs: totals.scannedLogCount,
      matched_events: totals.totalMatchedEvents,
      inserted_detected: totals.insertedDetectedCount,
      duplicate_detected: totals.duplicateDetectedCount,
      invalid_assigned_addresses: totals.invalidAssignedAddressCount,
      skipped_malformed_logs: totals.skippedMalformedLogs,
      skipped_zero_amount_logs: totals.skippedZeroAmountLogs,
      skipped_below_storage_scale_logs: totals.skippedBelowStorageScaleLogs,
      checkpoint: expectedCheckpoint,
    });
  } catch (error) {
    // Each batch checkpoint advances only after every detected row in that batch is
    // stored. Earlier completed batches remain committed; a failed batch is safely
    // retried because the detector's chain-event identity is idempotent.
    logError("run_failed", error);
    throw error;
  }
};

export const config: Config = {
  schedule: "* * * * *",
};

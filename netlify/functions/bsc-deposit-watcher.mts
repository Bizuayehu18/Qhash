import { createClient } from "@supabase/supabase-js";
import type { Config } from "@netlify/functions";
import type { Database } from "../../src/lib/database.types.ts";
import { storeBscDetectedTransfersForRange } from "../../src/lib/server/crypto-bsc-dry-run-detector.ts";

const BSC_NETWORK = "BSC" as const;
const SAFE_HEAD_CONFIRMATIONS = 20;
const INITIAL_LOOKBACK_BLOCKS = 2_000;
const MAX_BLOCKS_PER_RUN = 500;
const MAX_MATCHED_EVENTS_PER_RUN = 2_000;
const RPC_TIMEOUT_MS = 10_000;

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
  const timeoutId = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

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
  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL") ?? Netlify.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const rpcUrl = Netlify.env.get("BSC_RPC_URL") ?? "";

  if (!supabaseUrl || !serviceRoleKey || !rpcUrl) {
    logError("config_error", "Missing required server configuration", {
      has_supabase_url: Boolean(supabaseUrl),
      has_service_role_key: Boolean(serviceRoleKey),
      has_bsc_rpc_url: Boolean(rpcUrl),
    });
    return;
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

    const fromBlock = checkpoint === 0
      ? Math.max(0, safeHead - INITIAL_LOOKBACK_BLOCKS + 1)
      : checkpoint + 1;
    const toBlock = Math.min(safeHead, fromBlock + MAX_BLOCKS_PER_RUN - 1);

    log("scan_started", {
      latest_block: latestBlock,
      safe_head: safeHead,
      checkpoint,
      from_block: fromBlock,
      to_block: toBlock,
    });

    const result = await storeBscDetectedTransfersForRange({
      admin,
      rpcUrl,
      fromBlock,
      toBlock,
      matchedEventLimit: MAX_MATCHED_EVENTS_PER_RUN,
    });

    const { data: advancedState, error: advanceError } = await admin
      .from("crypto_watcher_state")
      .update({ last_scanned_block: toBlock })
      .eq("network", BSC_NETWORK)
      .eq("last_scanned_block", checkpoint)
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

      if (currentStateError || !currentState || Number(currentState.last_scanned_block) < toBlock) {
        throw new Error(`BSC watcher checkpoint changed unexpectedly: ${currentStateError?.message ?? "stale state"}`);
      }

      log("checkpoint_already_advanced", {
        from_block: fromBlock,
        to_block: toBlock,
        current_checkpoint: currentState.last_scanned_block,
        inserted_detected: result.insertedDetectedCount,
        duplicate_detected: result.duplicateDetectedCount,
      });
      return;
    }

    log("scan_completed", {
      from_block: fromBlock,
      to_block: toBlock,
      assigned_addresses: result.assignedAddressCount,
      rpc_batches: result.rpcBatchCount,
      scanned_logs: result.scannedLogCount,
      matched_events: result.totalMatchedEvents,
      inserted_detected: result.insertedDetectedCount,
      duplicate_detected: result.duplicateDetectedCount,
      invalid_assigned_addresses: result.invalidAssignedAddressCount,
      skipped_malformed_logs: result.skippedMalformedLogs,
      skipped_zero_amount_logs: result.skippedZeroAmountLogs,
      skipped_below_storage_scale_logs: result.skippedBelowStorageScaleLogs,
      checkpoint: advancedState.last_scanned_block,
    });
  } catch (error) {
    // The checkpoint advances only after every detected row is stored. Partial inserts
    // are harmless because the detector's chain-event identity is idempotent on retry.
    logError("run_failed", error);
  }
};

export const config: Config = {
  schedule: "* * * * *",
};

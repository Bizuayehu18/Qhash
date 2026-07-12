import { createServerFn } from "@tanstack/react-start";
import { throwSafe } from "../errors.js";
import { getAdminClient } from "./supabase-admin.js";

const BSC_NETWORK = "BSC" as const;
const BSC_USDT_CONTRACT_ADDRESS = "0x55d398326f99059ff775485246999027b3197955";
const BSC_USDT_DECIMALS = 18;
const TRANSFER_EVENT_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MAX_BLOCK_RANGE = 2000;

function validateInput(data: unknown) {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Invalid request.", "Missing request body");
  }

  const { accessToken, fromBlock, toBlock } = data as Record<string, unknown>;
  const start = Number(fromBlock);
  const end = Number(toBlock);

  if (typeof accessToken !== "string" || !accessToken) {
    throwSafe("ADMIN", "Unauthorized.", "Missing access token");
  }

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end - start > MAX_BLOCK_RANGE) {
    throwSafe("ADMIN", "Invalid block range.", "Dry-run range is invalid");
  }

  return { accessToken, fromBlock: start, toBlock: end };
}

async function assertAdmin(accessToken: string) {
  const admin = getAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(accessToken);

  if (error || !user) {
    throwSafe("ADMIN", "Unauthorized.", "Invalid access token");
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin, is_frozen")
    .eq("id", user.id)
    .single();

  if (!profile || profile.is_admin !== true || profile.is_frozen === true) {
    throwSafe("ADMIN", "Unauthorized.", "Admin permission required");
  }
}

function formatUnits(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function topicAddress(topic: unknown): string | null {
  if (typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null;
  return `0x${topic.slice(-40).toLowerCase()}`;
}

function quantity(value: number): string {
  return `0x${value.toString(16)}`;
}

export const runAdminBscDryRunDetectorFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateInput(data))
  .handler(async ({ data }) => {
    await assertAdmin(data.accessToken);

    const rpcUrl = process.env.BSC_RPC_URL;
    if (!rpcUrl) {
      throwSafe("ADMIN", "BSC dry-run is not configured.", "Missing BSC_RPC_URL");
    }

    const admin = getAdminClient();
    const { data: addresses, error: addressError } = await admin
      .from("crypto_deposit_addresses")
      .select("id, user_id, address")
      .eq("network", BSC_NETWORK)
      .eq("asset", "USDT")
      .eq("status", "active")
      .eq("activation_status", "not_required")
      .limit(2000);

    if (addressError) {
      throwSafe("ADMIN", "Unable to load crypto addresses.", addressError.message);
    }

    const assigned = new Map(
      (addresses ?? []).map((row) => [String(row.address).toLowerCase(), row]),
    );

    if (assigned.size === 0) {
      return {
        dryRun: true,
        network: BSC_NETWORK,
        contract: BSC_USDT_CONTRACT_ADDRESS,
        decimals: BSC_USDT_DECIMALS,
        matchedEvents: [],
      };
    }

    const topics = Array.from(assigned.keys()).map((address) => `0x${"0".repeat(24)}${address.slice(2)}`);

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_getLogs",
        params: [{
          address: BSC_USDT_CONTRACT_ADDRESS,
          fromBlock: quantity(data.fromBlock),
          toBlock: quantity(data.toBlock),
          topics: [TRANSFER_EVENT_TOPIC, null, topics],
        }],
      }),
    });

    const json = await response.json() as { result?: unknown; error?: { message?: string } };
    if (!response.ok || json.error || !Array.isArray(json.result)) {
      throwSafe("ADMIN", "BSC dry-run failed.", json.error?.message ?? "RPC returned invalid response");
    }

    const matchedEvents = json.result.flatMap((log) => {
      const item = log as { topics?: unknown[]; data?: string; transactionHash?: string; logIndex?: string; blockNumber?: string };
      const to = topicAddress(item.topics?.[2]);
      const row = to ? assigned.get(to) : undefined;

      if (!row || typeof item.data !== "string" || !item.transactionHash || !item.logIndex || !item.blockNumber) {
        return [];
      }

      const amountRaw = BigInt(item.data).toString();

      return [{
        network: BSC_NETWORK,
        contract: BSC_USDT_CONTRACT_ADDRESS,
        txHash: item.transactionHash,
        eventIndex: Number(BigInt(item.logIndex)),
        blockNumber: Number(BigInt(item.blockNumber)),
        recipient: to,
        userId: row.user_id,
        addressId: row.id,
        amountRaw,
        amountUsdt: formatUnits(BigInt(amountRaw), BSC_USDT_DECIMALS),
        dryRun: true,
      }];
    });

    return {
      dryRun: true,
      network: BSC_NETWORK,
      contract: BSC_USDT_CONTRACT_ADDRESS,
      decimals: BSC_USDT_DECIMALS,
      fromBlock: data.fromBlock,
      toBlock: data.toBlock,
      matchedEvents: matchedEvents.slice(0, 200),
    };
  });

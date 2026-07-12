import { createServerFn } from "@tanstack/react-start";
import { throwSafe } from "../errors.js";
import { getAdminClient } from "./supabase-admin.js";

const BSC_NETWORK = "BSC" as const;
const BSC_USDT_CONTRACT_ADDRESS = "0x55d398326f99059ff775485246999027b3197955";
const BSC_USDT_DECIMALS = 18;
const BSC_DRY_RUN_MAX_BLOCK_RANGE = 2_000;
const BSC_DRY_RUN_ADDRESS_LIMIT = 2_000;
const BSC_DRY_RUN_MATCH_LIMIT = 200;
const TRANSFER_EVENT_TOPIC = "0xddf
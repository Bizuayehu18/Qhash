import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

const DEPOSIT_LIMIT = 100;
const NETWORK_FILTERS = ["all", "TRON", "BSC"] as const;
const STATUS_FILTERS = ["all", "detected", "confirmed", "credited", "swept", "failed"] as const;

type NetworkFilter = (typeof NETWORK_FILTERS)[number];
type StatusFilter = (typeof STATUS_FILTERS)[number];
type CryptoNetwork = "TRON" | "BSC";

type CryptoDepositStatus = "
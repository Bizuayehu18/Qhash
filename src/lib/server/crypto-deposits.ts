import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

const SETTINGS_KEYS = [
  "usdt_etb_rate",
  "crypto_tron_min_usdt",
  "crypto_bsc_min_usdt",
  "crypto_auto_credit_enabled",
] as const;

const DEFAULT_SETTINGS = {
  usdt_etb_rate: 160,
  crypto_tron_min_usdt: 10,
  crypto_bsc_min_usdt: 5,
  crypto_auto_credit_enabled
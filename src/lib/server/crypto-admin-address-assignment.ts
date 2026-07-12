import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";
import type { AdminCryptoAddressInventoryRow } from "./crypto-admin-addresses.js";

const TRON_ADDRESS_VERSION_BYTE = 0x41;
const TRON_DECODED_ADDRESS_LENGTH = 25;
const TRON_PAYLOAD_LENGTH = 21;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZ
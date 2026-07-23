import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types.ts";
import { isPublishedProductionDeployContext } from "./lib/nowpayments-deploy-context.mts";

const MAX_BODY_BYTES = 8_192;
const OVERVIEW_LIMIT = 200;
const RELATED_LIMIT = 2_000;
const TOKEN_CONTRACT = "0x55d398326f99059ff775485246999027b3197955";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,6})?$/;
const STATUS_SET = new Set([
  "reserved",
  "reviewing",
  "send_locked",
  "broadcasted",
  "completed",
  "rejected",
]);
const ACTION_TYPE_SET = new Set([
  "request",
  "claim_review",
  "send_lock",
  "record_broadcast",
  "complete",
  "reject",
  "admin_takeover",
]);

type AdminClient = ReturnType<typeof createClient<Database>>;
type WithdrawalStatus =
  | "reserved"
  | "reviewing"
  | "send_locked"
  | "broadcasted"
  | "completed"
  | "rejected";
type ActionType =
  | "request"
  | "claim_review"
  | "send_lock"
  | "record_broadcast"
  | "complete"
  | "reject"
  | "admin_takeover";

type WithdrawalRow = {
  id: string;
  user_id: string;
  destination_address: string;
  asset: "USDT";
  network: "BEP20";
  provider_currency: "usdtbsc";
  gross_amount_usdt: string;
  fee_percent: string;
  fee_amount_usdt: string;
  net_amount_usdt: string;
  status: WithdrawalStatus;
  requested_at: string;
  initial_admin_id: string | null;
  current_admin_id: string | null;
  claimed_at: string | null;
  send_locked_at: string | null;
  broadcasted_at: string | null;
  completed_at: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  current_broadcast_id: string | null;
  created_at: string;
  updated_at: string;
};

type ProfileRow = {
  id: string;
  username: string;
  is_admin: boolean;
  is_frozen: boolean;
};

type EventRow = {
  id: string;
  withdrawal_id: string;
  user_id: string;
  actor_id: string;
  action_id: string;
  action_type: ActionType;
  from_status: WithdrawalStatus | null;
  to_status: WithdrawalStatus;
  result_snapshot: Record<string, unknown>;
  created_at: string;
};

type BroadcastRow = {
  id: string;
  withdrawal_id: string;
  recorded_by: string;
  transaction_hash: string;
  destination_address: string;
  net_amount_usdt: string;
  supersedes_broadcast_id: string | null;
  correction_reason: string | null;
  recorded_at: string;
};

type VerificationRow = {
  id: string;
  withdrawal_id: string;
  broadcast_id: string;
  verified_by: string;
  chain_id: number;
  token_contract: string;
  transaction_success: boolean;
  exactly_one_matching_transfer: boolean;
  destination_address: string;
  net_amount_usdt: string;
  block_number: number;
  transfer_log_index: number;
  confirmations: number;
  verified_at: string;
  created_at: string;
};

type AdminActionBody =
  | {
      action: "begin_review";
      withdrawal_id: string;
      action_id: string;
    }
  | {
      action: "reject";
      withdrawal_id: string;
      action_id: string;
      reason: string;
    }
  | {
      action: "send_lock";
      withdrawal_id: string;
      action_id: string;
      external_liquidity_confirmed: true;
      destination_manually_verified: true;
      irreversible_send_confirmed: true;
    }
  | {
      action: "record_broadcast";
      withdrawal_id: string;
      action_id: string;
      transaction_hash: string;
      correction_reason: string | null;
    }
  | {
      action: "complete";
      withdrawal_id: string;
      action_id: string;
      transaction_hash: string;
      chain_id: 56;
      token_contract: typeof TOKEN_CONTRACT;
      transaction_success: true;
      exactly_one_matching_transfer: true;
      destination_address: string;
      net_amount_usdt: string;
      block_number: number;
      transfer_log_index: number;
      confirmations: number;
      verified_at: string;
    };

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorResponse(error: string, message: string, status: number): Response {
  return json({ error, message }, status);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isDecimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

function decimalMicros(value: string): bigint {
  const [integer, fraction = ""] = value.split(".");
  return BigInt(integer) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

function canonicalDecimal(value: string): string {
  const [integer, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
}

function isSafeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string"
    && value.trim() === value
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  return actual.length === expected.length
    && actual.every((field, index) => field === expected[index]);
}

function validateWithdrawal(value: unknown): WithdrawalRow {
  if (!isObject(value)) throw new Error("invalid_withdrawal");
  const row = value;
  if (
    typeof row.id !== "string"
    || !UUID_V4_PATTERN.test(row.id)
    || typeof row.user_id !== "string"
    || !UUID_PATTERN.test(row.user_id)
    || typeof row.destination_address !== "string"
    || !ADDRESS_PATTERN.test(row.destination_address)
    || row.asset !== "USDT"
    || row.network !== "BEP20"
    || row.provider_currency !== "usdtbsc"
    || !isDecimal(row.gross_amount_usdt)
    || !isDecimal(row.fee_percent)
    || canonicalDecimal(row.fee_percent) !== "5"
    || !isDecimal(row.fee_amount_usdt)
    || !isDecimal(row.net_amount_usdt)
    || typeof row.status !== "string"
    || !STATUS_SET.has(row.status)
    || !isTimestamp(row.requested_at)
    || !isTimestamp(row.created_at)
    || !isTimestamp(row.updated_at)
    || !isNullableTimestamp(row.claimed_at)
    || !isNullableTimestamp(row.send_locked_at)
    || !isNullableTimestamp(row.broadcasted_at)
    || !isNullableTimestamp(row.completed_at)
    || !isNullableTimestamp(row.rejected_at)
    || (row.initial_admin_id !== null
      && (typeof row.initial_admin_id !== "string" || !UUID_PATTERN.test(row.initial_admin_id)))
    || (row.current_admin_id !== null
      && (typeof row.current_admin_id !== "string" || !UUID_PATTERN.test(row.current_admin_id)))
    || (row.current_broadcast_id !== null
      && (
        typeof row.current_broadcast_id !== "string"
        || !UUID_PATTERN.test(row.current_broadcast_id)
      ))
    || (row.rejection_reason !== null && !isSafeText(row.rejection_reason, 500))
  ) {
    throw new Error("invalid_withdrawal");
  }
  const gross = decimalMicros(row.gross_amount_usdt);
  const fee = decimalMicros(row.fee_amount_usdt);
  const net = decimalMicros(row.net_amount_usdt);
  if (
    gross < 2_000_000n
    || fee !== (gross * 5n + 50n) / 100n
    || net !== gross - fee
    || (row.status === "reserved"
      && (
        row.initial_admin_id !== null
        || row.current_admin_id !== null
        || row.claimed_at !== null
        || row.send_locked_at !== null
        || row.broadcasted_at !== null
        || row.completed_at !== null
        || row.rejected_at !== null
        || row.current_broadcast_id !== null
      ))
    || (row.status === "reviewing"
      && (
        row.initial_admin_id === null
        || row.current_admin_id === null
        || row.claimed_at === null
        || row.send_locked_at !== null
        || row.broadcasted_at !== null
        || row.completed_at !== null
        || row.rejected_at !== null
        || row.current_broadcast_id !== null
      ))
    || (row.status === "send_locked"
      && (
        row.initial_admin_id === null
        || row.current_admin_id === null
        || row.claimed_at === null
        || row.send_locked_at === null
        || row.broadcasted_at !== null
        || row.completed_at !== null
        || row.rejected_at !== null
        || row.current_broadcast_id !== null
      ))
    || (row.status === "broadcasted"
      && (
        row.initial_admin_id === null
        || row.current_admin_id === null
        || row.claimed_at === null
        || row.send_locked_at === null
        || row.broadcasted_at === null
        || row.completed_at !== null
        || row.rejected_at !== null
        || row.current_broadcast_id === null
      ))
    || (row.status === "completed"
      && (
        row.initial_admin_id === null
        || row.current_admin_id === null
        || row.claimed_at === null
        || row.send_locked_at === null
        || row.broadcasted_at === null
        || row.completed_at === null
        || row.rejected_at !== null
        || row.current_broadcast_id === null
      ))
    || (row.status === "rejected"
      && (
        row.rejected_at === null
        || row.rejection_reason === null
        || row.send_locked_at !== null
        || row.broadcasted_at !== null
        || row.completed_at !== null
        || row.current_broadcast_id !== null
      ))
  ) {
    throw new Error("invalid_withdrawal_state");
  }
  return row as unknown as WithdrawalRow;
}

function validateProfile(value: unknown): ProfileRow {
  if (!isObject(value)) throw new Error("invalid_profile");
  if (
    typeof value.id !== "string"
    || !UUID_PATTERN.test(value.id)
    || !isSafeText(value.username, 100)
    || typeof value.is_admin !== "boolean"
    || typeof value.is_frozen !== "boolean"
  ) {
    throw new Error("invalid_profile");
  }
  return value as unknown as ProfileRow;
}

function validateEvent(value: unknown): EventRow {
  if (!isObject(value) || !isObject(value.result_snapshot)) {
    throw new Error("invalid_event");
  }
  if (
    typeof value.id !== "string"
    || !UUID_PATTERN.test(value.id)
    || typeof value.withdrawal_id !== "string"
    || !UUID_V4_PATTERN.test(value.withdrawal_id)
    || typeof value.user_id !== "string"
    || !UUID_PATTERN.test(value.user_id)
    || typeof value.actor_id !== "string"
    || !UUID_PATTERN.test(value.actor_id)
    || typeof value.action_id !== "string"
    || !UUID_V4_PATTERN.test(value.action_id)
    || typeof value.action_type !== "string"
    || !ACTION_TYPE_SET.has(value.action_type)
    || (value.from_status !== null
      && (typeof value.from_status !== "string" || !STATUS_SET.has(value.from_status)))
    || typeof value.to_status !== "string"
    || !STATUS_SET.has(value.to_status)
    || !isTimestamp(value.created_at)
    || value.result_snapshot.withdrawal_id !== value.withdrawal_id
    || value.result_snapshot.status !== value.to_status
  ) {
    throw new Error("invalid_event");
  }
  return value as unknown as EventRow;
}

function validateBroadcast(value: unknown): BroadcastRow {
  if (!isObject(value)) throw new Error("invalid_broadcast");
  if (
    typeof value.id !== "string"
    || !UUID_PATTERN.test(value.id)
    || typeof value.withdrawal_id !== "string"
    || !UUID_V4_PATTERN.test(value.withdrawal_id)
    || typeof value.recorded_by !== "string"
    || !UUID_PATTERN.test(value.recorded_by)
    || typeof value.transaction_hash !== "string"
    || !TRANSACTION_HASH_PATTERN.test(value.transaction_hash)
    || typeof value.destination_address !== "string"
    || !ADDRESS_PATTERN.test(value.destination_address)
    || !isDecimal(value.net_amount_usdt)
    || !isTimestamp(value.recorded_at)
    || (value.supersedes_broadcast_id !== null
      && (
        typeof value.supersedes_broadcast_id !== "string"
        || !UUID_PATTERN.test(value.supersedes_broadcast_id)
      ))
    || (value.correction_reason !== null && !isSafeText(value.correction_reason, 500))
    || ((value.supersedes_broadcast_id === null) !== (value.correction_reason === null))
  ) {
    throw new Error("invalid_broadcast");
  }
  return value as unknown as BroadcastRow;
}

function validateVerification(value: unknown): VerificationRow {
  if (!isObject(value)) throw new Error("invalid_verification");
  if (
    typeof value.id !== "string"
    || !UUID_PATTERN.test(value.id)
    || typeof value.withdrawal_id !== "string"
    || !UUID_V4_PATTERN.test(value.withdrawal_id)
    || typeof value.broadcast_id !== "string"
    || !UUID_PATTERN.test(value.broadcast_id)
    || typeof value.verified_by !== "string"
    || !UUID_PATTERN.test(value.verified_by)
    || value.chain_id !== 56
    || value.token_contract !== TOKEN_CONTRACT
    || value.transaction_success !== true
    || value.exactly_one_matching_transfer !== true
    || typeof value.destination_address !== "string"
    || !ADDRESS_PATTERN.test(value.destination_address)
    || !isDecimal(value.net_amount_usdt)
    || typeof value.block_number !== "number"
    || !Number.isSafeInteger(value.block_number)
    || value.block_number <= 0
    || typeof value.transfer_log_index !== "number"
    || !Number.isSafeInteger(value.transfer_log_index)
    || value.transfer_log_index < 0
    || typeof value.confirmations !== "number"
    || !Number.isSafeInteger(value.confirmations)
    || value.confirmations < 120
    || !isTimestamp(value.verified_at)
    || !isTimestamp(value.created_at)
    || new Date(value.verified_at).getTime() > new Date(value.created_at).getTime()
  ) {
    throw new Error("invalid_verification");
  }
  return value as unknown as VerificationRow;
}

function expectedTransition(event: EventRow): boolean {
  switch (event.action_type) {
    case "request":
      return event.from_status === null && event.to_status === "reserved";
    case "claim_review":
      return event.from_status === "reserved" && event.to_status === "reviewing";
    case "send_lock":
      return event.from_status === "reviewing" && event.to_status === "send_locked";
    case "record_broadcast":
      return (
        (event.from_status === "send_locked" || event.from_status === "broadcasted")
        && event.to_status === "broadcasted"
      );
    case "complete":
      return event.from_status === "broadcasted" && event.to_status === "completed";
    case "reject":
      return (
        (event.from_status === "reserved" || event.from_status === "reviewing")
        && event.to_status === "rejected"
      );
    case "admin_takeover":
      return (
        event.from_status !== null
        && ["reviewing", "send_locked", "broadcasted"].includes(event.from_status)
        && event.to_status === event.from_status
      );
  }
}

function validateRelationshipSet(
  withdrawal: WithdrawalRow,
  profiles: Map<string, ProfileRow>,
  events: EventRow[],
  broadcasts: BroadcastRow[],
  verifications: VerificationRow[],
): {
  publicEvents: Array<Record<string, unknown>>;
  publicBroadcasts: Array<Record<string, unknown>>;
  publicVerification: Record<string, unknown> | null;
} {
  const user = profiles.get(withdrawal.user_id);
  if (!user || user.is_admin) throw new Error("invalid_withdrawal_user");
  for (const adminId of [withdrawal.initial_admin_id, withdrawal.current_admin_id]) {
    if (adminId !== null && profiles.get(adminId)?.is_admin !== true) {
      throw new Error("invalid_withdrawal_admin");
    }
  }

  if (events.length === 0 || events.length >= RELATED_LIMIT) {
    throw new Error("missing_withdrawal_events");
  }
  let currentStatus: WithdrawalStatus | null = null;
  let requestCount = 0;
  let claimCount = 0;
  let sendLockCount = 0;
  let completeCount = 0;
  let rejectCount = 0;
  let recordCount = 0;
  let activeAdminId: string | null = null;
  let initialAdminId: string | null = null;
  let rejectedFromReserved = false;
  const eventBroadcastIds = new Set<string>();
  for (const event of events) {
    if (
      event.withdrawal_id !== withdrawal.id
      || event.user_id !== withdrawal.user_id
      || !expectedTransition(event)
      || (event.action_type === "request" && event.actor_id !== withdrawal.user_id)
      || (event.action_type !== "request" && profiles.get(event.actor_id)?.is_admin !== true)
      || event.from_status !== currentStatus
    ) {
      throw new Error("invalid_event_relationship");
    }
    if (event.action_type === "claim_review") {
      if (activeAdminId !== null || initialAdminId !== null) {
        throw new Error("duplicate_admin_claim");
      }
      activeAdminId = event.actor_id;
      initialAdminId = event.actor_id;
    } else if (event.action_type === "admin_takeover") {
      if (activeAdminId === null) throw new Error("takeover_without_claim");
      activeAdminId = event.actor_id;
    } else if (
      ["send_lock", "record_broadcast", "complete"].includes(event.action_type)
      && event.actor_id !== activeAdminId
    ) {
      throw new Error("invalid_admin_action_owner");
    } else if (event.action_type === "reject") {
      rejectedFromReserved = event.from_status === "reserved";
      if (!rejectedFromReserved && event.actor_id !== activeAdminId) {
        throw new Error("invalid_rejection_owner");
      }
    }
    currentStatus = event.to_status;
    if (event.action_type === "request") requestCount += 1;
    if (event.action_type === "claim_review") claimCount += 1;
    if (event.action_type === "send_lock") sendLockCount += 1;
    if (event.action_type === "complete") completeCount += 1;
    if (event.action_type === "reject") rejectCount += 1;
    if (event.action_type === "record_broadcast") {
      recordCount += 1;
      const broadcastId = event.result_snapshot.broadcast_id;
      const transactionHash = event.result_snapshot.transaction_hash;
      if (
        typeof broadcastId !== "string"
        || !UUID_PATTERN.test(broadcastId)
        || eventBroadcastIds.has(broadcastId)
        || typeof transactionHash !== "string"
        || !TRANSACTION_HASH_PATTERN.test(transactionHash)
      ) {
        throw new Error("invalid_broadcast_event");
      }
      eventBroadcastIds.add(broadcastId);
    }
  }
  if (
    currentStatus !== withdrawal.status
    || requestCount !== 1
    || claimCount > 1
    || sendLockCount > 1
    || completeCount > 1
    || rejectCount > 1
    || (withdrawal.status === "reserved" && events.length !== 1)
    || (["reviewing", "send_locked", "broadcasted", "completed"].includes(withdrawal.status)
      && claimCount !== 1)
    || (["send_locked", "broadcasted", "completed"].includes(withdrawal.status)
      && sendLockCount !== 1)
    || (withdrawal.status === "completed" && completeCount !== 1)
    || (withdrawal.status === "rejected" && rejectCount !== 1)
    || withdrawal.initial_admin_id !== initialAdminId
    || (
      rejectedFromReserved
        ? withdrawal.current_admin_id !== null || withdrawal.claimed_at !== null
        : withdrawal.current_admin_id !== activeAdminId
          || (initialAdminId !== null && withdrawal.claimed_at === null)
    )
  ) {
    throw new Error("invalid_event_chain");
  }

  const broadcastById = new Map<string, BroadcastRow>();
  for (const broadcast of broadcasts) {
    if (
      broadcastById.has(broadcast.id)
      || broadcast.withdrawal_id !== withdrawal.id
      || profiles.get(broadcast.recorded_by)?.is_admin !== true
      || broadcast.destination_address !== withdrawal.destination_address
      || decimalMicros(broadcast.net_amount_usdt) !== decimalMicros(withdrawal.net_amount_usdt)
      || !eventBroadcastIds.has(broadcast.id)
    ) {
      throw new Error("invalid_broadcast_relationship");
    }
    const event = events.find(
      (candidate) => candidate.result_snapshot.broadcast_id === broadcast.id,
    );
    if (
      event?.result_snapshot.transaction_hash !== broadcast.transaction_hash
      || event.actor_id !== broadcast.recorded_by
    ) {
      throw new Error("invalid_broadcast_event_relationship");
    }
    broadcastById.set(broadcast.id, broadcast);
  }
  if (recordCount !== broadcasts.length || recordCount !== eventBroadcastIds.size) {
    throw new Error("missing_broadcast_relationship");
  }

  if (withdrawal.current_broadcast_id === null) {
    if (broadcasts.length !== 0) throw new Error("orphan_broadcast");
  } else {
    const visited = new Set<string>();
    let cursor: string | null = withdrawal.current_broadcast_id;
    while (cursor !== null) {
      const row = broadcastById.get(cursor);
      if (!row || visited.has(cursor)) throw new Error("invalid_broadcast_chain");
      visited.add(cursor);
      cursor = row.supersedes_broadcast_id;
    }
    if (visited.size !== broadcasts.length) throw new Error("orphan_broadcast");
  }

  if (
    (withdrawal.status === "completed" && verifications.length !== 1)
    || (withdrawal.status !== "completed" && verifications.length !== 0)
  ) {
    throw new Error("invalid_verification_count");
  }
  const verification = verifications[0] ?? null;
  if (
    verification
    && (
      verification.withdrawal_id !== withdrawal.id
      || verification.broadcast_id !== withdrawal.current_broadcast_id
      || profiles.get(verification.verified_by)?.is_admin !== true
      || verification.destination_address !== withdrawal.destination_address
      || decimalMicros(verification.net_amount_usdt)
        !== decimalMicros(withdrawal.net_amount_usdt)
      || events.find((event) => event.action_type === "complete")?.actor_id
        !== verification.verified_by
    )
  ) {
    throw new Error("invalid_verification_relationship");
  }

  return {
    publicEvents: events.map((event) => ({
      action: event.action_type,
      from_status: event.from_status,
      to_status: event.to_status,
      created_at: event.created_at,
    })),
    publicBroadcasts: broadcasts.map((broadcast) => ({
      transaction_hash: broadcast.transaction_hash,
      recorded_at: broadcast.recorded_at,
      is_current: broadcast.id === withdrawal.current_broadcast_id,
      correction_reason: broadcast.correction_reason,
    })),
    publicVerification: verification
      ? {
          chain_id: verification.chain_id,
          token_contract: verification.token_contract,
          transaction_success: verification.transaction_success,
          exactly_one_matching_transfer: verification.exactly_one_matching_transfer,
          destination_address: verification.destination_address,
          net_amount_usdt: verification.net_amount_usdt,
          block_number: verification.block_number,
          transfer_log_index: verification.transfer_log_index,
          confirmations: verification.confirmations,
          verified_at: verification.verified_at,
        }
      : null,
  };
}

async function handleOverview(admin: AdminClient, adminId: string): Promise<Response> {
  const [configResult, withdrawalResult] = await Promise.all([
    admin
      .from("nowpayments_usdt_config")
      .select(
        "id,asset,network,provider_currency,withdrawals_enabled,withdrawal_minimum_usdt::text,withdrawal_fee_percent::text",
      )
      .eq("id", "USDT-BEP20")
      .maybeSingle(),
    admin
      .from("nowpayments_usdt_withdrawals")
      .select(
        "id,user_id,destination_address,asset,network,provider_currency,gross_amount_usdt::text,fee_percent::text,fee_amount_usdt::text,net_amount_usdt::text,status,requested_at,initial_admin_id,current_admin_id,claimed_at,send_locked_at,broadcasted_at,completed_at,rejected_at,rejection_reason,current_broadcast_id,created_at,updated_at",
      )
      .order("requested_at", { ascending: false })
      .limit(OVERVIEW_LIMIT + 1),
  ]);
  if (configResult.error || withdrawalResult.error) {
    return errorResponse(
      "withdrawal_admin_overview_unavailable",
      "USDT withdrawal administration is unavailable.",
      503,
    );
  }

  try {
    const config = configResult.data as unknown as Record<string, unknown> | null;
    if (
      !config
      || config.id !== "USDT-BEP20"
      || config.asset !== "USDT"
      || config.network !== "BEP20"
      || config.provider_currency !== "usdtbsc"
      || typeof config.withdrawals_enabled !== "boolean"
      || !isDecimal(config.withdrawal_minimum_usdt)
      || canonicalDecimal(config.withdrawal_minimum_usdt) !== "2"
      || !isDecimal(config.withdrawal_fee_percent)
      || canonicalDecimal(config.withdrawal_fee_percent) !== "5"
    ) {
      throw new Error("invalid_config");
    }
    const withdrawals = ((withdrawalResult.data ?? []) as unknown[]).map(validateWithdrawal);
    if (
      withdrawals.length > OVERVIEW_LIMIT
      || new Set(withdrawals.map((row) => row.id)).size !== withdrawals.length
    ) {
      throw new Error("invalid_withdrawal_count");
    }
    if (withdrawals.length === 0) {
      return json({
        withdrawals_enabled: config.withdrawals_enabled,
        asset: "USDT",
        network: "BEP20",
        minimum_withdrawal_usdt: config.withdrawal_minimum_usdt,
        withdrawal_fee_percent: config.withdrawal_fee_percent,
        required_confirmations: 120,
        withdrawals: [],
      }, 200);
    }

    const withdrawalIds = withdrawals.map((row) => row.id);
    const profileIds = new Set<string>();
    for (const withdrawal of withdrawals) {
      profileIds.add(withdrawal.user_id);
      if (withdrawal.initial_admin_id) profileIds.add(withdrawal.initial_admin_id);
      if (withdrawal.current_admin_id) profileIds.add(withdrawal.current_admin_id);
    }
    const [eventResult, broadcastResult, verificationResult] = await Promise.all([
      admin
        .from("nowpayments_usdt_withdrawal_events")
        .select(
          "id,withdrawal_id,user_id,actor_id,action_id,action_type,from_status,to_status,result_snapshot,created_at",
        )
        .in("withdrawal_id", withdrawalIds)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(RELATED_LIMIT),
      admin
        .from("nowpayments_usdt_withdrawal_broadcasts")
        .select(
          "id,withdrawal_id,recorded_by,transaction_hash,destination_address,net_amount_usdt::text,supersedes_broadcast_id,correction_reason,recorded_at",
        )
        .in("withdrawal_id", withdrawalIds)
        .order("recorded_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(RELATED_LIMIT),
      admin
        .from("nowpayments_usdt_withdrawal_verifications")
        .select(
          "id,withdrawal_id,broadcast_id,verified_by,chain_id,token_contract,transaction_success,exactly_one_matching_transfer,destination_address,net_amount_usdt::text,block_number,transfer_log_index,confirmations,verified_at,created_at",
        )
        .in("withdrawal_id", withdrawalIds)
        .limit(OVERVIEW_LIMIT + 1),
    ]);
    if (
      eventResult.error
      || broadcastResult.error
      || verificationResult.error
    ) {
      throw new Error("related_read_failed");
    }

    const events = ((eventResult.data ?? []) as unknown[]).map(validateEvent);
    const broadcasts = ((broadcastResult.data ?? []) as unknown[]).map(validateBroadcast);
    const verifications = ((verificationResult.data ?? []) as unknown[])
      .map(validateVerification);
    if (
      new Set(events.map((row) => row.id)).size !== events.length
      || new Set(events.map((row) => row.action_id)).size !== events.length
      || new Set(broadcasts.map((row) => row.id)).size !== broadcasts.length
      || new Set(broadcasts.map((row) => row.transaction_hash)).size !== broadcasts.length
      || new Set(verifications.map((row) => row.id)).size !== verifications.length
      || new Set(verifications.map((row) => row.withdrawal_id)).size !== verifications.length
      || new Set(verifications.map((row) => row.broadcast_id)).size !== verifications.length
    ) {
      throw new Error("duplicate_related_row");
    }
    for (const event of events) profileIds.add(event.actor_id);
    for (const broadcast of broadcasts) profileIds.add(broadcast.recorded_by);
    for (const verification of verifications) profileIds.add(verification.verified_by);
    const profileResult = await admin
      .from("profiles")
      .select("id,username,is_admin,is_frozen")
      .in("id", [...profileIds]);
    if (profileResult.error) throw new Error("profile_read_failed");
    const profiles = ((profileResult.data ?? []) as unknown[]).map(validateProfile);
    const profileMap = new Map(profiles.map((profile) => [profile.id, profile] as const));
    if (
      profiles.length !== profileMap.size
      || profileMap.size !== profileIds.size
      || [...profileIds].some((id) => !profileMap.has(id))
      || events.length >= RELATED_LIMIT
      || broadcasts.length >= RELATED_LIMIT
      || verifications.length > OVERVIEW_LIMIT
    ) {
      throw new Error("invalid_related_count");
    }

    const publicWithdrawals = withdrawals.map((withdrawal) => {
      const relationship = validateRelationshipSet(
        withdrawal,
        profileMap,
        events.filter((event) => event.withdrawal_id === withdrawal.id),
        broadcasts.filter((broadcast) => broadcast.withdrawal_id === withdrawal.id),
        verifications.filter((verification) => verification.withdrawal_id === withdrawal.id),
      );
      return {
        id: withdrawal.id,
        username: profileMap.get(withdrawal.user_id)!.username,
        destination_address: withdrawal.destination_address,
        gross_amount_usdt: withdrawal.gross_amount_usdt,
        fee_amount_usdt: withdrawal.fee_amount_usdt,
        net_amount_usdt: withdrawal.net_amount_usdt,
        status: withdrawal.status,
        requested_at: withdrawal.requested_at,
        claimed_at: withdrawal.claimed_at,
        send_locked_at: withdrawal.send_locked_at,
        broadcasted_at: withdrawal.broadcasted_at,
        completed_at: withdrawal.completed_at,
        rejected_at: withdrawal.rejected_at,
        rejection_reason: withdrawal.rejection_reason,
        assigned_to_current_admin: withdrawal.current_admin_id === adminId,
        events: relationship.publicEvents,
        broadcasts: relationship.publicBroadcasts,
        verification: relationship.publicVerification,
      };
    });

    return json({
      withdrawals_enabled: config.withdrawals_enabled,
      asset: "USDT",
      network: "BEP20",
      minimum_withdrawal_usdt: config.withdrawal_minimum_usdt,
      withdrawal_fee_percent: config.withdrawal_fee_percent,
      required_confirmations: 120,
      withdrawals: publicWithdrawals,
    }, 200);
  } catch {
    return errorResponse(
      "withdrawal_admin_overview_unavailable",
      "USDT withdrawal administration is unavailable.",
      503,
    );
  }
}

function parseContentLength(req: Request): number | null {
  const value = req.headers.get("content-length");
  if (value === null) return null;
  if (!/^\d+$/.test(value)) return Number.POSITIVE_INFINITY;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

async function parseBody(req: Request): Promise<AdminActionBody | null> {
  const contentType = (req.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "application/json") return null;
  const contentLength = parseContentLength(req);
  if (contentLength !== null && contentLength > MAX_BODY_BYTES) {
    throw new RangeError("request_body_too_large");
  }
  const text = await req.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new RangeError("request_body_too_large");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(value)) return null;
  if (
    typeof value.action !== "string"
    || typeof value.withdrawal_id !== "string"
    || !UUID_V4_PATTERN.test(value.withdrawal_id)
    || typeof value.action_id !== "string"
    || !UUID_V4_PATTERN.test(value.action_id)
  ) {
    return null;
  }

  if (value.action === "begin_review") {
    return exactFields(value, ["action", "withdrawal_id", "action_id"])
      ? value as unknown as AdminActionBody
      : null;
  }
  if (value.action === "reject") {
    return exactFields(value, ["action", "withdrawal_id", "action_id", "reason"])
      && isSafeText(value.reason, 500)
      ? value as unknown as AdminActionBody
      : null;
  }
  if (value.action === "send_lock") {
    return exactFields(value, [
      "action",
      "withdrawal_id",
      "action_id",
      "external_liquidity_confirmed",
      "destination_manually_verified",
      "irreversible_send_confirmed",
    ])
      && value.external_liquidity_confirmed === true
      && value.destination_manually_verified === true
      && value.irreversible_send_confirmed === true
      ? value as unknown as AdminActionBody
      : null;
  }
  if (value.action === "record_broadcast") {
    return exactFields(value, [
      "action",
      "withdrawal_id",
      "action_id",
      "transaction_hash",
      "correction_reason",
    ])
      && typeof value.transaction_hash === "string"
      && TRANSACTION_HASH_PATTERN.test(value.transaction_hash)
      && (
        value.correction_reason === null
        || isSafeText(value.correction_reason, 500)
      )
      ? value as unknown as AdminActionBody
      : null;
  }
  if (value.action === "complete") {
    return exactFields(value, [
      "action",
      "withdrawal_id",
      "action_id",
      "transaction_hash",
      "chain_id",
      "token_contract",
      "transaction_success",
      "exactly_one_matching_transfer",
      "destination_address",
      "net_amount_usdt",
      "block_number",
      "transfer_log_index",
      "confirmations",
      "verified_at",
    ])
      && typeof value.transaction_hash === "string"
      && TRANSACTION_HASH_PATTERN.test(value.transaction_hash)
      && value.chain_id === 56
      && value.token_contract === TOKEN_CONTRACT
      && value.transaction_success === true
      && value.exactly_one_matching_transfer === true
      && typeof value.destination_address === "string"
      && ADDRESS_PATTERN.test(value.destination_address)
      && isDecimal(value.net_amount_usdt)
      && decimalMicros(value.net_amount_usdt) > 0n
      && typeof value.block_number === "number"
      && Number.isSafeInteger(value.block_number)
      && value.block_number > 0
      && typeof value.transfer_log_index === "number"
      && Number.isSafeInteger(value.transfer_log_index)
      && value.transfer_log_index >= 0
      && typeof value.confirmations === "number"
      && Number.isSafeInteger(value.confirmations)
      && value.confirmations >= 120
      && isTimestamp(value.verified_at)
      && new Date(value.verified_at).getTime() <= Date.now()
      ? value as unknown as AdminActionBody
      : null;
  }
  return null;
}

function rpcErrorResponse(error: { code?: string; message?: string } | null): Response {
  const message = error?.message ?? "";
  if (message.includes("nowpayments_usdt_action_id_conflict") || error?.code === "23505") {
    return errorResponse(
      "admin_action_conflict",
      "This action key or transaction hash conflicts with existing evidence.",
      409,
    );
  }
  if (
    message.includes("invalid_nowpayments_usdt_withdrawal_state")
    || message.includes("invalid_nowpayments_usdt_withdrawal_owner_or_state")
    || message.includes("withdrawal_cannot_be_rejected_after_send_lock")
    || message.includes("broadcast_correction_requires_new_hash_and_reason")
    || message.includes("initial_broadcast_must_not_have_correction_reason")
  ) {
    return errorResponse(
      "admin_action_state_conflict",
      "The withdrawal state changed. Refresh before continuing.",
      409,
    );
  }
  if (message.includes("nowpayments_usdt_withdrawals_disabled")) {
    return errorResponse(
      "crypto_withdrawals_disabled",
      "USDT withdrawals are temporarily unavailable.",
      503,
    );
  }
  if (message.includes("nowpayments_usdt_withdrawal_not_found")) {
    return errorResponse("withdrawal_not_found", "Withdrawal not found.", 404);
  }
  if (message.includes("nowpayments_usdt_admin_ineligible")) {
    return errorResponse("administrator_unavailable", "Administrator access is unavailable.", 403);
  }
  if (
    message.includes("invalid_nowpayments_usdt_withdrawal")
    || message.includes("nowpayments_usdt_withdrawal_verification_mismatch")
    || message.includes("qhash_controlled_withdrawal_destination")
  ) {
    return errorResponse("invalid_admin_action", "Check the withdrawal evidence.", 400);
  }
  return errorResponse(
    "withdrawal_admin_action_failed",
    "The withdrawal action could not be completed.",
    500,
  );
}

function sanitizeActionResult(
  value: unknown,
  body: AdminActionBody,
): Record<string, unknown> | null {
  if (!isObject(value) || value.withdrawal_id !== body.withdrawal_id) return null;
  const expectedStatus: Record<AdminActionBody["action"], WithdrawalStatus> = {
    begin_review: "reviewing",
    reject: "rejected",
    send_lock: "send_locked",
    record_broadcast: "broadcasted",
    complete: "completed",
  };
  if (value.status !== expectedStatus[body.action]) return null;
  if (
    body.action === "record_broadcast"
    && value.transaction_hash !== body.transaction_hash
  ) {
    return null;
  }
  if (body.action === "complete" && value.transaction_hash !== body.transaction_hash) {
    return null;
  }
  return {
    status: expectedStatus[body.action],
    ...(body.action === "record_broadcast" || body.action === "complete"
      ? { transaction_hash: body.transaction_hash }
      : {}),
  };
}

async function handleAction(
  req: Request,
  admin: AdminClient,
  adminId: string,
): Promise<Response> {
  let body: AdminActionBody | null;
  try {
    body = await parseBody(req);
  } catch (error) {
    if (error instanceof RangeError) {
      return errorResponse("request_too_large", "Request body is too large.", 413);
    }
    return errorResponse("invalid_request", "Invalid request body.", 400);
  }
  if (!body) {
    const contentType = (req.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    return contentType === "application/json"
      ? errorResponse("invalid_request", "Invalid request body.", 400)
      : errorResponse("unsupported_media_type", "Use application/json.", 415);
  }

  let result: { data: unknown; error: { code?: string; message?: string } | null };
  switch (body.action) {
    case "begin_review":
      result = await admin.rpc("claim_nowpayments_usdt_withdrawal_review", {
        p_withdrawal_id: body.withdrawal_id,
        p_admin_id: adminId,
        p_action_id: body.action_id,
      });
      break;
    case "reject":
      result = await admin.rpc("reject_nowpayments_usdt_withdrawal", {
        p_withdrawal_id: body.withdrawal_id,
        p_admin_id: adminId,
        p_action_id: body.action_id,
        p_reason: body.reason,
      });
      break;
    case "send_lock":
      result = await admin.rpc("lock_nowpayments_usdt_withdrawal_send", {
        p_withdrawal_id: body.withdrawal_id,
        p_admin_id: adminId,
        p_action_id: body.action_id,
        p_external_liquidity_confirmed: true,
        p_destination_manually_verified: true,
      });
      break;
    case "record_broadcast":
      result = await admin.rpc("record_nowpayments_usdt_withdrawal_broadcast", {
        p_withdrawal_id: body.withdrawal_id,
        p_admin_id: adminId,
        p_action_id: body.action_id,
        p_transaction_hash: body.transaction_hash,
        p_correction_reason: body.correction_reason,
      });
      break;
    case "complete":
      result = await admin.rpc("complete_nowpayments_usdt_withdrawal", {
        p_withdrawal_id: body.withdrawal_id,
        p_admin_id: adminId,
        p_action_id: body.action_id,
        p_transaction_hash: body.transaction_hash,
        p_chain_id: 56,
        p_token_contract: TOKEN_CONTRACT,
        p_transaction_success: true,
        p_exactly_one_matching_transfer: true,
        p_destination_address: body.destination_address,
        p_net_amount_usdt: body.net_amount_usdt,
        p_block_number: body.block_number,
        p_transfer_log_index: body.transfer_log_index,
        p_confirmations: body.confirmations,
        p_verified_at: body.verified_at,
      });
      break;
  }
  if (result.error) return rpcErrorResponse(result.error);
  const response = sanitizeActionResult(result.data, body);
  if (!response) {
    return errorResponse(
      "withdrawal_admin_action_failed",
      "The withdrawal action could not be completed.",
      500,
    );
  }
  return json(response, 200);
}

export default async (req: Request, context?: Context): Promise<Response> => {
  if (!isPublishedProductionDeployContext(context)) {
    return errorResponse(
      "crypto_runtime_unavailable",
      "USDT withdrawal administration is unavailable.",
      503,
    );
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return errorResponse("method_not_allowed", "GET or POST only.", 405);
  }

  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL")
    ?? Netlify.env.get("SUPABASE_URL")
    ?? "";
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return errorResponse("server_config", "Server is not configured.", 500);
  }

  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || token === authorization) {
    return errorResponse("authentication_required", "Authentication required.", 401);
  }

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    return errorResponse("invalid_session", "Invalid or expired session.", 401);
  }
  const adminId = authData.user.id;
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id,is_admin,is_frozen")
    .eq("id", adminId)
    .maybeSingle();
  if (
    profileError
    || !profile
    || profile.id !== adminId
    || profile.is_admin !== true
    || profile.is_frozen === true
  ) {
    return errorResponse("administrator_unavailable", "Administrator access is unavailable.", 403);
  }

  return req.method === "GET"
    ? handleOverview(admin, adminId)
    : handleAction(req, admin, adminId);
};

export const config: Config = {
  path: "/api/admin/crypto/nowpayments/usdt-withdrawals",
};

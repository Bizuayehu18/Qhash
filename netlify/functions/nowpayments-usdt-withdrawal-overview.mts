import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/database.types.ts";
import { isPublishedProductionDeployContext } from "./lib/nowpayments-deploy-context.mts";

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;
const TRANSACTION_HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HISTORY_LIMIT = 100;
const WITHDRAWAL_STATUSES = new Set([
  "reserved",
  "reviewing",
  "send_locked",
  "broadcasted",
  "completed",
  "rejected",
]);

type WithdrawalRow = {
  id: string;
  user_id: string;
  destination_address: string;
  gross_amount_usdt: string;
  fee_percent: string;
  fee_amount_usdt: string;
  net_amount_usdt: string;
  status: string;
  requested_at: string;
  updated_at: string;
  broadcasted_at: string | null;
  completed_at: string | null;
  rejected_at: string | null;
  current_broadcast_id: string | null;
};

type BroadcastRow = {
  id: string;
  withdrawal_id: string;
  transaction_hash: string;
};

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

function canonicalDecimal(value: string): string {
  const [integer, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
}

function validateWithdrawal(value: unknown, userId: string): WithdrawalRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_withdrawal_read");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string"
    || !UUID_PATTERN.test(row.id)
    || row.user_id !== userId
    || typeof row.destination_address !== "string"
    || !ADDRESS_PATTERN.test(row.destination_address)
    || !isDecimal(row.gross_amount_usdt)
    || !isDecimal(row.fee_percent)
    || canonicalDecimal(row.fee_percent) !== "5"
    || !isDecimal(row.fee_amount_usdt)
    || !isDecimal(row.net_amount_usdt)
    || typeof row.status !== "string"
    || !WITHDRAWAL_STATUSES.has(row.status)
    || !isTimestamp(row.requested_at)
    || !isTimestamp(row.updated_at)
    || !isNullableTimestamp(row.broadcasted_at)
    || !isNullableTimestamp(row.completed_at)
    || !isNullableTimestamp(row.rejected_at)
    || (row.current_broadcast_id !== null
      && (typeof row.current_broadcast_id !== "string"
        || !UUID_PATTERN.test(row.current_broadcast_id)))
    || (row.status === "completed" && row.completed_at === null)
    || (row.status === "rejected" && row.rejected_at === null)
  ) {
    throw new Error("invalid_withdrawal_read");
  }
  return row as unknown as WithdrawalRow;
}

function validateBroadcast(value: unknown): BroadcastRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_broadcast_read");
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string"
    || !UUID_PATTERN.test(row.id)
    || typeof row.withdrawal_id !== "string"
    || !UUID_PATTERN.test(row.withdrawal_id)
    || typeof row.transaction_hash !== "string"
    || !TRANSACTION_HASH_PATTERN.test(row.transaction_hash)
  ) {
    throw new Error("invalid_broadcast_read");
  }
  return row as unknown as BroadcastRow;
}

export default async (req: Request, context?: Context): Promise<Response> => {
  if (!isPublishedProductionDeployContext(context)) {
    return json(
      { error: "crypto_runtime_unavailable", message: "USDT withdrawals are unavailable." },
      503,
    );
  }
  if (req.method !== "GET") {
    return json({ error: "method_not_allowed", message: "GET only." }, 405);
  }

  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL")
    ?? Netlify.env.get("SUPABASE_URL")
    ?? "";
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "server_config", message: "Server is not configured." }, 500);
  }

  const authorization = req.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token || token === authorization) {
    return json({ error: "authentication_required", message: "Authentication required." }, 401);
  }

  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    return json({ error: "invalid_session", message: "Invalid or expired session." }, 401);
  }
  const userId = authData.user.id;

  const [{ data: profile, error: profileError }, { data: config, error: configError }] =
    await Promise.all([
      admin.from("profiles").select("is_frozen,is_admin").eq("id", userId).maybeSingle(),
      admin
        .from("nowpayments_usdt_config")
        .select(
          "id,asset,network,provider_currency,withdrawals_enabled,withdrawal_minimum_usdt::text,withdrawal_fee_percent::text",
        )
        .eq("id", "USDT-BEP20")
        .maybeSingle(),
    ]);

  if (profileError || !profile || profile.is_frozen || profile.is_admin) {
    return json({ error: "account_unavailable", message: "Account is unavailable." }, 403);
  }
  const configRow = config as unknown as Record<string, unknown> | null;
  if (
    configError
    || !configRow
    || configRow.id !== "USDT-BEP20"
    || configRow.asset !== "USDT"
    || configRow.network !== "BEP20"
    || configRow.provider_currency !== "usdtbsc"
    || typeof configRow.withdrawals_enabled !== "boolean"
    || !isDecimal(configRow.withdrawal_minimum_usdt)
    || canonicalDecimal(configRow.withdrawal_minimum_usdt) !== "2"
    || !isDecimal(configRow.withdrawal_fee_percent)
    || canonicalDecimal(configRow.withdrawal_fee_percent) !== "5"
  ) {
    return json(
      { error: "withdrawal_overview_unavailable", message: "USDT withdrawals are unavailable." },
      503,
    );
  }

  const [walletResult, withdrawalsResult] = await Promise.all([
    admin
      .from("nowpayments_usdt_wallets")
      .select("user_id,asset,available_balance_usdt::text,reserved_balance_usdt::text")
      .eq("user_id", userId)
      .maybeSingle(),
    admin
      .from("nowpayments_usdt_withdrawals")
      .select(
        "id,user_id,destination_address,gross_amount_usdt::text,fee_percent::text,fee_amount_usdt::text,net_amount_usdt::text,status,requested_at,updated_at,broadcasted_at,completed_at,rejected_at,current_broadcast_id",
      )
      .eq("user_id", userId)
      .order("requested_at", { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);
  if (walletResult.error || withdrawalsResult.error) {
    return json(
      { error: "withdrawal_overview_unavailable", message: "USDT withdrawals are unavailable." },
      503,
    );
  }

  try {
    const wallet = walletResult.data as unknown as Record<string, unknown> | null;
    if (
      wallet
      && (
        wallet.user_id !== userId
        || wallet.asset !== "USDT"
        || !isDecimal(wallet.available_balance_usdt)
        || !isDecimal(wallet.reserved_balance_usdt)
      )
    ) {
      throw new Error("invalid_wallet_read");
    }

    const withdrawals = ((withdrawalsResult.data ?? []) as unknown[])
      .map((row) => validateWithdrawal(row, userId));
    if (new Set(withdrawals.map((row) => row.id)).size !== withdrawals.length) {
      throw new Error("duplicate_withdrawal_read");
    }
    const expectedBroadcasts = withdrawals.flatMap((row) => (
      row.current_broadcast_id
        ? [{ withdrawalId: row.id, broadcastId: row.current_broadcast_id }]
        : []
    ));
    const broadcastIds = expectedBroadcasts.map((row) => row.broadcastId);
    if (new Set(broadcastIds).size !== broadcastIds.length) {
      throw new Error("duplicate_broadcast_relationship");
    }
    let broadcasts: BroadcastRow[] = [];
    if (expectedBroadcasts.length > 0) {
      const withdrawalIds = expectedBroadcasts.map((row) => row.withdrawalId);
      const { data, error } = await admin
        .from("nowpayments_usdt_withdrawal_broadcasts")
        .select("id,withdrawal_id,transaction_hash")
        .in("id", broadcastIds)
        .in("withdrawal_id", withdrawalIds);
      if (error) throw new Error("broadcast_read_failed");
      broadcasts = ((data ?? []) as unknown[]).map(validateBroadcast);
      const expectedByBroadcastId = new Map(
        expectedBroadcasts.map((row) => [row.broadcastId, row.withdrawalId] as const),
      );
      const seenBroadcastIds = new Set<string>();
      const seenWithdrawalIds = new Set<string>();
      for (const broadcast of broadcasts) {
        if (
          seenBroadcastIds.has(broadcast.id)
          || seenWithdrawalIds.has(broadcast.withdrawal_id)
          || expectedByBroadcastId.get(broadcast.id) !== broadcast.withdrawal_id
        ) {
          throw new Error("invalid_broadcast_relationship");
        }
        seenBroadcastIds.add(broadcast.id);
        seenWithdrawalIds.add(broadcast.withdrawal_id);
      }
      if (
        broadcasts.length !== expectedBroadcasts.length
        || seenBroadcastIds.size !== expectedBroadcasts.length
      ) {
        throw new Error("broadcast_read_incomplete");
      }
    }
    const transactionHashes = new Map(
      broadcasts.map((row) => [row.id, row.transaction_hash] as const),
    );

    return json(
      {
        withdrawals_enabled: configRow.withdrawals_enabled,
        asset: "USDT",
        network: "BEP20",
        available_balance_usdt: wallet?.available_balance_usdt ?? "0",
        reserved_balance_usdt: wallet?.reserved_balance_usdt ?? "0",
        minimum_withdrawal_usdt: configRow.withdrawal_minimum_usdt,
        withdrawal_fee_percent: configRow.withdrawal_fee_percent,
        history: withdrawals.map((row) => ({
          status: row.status,
          destination: row.destination_address,
          gross_amount_usdt: row.gross_amount_usdt,
          fee_amount_usdt: row.fee_amount_usdt,
          net_amount_usdt: row.net_amount_usdt,
          requested_at: row.requested_at,
          updated_at: row.updated_at,
          transaction_hash: row.current_broadcast_id
            ? transactionHashes.get(row.current_broadcast_id) ?? null
            : null,
          completed_at: row.completed_at,
          rejected_at: row.rejected_at,
          rejection_message: row.status === "rejected" ? "Funds returned." : null,
        })),
      },
      200,
    );
  } catch {
    return json(
      { error: "withdrawal_overview_unavailable", message: "USDT withdrawals are unavailable." },
      503,
    );
  }
};

export const config: Config = {
  path: "/api/crypto/nowpayments/withdrawal-overview",
};

import { createServerFn } from "@tanstack/react-start";
import type { Json } from "../database.types.js";
import { logServerError, throwSafe } from "../errors.js";
import {
  runAdminBscConfirmationVerification,
  type AdminBscConfirmationDryRunRow,
} from "./crypto-bsc-confirmation-dry-run.js";
import { getAdminClient } from "./supabase-admin.js";

const CREDIT_CONFIRMATION_THRESHOLD = 20;
const CREDIT_TIMEOUT_DESCRIPTION = "BSC USDT manual credit";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const MAX_RATE_SCALED = 1_000_000n * 1_000_000n;
const MIN_RATE_SCALED = 1n * 1_000_000n;
const MAX_CREDIT_CENTS = 999_999_999_999_999_999n;

type EligibleCreditRow = AdminBscConfirmationDryRunRow & {
  depositId: string;
  userId: string;
  addressId: string;
  txHash: string;
  eventIndex: number;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  amountUsdt: string;
  storedBlockNumber: number;
  storedConfirmations: number;
  canonicalBlockNumber: number;
  calculatedConfirmations: number;
  status: "confirmed";
  verificationStatus: "canonical_verified";
};

type CreditRpcResult = {
  success: boolean;
  code: string;
  depositId: string | null;
  userId: string | null;
  transactionId: string | null;
  exchangeRateEtb: string | null;
  creditedAmountEtb: string | null;
  balanceBefore: string | null;
  balanceAfter: string | null;
  confirmations: number | null;
  creditedAt: string | null;
};

export type AdminBscCryptoCreditPreview = {
  depositId: string;
  userId: string;
  network: "BSC";
  asset: "USDT";
  amountUsdt: string;
  exchangeRateEtb: string;
  creditedAmountEtb: string;
  storedConfirmations: number;
  calculatedConfirmations: number;
  confirmationThreshold: number;
  canonicalBlockNumber: number;
  latestBlockNumber: number;
  canonicalVerificationStatus: "canonical_verified";
  verifiedAt: string;
};

export type AdminBscCryptoCreditResult = {
  success: true;
  code: "credited" | "already_credited";
  depositId: string;
  userId: string;
  transactionId: string;
  exchangeRateEtb: string;
  creditedAmountEtb: string;
  balanceBefore: string;
  balanceAfter: string;
  confirmations: number;
  creditedAt: string;
};

function validateBaseInput(data: unknown): { accessToken: string; depositId: string } {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Invalid crypto credit request.", "Missing request body");
  }

  const { accessToken, depositId } = data as Record<string, unknown>;
  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throwSafe("ADMIN", "Unauthorized.", "Missing access token");
  }

  if (typeof depositId !== "string" || !UUID_PATTERN.test(depositId.trim())) {
    throwSafe("ADMIN", "Invalid crypto deposit selection.", "Deposit ID is not a UUID");
  }

  return {
    accessToken: accessToken.trim(),
    depositId: depositId.trim().toLowerCase(),
  };
}

function validateCreditInput(data: unknown): {
  accessToken: string;
  depositId: string;
  expectedExchangeRateEtb: string;
  expectedCreditedAmountEtb: string;
} {
  const base = validateBaseInput(data);
  const { expectedExchangeRateEtb, expectedCreditedAmountEtb } = data as Record<string, unknown>;

  if (
    typeof expectedExchangeRateEtb !== "string" ||
    expectedExchangeRateEtb.length > 32 ||
    !DECIMAL_PATTERN.test(expectedExchangeRateEtb) ||
    typeof expectedCreditedAmountEtb !== "string" ||
    expectedCreditedAmountEtb.length > 32 ||
    !DECIMAL_PATTERN.test(expectedCreditedAmountEtb)
  ) {
    throwSafe("ADMIN", "Run a fresh credit verification first.", "Missing or invalid expected credit values");
  }

  return {
    ...base,
    expectedExchangeRateEtb,
    expectedCreditedAmountEtb,
  };
}

async function assertAdmin(accessToken: string): Promise<string> {
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
    throwSafe("ADMIN", "Unauthorized.", "Admin permission required for crypto crediting");
  }

  return user.id;
}

function decimalToScaled(value: string, scale: number): bigint | null {
  if (!DECIMAL_PATTERN.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) return null;

  try {
    return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
  } catch {
    return null;
  }
}

function formatScaled(value: bigint, scale: number, trimTrailingZeros: boolean): string {
  const base = 10n ** BigInt(scale);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(scale, "0");
  if (scale === 0) return whole.toString();
  const displayedFraction = trimTrailingZeros ? fraction.replace(/0+$/, "") : fraction;
  return displayedFraction.length > 0 ? `${whole}.${displayedFraction}` : whole.toString();
}

function calculateCreditPreview(amountUsdt: string, rateText: string): {
  exchangeRateEtb: string;
  creditedAmountEtb: string;
} {
  const amountScaled = decimalToScaled(amountUsdt, 6);
  const rateScaled = decimalToScaled(rateText, 6);

  if (
    amountScaled === null ||
    amountScaled <= 0n ||
    rateScaled === null ||
    rateScaled < MIN_RATE_SCALED ||
    rateScaled > MAX_RATE_SCALED
  ) {
    throwSafe("ADMIN", "The current crypto credit values are invalid.", "Invalid exact amount or exchange rate");
  }

  const productScaleDivisor = 10n ** 10n;
  const exactProduct = amountScaled * rateScaled;
  const roundedCents = (exactProduct + productScaleDivisor / 2n) / productScaleDivisor;

  if (roundedCents <= 0n || roundedCents > MAX_CREDIT_CENTS) {
    throwSafe("ADMIN", "The calculated ETB credit is outside the supported range.", "Credited amount is out of numeric(18,2) range");
  }

  return {
    exchangeRateEtb: formatScaled(rateScaled, 6, true),
    creditedAmountEtb: formatScaled(roundedCents, 2, false),
  };
}

async function loadRateText(): Promise<string> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "usdt_etb_rate")
    .single();

  if (error || !data || typeof data.value !== "string") {
    throwSafe("ADMIN", "Unable to load the current USDT/ETB rate.", `Rate lookup failed: ${error?.message ?? "missing row"}`);
  }

  return data.value.trim();
}

function isEligibleCreditRow(row: AdminBscConfirmationDryRunRow | undefined): row is EligibleCreditRow {
  return Boolean(
    row &&
    row.depositId &&
    row.userId &&
    row.addressId &&
    row.txHash &&
    row.eventIndex !== null &&
    row.fromAddress &&
    row.toAddress &&
    row.amountRaw &&
    row.amountUsdt &&
    row.storedBlockNumber !== null &&
    row.storedConfirmations !== null &&
    row.canonicalBlockNumber !== null &&
    row.calculatedConfirmations !== null &&
    row.calculatedConfirmations >= CREDIT_CONFIRMATION_THRESHOLD &&
    row.status === "confirmed" &&
    row.verificationStatus === "canonical_verified" &&
    row.alreadyConfirmed,
  );
}

async function verifyEligibleDeposit(accessToken: string, depositId: string): Promise<{
  row: EligibleCreditRow;
  latestBlockNumber: number;
}> {
  const verification = await runAdminBscConfirmationVerification({
    accessToken,
    confirmationThreshold: CREDIT_CONFIRMATION_THRESHOLD,
    candidateOffset: 0,
    candidateIds: [depositId],
  });

  const row = verification.rows[0];
  if (verification.candidateCount !== 1 || !isEligibleCreditRow(row) || row.depositId !== depositId) {
    const reason = row?.reason ?? "Confirmed candidate was not found";
    throwSafe(
      "ADMIN",
      "This deposit is not eligible for crediting. Recheck its confirmation audit.",
      `${CREDIT_TIMEOUT_DESCRIPTION}: ${reason}`,
    );
  }

  return { row, latestBlockNumber: verification.latestBlockNumber };
}

async function buildPreview(accessToken: string, depositId: string): Promise<{
  preview: AdminBscCryptoCreditPreview;
  row: EligibleCreditRow;
}> {
  const [{ row, latestBlockNumber }, rateText] = await Promise.all([
    verifyEligibleDeposit(accessToken, depositId),
    loadRateText(),
  ]);
  const amounts = calculateCreditPreview(row.amountUsdt, rateText);

  return {
    row,
    preview: {
      depositId: row.depositId,
      userId: row.userId,
      network: "BSC",
      asset: "USDT",
      amountUsdt: row.amountUsdt,
      exchangeRateEtb: amounts.exchangeRateEtb,
      creditedAmountEtb: amounts.creditedAmountEtb,
      storedConfirmations: row.storedConfirmations,
      calculatedConfirmations: row.calculatedConfirmations,
      confirmationThreshold: CREDIT_CONFIRMATION_THRESHOLD,
      canonicalBlockNumber: row.canonicalBlockNumber,
      latestBlockNumber,
      canonicalVerificationStatus: "canonical_verified",
      verifiedAt: new Date().toISOString(),
    },
  };
}

function toObject(value: Json): Record<string, Json | undefined> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, Json | undefined>;
}

function toStringOrNull(value: Json | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toSafeIntegerOrNull(value: Json | undefined): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function parseRpcResult(value: Json): CreditRpcResult | null {
  const result = toObject(value);
  if (!result || typeof result.success !== "boolean" || typeof result.code !== "string") return null;

  return {
    success: result.success,
    code: result.code,
    depositId: toStringOrNull(result.deposit_id),
    userId: toStringOrNull(result.user_id),
    transactionId: toStringOrNull(result.transaction_id),
    exchangeRateEtb: toStringOrNull(result.exchange_rate_etb),
    creditedAmountEtb: toStringOrNull(result.credited_amount_etb),
    balanceBefore: toStringOrNull(result.balance_before),
    balanceAfter: toStringOrNull(result.balance_after),
    confirmations: toSafeIntegerOrNull(result.confirmations),
    creditedAt: toStringOrNull(result.credited_at),
  };
}

function rpcFailureMessage(code: string): string {
  if (code === "rate_changed_or_invalid" || code === "credit_amount_changed_or_invalid") {
    return "The rate or ETB amount changed. Verify the credit again before continuing.";
  }
  if (code === "stale_or_ineligible" || code === "deposit_not_found") {
    return "The deposit changed and is no longer eligible. Refresh its audit state.";
  }
  if (code === "inconsistent_credit_state") {
    return "The deposit ledger is inconsistent. Do not retry until it is reviewed.";
  }
  if (code === "user_not_found" || code === "wallet_not_found") {
    return "The user's wallet is unavailable. No credit was applied.";
  }
  if (code === "admin_not_found" || code === "not_admin" || code === "admin_frozen") {
    return "Admin authorization changed. Sign in again before retrying.";
  }
  return "The database rejected this crypto credit. No successful credit was reported.";
}

export const previewAdminBscCryptoCreditFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateBaseInput(data))
  .handler(async ({ data }): Promise<AdminBscCryptoCreditPreview> => {
    await assertAdmin(data.accessToken);
    const { preview } = await buildPreview(data.accessToken, data.depositId);
    return preview;
  });

export const creditAdminBscCryptoDepositFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateCreditInput(data))
  .handler(async ({ data }): Promise<AdminBscCryptoCreditResult> => {
    const adminId = await assertAdmin(data.accessToken);
    const { preview, row } = await buildPreview(data.accessToken, data.depositId);

    const expectedRateScaled = decimalToScaled(data.expectedExchangeRateEtb, 6);
    const previewRateScaled = decimalToScaled(preview.exchangeRateEtb, 6);
    const expectedCreditCents = decimalToScaled(data.expectedCreditedAmountEtb, 2);
    const previewCreditCents = decimalToScaled(preview.creditedAmountEtb, 2);
    if (
      expectedRateScaled === null ||
      expectedCreditCents === null ||
      expectedRateScaled !== previewRateScaled ||
      expectedCreditCents !== previewCreditCents
    ) {
      throwSafe("ADMIN", "The rate or ETB amount changed. Verify the credit again.", "Credit preview stale before RPC");
    }

    const admin = getAdminClient();
    const { data: rpcData, error } = await admin.rpc("credit_confirmed_bsc_crypto_deposit", {
      p_deposit_id: row.depositId,
      p_admin_id: adminId,
      p_expected_user_id: row.userId,
      p_expected_address_id: row.addressId,
      p_expected_tx_hash: row.txHash,
      p_expected_event_index: row.eventIndex,
      p_expected_from_address: row.fromAddress,
      p_expected_to_address: row.toAddress,
      p_expected_amount_raw_text: row.amountRaw,
      p_expected_amount_usdt_text: row.amountUsdt,
      p_expected_block_number: row.storedBlockNumber,
      p_expected_confirmations: row.storedConfirmations,
      p_calculated_confirmations: row.calculatedConfirmations,
      p_expected_exchange_rate_etb_text: preview.exchangeRateEtb,
      p_expected_credited_amount_etb_text: preview.creditedAmountEtb,
    });

    if (error) {
      logServerError("bsc-manual-credit-rpc", error, { depositId: row.depositId });
      throwSafe("ADMIN", "The atomic crypto credit failed. No successful credit was reported.", `Credit RPC failed: ${error.message}`);
    }

    const result = parseRpcResult(rpcData);
    if (!result) {
      logServerError("bsc-manual-credit-invalid-rpc-result", new Error("Invalid credit RPC result"), { depositId: row.depositId });
      throwSafe("ADMIN", "The atomic crypto credit returned an invalid result.", "Invalid credit RPC response");
    }

    if (!result.success) {
      throwSafe("ADMIN", rpcFailureMessage(result.code), `Credit RPC rejected with ${result.code}`);
    }

    if (
      (result.code !== "credited" && result.code !== "already_credited") ||
      !result.depositId ||
      !result.userId ||
      !result.transactionId ||
      !result.exchangeRateEtb ||
      !result.creditedAmountEtb ||
      !result.balanceBefore ||
      !result.balanceAfter ||
      result.confirmations === null ||
      !result.creditedAt
    ) {
      logServerError("bsc-manual-credit-incomplete-rpc-result", new Error("Incomplete successful credit RPC result"), { depositId: row.depositId });
      throwSafe("ADMIN", "The atomic crypto credit returned an incomplete result.", "Incomplete successful credit RPC response");
    }

    return {
      success: true,
      code: result.code,
      depositId: result.depositId,
      userId: result.userId,
      transactionId: result.transactionId,
      exchangeRateEtb: result.exchangeRateEtb,
      creditedAmountEtb: result.creditedAmountEtb,
      balanceBefore: result.balanceBefore,
      balanceAfter: result.balanceAfter,
      confirmations: result.confirmations,
      creditedAt: result.creditedAt,
    };
  });

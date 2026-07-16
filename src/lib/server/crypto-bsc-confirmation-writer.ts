import { createServerFn } from "@tanstack/react-start";
import { logServerError, throwSafe } from "../errors.js";
import type { Json } from "../database.types.js";
import {
  runAdminBscConfirmationVerification,
  type AdminBscConfirmationDryRunRow,
} from "./crypto-bsc-confirmation-dry-run.js";
import { getAdminClient } from "./supabase-admin.js";

const MAX_CANDIDATES_PER_WRITE = 15;
const MAX_CONFIRMATION_THRESHOLD = 5_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ValidatedWriterInput = {
  accessToken: string;
  confirmationThreshold: number;
  candidateIds: string[];
};

type ConfirmationWriteStatus =
  | "confirmed"
  | "progressed"
  | "unchanged"
  | "already_confirmed"
  | "not_canonical"
  | "stale_or_ineligible"
  | "write_error";

type ConfirmationRpcResult = {
  success: boolean;
  code: string;
  confirmations: number | null;
  status: string | null;
  confirmedAt: string | null;
};

export type AdminBscConfirmationWriteRow = AdminBscConfirmationDryRunRow & {
  writeStatus: ConfirmationWriteStatus;
  persistedConfirmations: number | null;
  persistedStatus: "detected" | "confirmed" | null;
  persistedConfirmedAt: string | null;
  writeReason: string;
};

export type AdminBscConfirmationWriteResult = {
  dryRun: false;
  network: "BSC";
  latestBlockNumber: number;
  confirmationThreshold: number;
  requestedCandidateCount: number;
  loadedCandidateCount: number;
  missingOrProtectedCount: number;
  canonicalVerifiedCount: number;
  confirmedCount: number;
  progressedCount: number;
  unchangedCount: number;
  alreadyConfirmedCount: number;
  notCanonicalCount: number;
  staleOrIneligibleCount: number;
  writeErrorCount: number;
  rows: AdminBscConfirmationWriteRow[];
};

function validateInput(data: unknown): ValidatedWriterInput {
  if (!data || typeof data !== "object") {
    throwSafe("ADMIN", "Invalid confirmation update request.", "Missing request body");
  }

  const { accessToken, confirmationThreshold, candidateIds } = data as Record<string, unknown>;
  const threshold = Number(confirmationThreshold);

  if (typeof accessToken !== "string" || accessToken.trim().length === 0) {
    throwSafe("ADMIN", "Unauthorized.", "Missing access token");
  }

  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > MAX_CONFIRMATION_THRESHOLD) {
    throwSafe("ADMIN", "Invalid confirmation threshold.", "BSC confirmation threshold is invalid");
  }

  if (!Array.isArray(candidateIds) || candidateIds.length < 1 || candidateIds.length > MAX_CANDIDATES_PER_WRITE) {
    throwSafe("ADMIN", "Invalid confirmation candidate selection.", "Candidate ID count is invalid");
  }

  const normalizedIds = candidateIds.map((candidateId) =>
    typeof candidateId === "string" ? candidateId.trim().toLowerCase() : "",
  );

  if (normalizedIds.some((candidateId) => !UUID_PATTERN.test(candidateId))) {
    throwSafe("ADMIN", "Invalid confirmation candidate selection.", "Candidate ID is not a UUID");
  }

  if (new Set(normalizedIds).size !== normalizedIds.length) {
    throwSafe("ADMIN", "Invalid confirmation candidate selection.", "Candidate IDs must be unique");
  }

  return {
    accessToken: accessToken.trim(),
    confirmationThreshold: threshold,
    candidateIds: normalizedIds,
  };
}

function toObject(value: Json): Record<string, Json | undefined> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, Json | undefined>;
}

function toSafeIntegerOrNull(value: Json | undefined): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function toStringOrNull(value: Json | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseRpcResult(value: Json): ConfirmationRpcResult | null {
  const result = toObject(value);
  if (!result || typeof result.success !== "boolean" || typeof result.code !== "string") return null;

  const parsed: ConfirmationRpcResult = {
    success: result.success,
    code: result.code,
    confirmations: toSafeIntegerOrNull(result.confirmations),
    status: toStringOrNull(result.status),
    confirmedAt: toStringOrNull(result.confirmed_at),
  };

  if (
    parsed.success &&
    (
      parsed.confirmations === null ||
      (parsed.status !== "detected" && parsed.status !== "confirmed") ||
      (parsed.status === "confirmed" && !parsed.confirmedAt)
    )
  ) {
    return null;
  }

  return parsed;
}

function buildWriteRow(
  row: AdminBscConfirmationDryRunRow,
  writeStatus: ConfirmationWriteStatus,
  writeReason: string,
  persistedConfirmations: number | null = row.storedConfirmations,
  persistedStatus: "detected" | "confirmed" | null = row.status,
  persistedConfirmedAt: string | null = null,
): AdminBscConfirmationWriteRow {
  return {
    ...row,
    writeStatus,
    persistedConfirmations,
    persistedStatus,
    persistedConfirmedAt,
    writeReason,
  };
}

export const runAdminBscConfirmationWriterFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateInput(data))
  .handler(async ({ data }): Promise<AdminBscConfirmationWriteResult> => {
    const verification = await runAdminBscConfirmationVerification({
      accessToken: data.accessToken,
      confirmationThreshold: data.confirmationThreshold,
      candidateOffset: 0,
      candidateIds: data.candidateIds,
    });

    const admin = getAdminClient();
    const rows: AdminBscConfirmationWriteRow[] = [];

    for (const row of verification.rows) {
      if (row.status === "confirmed") {
        rows.push(buildWriteRow(
          row,
          "already_confirmed",
          "The row became confirmed before this write verification; no fields were changed.",
        ));
        continue;
      }

      if (row.status !== "detected" || row.verificationStatus !== "canonical_verified") {
        rows.push(buildWriteRow(
          row,
          "not_canonical",
          `No fields were changed: ${row.reason}`,
        ));
        continue;
      }

      const {
        depositId,
        userId,
        addressId,
        txHash,
        eventIndex,
        fromAddress,
        toAddress,
        amountRaw,
        amountUsdt,
        storedBlockNumber,
        storedConfirmations,
        calculatedConfirmations,
      } = row;

      if (
        !depositId ||
        !userId ||
        !addressId ||
        !txHash ||
        eventIndex === null ||
        !fromAddress ||
        !toAddress ||
        !amountRaw ||
        !amountUsdt ||
        storedBlockNumber === null ||
        storedConfirmations === null ||
        calculatedConfirmations === null
      ) {
        rows.push(buildWriteRow(
          row,
          "not_canonical",
          "No fields were changed because required exact verification fields were unavailable.",
        ));
        continue;
      }

      const nextConfirmations = Math.max(storedConfirmations, calculatedConfirmations);
      const shouldConfirm = calculatedConfirmations >= data.confirmationThreshold;

      if (nextConfirmations === storedConfirmations && !shouldConfirm) {
        rows.push(buildWriteRow(
          row,
          "unchanged",
          "Canonical confirmation progress did not exceed the stored value and the threshold is not reached.",
        ));
        continue;
      }

      const { data: rpcData, error } = await admin.rpc("apply_bsc_crypto_deposit_confirmation", {
        p_deposit_id: depositId,
        p_expected_user_id: userId,
        p_expected_address_id: addressId,
        p_expected_tx_hash: txHash,
        p_expected_event_index: eventIndex,
        p_expected_from_address: fromAddress,
        p_expected_to_address: toAddress,
        p_expected_amount_raw_text: amountRaw,
        p_expected_amount_usdt_text: amountUsdt,
        p_expected_block_number: storedBlockNumber,
        p_expected_confirmations: storedConfirmations,
        p_calculated_confirmations: calculatedConfirmations,
        p_confirmation_threshold: data.confirmationThreshold,
      });

      if (error) {
        logServerError("bsc-confirmation-writer-rpc", error, { depositId });
        rows.push(buildWriteRow(
          row,
          "write_error",
          "The atomic database update failed; no successful update was reported for this row.",
        ));
        continue;
      }

      const rpcResult = parseRpcResult(rpcData);
      if (!rpcResult) {
        logServerError("bsc-confirmation-writer-invalid-rpc-result", new Error("Invalid confirmation RPC result"), { depositId });
        rows.push(buildWriteRow(
          row,
          "write_error",
          "The atomic database update returned an invalid result.",
        ));
        continue;
      }

      if (!rpcResult.success) {
        rows.push(buildWriteRow(
          row,
          rpcResult.code === "stale_or_ineligible" ? "stale_or_ineligible" : "write_error",
          rpcResult.code === "stale_or_ineligible"
            ? "No fields were changed because the row changed after verification or is no longer eligible."
            : "The atomic database update rejected the candidate.",
        ));
        continue;
      }

      const persistedStatus = rpcResult.status === "confirmed" || rpcResult.status === "detected"
        ? rpcResult.status
        : null;
      const writeStatus: ConfirmationWriteStatus = persistedStatus === "confirmed" ? "confirmed" : "progressed";

      rows.push(buildWriteRow(
        row,
        writeStatus,
        writeStatus === "confirmed"
          ? "Canonical receipt/log revalidated and the detected row was marked confirmed."
          : "Canonical receipt/log revalidated and confirmation progress was increased monotonically.",
        rpcResult.confirmations,
        persistedStatus,
        rpcResult.confirmedAt,
      ));
    }

    const count = (status: ConfirmationWriteStatus) => rows.filter((row) => row.writeStatus === status).length;

    return {
      dryRun: false,
      network: "BSC",
      latestBlockNumber: verification.latestBlockNumber,
      confirmationThreshold: data.confirmationThreshold,
      requestedCandidateCount: data.candidateIds.length,
      loadedCandidateCount: verification.candidateCount,
      missingOrProtectedCount: Math.max(0, data.candidateIds.length - verification.candidateCount),
      canonicalVerifiedCount: verification.canonicalVerifiedCount,
      confirmedCount: count("confirmed"),
      progressedCount: count("progressed"),
      unchangedCount: count("unchanged"),
      alreadyConfirmedCount: count("already_confirmed"),
      notCanonicalCount: count("not_canonical"),
      staleOrIneligibleCount: count("stale_or_ineligible"),
      writeErrorCount: count("write_error"),
      rows,
    };
  });

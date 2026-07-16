import { useState } from "react";
import { CheckCircle2, ExternalLink, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { withTimeout } from "@/lib/async.js";
import {
  runAdminBscConfirmationDryRunFn,
  type AdminBscConfirmationDryRunResult,
  type AdminBscConfirmationDryRunRow,
} from "@/lib/server/crypto-bsc-confirmation-dry-run.js";
import { useAuthStore } from "@/store/authStore.js";

const ADMIN_BSC_CONFIRMATION_DRY_RUN_TIMEOUT_MS = 60_000;
const DEFAULT_CONFIRMATION_THRESHOLD = "20";
const MAX_CONFIRMATION_THRESHOLD = 5_000;
const MAX_CANDIDATE_OFFSET = 10_000;

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

function parseConfirmationThreshold(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= MAX_CONFIRMATION_THRESHOLD
    ? parsed
    : null;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatOptionalCount(value: number | null): string {
  return value === null ? "—" : formatCount(value);
}

function shortValue(value: string | null): string {
  if (!value) return "—";
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function verificationLabel(status: AdminBscConfirmationDryRunRow["verificationStatus"]): string {
  const labels: Record<AdminBscConfirmationDryRunRow["verificationStatus"], string> = {
    canonical_verified: "canonical verified",
    malformed_row: "malformed row",
    receipt_missing: "receipt missing",
    receipt_not_successful: "receipt failed",
    log_missing: "log missing",
    log_removed: "log removed",
    log_mismatch: "log mismatch",
    block_mismatch: "block mismatch",
    rpc_error: "RPC error",
  };
  return labels[status];
}

function verificationVariant(status: AdminBscConfirmationDryRunRow["verificationStatus"]): BadgeVariant {
  if (status === "canonical_verified") return "success";
  if (status === "rpc_error" || status === "receipt_missing") return "warning";
  if (status === "malformed_row" || status === "receipt_not_successful" || status === "log_removed") return "danger";
  return "default";
}

function candidateStatusVariant(status: AdminBscConfirmationDryRunRow["status"]): BadgeVariant {
  if (status === "confirmed") return "success";
  if (status === "detected") return "warning";
  return "default";
}

function SummaryItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[#1a1a1a] bg-[#0d0d0d] p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-700">{label}</p>
      <p className="mt-1 font-mono text-xs text-gray-200">
        {typeof value === "number" ? formatCount(value) : value}
      </p>
    </div>
  );
}

function ConfirmationDryRunRow({ row }: { row: AdminBscConfirmationDryRunRow }) {
  const explorerUrl = row.txHash && /^0x[0-9a-f]{64}$/i.test(row.txHash)
    ? `https://bscscan.com/tx/${row.txHash}`
    : null;
  const verified = row.verificationStatus === "canonical_verified";

  return (
    <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] p-3 text-[11px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge variant={candidateStatusVariant(row.status)}>{row.status ?? "invalid status"}</Badge>
            <Badge variant={verificationVariant(row.verificationStatus)}>{verificationLabel(row.verificationStatus)}</Badge>
            {row.wouldMarkConfirmed ? <Badge variant="info">would confirm</Badge> : null}
            {row.alreadyConfirmed ? <Badge variant="success">already confirmed</Badge> : null}
          </div>
          <p className="font-mono text-[#00ff41]" title={row.txHash ?? undefined}>{shortValue(row.txHash)}</p>
        </div>
        {explorerUrl ? (
          <a
            href={explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#1f1f1f] px-2 py-1 text-[10px] text-gray-500 transition-colors hover:text-[#00ff41]"
          >
            <ExternalLink size={11} /> BscScan
          </a>
        ) : null}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div>
          <span className="block text-gray-700">Amount</span>
          <span className="font-mono text-gray-200">{row.amountUsdt ? `${row.amountUsdt} USDT` : "—"}</span>
          <span className="mt-0.5 block break-all font-mono text-[10px] text-gray-700">raw {row.amountRaw ?? "—"}</span>
        </div>
        <div>
          <span className="block text-gray-700">Stored / canonical block</span>
          <span className="font-mono text-gray-500">
            {formatOptionalCount(row.storedBlockNumber)} / {formatOptionalCount(row.canonicalBlockNumber)}
          </span>
        </div>
        <div>
          <span className="block text-gray-700">Stored / calculated confirmations</span>
          <span className="font-mono text-gray-500">
            {formatOptionalCount(row.storedConfirmations)} / {formatOptionalCount(row.calculatedConfirmations)}
          </span>
        </div>
        <div>
          <span className="block text-gray-700">Threshold / event index</span>
          <span className="font-mono text-gray-500">
            {formatCount(row.confirmationThreshold)} / {formatOptionalCount(row.eventIndex)}
          </span>
        </div>
        <div>
          <span className="block text-gray-700">From</span>
          <span className="font-mono text-gray-500" title={row.fromAddress ?? undefined}>{shortValue(row.fromAddress)}</span>
        </div>
        <div>
          <span className="block text-gray-700">To assigned address</span>
          <span className="font-mono text-gray-500" title={row.toAddress ?? undefined}>{shortValue(row.toAddress)}</span>
        </div>
        <div>
          <span className="block text-gray-700">Deposit ID</span>
          <span className="font-mono text-gray-500" title={row.depositId ?? undefined}>{shortValue(row.depositId)}</span>
        </div>
        <div>
          <span className="block text-gray-700">User / address row</span>
          <span className="font-mono text-gray-500" title={row.userId ?? undefined}>{shortValue(row.userId)}</span>
          <span className="mt-0.5 block font-mono text-[10px] text-gray-700" title={row.addressId ?? undefined}>{shortValue(row.addressId)}</span>
        </div>
      </div>

      <div className={`mt-3 rounded-lg border p-2.5 leading-relaxed ${verified ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-100/80" : "border-amber-500/20 bg-amber-500/5 text-amber-100/80"}`}>
        {row.reason}
      </div>
    </div>
  );
}

export function AdminCryptoBscConfirmationDryRunPanel({ userId }: { userId: string | undefined }) {
  const accessToken = useAuthStore((state) => state.session?.access_token ?? null);
  const [confirmationThreshold, setConfirmationThreshold] = useState(DEFAULT_CONFIRMATION_THRESHOLD);
  const [candidateOffset, setCandidateOffset] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AdminBscConfirmationDryRunResult | null>(null);

  const runDryRun = async (nextOffset: number) => {
    if (!userId || running) return;

    if (!accessToken) {
      toast.error("Session expired. Please sign in again.");
      return;
    }

    const parsedThreshold = parseConfirmationThreshold(confirmationThreshold);
    if (parsedThreshold === null) {
      toast.error("Confirmation threshold must be a whole number between 1 and 5,000.");
      return;
    }

    if (!Number.isSafeInteger(nextOffset) || nextOffset < 0 || nextOffset > MAX_CANDIDATE_OFFSET) {
      toast.error("Candidate page is outside the supported dry-run range.");
      return;
    }

    setRunning(true);
    try {
      const dryRunResult = await withTimeout(
        runAdminBscConfirmationDryRunFn({
          data: {
            accessToken,
            confirmationThreshold: parsedThreshold,
            candidateOffset: nextOffset,
          },
        }),
        ADMIN_BSC_CONFIRMATION_DRY_RUN_TIMEOUT_MS,
        "BSC confirmation dry-run request timed out.",
      );

      setCandidateOffset(dryRunResult.candidateOffset);
      setResult(dryRunResult);
      toast.success(
        `Confirmation dry-run complete: ${dryRunResult.canonicalVerifiedCount} canonical, ${dryRunResult.wouldMarkConfirmedCount} would confirm.`,
      );
    } catch (error) {
      toast.error(getSafeErrorMessage(error, "ADMIN").message);
    } finally {
      setRunning(false);
    }
  };

  const previousOffset = result ? Math.max(0, result.candidateOffset - result.candidateLimit) : 0;
  const nextOffset = result ? result.candidateOffset + result.candidateLimit : 0;
  const canLoadNext = Boolean(result?.hasMoreCandidates) && nextOffset <= MAX_CANDIDATE_OFFSET;

  return (
    <div className="space-y-4 rounded-xl border border-[rgba(0,255,65,0.15)] bg-[#111] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} className="text-[#00ff41]" />
            <span className="text-xs font-semibold">BSC Confirmation Dry-Run</span>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            Revalidates stored BSC USDT deposits against canonical receipts and previews confirmation eligibility.
          </p>
        </div>
        <Badge variant="warning">Read-only</Badge>
      </div>

      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 text-[11px] leading-relaxed text-blue-100/80">
        This admin tool only reads deposit rows and BSC receipts. It does not update confirmations or statuses, credit wallets, change balances,
        insert wallet transactions, expose addresses to users, sweep, sign, or move funds.
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          label="Confirmation threshold"
          type="number"
          min="1"
          max={String(MAX_CONFIRMATION_THRESHOLD)}
          step="1"
          inputMode="numeric"
          disabled={running}
          value={confirmationThreshold}
          onChange={(event) => {
            setConfirmationThreshold(event.target.value);
            setCandidateOffset(0);
            setResult(null);
          }}
          hint="Whole-number confirmations required for the preview. Default: 20."
        />
        <div className="flex items-end">
          <Button size="sm" loading={running} onClick={() => void runDryRun(0)}>
            <CheckCircle2 size={13} /> Run Confirmation Dry-Run
          </Button>
        </div>
      </div>

      {result ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryItem label="Latest BSC block" value={result.latestBlockNumber} />
            <SummaryItem label="Threshold" value={result.confirmationThreshold} />
            <SummaryItem label="Candidate offset" value={result.candidateOffset} />
            <SummaryItem label="Candidates on page" value={result.candidateCount} />
            <SummaryItem label="Canonical verified" value={result.canonicalVerifiedCount} />
            <SummaryItem label="Would confirm" value={result.wouldMarkConfirmedCount} />
            <SummaryItem label="Already confirmed" value={result.alreadyConfirmedCount} />
            <SummaryItem label="Below threshold" value={result.belowThresholdCount} />
            <SummaryItem label="Malformed rows" value={result.malformedRowCount} />
            <SummaryItem label="Receipt missing" value={result.receiptMissingCount} />
            <SummaryItem label="Receipt failed" value={result.receiptNotSuccessfulCount} />
            <SummaryItem label="Log missing" value={result.logMissingCount} />
            <SummaryItem label="Log removed" value={result.logRemovedCount} />
            <SummaryItem label="Log mismatch" value={result.logMismatchCount} />
            <SummaryItem label="Block mismatch" value={result.blockMismatchCount} />
            <SummaryItem label="RPC errors" value={result.rpcErrorCount} />
          </div>

          {result.resultsTruncated ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-200/80">
              More BSC deposit candidates remain after this {formatCount(result.candidateLimit)}-row page.
              {result.hasMoreCandidates && !canLoadNext ? " The server's maximum candidate offset has been reached." : null}
            </div>
          ) : null}

          {result.rows.length === 0 ? (
            <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] p-6 text-center text-xs text-gray-600">
              No detected or confirmed BSC USDT deposit candidates found on this page.
            </div>
          ) : (
            <div className="grid gap-2 lg:grid-cols-2">
              {result.rows.map((row, index) => (
                <ConfirmationDryRunRow key={row.depositId ?? `${row.txHash ?? "candidate"}:${index}`} row={row} />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-gray-600">
              Showing offset {formatCount(candidateOffset)} with up to {formatCount(result.candidateLimit)} candidates.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={running || result.candidateOffset === 0}
                onClick={() => void runDryRun(previousOffset)}
              >
                Previous Page
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={running || !canLoadNext}
                onClick={() => void runDryRun(nextOffset)}
              >
                Next Page
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] p-4 text-[11px] leading-relaxed text-gray-600">
          Run the dry-run to inspect the latest detected and confirmed BSC USDT rows. No database values will be changed.
        </div>
      )}
    </div>
  );
}

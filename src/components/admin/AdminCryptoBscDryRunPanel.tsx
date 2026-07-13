import { useState } from "react";
import { Activity, Database, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { withTimeout } from "@/lib/async.js";
import {
  runAdminBscDetectedStorageFn,
  runAdminBscDryRunDetectorFn,
  type AdminBscDetectedStorageResult,
  type AdminBscDryRunDetectorResult,
  type AdminBscDryRunMatchedEvent,
} from "@/lib/server/crypto-bsc-dry-run-detector.js";
import { useAuthStore } from "@/store/authStore.js";

const ADMIN_BSC_DETECTOR_TIMEOUT_MS = 60_000;
const MAX_BLOCK_DIFFERENCE = 2_000;

type BlockRange = {
  fromBlock: number;
  toBlock: number;
};

function parseBlockNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function validateBlockRange(fromBlock: string, toBlock: string): BlockRange | null {
  const parsedFromBlock = parseBlockNumber(fromBlock);
  const parsedToBlock = parseBlockNumber(toBlock);

  if (parsedFromBlock === null || parsedToBlock === null) {
    toast.error("Enter valid numeric BSC block numbers.");
    return null;
  }

  if (parsedToBlock < parsedFromBlock) {
    toast.error("To block must be greater than or equal to from block.");
    return null;
  }

  if (parsedToBlock - parsedFromBlock > MAX_BLOCK_DIFFERENCE) {
    toast.error("BSC detector range is limited to a 2,000-block difference.");
    return null;
  }

  return { fromBlock: parsedFromBlock, toBlock: parsedToBlock };
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function shortHex(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function BscDryRunEventRow({ event }: { event: AdminBscDryRunMatchedEvent }) {
  return (
    <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] p-3 text-[11px]">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge variant="default">BSC</Badge>
            <Badge variant="success">dry-run</Badge>
            <Badge variant="default">event #{event.eventIndex}</Badge>
          </div>
          <p className="font-mono text-[#00ff41]" title={event.txHash}>
            {shortHex(event.txHash)}
          </p>
        </div>
        <a
          href={`https://bscscan.com/tx/${event.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#1f1f1f] px-2 py-1 text-[10px] text-gray-500 transition-colors hover:text-[#00ff41]"
        >
          <ExternalLink size={11} /> BscScan
        </a>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <span className="block text-gray-700">Amount</span>
          <span className="font-mono text-gray-200">{event.amountUsdt} USDT</span>
          <span className="mt-0.5 block break-all font-mono text-[10px] text-gray-700">raw {event.amountRaw}</span>
        </div>
        <div>
          <span className="block text-gray-700">Block</span>
          <span className="font-mono text-gray-200">{formatCount(event.blockNumber)}</span>
        </div>
        <div>
          <span className="block text-gray-700">From</span>
          <span className="font-mono text-gray-500" title={event.fromAddress}>{shortHex(event.fromAddress)}</span>
        </div>
        <div>
          <span className="block text-gray-700">Recipient</span>
          <span className="font-mono text-gray-500" title={event.recipient}>{shortHex(event.recipient)}</span>
        </div>
        <div>
          <span className="block text-gray-700">User ID</span>
          <span className="font-mono text-gray-500" title={event.userId}>{shortHex(event.userId)}</span>
        </div>
        <div>
          <span className="block text-gray-700">Address Row</span>
          <span className="font-mono text-gray-500" title={event.addressId}>{shortHex(event.addressId)}</span>
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-[#1a1a1a] bg-[#0d0d0d] p-3">
      <p className="text-[10px] uppercase tracking-wide text-gray-700">{label}</p>
      <p className="mt-1 font-mono text-xs text-gray-200">{typeof value === "number" ? formatCount(value) : value}</p>
    </div>
  );
}

function StorageResultPanel({ result }: { result: AdminBscDetectedStorageResult }) {
  return (
    <div className="space-y-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-blue-100/90">
          <Database size={13} /> Detected-row storage result
        </div>
        <Badge variant="default">detected only</Badge>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryItem label="Block range" value={`${formatCount(result.fromBlock)} → ${formatCount(result.toBlock)}`} />
        <SummaryItem label="Matched events" value={result.totalMatchedEvents} />
        <SummaryItem label="Attempted inserts" value={result.attemptedInsertCount} />
        <SummaryItem label="Inserted detected" value={result.insertedDetectedCount} />
        <SummaryItem label="Already seen" value={result.duplicateDetectedCount} />
        <SummaryItem label="RPC batches" value={result.rpcBatchCount} />
        <SummaryItem label="Returned logs" value={result.scannedLogCount} />
        <SummaryItem label="Assigned addresses" value={result.assignedAddressCount} />
        <SummaryItem label="Malformed skipped" value={result.skippedMalformedLogs} />
        <SummaryItem label="Unassigned skipped" value={result.skippedUnassignedLogs} />
        <SummaryItem label="Zero amount skipped" value={result.skippedZeroAmountLogs} />
        <SummaryItem label="Below scale skipped" value={result.skippedBelowStorageScaleLogs} />
      </div>

      <div className="rounded-lg border border-blue-500/20 bg-[#0d0d0d] p-3 text-[11px] leading-relaxed text-blue-100/80">
        Stored rows, when inserted, remain at <span className="font-mono">status=detected</span> with zero confirmations and no ETB credit fields. User crypto history remains gated while crypto deposits are disabled.
        {result.invalidAssignedAddressCount > 0 ? <p className="mt-1 text-amber-200/80">{formatCount(result.invalidAssignedAddressCount)} assigned BSC address row(s) were invalid and ignored.</p> : null}
      </div>
    </div>
  );
}

export function AdminCryptoBscDryRunPanel({ userId }: { userId: string | undefined }) {
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);
  const [fromBlock, setFromBlock] = useState("");
  const [toBlock, setToBlock] = useState("");
  const [runningDryRun, setRunningDryRun] = useState(false);
  const [storingDetectedRows, setStoringDetectedRows] = useState(false);
  const [result, setResult] = useState<AdminBscDryRunDetectorResult | null>(null);
  const [storageResult, setStorageResult] = useState<AdminBscDetectedStorageResult | null>(null);

  const inspectedRangeMatchesInputs =
    result !== null && result.fromBlock === parseBlockNumber(fromBlock) && result.toBlock === parseBlockNumber(toBlock);

  const clearInspectionResults = () => {
    setResult(null);
    setStorageResult(null);
  };

  const handleRunDryRun = async () => {
    if (!userId || runningDryRun || storingDetectedRows) return;

    if (!accessToken) {
      toast.error("Session expired. Please sign in again.");
      return;
    }

    const range = validateBlockRange(fromBlock, toBlock);
    if (!range) return;

    setRunningDryRun(true);
    try {
      const dryRunResult = await withTimeout(
        runAdminBscDryRunDetectorFn({
          data: {
            accessToken,
            fromBlock: range.fromBlock,
            toBlock: range.toBlock,
          },
        }),
        ADMIN_BSC_DETECTOR_TIMEOUT_MS,
        "BSC dry-run detector request timed out.",
      );

      setResult(dryRunResult);
      setStorageResult(null);
      toast.success(`BSC dry-run complete: ${dryRunResult.totalMatchedEvents} matched event${dryRunResult.totalMatchedEvents === 1 ? "" : "s"}.`);
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "ADMIN").message);
    } finally {
      setRunningDryRun(false);
    }
  };

  const handleStoreDetectedRows = async () => {
    if (!userId || runningDryRun || storingDetectedRows) return;

    if (!accessToken) {
      toast.error("Session expired. Please sign in again.");
      return;
    }

    const range = validateBlockRange(fromBlock, toBlock);
    if (!range) return;

    if (!result || result.fromBlock !== range.fromBlock || result.toBlock !== range.toBlock) {
      toast.error("Run a dry-run for this exact BSC block range before storing detected rows.");
      return;
    }

    const confirmed = window.confirm(
      "This admin action stores matched BSC USDT rows as detected audit records only. It does not credit users, change balances, or advance watcher state. Continue?",
    );

    if (!confirmed) return;

    setStoringDetectedRows(true);
    setStorageResult(null);
    try {
      const detectedStorageResult = await withTimeout(
        runAdminBscDetectedStorageFn({
          data: {
            accessToken,
            fromBlock: range.fromBlock,
            toBlock: range.toBlock,
          },
        }),
        ADMIN_BSC_DETECTOR_TIMEOUT_MS,
        "BSC detected-row storage request timed out.",
      );

      setStorageResult(detectedStorageResult);
      toast.success(`BSC storage complete: ${detectedStorageResult.insertedDetectedCount} inserted, ${detectedStorageResult.duplicateDetectedCount} already seen.`);
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "ADMIN").message);
    } finally {
      setStoringDetectedRows(false);
    }
  };

  return (
    <div className="rounded-xl border border-[rgba(0,255,65,0.15)] bg-[#111] p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity size={14} className="text-[#00ff41]" />
            <span className="text-xs font-semibold">BSC Detector</span>
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            Admin-only BSC USDT Transfer detection. Dry-run previews events; detected storage stores audit rows only.
          </p>
        </div>
        <Badge variant="warning">Admin only</Badge>
      </div>

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-200/80">
        This tool scans BSC USDT Transfer events for the block range you enter and matches only assigned active BSC addresses.
        Detected storage inserts audit rows with status detected only. It does not credit users, update balances, advance watcher state, expose addresses to users, or perform fund movement.
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Input
          label="From block"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          placeholder="e.g. 52000000"
          value={fromBlock}
          onChange={(e) => {
            setFromBlock(e.target.value);
            clearInspectionResults();
          }}
          hint="Start of the BSC block range."
        />
        <Input
          label="To block"
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          placeholder="e.g. 52002000"
          value={toBlock}
          onChange={(e) => {
            setToBlock(e.target.value);
            clearInspectionResults();
          }}
          hint="End of the BSC block range."
        />
        <div className="flex flex-col justify-end gap-2 sm:min-w-[170px]">
          <Button size="sm" loading={runningDryRun} disabled={storingDetectedRows} onClick={handleRunDryRun}>
            Run Dry-Run
          </Button>
          <Button size="sm" variant="outline" loading={storingDetectedRows} disabled={runningDryRun || !inspectedRangeMatchesInputs} onClick={handleStoreDetectedRows}>
            Store Detected Rows
          </Button>
        </div>
      </div>

      {storageResult ? <StorageResultPanel result={storageResult} /> : null}

      {result ? (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryItem label="Block range" value={`${formatCount(result.fromBlock)} → ${formatCount(result.toBlock)}`} />
            <SummaryItem label="Assigned BSC addresses" value={result.assignedAddressCount} />
            <SummaryItem label="RPC batches" value={result.rpcBatchCount} />
            <SummaryItem label="Returned logs" value={result.scannedLogCount} />
            <SummaryItem label="Matched events" value={result.totalMatchedEvents} />
            <SummaryItem label="Displayed events" value={result.matchedEvents.length} />
            <SummaryItem label="Malformed skipped" value={result.skippedMalformedLogs} />
            <SummaryItem label="Unassigned skipped" value={result.skippedUnassignedLogs} />
          </div>

          {(result.resultsTruncated || result.invalidAssignedAddressCount > 0 || result.skippedZeroAmountLogs > 0) ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] leading-relaxed text-amber-200/80">
              {result.resultsTruncated ? <p>Results were truncated at {formatCount(result.matchedEventLimit)} displayed events. Use a smaller block range for full visual inspection.</p> : null}
              {result.invalidAssignedAddressCount > 0 ? <p>{formatCount(result.invalidAssignedAddressCount)} assigned BSC address row(s) were invalid and ignored by the dry-run helper.</p> : null}
              {result.skippedZeroAmountLogs > 0 ? <p>{formatCount(result.skippedZeroAmountLogs)} zero-amount transfer log(s) were skipped.</p> : null}
            </div>
          ) : null}

          {result.matchedEvents.length === 0 ? (
            <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] p-6 text-center text-xs text-gray-600">
              No matched BSC USDT deposits found in this dry-run range.
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-gray-400">Matched preview events</p>
              <div className="grid gap-2 lg:grid-cols-2">
                {result.matchedEvents.map((event) => (
                  <BscDryRunEventRow key={`${event.txHash}:${event.eventIndex}`} event={event} />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#0d0d0d] p-4 text-[11px] leading-relaxed text-gray-600">
          Enter a small recent BSC block range and run a dry-run first. Store detected rows only after you have inspected the intended range.
        </div>
      )}
    </div>
  );
}

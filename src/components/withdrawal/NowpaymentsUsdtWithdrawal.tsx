import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Clock, Info, ShieldAlert, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { formatDateTime } from "@/lib/format.js";
import {
  calculateWithdrawalPreview,
  createWithdrawalAttemptKeyManager,
  floorUsdtToSix,
  formatUsdtDisplay,
  formatUsdtMicros,
  isMinimumWithdrawal,
  isValidBep20Address,
  maskBep20Address,
  NowpaymentsWithdrawalUiError,
  nowpaymentsWithdrawalStatusLabel,
  parseUsdtMicros,
  runSingleFlight,
  fetchNowpaymentsWithdrawalOverview,
  submitNowpaymentsWithdrawalRequest,
  type NowpaymentsWithdrawalOverview,
} from "@/lib/nowpayments-withdrawal-ui.js";

const HISTORY_PREVIEW_LIMIT = 8;

export function NowpaymentsUsdtWithdrawal({
  accessToken,
  onBack,
}: {
  accessToken: string | null;
  onBack: () => void;
}) {
  const [overview, setOverview] = useState<NowpaymentsWithdrawalOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [grossAmount, setGrossAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const mountedRef = useRef(true);
  const submitPromiseRef = useRef<Promise<void> | null>(null);
  const attemptKeysRef = useRef<ReturnType<typeof createWithdrawalAttemptKeyManager> | null>(null);
  if (attemptKeysRef.current === null) {
    attemptKeysRef.current = createWithdrawalAttemptKeyManager();
  }

  const loadOverview = useCallback(async () => {
    if (!accessToken) {
      if (mountedRef.current) {
        setLoading(false);
        setLoadError(true);
      }
      return;
    }
    setLoading(true);
    setLoadError(false);
    try {
      const nextOverview = await fetchNowpaymentsWithdrawalOverview(accessToken);
      if (mountedRef.current) setOverview(nextOverview);
    } catch {
      if (mountedRef.current) setLoadError(true);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    mountedRef.current = true;
    void loadOverview();
    return () => {
      mountedRef.current = false;
    };
  }, [loadOverview]);

  const preview = useMemo(() => calculateWithdrawalPreview(grossAmount), [grossAmount]);
  const availableMicros = useMemo(
    () => overview
      ? parseUsdtMicros(floorUsdtToSix(overview.available_balance_usdt) ?? "0") ?? 0n
      : 0n,
    [overview],
  );
  const amountValid = preview !== null && isMinimumWithdrawal(grossAmount);
  const addressValid = isValidBep20Address(destination);
  const sufficientBalance = preview !== null && preview.grossMicros <= availableMicros;
  const controlsEnabled = overview?.withdrawals_enabled === true && !loading && !submitting;
  const canSubmit = controlsEnabled && amountValid && addressValid && sufficientBalance;
  const visibleHistory = overview?.history.slice(
    0,
    historyExpanded ? undefined : HISTORY_PREVIEW_LIMIT,
  ) ?? [];

  const handleMax = () => {
    if (!controlsEnabled || !overview) return;
    setGrossAmount(floorUsdtToSix(overview.available_balance_usdt) ?? "0");
  };

  const submit = async () => {
    if (!accessToken || !overview?.withdrawals_enabled) return;
    if (!amountValid) {
      toast.error("Enter at least 2 USDT with no more than six decimals.");
      return;
    }
    if (!addressValid) {
      toast.error("Enter a valid USDT BEP20 destination address.");
      return;
    }
    if (!sufficientBalance) {
      toast.error("Insufficient available USDT balance.");
      return;
    }

    const normalizedAddress = destination.toLowerCase();
    const idempotencyKey = attemptKeysRef.current!.keyFor(grossAmount, normalizedAddress);
    setSubmitting(true);
    try {
      await submitNowpaymentsWithdrawalRequest(accessToken, {
        gross_amount_usdt: grossAmount,
        destination_address: normalizedAddress,
        idempotency_key: idempotencyKey,
      });
      attemptKeysRef.current!.clear();
      setGrossAmount("");
      setDestination("");
      toast.success("USDT withdrawal submitted for manual review.");
      await loadOverview();
    } catch (error) {
      if (error instanceof NowpaymentsWithdrawalUiError) {
        const messages: Record<NowpaymentsWithdrawalUiError["kind"], string> = {
          authentication: "Your session has expired. Please sign in again.",
          disabled: "USDT withdrawals are temporarily unavailable.",
          conflict: "A withdrawal is already in progress or this request changed. Refresh and review it.",
          insufficient_balance: "Insufficient available USDT balance.",
          invalid_destination: "Use a valid external USDT BEP20 destination address.",
          validation: "Check the withdrawal amount and BEP20 destination.",
          unavailable: "USDT withdrawal could not be submitted. You can retry safely.",
        };
        toast.error(messages[error.kind]);
      } else {
        toast.error("USDT withdrawal could not be submitted. You can retry safely.");
      }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    return runSingleFlight(submitPromiseRef, submit);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] text-gray-400 transition-colors hover:border-[rgba(0,255,65,0.35)] hover:text-[#00ff41] card-press"
          aria-label="Back to withdrawal methods"
        >
          <ArrowLeft size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#00ff41]/70">
            Manual USDT withdrawal
          </p>
          <h2 className="truncate text-sm font-bold text-gray-100">USDT on BNB Smart Chain</h2>
        </div>
        <Badge variant="neon" className="shrink-0 text-[9px]">BEP20 only</Badge>
      </div>

      {loading && !overview ? (
        <div className="space-y-2">
          <div className="skeleton h-20 rounded-xl" />
          <div className="skeleton h-64 rounded-xl" />
        </div>
      ) : loadError || !overview ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-center">
          <p className="text-xs text-red-300">USDT withdrawal information is unavailable.</p>
          <Button className="mt-3" size="sm" variant="outline" onClick={() => void loadOverview()}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <UsdtBalanceCard label="Available USDT" value={overview.available_balance_usdt} />
            <UsdtBalanceCard label="Reserved USDT" value={overview.reserved_balance_usdt} />
          </div>

          {!overview.withdrawals_enabled && (
            <div className="flex items-start gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5">
              <Info size={14} className="mt-0.5 shrink-0 text-yellow-400" />
              <p className="text-xs font-medium text-yellow-300">
                USDT withdrawals are temporarily unavailable.
              </p>
            </div>
          )}

          <section className="overflow-hidden rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111]">
            <div className="border-b border-[#1a1a1a] px-3.5 py-3">
              <h3 className="text-sm font-bold text-gray-100">Request withdrawal</h3>
              <p className="mt-0.5 text-[11px] text-gray-500">USDT on BNB Smart Chain (BEP20 only)</p>
            </div>
            <div className="space-y-3.5 p-3.5">
              <div>
                <Input
                  label="Gross withdrawal amount (USDT)"
                  type="text"
                  inputMode="decimal"
                  placeholder="2"
                  value={grossAmount}
                  disabled={!controlsEnabled}
                  onChange={(event) => setGrossAmount(event.target.value)}
                  hint="Minimum: 2 USDT · Fee: 5%"
                />
                <button
                  type="button"
                  disabled={!controlsEnabled}
                  onClick={handleMax}
                  className="mt-1.5 text-[11px] font-semibold text-[#00ff41] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Max
                </button>
              </div>

              <Input
                label="BEP20 destination address"
                type="text"
                placeholder="0x…"
                value={destination}
                disabled={!controlsEnabled}
                onChange={(event) => setDestination(event.target.value.trim())}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                hint="Do not use TRC20, ERC20, or an exchange memo/tag."
              />

              {preview && (
                <div className="space-y-2 rounded-xl border border-[#1f1f1f] bg-[#0b0b0b] p-3">
                  <UsdtSummaryRow label="Gross request" value={formatUsdtMicros(preview.grossMicros)} />
                  <UsdtSummaryRow label="Withdrawal fee (5%)" value={formatUsdtMicros(preview.feeMicros)} />
                  <div className="border-t border-[#1a1a1a] pt-2">
                    <UsdtSummaryRow label="Recipient receives" value={formatUsdtMicros(preview.netMicros)} highlight />
                  </div>
                </div>
              )}

              {preview && !sufficientBalance && (
                <p className="rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-[11px] text-red-300">
                  Insufficient available USDT balance.
                </p>
              )}

              <div className="flex items-start gap-2 rounded-xl border border-red-500/15 bg-red-500/5 px-3 py-2.5">
                <ShieldAlert size={14} className="mt-0.5 shrink-0 text-red-300" />
                <p className="text-[10px] leading-relaxed text-gray-400">
                  BEP20 transfers are irreversible. Verify the destination carefully. QHash staff will send the displayed net amount manually after review.
                </p>
              </div>

              <Button
                fullWidth
                loading={submitting}
                disabled={!canSubmit}
                onClick={() => void handleSubmit()}
              >
                Submit USDT Withdrawal
              </Button>
            </div>
          </section>

          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-gray-100">USDT Withdrawal History</h3>
              {overview.history.length > 0 && (
                <Badge variant="default" className="text-[9px]">{overview.history.length}</Badge>
              )}
            </div>
            {overview.history.length === 0 ? (
              <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-5 text-center">
                <Clock size={17} className="mx-auto text-gray-600" />
                <p className="mt-2 text-xs text-gray-500">No USDT withdrawals yet.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {visibleHistory.map((row, index) => (
                  <div key={`${row.requested_at}-${index}`} className="rounded-xl border border-[#1a1a1a] bg-[#111] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-gray-200">
                          {formatUsdtDisplay(row.gross_amount_usdt)} USDT
                        </p>
                        <p className="mt-0.5 text-[10px] text-gray-600">
                          To {maskBep20Address(row.destination)} · {formatDateTime(row.requested_at)}
                        </p>
                      </div>
                      <span className="text-right text-[10px] font-semibold text-[#00ff41]">
                        {nowpaymentsWithdrawalStatusLabel(row.status)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between border-t border-[#1a1a1a] pt-2 text-[10px] text-gray-500">
                      <span>Fee {formatUsdtDisplay(row.fee_amount_usdt)} USDT</span>
                      <span>Net {formatUsdtDisplay(row.net_amount_usdt)} USDT</span>
                    </div>
                    {row.transaction_hash && (
                      <p className="mt-1.5 truncate font-mono text-[9px] text-gray-600">
                        Tx {row.transaction_hash}
                      </p>
                    )}
                    {row.rejection_message && (
                      <p className="mt-1.5 text-[10px] text-gray-500">{row.rejection_message}</p>
                    )}
                  </div>
                ))}
                {overview.history.length > HISTORY_PREVIEW_LIMIT && (
                  <Button
                    fullWidth
                    size="sm"
                    variant="ghost"
                    onClick={() => setHistoryExpanded((value) => !value)}
                  >
                    {historyExpanded ? "Show less" : "Show all"}
                  </Button>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function UsdtBalanceCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111] p-3">
      <div className="flex items-center gap-2 text-[#00ff41]">
        <Wallet size={13} />
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em]">{label}</span>
      </div>
      <p className="mt-2 text-base font-black text-gray-100">{formatUsdtDisplay(value)} USDT</p>
    </div>
  );
}

function UsdtSummaryRow({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="text-gray-500">{label}</span>
      <span className={highlight ? "font-bold text-[#00ff41]" : "font-semibold text-gray-200"}>
        {value} USDT
      </span>
    </div>
  );
}

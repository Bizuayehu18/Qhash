import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Clock3,
  Coins,
  Copy,
  History,
  QrCode,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { formatDateTime } from "@/lib/format.js";
import {
  fetchNowpaymentsDepositOverview,
  createSingleFlight,
  formatDepositCountdown,
  formatUsdtDecimal,
  isDepositAddressSendable,
  nowpaymentsStatusLabel,
  requestNowpaymentsDepositSession,
  type NowpaymentsDepositHistoryView,
  type NowpaymentsDepositOverview,
  type NowpaymentsHistoryStatus,
} from "@/lib/nowpayments-deposit-ui.js";

const OVERVIEW_TIMEOUT_MS = 12_000;
const COPY_FEEDBACK_TIMEOUT_MS = 2_000;

type CopyFeedback = {
  copied: boolean;
  announcement: string;
};

export const IDLE_COPY_FEEDBACK: CopyFeedback = {
  copied: false,
  announcement: "",
};

export function copyButtonAccessibleName({
  addressSendable,
  copied,
}: {
  addressSendable: boolean;
  copied: boolean;
}): string {
  if (!addressSendable) return "Copy disabled for expired address.";
  return copied
    ? "USDT BEP20 deposit address copied."
    : "Copy USDT BEP20 deposit address.";
}

export async function copyUsdtDepositAddress(
  address: string,
  writeText: (value: string) => Promise<void>,
): Promise<CopyFeedback> {
  try {
    await writeText(address);
    return {
      copied: true,
      announcement: "USDT BEP20 deposit address copied to clipboard.",
    };
  } catch {
    return {
      copied: false,
      announcement: "Unable to copy the USDT BEP20 deposit address. Please copy it manually.",
    };
  }
}

async function withRequestTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("crypto_request_timeout")), OVERVIEW_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function statusVariant(status: NowpaymentsHistoryStatus) {
  if (status === "finished") return "success" as const;
  if (["failed", "refunded", "expired"].includes(status)) return "danger" as const;
  if (["waiting", "partially_paid", "manual_review"].includes(status)) return "warning" as const;
  return "info" as const;
}

export function NowpaymentsUsdtDeposit({
  accessToken,
  onBack,
}: {
  accessToken: string | null;
  onBack: () => void;
}) {
  const [overview, setOverview] = useState<NowpaymentsDepositOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(IDLE_COPY_FEEDBACK);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const mountedRef = useRef(true);
  const loadingRef = useRef(false);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadOverview = useCallback(async () => {
    if (!accessToken) {
      setLoading(false);
      setError(true);
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    setError(false);
    try {
      const result = await withRequestTimeout(fetchNowpaymentsDepositOverview(accessToken));
      if (!mountedRef.current) return;
      setOverview(result);
    } catch {
      if (!mountedRef.current) return;
      setError(true);
    } finally {
      loadingRef.current = false;
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

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") void loadOverview();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [loadOverview]);

  const activeSession = overview?.active_session ?? null;
  const addressSendable = activeSession
    ? isDepositAddressSendable(activeSession, nowMs)
    : false;

  useEffect(() => {
    if (
      activeSession?.address_lifecycle === "pending_activation"
      && !addressSendable
    ) {
      void loadOverview();
    }
  }, [activeSession, addressSendable, loadOverview]);

  useEffect(() => {
    let cancelled = false;
    setQrDataUrl(null);
    if (!activeSession || !addressSendable) return;
    void QRCode.toDataURL(activeSession.pay_address, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 220,
      color: { dark: "#050505", light: "#ffffff" },
    }).then((dataUrl) => {
      if (!cancelled) setQrDataUrl(dataUrl);
    }).catch(() => {
      if (!cancelled) setQrDataUrl(null);
    });
    return () => {
      cancelled = true;
    };
  }, [activeSession, addressSendable]);

  const performGenerate = useCallback(async () => {
    if (!accessToken || !overview?.feature_enabled) return;
    setGenerating(true);
    setError(false);
    try {
      await withRequestTimeout(requestNowpaymentsDepositSession(accessToken));
      await loadOverview();
      toast.success("Your USDT BEP20 deposit address is ready.");
    } catch {
      if (mountedRef.current) setError(true);
      toast.error("The deposit address is temporarily unavailable. Please try again.");
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  }, [accessToken, loadOverview, overview?.feature_enabled]);
  const handleGenerate = useMemo(
    () => createSingleFlight(performGenerate),
    [performGenerate],
  );

  const handleCopy = useCallback(async () => {
    if (!activeSession || !addressSendable) return;
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    const feedback = await copyUsdtDepositAddress(
      activeSession.pay_address,
      (value) => navigator.clipboard.writeText(value),
    );
    if (!mountedRef.current) return;
    setCopyFeedback(feedback);
    if (feedback.copied) {
      copyResetTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setCopyFeedback(IDLE_COPY_FEEDBACK);
        copyResetTimerRef.current = null;
      }, COPY_FEEDBACK_TIMEOUT_MS);
    } else {
      toast.error("Unable to copy. Please copy the address manually.");
    }
  }, [activeSession, addressSendable]);

  const lastResolved = useMemo(
    () => overview?.history[0] ?? null,
    [overview?.history],
  );

  return (
    <section className="space-y-3" aria-labelledby="crypto-deposit-title">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {copyFeedback.announcement}
      </p>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] text-gray-400 transition-colors hover:border-[rgba(0,255,65,0.35)] hover:text-[#00ff41] card-press"
            aria-label="Back to deposit method selection"
          >
            <ChevronLeft size={15} />
          </button>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#00ff41]/70">
              Crypto Deposit
            </p>
            <h2 id="crypto-deposit-title" className="truncate text-sm font-bold text-gray-100">
              USDT on BNB Smart Chain
            </h2>
          </div>
        </div>
        <Badge variant={overview?.feature_enabled ? "neon" : "default"} className="shrink-0 text-[9px]">
          BEP20 only
        </Badge>
      </div>

      {loading && !overview ? (
        <CryptoLoadingState />
      ) : error && !overview ? (
        <CryptoErrorState onRetry={loadOverview} />
      ) : overview ? (
        <>
          <UsdtWalletSummary overview={overview} />

          {activeSession ? (
            <ActiveDepositCard
              session={activeSession}
              nowMs={nowMs}
              addressSendable={addressSendable}
              qrDataUrl={qrDataUrl}
              copied={copyFeedback.copied}
              onCopy={handleCopy}
            />
          ) : !overview.feature_enabled ? (
            <DisabledCryptoState />
          ) : overview.session_state === "provisioning" ? (
            <ProcessingState label="Deposit address setup is in progress." />
          ) : overview.session_state === "manual_review" ? (
            <ProcessingState label="Deposit address setup needs support review." />
          ) : (
            <NoActiveSession
              lastResolved={lastResolved}
              generating={generating}
              onGenerate={handleGenerate}
            />
          )}

          {error && <InlineRetry onRetry={loadOverview} />}
          <DepositSafetyNotice minimum={activeSession?.minimum_deposit_usdt ?? overview.minimum_deposit_usdt} />
          <CryptoDepositHistory history={overview.history} />
        </>
      ) : null}
    </section>
  );
}

function CryptoLoadingState() {
  return (
    <div className="space-y-2" aria-label="Loading USDT deposit details" role="status">
      <div className="skeleton h-20 rounded-xl" />
      <div className="skeleton h-64 rounded-xl" />
    </div>
  );
}

function CryptoErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] p-5 text-center" role="alert">
      <AlertTriangle size={20} className="mx-auto text-red-400" />
      <p className="mt-2 text-sm font-semibold text-gray-200">Crypto deposits are unavailable</p>
      <p className="mt-1 text-xs text-gray-500">No address was created. Please try again later.</p>
      <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
        <RefreshCw size={13} /> Retry
      </Button>
    </div>
  );
}

function UsdtWalletSummary({ overview }: { overview: NowpaymentsDepositOverview }) {
  return (
    <div className="grid grid-cols-2 gap-2" aria-label="USDT wallet balances">
      <BalanceCard
        label="Available USDT"
        value={overview.wallet.available_balance_usdt}
        icon={<WalletCards size={14} />}
      />
      <BalanceCard
        label="Reserved USDT"
        value={overview.wallet.reserved_balance_usdt}
        icon={<ShieldCheck size={14} />}
      />
    </div>
  );
}

function BalanceCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#1f1f1f] bg-[#111] p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-gray-500">{icon}{label}</div>
      <p className="mt-1.5 break-all font-mono text-sm font-bold text-gray-100">
        {formatUsdtDecimal(value)} <span className="text-[10px] text-[#00ff41]">USDT</span>
      </p>
    </div>
  );
}

function DisabledCryptoState() {
  return (
    <div className="rounded-xl border border-[#252525] bg-[#111] p-5 text-center" role="status">
      <Coins size={22} className="mx-auto text-gray-600" />
      <p className="mt-2 text-sm font-semibold text-gray-200">USDT deposits are not available yet</p>
      <p className="mt-1 text-xs leading-relaxed text-gray-500">
        Address generation is disabled. CBE and TeleBirr deposits remain available.
      </p>
      <Button type="button" fullWidth disabled className="mt-4">
        Generate Deposit Address
      </Button>
    </div>
  );
}

function ActiveDepositCard({
  session,
  nowMs,
  addressSendable,
  qrDataUrl,
  copied,
  onCopy,
}: {
  session: NonNullable<NowpaymentsDepositOverview["active_session"]>;
  nowMs: number;
  addressSendable: boolean;
  qrDataUrl: string | null;
  copied: boolean;
  onCopy: () => void;
}) {
  const permanentlyActivated = session.address_lifecycle === "permanently_activated";
  return (
    <div className="overflow-hidden rounded-xl border border-[rgba(0,255,65,0.16)] bg-[#111]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1f1f1f] px-3.5 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            {permanentlyActivated ? "Permanent deposit address" : "Pending address activation"}
          </p>
          <p className="mt-0.5 text-sm font-bold text-gray-100">USDT · BNB Smart Chain (BEP20)</p>
        </div>
        <Badge variant={permanentlyActivated ? "success" : "warning"} className="text-[9px]">
          {permanentlyActivated ? "Permanently activated" : nowpaymentsStatusLabel(session.status)}
        </Badge>
      </div>

      <div className="space-y-3 p-3.5">
        <div className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center">
          <div className="mx-auto grid h-[220px] w-[220px] place-items-center overflow-hidden rounded-xl border border-[#262626] bg-white p-2">
            {addressSendable && qrDataUrl ? (
              <img src={qrDataUrl} alt="QR code for the USDT BEP20 deposit address" className="h-full w-full" />
            ) : addressSendable ? (
              <QrCode size={38} className="text-gray-400" aria-label="QR code loading" />
            ) : (
              <div className="text-center text-gray-500" aria-label="QR code disabled for expired address">
                <QrCode size={38} className="mx-auto opacity-40" />
                <p className="mt-2 text-[10px] font-semibold uppercase">QR disabled</p>
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-gray-500">Deposit address</p>
              <div className="mt-1.5 flex items-start gap-2 rounded-xl border border-[#252525] bg-[#090909] p-3">
                <code className="min-w-0 flex-1 break-all text-xs leading-relaxed text-[#00ff41]">
                  {session.pay_address}
                </code>
                <button
                  type="button"
                  onClick={onCopy}
                  disabled={!addressSendable}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#252525] text-gray-400 hover:text-[#00ff41] disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label={copyButtonAccessibleName({ addressSendable, copied })}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-xs">
              <SessionDetail label="Minimum" value={`${formatUsdtDecimal(session.minimum_deposit_usdt)} USDT`} />
              <SessionDetail label="Created" value={formatDateTime(session.created_at)} />
              {session.valid_until && (
                <>
                  <SessionDetail label="Activation time remaining" value={formatDepositCountdown(session.valid_until, nowMs)} />
                  <SessionDetail label="Activation deadline" value={formatDateTime(session.valid_until)} />
                </>
              )}
            </dl>
          </div>
        </div>

        <div className="rounded-xl border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.035)] p-3" role="status">
          <p className="text-xs font-bold text-gray-200">
            {permanentlyActivated
              ? "This is your permanent USDT BEP20 deposit address."
              : "Complete your first verified deposit before the activation deadline."}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            {permanentlyActivated
              ? "Future deposits to this same address are credited separately after independent verification."
              : "A verified finished first deposit activates this same address permanently. The deadline is never extended."}
          </p>
        </div>
      </div>
    </div>
  );
}

function SessionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#202020] bg-[#0a0a0a] p-2.5">
      <dt className="text-[9px] uppercase tracking-wider text-gray-600">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-gray-300">{value}</dd>
    </div>
  );
}

function ProcessingState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-5 text-center" role="status">
      <Clock3 size={21} className="mx-auto animate-pulse text-amber-300" />
      <p className="mt-2 text-sm font-semibold text-gray-200">{label}</p>
      <p className="mt-1 text-xs text-gray-500">Do not start another deposit until this is resolved.</p>
    </div>
  );
}

function NoActiveSession({
  lastResolved,
  generating,
  onGenerate,
}: {
  lastResolved: NowpaymentsDepositHistoryView | null;
  generating: boolean;
  onGenerate: () => void;
}) {
  const finished = lastResolved?.status === "finished";
  const expired = lastResolved?.status === "expired";
  return (
    <div className="rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111] p-5 text-center">
      {finished ? (
        <>
          <Check size={22} className="mx-auto text-[#00ff41]" />
          <p className="mt-2 text-sm font-semibold text-gray-100">Deposit finished</p>
          <p className="mt-1 font-mono text-sm font-bold text-[#00ff41]">
            {lastResolved.credited_amount_usdt
              ? `+${formatUsdtDecimal(lastResolved.credited_amount_usdt)} USDT credited`
              : "Provider verification is complete; credit confirmation is pending."}
          </p>
        </>
      ) : expired ? (
        <>
          <AlertTriangle size={22} className="mx-auto text-red-400" />
          <p className="mt-2 text-sm font-semibold text-red-300">Expired — do not send.</p>
          <p className="mt-1 text-xs text-gray-500">
            The old address remains in history. If you already sent funds, keep the transaction hash and contact support.
          </p>
        </>
      ) : (
        <>
          <QrCode size={22} className="mx-auto text-[#00ff41]" />
          <p className="mt-2 text-sm font-semibold text-gray-100">No active deposit address</p>
          <p className="mt-1 text-xs text-gray-500">Generate an address when you are ready to send USDT.</p>
        </>
      )}
      <Button type="button" fullWidth className="mt-4" loading={generating} disabled={generating} onClick={onGenerate}>
        {lastResolved ? "Generate New Deposit Address" : "Generate Deposit Address"}
      </Button>
    </div>
  );
}

function InlineRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-3 py-2" role="alert">
      <p className="text-[11px] text-amber-200">Latest deposit status could not be refreshed.</p>
      <button type="button" onClick={onRetry} className="text-[11px] font-bold text-[#00ff41]">Retry</button>
    </div>
  );
}

function DepositSafetyNotice({ minimum }: { minimum: string }) {
  return (
    <div className="space-y-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.035] p-3.5">
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="shrink-0 text-amber-300" />
        <h3 className="text-xs font-bold text-amber-200">Send carefully</h3>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-[11px] leading-relaxed text-gray-500">
        <li>Send only USDT on BNB Smart Chain (BEP20). Other assets or networks may be lost.</li>
        <li>Send at least {formatUsdtDecimal(minimum)} USDT. Network and provider fees may reduce what arrives.</li>
        <li>Your QHash wallet is credited in USDT only, using the exact verified gross amount actually paid.</li>
        <li>The displayed minimum is not a requested amount and does not cap a larger deposit.</li>
      </ul>
    </div>
  );
}

function CryptoDepositHistory({ history }: { history: NowpaymentsDepositHistoryView[] }) {
  return (
    <section className="space-y-2.5" aria-labelledby="usdt-deposit-history-title">
      <div className="flex items-center justify-between gap-3">
        <h3 id="usdt-deposit-history-title" className="flex items-center gap-2 text-sm font-bold text-gray-100">
          <History size={14} className="text-[#00ff41]" /> USDT Deposit History
        </h3>
        {history.length > 0 && <Badge variant="default" className="text-[9px]">{history.length}</Badge>}
      </div>
      {history.length === 0 ? (
        <div className="rounded-xl border border-[#1f1f1f] bg-[#111] p-6 text-center">
          <p className="text-xs font-semibold text-gray-400">No USDT deposits yet</p>
          <p className="mt-1 text-[11px] text-gray-600">Your address sessions will appear here.</p>
        </div>
      ) : (
        <div className="divide-y divide-[#1f1f1f] overflow-hidden rounded-xl border border-[#1f1f1f] bg-[#111]">
          {history.map((entry, index) => (
            <HistoryRow key={`${entry.created_at}-${entry.pay_address ?? "none"}-${index}`} entry={entry} />
          ))}
        </div>
      )}
    </section>
  );
}

function HistoryRow({ entry }: { entry: NowpaymentsDepositHistoryView }) {
  return (
    <article className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-gray-100">USDT · BEP20</p>
          <p className="mt-0.5 text-[10px] text-gray-600">Created {formatDateTime(entry.created_at)}</p>
        </div>
        <Badge variant={statusVariant(entry.status)} className="text-[9px]">
          {nowpaymentsStatusLabel(entry.status)}
        </Badge>
      </div>
      {entry.pay_address && (
        <p className="truncate font-mono text-[10px] text-gray-500" title="Historical deposit address">
          {entry.pay_address}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-gray-600">
        <span>
          {entry.valid_until
            ? `Original activation deadline ${formatDateTime(entry.valid_until)}`
            : "Activation deadline unavailable"}
        </span>
        <span className="text-right">
          {entry.credited_amount_usdt && (
            <span className="block text-[#00ff41]">
              {formatUsdtDecimal(entry.credited_amount_usdt)} USDT credited
            </span>
          )}
          {entry.completed_at ? (
            <span className="block">Completed {formatDateTime(entry.completed_at)}</span>
          ) : !entry.credited_amount_usdt ? (
            <span className="block">No credit recorded</span>
          ) : null}
        </span>
      </div>
    </article>
  );
}

export function CryptoDepositMethodIcon() {
  return <Coins size={15} />;
}

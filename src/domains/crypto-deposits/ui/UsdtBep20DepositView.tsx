import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Clock3,
  Coins,
  QrCode,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import {
  formatUsdtDecimal,
  type NowpaymentsDepositHistoryView,
  type NowpaymentsDepositOverview,
} from "./nowpayments-deposit-ui.js";
import { UsdtBep20AddressCard } from "./UsdtBep20AddressCard.js";
import { UsdtBep20DepositHistory } from "./UsdtBep20DepositHistory.js";

type UsdtBep20DepositViewProps = {
  addressSendable: boolean;
  copied: boolean;
  copyAnnouncement: string;
  error: boolean;
  generating: boolean;
  loading: boolean;
  nowMs: number;
  onBack: () => void;
  onCopy: () => void;
  onGenerate: () => void;
  onRetry: () => void;
  overview: NowpaymentsDepositOverview | null;
  qrDataUrl: string | null;
};

export function UsdtBep20DepositView({
  addressSendable,
  copied,
  copyAnnouncement,
  error,
  generating,
  loading,
  nowMs,
  onBack,
  onCopy,
  onGenerate,
  onRetry,
  overview,
  qrDataUrl,
}: UsdtBep20DepositViewProps) {
  const activeSession = overview?.active_session ?? null;
  const lastResolved = overview?.history[0] ?? null;

  return (
    <section className="space-y-3" aria-labelledby="crypto-deposit-title">
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {copyAnnouncement}
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
        <CryptoErrorState onRetry={onRetry} />
      ) : overview ? (
        <>
          <UsdtWalletSummary overview={overview} />

          {!overview.feature_enabled ? (
            <DisabledCryptoState />
          ) : activeSession ? (
            <UsdtBep20AddressCard
              session={activeSession}
              nowMs={nowMs}
              addressSendable={addressSendable}
              qrDataUrl={qrDataUrl}
              copied={copied}
              onCopy={onCopy}
            />
          ) : overview.session_state === "provisioning" ? (
            <ProcessingState label="Deposit address setup is in progress." />
          ) : overview.session_state === "manual_review" ? (
            <ProcessingState label="Deposit address setup needs support review." />
          ) : (
            <NoActiveSession
              lastResolved={lastResolved}
              generating={generating}
              onGenerate={onGenerate}
            />
          )}

          {error && overview.feature_enabled && <InlineRetry onRetry={onRetry} />}
          {overview.feature_enabled && (
            <DepositSafetyNotice minimum={activeSession?.minimum_deposit_usdt ?? overview.minimum_deposit_usdt} />
          )}
          <UsdtBep20DepositHistory history={overview.history} />
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
        Address generation is unavailable.
      </p>
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

import { ArrowLeft, Clock, Info, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { CROSS_RAIL_WITHDRAWAL_POLICY_MESSAGE } from "@/lib/withdrawal-policy.js";
import {
  formatUsdtDisplay,
  type NowpaymentsWithdrawalHistoryView,
  type NowpaymentsWithdrawalOverview,
} from "@/lib/nowpayments-withdrawal-ui.js";
import { UsdtBep20WithdrawalHistory } from "./UsdtBep20WithdrawalHistory.js";
import { UsdtBep20WithdrawalRequestForm } from "./UsdtBep20WithdrawalRequestForm.js";

type UsdtBep20WithdrawalViewProps = {
  canSubmit: boolean;
  controlsEnabled: boolean;
  destination: string;
  fundPassword: string;
  grossAmount: string;
  historyExpandable: boolean;
  historyExpanded: boolean;
  loadError: boolean;
  loading: boolean;
  onBack: () => void;
  onDestinationChange: (value: string) => void;
  onFundPasswordChange: (value: string) => void;
  onGrossAmountChange: (value: string) => void;
  onHistoryExpandedChange: (value: boolean) => void;
  onMax: () => void;
  onRetry: () => void;
  onSubmit: () => void;
  overview: NowpaymentsWithdrawalOverview | null;
  preview: {
    grossMicros: bigint;
    feeMicros: bigint;
    netMicros: bigint;
  } | null;
  submitting: boolean;
  sufficientBalance: boolean;
  visibleHistory: NowpaymentsWithdrawalHistoryView[];
};

export function UsdtBep20WithdrawalView({
  canSubmit,
  controlsEnabled,
  destination,
  fundPassword,
  grossAmount,
  historyExpandable,
  historyExpanded,
  loadError,
  loading,
  onBack,
  onDestinationChange,
  onFundPasswordChange,
  onGrossAmountChange,
  onHistoryExpandedChange,
  onMax,
  onRetry,
  onSubmit,
  overview,
  preview,
  submitting,
  sufficientBalance,
  visibleHistory,
}: UsdtBep20WithdrawalViewProps) {
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
            USDT withdrawal
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
          <Button className="mt-3" size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <UsdtWalletSummary overview={overview} />

          {!overview.withdrawals_enabled && (
            <div className="flex items-start gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-3 py-2.5">
              <Info size={14} className="mt-0.5 shrink-0 text-yellow-400" />
              <p className="text-xs font-medium text-yellow-300">
                USDT withdrawals are temporarily unavailable.
              </p>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-xl border border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.035)] px-3 py-2.5">
            <Clock size={14} className="mt-0.5 shrink-0 text-[#00ff41]" />
            <p className="text-xs leading-relaxed text-gray-400">
              {CROSS_RAIL_WITHDRAWAL_POLICY_MESSAGE}.
            </p>
          </div>

          <UsdtBep20WithdrawalRequestForm
            canSubmit={canSubmit}
            controlsEnabled={controlsEnabled}
            destination={destination}
            fundPassword={fundPassword}
            grossAmount={grossAmount}
            onDestinationChange={onDestinationChange}
            onFundPasswordChange={onFundPasswordChange}
            onGrossAmountChange={onGrossAmountChange}
            onMax={onMax}
            onSubmit={onSubmit}
            preview={preview}
            submitting={submitting}
            sufficientBalance={sufficientBalance}
          />

          <UsdtBep20WithdrawalHistory
            expanded={historyExpanded}
            history={overview.history}
            isExpandable={historyExpandable}
            onExpandedChange={onHistoryExpandedChange}
            visibleHistory={visibleHistory}
          />
        </>
      )}
    </div>
  );
}

function UsdtWalletSummary({ overview }: { overview: NowpaymentsWithdrawalOverview }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <UsdtBalanceCard label="Available USDT" value={overview.available_balance_usdt} />
      <UsdtBalanceCard label="Reserved USDT" value={overview.reserved_balance_usdt} />
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

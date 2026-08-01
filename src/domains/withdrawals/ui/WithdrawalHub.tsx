import { useNavigate } from "@tanstack/react-router";
import { ArrowUpCircle, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import {
  FiatWithdrawalBalanceStrip,
  FiatWithdrawalConfirmForm,
  FiatWithdrawalDetailsForm,
  FiatWithdrawalHistory,
  FiatWithdrawalMethodList,
  FiatWithdrawalNotice,
  FiatWithdrawalSecurityStatusLine,
  useFiatWithdrawal,
} from "@/domains/fiat-withdrawals/public.js";

export function WithdrawalHub() {
  const navigate = useNavigate();
  const fiatWithdrawal = useFiatWithdrawal();
  const isFormView = fiatWithdrawal.method !== null;

  return (
    <div
      className={
        isFormView
          ? "space-y-3 lg:mx-auto lg:max-w-3xl"
          : "space-y-3 lg:mx-auto lg:grid lg:max-w-5xl lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0"
      }
    >
      <div className={isFormView ? "space-y-3" : "space-y-3 lg:col-span-7 xl:col-span-8"}>
        <WithdrawalPageHeader />
        <FiatWithdrawalBalanceStrip walletBalance={fiatWithdrawal.walletBalance} />

        {!fiatWithdrawal.method ? (
          <>
            <WithdrawalMethodSelection
              onSelectFiat={fiatWithdrawal.selectMethod}
              onSelectUsdt={() => {
                void navigate({ to: "/withdraw/crypto/usdt/bep20" });
              }}
            />
            <FiatWithdrawalSecurityStatusLine
              securityStatus={fiatWithdrawal.securityStatus}
              loading={fiatWithdrawal.loadingSecurityStatus}
              onSetNow={fiatWithdrawal.setUpFundPassword}
            />
            <FiatWithdrawalNotice />
          </>
        ) : fiatWithdrawal.withdrawalStep === "confirm" ? (
          <FiatWithdrawalConfirmForm
            method={fiatWithdrawal.method}
            selectedMeta={fiatWithdrawal.selectedMeta}
            accountName={fiatWithdrawal.accountName}
            accountNumber={fiatWithdrawal.accountNumber}
            fundPassword={fiatWithdrawal.fundPassword}
            parsedAmount={fiatWithdrawal.parsedAmount}
            feeAmount={fiatWithdrawal.feeAmount}
            netAmount={fiatWithdrawal.netAmount}
            submitting={fiatWithdrawal.submitting}
            onFundPasswordChange={fiatWithdrawal.setFundPassword}
            onBackToDetails={fiatWithdrawal.backToDetails}
            onSubmit={() => void fiatWithdrawal.submit()}
          />
        ) : (
          <FiatWithdrawalDetailsForm
            selectedMeta={fiatWithdrawal.selectedMeta}
            amount={fiatWithdrawal.amount}
            accountName={fiatWithdrawal.accountName}
            accountNumber={fiatWithdrawal.accountNumber}
            parsedAmount={fiatWithdrawal.parsedAmount}
            feeAmount={fiatWithdrawal.feeAmount}
            netAmount={fiatWithdrawal.netAmount}
            hasEnoughBalance={fiatWithdrawal.hasEnoughBalance}
            onAmountChange={fiatWithdrawal.setAmount}
            onAccountNameChange={fiatWithdrawal.setAccountName}
            onAccountNumberChange={fiatWithdrawal.setAccountNumber}
            onChangeMethod={fiatWithdrawal.changeMethod}
            onContinue={fiatWithdrawal.continueToConfirm}
          />
        )}
      </div>

      {!isFormView && (
        <div className="lg:col-span-5 xl:col-span-4">
          <FiatWithdrawalHistory
            withdrawals={fiatWithdrawal.withdrawals}
            historyLoaded={fiatWithdrawal.historyLoaded}
          />
        </div>
      )}
    </div>
  );
}

function WithdrawalPageHeader() {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
        Withdrawal Center
      </p>
      <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">Withdraw</h1>
      <p className="mt-1 text-xs text-gray-500">
        Request a withdrawal via CBE, TeleBirr, or USDT BEP20.
      </p>
    </div>
  );
}

function WithdrawalMethodSelection({
  onSelectFiat,
  onSelectUsdt,
}: {
  onSelectFiat: Parameters<typeof FiatWithdrawalMethodList>[0]["onSelect"];
  onSelectUsdt: () => void;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-100">Choose Withdrawal Method</h2>
        <Badge variant="neon" className="shrink-0 text-[9px]">
          3 options
        </Badge>
      </div>
      <FiatWithdrawalMethodList onSelect={onSelectFiat} />
      <CryptoWithdrawalOption onSelect={onSelectUsdt} />
    </section>
  );
}

function CryptoWithdrawalOption({ onSelect }: { onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group w-full rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111] px-3.5 py-2.5 text-left transition-colors hover:bg-[rgba(0,255,65,0.035)] card-press"
    >
      <span className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
          <ArrowUpCircle size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold leading-tight text-gray-100">
            USDT Withdrawal
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-gray-500">
            BNB Smart Chain (BEP20 only)
          </span>
        </span>
        <Badge variant="neon" className="shrink-0 text-[9px]">
          USDT
        </Badge>
        <ChevronRight
          size={15}
          className="shrink-0 text-gray-600 transition-colors group-hover:text-[#00ff41]"
        />
      </span>
    </button>
  );
}

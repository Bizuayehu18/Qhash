import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, Info } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { CryptoDepositMethodIcon } from "@/domains/crypto-deposits/public.js";
import {
  FiatDepositForm,
  FiatDepositHistory,
  FiatDepositMethodList,
  useFiatDeposit,
} from "@/domains/fiat-deposits/public.js";

export function DepositHub() {
  const navigate = useNavigate();
  const fiatDeposit = useFiatDeposit();
  const isFormView = fiatDeposit.step === "form" && fiatDeposit.selectedMethod !== null;

  return (
    <div
      className={
        isFormView
          ? "space-y-3 lg:mx-auto lg:max-w-3xl"
          : "space-y-3 lg:mx-auto lg:grid lg:max-w-5xl lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0"
      }
    >
      <div className={isFormView ? "space-y-3" : "space-y-3 lg:col-span-7 xl:col-span-8"}>
        <DepositPageHeader />

        {fiatDeposit.step === "select" ? (
          <DepositMethodSelection
            methodsLoaded={fiatDeposit.methodsLoaded}
            methodsCount={fiatDeposit.methodsCount}
            methodOptions={fiatDeposit.methodOptions}
            onSelect={fiatDeposit.selectMethod}
            onSelectCrypto={() => {
              void navigate({ to: "/deposit/crypto/usdt/bep20" });
            }}
          />
        ) : fiatDeposit.selectedMethod ? (
          <FiatDepositForm
            method={fiatDeposit.selectedMethod}
            amount={fiatDeposit.amount}
            txReference={fiatDeposit.txReference}
            submitting={fiatDeposit.submitting}
            onAmountChange={fiatDeposit.setAmount}
            onReferenceChange={fiatDeposit.setTxReference}
            onBack={fiatDeposit.resetForm}
            onSubmit={fiatDeposit.submit}
          />
        ) : null}
      </div>

      {!isFormView && (
        <div className="lg:col-span-5 xl:col-span-4">
          <FiatDepositHistory
            deposits={fiatDeposit.deposits}
            historyLoaded={fiatDeposit.historyLoaded}
          />
        </div>
      )}
    </div>
  );
}

function DepositPageHeader() {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
        Deposit Center
      </p>
      <h1 className="mt-1 text-lg font-bold leading-tight text-gray-100">Deposit</h1>
      <p className="mt-1 text-xs text-gray-500">Add funds via CBE, TeleBirr, or USDT BEP20</p>
    </div>
  );
}

function DepositMethodSelection({
  methodsLoaded,
  methodsCount,
  methodOptions,
  onSelect,
  onSelectCrypto,
}: {
  methodsLoaded: boolean;
  methodsCount: number;
  methodOptions: Parameters<typeof FiatDepositMethodList>[0]["methodOptions"];
  onSelect: Parameters<typeof FiatDepositMethodList>[0]["onSelect"];
  onSelectCrypto: () => void;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-100">Choose Deposit Method</h2>
        <Badge variant="default" className="shrink-0 text-[9px]">
          {methodsCount + 1} option{methodsCount + 1 === 1 ? "" : "s"}
        </Badge>
      </div>

      <FiatDepositMethodList
        methodsLoaded={methodsLoaded}
        methodOptions={methodOptions}
        onSelect={onSelect}
      />
      <CryptoDepositOption onSelect={onSelectCrypto} />
      <DepositNoticeLine />
    </section>
  );
}

function CryptoDepositOption({ onSelect }: { onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group w-full rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111] px-3.5 py-3 text-left transition-colors hover:bg-[rgba(0,255,65,0.035)] card-press"
    >
      <span className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[rgba(0,255,65,0.18)] bg-[linear-gradient(145deg,rgba(0,255,65,0.12),rgba(0,255,65,0.04))] text-[#00ff41]">
          <CryptoDepositMethodIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-black leading-tight text-gray-100">
            Crypto Deposit
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-gray-500">
            USDT · BNB Smart Chain (BEP20)
          </span>
        </span>
        <Badge variant="neon" className="shrink-0 text-[9px]">USDT</Badge>
        <ChevronRight
          size={15}
          className="shrink-0 text-gray-600 transition-colors group-hover:text-[#00ff41]"
        />
      </span>
    </button>
  );
}

function DepositNoticeLine() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.035)] px-3 py-2.5">
      <Info size={13} className="mt-0.5 shrink-0 text-[#00ff41]" />
      <p className="text-[10px] leading-relaxed text-gray-500">
        <span className="font-semibold text-[#00ff41]">Fund wallet</span>
        <span> · Transfer first, then submit your reference.</span>
      </p>
    </div>
  );
}

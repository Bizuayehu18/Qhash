import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import type { FiatWithdrawalMethodMeta } from "./fiat-withdrawal-provider.js";
import { FiatWithdrawalSummaryCard } from "./FiatWithdrawalSummary.js";
import { ETHIOPIA_MIN_WITHDRAWAL_AMOUNT_ETB } from "./providers/et/ethiopia-withdrawal-policy.js";

export function FiatWithdrawalDetailsForm({
  selectedMeta,
  amount,
  accountName,
  accountNumber,
  parsedAmount,
  feeAmount,
  netAmount,
  hasEnoughBalance,
  onAmountChange,
  onAccountNameChange,
  onAccountNumberChange,
  onChangeMethod,
  onContinue,
}: {
  selectedMeta: FiatWithdrawalMethodMeta | null;
  amount: string;
  accountName: string;
  accountNumber: string;
  parsedAmount: number;
  feeAmount: number;
  netAmount: number;
  hasEnoughBalance: boolean;
  onAmountChange: (value: string) => void;
  onAccountNameChange: (value: string) => void;
  onAccountNumberChange: (value: string) => void;
  onChangeMethod: () => void;
  onContinue: () => void;
}) {
  const canContinue =
    parsedAmount >= ETHIOPIA_MIN_WITHDRAWAL_AMOUNT_ETB &&
    hasEnoughBalance &&
    accountName.trim().length >= 2 &&
    accountNumber.trim().length >= 5;

  return (
    <section className="overflow-hidden rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111]">
      <div className="border-b border-[#1a1a1a] px-3.5 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onChangeMethod}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] text-gray-400 transition-colors hover:border-[rgba(0,255,65,0.35)] hover:text-[#00ff41] card-press"
            aria-label="Change withdrawal method"
          >
            <ArrowLeft size={14} />
          </button>
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
            {selectedMeta?.icon}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold leading-tight text-gray-100">
              {selectedMeta?.title}
            </h2>
          </div>
          <Badge variant="neon" className="shrink-0 text-[9px]">
            Step 1 of 2
          </Badge>
        </div>
      </div>

      <div className="space-y-3.5 p-3.5">
        <Input
          label="Amount (ETB)"
          type="text"
          placeholder="0.00"
          value={amount}
          onChange={(event) => onAmountChange(event.target.value)}
          inputMode="decimal"
          hint={`Minimum withdrawal is ${ETHIOPIA_MIN_WITHDRAWAL_AMOUNT_ETB} ETB.`}
        />
        <Input
          label={selectedMeta?.nameLabel ?? "Account Name"}
          type="text"
          placeholder="Enter account holder name"
          value={accountName}
          onChange={(event) => onAccountNameChange(event.target.value)}
        />
        <Input
          label={selectedMeta?.numberLabel ?? "Account Number"}
          type="text"
          placeholder={selectedMeta?.numberPlaceholder ?? "Enter account number"}
          value={accountNumber}
          onChange={(event) => onAccountNumberChange(event.target.value)}
        />
        {parsedAmount > 0 && (
          <FiatWithdrawalSummaryCard
            amount={parsedAmount}
            fee={feeAmount}
            net={netAmount}
          />
        )}
        {!hasEnoughBalance && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-[11px] leading-relaxed text-red-400">
            Insufficient wallet balance for this withdrawal amount.
          </div>
        )}
        <Button
          fullWidth
          disabled={!canContinue}
          className="disabled:bg-[#0b3f19] disabled:text-black/50 disabled:shadow-none disabled:hover:bg-[#0b3f19]"
          onClick={onContinue}
        >
          Continue
        </Button>
      </div>
    </section>
  );
}

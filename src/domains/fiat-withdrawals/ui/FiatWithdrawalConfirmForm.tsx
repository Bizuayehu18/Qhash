import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { maskFiatWithdrawalAccount } from "./fiat-withdrawal-format.js";
import { getFiatWithdrawalMethodLabel } from "./fiat-withdrawal-providers.js";
import type {
  FiatWithdrawalMethod,
  FiatWithdrawalMethodMeta,
} from "./fiat-withdrawal-provider.js";
import {
  EtbWithdrawalAmount,
  FiatWithdrawalSummaryRow,
} from "./FiatWithdrawalSummary.js";

export function FiatWithdrawalConfirmForm({
  method,
  selectedMeta,
  accountName,
  accountNumber,
  fundPassword,
  parsedAmount,
  feeAmount,
  netAmount,
  submitting,
  onFundPasswordChange,
  onBackToDetails,
  onSubmit,
}: {
  method: FiatWithdrawalMethod;
  selectedMeta: FiatWithdrawalMethodMeta | null;
  accountName: string;
  accountNumber: string;
  fundPassword: string;
  parsedAmount: number;
  feeAmount: number;
  netAmount: number;
  submitting: boolean;
  onFundPasswordChange: (value: string) => void;
  onBackToDetails: () => void;
  onSubmit: () => void;
}) {
  const canConfirm = !submitting && fundPassword.length === 4;

  return (
    <section className="overflow-hidden rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111]">
      <div className="border-b border-[#1a1a1a] px-3.5 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBackToDetails}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] text-gray-400 transition-colors hover:border-[rgba(0,255,65,0.35)] hover:text-[#00ff41] card-press"
            aria-label="Back to withdrawal details"
          >
            <ArrowLeft size={14} />
          </button>
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
            {selectedMeta?.icon}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold leading-tight text-gray-100">
              Confirm Withdrawal
            </h2>
            <p className="mt-0.5 truncate text-[11px] text-gray-500">
              Review and authorize
            </p>
          </div>
          <Badge variant="neon" className="shrink-0 text-[9px]">
            Step 2 of 2
          </Badge>
        </div>
      </div>

      <div className="space-y-3.5 p-3.5">
        <div className="space-y-2 rounded-xl border border-[#1f1f1f] bg-[#0b0b0b] p-3">
          <FiatWithdrawalSummaryRow
            label="Method"
            value={getFiatWithdrawalMethodLabel(method)}
          />
          <FiatWithdrawalSummaryRow label="Account name" value={accountName.trim()} />
          <FiatWithdrawalSummaryRow
            label="Account"
            value={maskFiatWithdrawalAccount(accountNumber)}
          />
          <div className="border-t border-[#1a1a1a] pt-2">
            <FiatWithdrawalSummaryRow
              label="Amount"
              value={<EtbWithdrawalAmount value={parsedAmount} />}
            />
            <FiatWithdrawalSummaryRow
              label="Fee"
              value={<EtbWithdrawalAmount value={feeAmount} />}
            />
            <FiatWithdrawalSummaryRow
              label="You receive"
              value={<EtbWithdrawalAmount value={netAmount} />}
              highlight
            />
          </div>
        </div>

        <Input
          label="Fund Password"
          type="password"
          placeholder="Enter 4-digit fund password"
          value={fundPassword}
          onChange={(event) => onFundPasswordChange(event.target.value)}
          inputMode="numeric"
          maxLength={4}
          autoComplete="current-password"
          hint="Required to confirm this withdrawal."
        />
        <Button
          fullWidth
          loading={submitting}
          disabled={!canConfirm}
          className="disabled:bg-[#0b3f19] disabled:text-black/50 disabled:shadow-none disabled:hover:bg-[#0b3f19]"
          onClick={onSubmit}
        >
          Confirm Withdrawal
        </Button>
      </div>
    </section>
  );
}

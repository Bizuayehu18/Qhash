import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { formatUsdtMicros } from "@/lib/nowpayments-withdrawal-ui.js";

type UsdtBep20WithdrawalRequestFormProps = {
  canSubmit: boolean;
  controlsEnabled: boolean;
  destination: string;
  fundPassword: string;
  grossAmount: string;
  onDestinationChange: (value: string) => void;
  onFundPasswordChange: (value: string) => void;
  onGrossAmountChange: (value: string) => void;
  onMax: () => void;
  onSubmit: () => void;
  preview: {
    grossMicros: bigint;
    feeMicros: bigint;
    netMicros: bigint;
  } | null;
  submitting: boolean;
  sufficientBalance: boolean;
};

export function UsdtBep20WithdrawalRequestForm({
  canSubmit,
  controlsEnabled,
  destination,
  fundPassword,
  grossAmount,
  onDestinationChange,
  onFundPasswordChange,
  onGrossAmountChange,
  onMax,
  onSubmit,
  preview,
  submitting,
  sufficientBalance,
}: UsdtBep20WithdrawalRequestFormProps) {
  return (
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
            onChange={(event) => onGrossAmountChange(event.target.value)}
            hint="Minimum: 2 USDT · Fee: 5%"
          />
          <button
            type="button"
            disabled={!controlsEnabled}
            onClick={onMax}
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
          onChange={(event) => onDestinationChange(event.target.value.trim())}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          hint="Do not use TRC20, ERC20, or an exchange memo/tag."
        />

        <Input
          label="Four-digit Fund PIN"
          type="password"
          inputMode="numeric"
          placeholder="••••"
          value={fundPassword}
          maxLength={4}
          disabled={!controlsEnabled}
          onChange={(event) => {
            const value = event.target.value.replace(/\D/g, "").slice(0, 4);
            onFundPasswordChange(value);
          }}
          autoComplete="off"
          hint="Use the same Fund PIN as ETB withdrawals."
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
            BEP20 transfers are irreversible. Verify the destination and displayed net amount carefully.
          </p>
        </div>

        <Button
          fullWidth
          loading={submitting}
          disabled={!canSubmit}
          onClick={onSubmit}
        >
          Submit USDT Withdrawal
        </Button>
      </div>
    </section>
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

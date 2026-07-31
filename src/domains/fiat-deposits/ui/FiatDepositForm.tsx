import { useCallback, useState } from "react";
import { Check, ChevronLeft, Copy } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/Badge.js";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { getFiatDepositMethodMeta } from "./fiat-deposit-providers.js";
import type { FiatDepositMethodMeta } from "./fiat-deposit-provider.js";
import type { FiatPaymentMethod } from "./fiat-deposit-types.js";

export function FiatDepositForm({
  method,
  amount,
  txReference,
  submitting,
  onAmountChange,
  onReferenceChange,
  onBack,
  onSubmit,
}: {
  method: FiatPaymentMethod;
  amount: string;
  txReference: string;
  submitting: boolean;
  onAmountChange: (value: string) => void;
  onReferenceChange: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const meta = getFiatDepositMethodMeta(method.type);
  const [copied, setCopied] = useState(false);

  const copyAccountNumber = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(method.account_number);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      toast.error("Unable to copy. Please copy manually.");
    }
  }, [method.account_number]);

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-gray-100">Deposit Details</h2>
        <Badge variant="default" className="shrink-0 text-[9px]">{meta.label}</Badge>
      </div>

      <section className="overflow-hidden rounded-xl border border-[rgba(0,255,65,0.14)] bg-[#111]">
        <div className="border-b border-[#1a1a1a] px-3.5 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#1f1f1f] bg-[#0b0b0b] text-gray-400 transition-colors hover:border-[rgba(0,255,65,0.35)] hover:text-[#00ff41] card-press"
              aria-label="Back to deposit method selection"
            >
              <ChevronLeft size={15} />
            </button>
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[rgba(0,255,65,0.16)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
              {meta.icon}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-bold leading-tight text-gray-100">
                {meta.label} Deposit
              </h2>
              <p className="mt-0.5 truncate text-[11px] text-gray-500">{meta.pageSubtitle}</p>
            </div>
          </div>
        </div>

        <div className="space-y-3 p-3.5">
          <PaymentAccountCard
            method={method}
            meta={meta}
            copied={copied}
            onCopy={copyAccountNumber}
          />
          <Input
            label="Amount (ETB) — optional"
            type="text"
            placeholder="Enter deposit amount"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            inputMode="decimal"
          />
          <Input
            label={meta.refLabel}
            placeholder={meta.refPlaceholder}
            value={txReference}
            onChange={(event) => onReferenceChange(event.target.value)}
            hint={meta.refHint}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            fullWidth
            loading={submitting}
            disabled={!txReference.trim() || submitting}
            onClick={onSubmit}
          >
            Submit Deposit
          </Button>
        </div>
      </section>
    </section>
  );
}

function PaymentAccountCard({
  method,
  meta,
  copied,
  onCopy,
}: {
  method: FiatPaymentMethod;
  meta: FiatDepositMethodMeta;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-2.5 rounded-xl border border-[#1f1f1f] bg-[#0b0b0b] p-3">
      <AccountDetail label={meta.accountLabel} value={method.account_name} />
      <div className="flex items-start justify-between gap-3">
        <span className="shrink-0 text-[11px] text-gray-500">{meta.numberLabel}</span>
        <div className="flex min-w-0 items-start justify-end gap-2">
          <span className="min-w-0 break-all text-right font-mono text-sm font-semibold leading-relaxed text-[#00ff41]">
            {method.account_number}
          </span>
          <button
            type="button"
            onClick={onCopy}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[#1f1f1f] bg-[#111] text-gray-500 hover:text-[#00ff41] card-press"
            aria-label={`Copy ${meta.numberLabel.toLowerCase()}`}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
        </div>
      </div>
      {method.instructions && (
        <p className="border-t border-[#1f1f1f] pt-2.5 text-[11px] leading-relaxed text-gray-500">
          {method.instructions}
        </p>
      )}
    </div>
  );
}

function AccountDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-[11px] text-gray-500">{label}</span>
      <span className="truncate text-xs font-semibold text-gray-200">{value}</span>
    </div>
  );
}

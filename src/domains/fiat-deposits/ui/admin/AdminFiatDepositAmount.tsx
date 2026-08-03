import { CurrencyUnit } from "@/components/ui/AmountText.js";

export function AdminFiatDepositAmount({ value }: { value: number }) {
  return (
    <>
      {Number(value || 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}
      <CurrencyUnit />
    </>
  );
}

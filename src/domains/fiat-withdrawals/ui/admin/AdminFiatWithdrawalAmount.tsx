import { CurrencyUnit } from "@/components/ui/AmountText.js";

function formatAdminFiatWithdrawalAmount(value: number): string {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function AdminFiatWithdrawalAmount({
  value,
}: Readonly<{ value: number }>) {
  return (
    <>
      {formatAdminFiatWithdrawalAmount(value)}
      <CurrencyUnit />
    </>
  );
}

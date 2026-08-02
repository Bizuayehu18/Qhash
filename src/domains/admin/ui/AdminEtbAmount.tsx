import { CurrencyUnit } from "@/components/ui/AmountText.js";

function formatAdminEtbNumber(value: number): string {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function AdminEtbAmount({ value }: { value: number }) {
  return (
    <>
      {formatAdminEtbNumber(value)}
      <CurrencyUnit />
    </>
  );
}

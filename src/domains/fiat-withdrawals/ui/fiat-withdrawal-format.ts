export function onlyFourDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

export function maskFiatWithdrawalAccount(value: string): string {
  const digits = value.trim();
  if (digits.length <= 4) return digits;

  return `•••• ${digits.slice(-4)}`;
}

export function formatEtb(value: number): string {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

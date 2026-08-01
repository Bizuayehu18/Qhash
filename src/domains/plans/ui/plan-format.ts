export function formatPlanAmount(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function formatPlanWalletAmount(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

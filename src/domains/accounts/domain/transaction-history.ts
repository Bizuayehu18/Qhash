export const TRANSACTION_HISTORY_FILTERS = [
  { key: "all", label: "All" },
  { key: "deposit", label: "Deposits" },
  { key: "withdrawal", label: "Withdrawals" },
  { key: "earning", label: "Earnings" },
  { key: "referral_bonus", label: "Referrals" },
  { key: "plan_purchase", label: "Investments" },
] as const;

export type TransactionHistoryFilter = (typeof TRANSACTION_HISTORY_FILTERS)[number]["key"];

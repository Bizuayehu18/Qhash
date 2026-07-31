export type FiatWithdrawalStep = "details" | "confirm";
export type UserFiatWithdrawal = {
  id: string;
  amount: number;
  method: "cbe" | "telebirr";
  account_name: string;
  account_last4: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  updated_at: string;
  fee_percent: number | null;
  fee_amount: number | null;
  net_amount: number | null;
};

export type FiatWithdrawalSecurityStatus = {
  hasFundPassword: boolean;
  fundPasswordLockedUntil: string | null;
  fundPasswordFailedAttempts: number;
  isFundPasswordLocked: boolean;
};

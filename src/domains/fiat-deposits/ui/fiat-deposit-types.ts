import type { Deposit, PaymentMethodType } from "@/lib/database.types.js";

export type FiatPaymentMethod = {
  id: string;
  type: PaymentMethodType;
  account_name: string;
  account_number: string;
  instructions: string | null;
  is_active: boolean;
};

export type UserFiatDeposit = Pick<
  Deposit,
  | "id"
  | "amount"
  | "status"
  | "transaction_reference"
  | "receipt_url"
  | "created_at"
  | "payment_method_id"
> & {
  method_type: string;
  method_name: string;
};
export type FiatDepositStep = "select" | "form";
export type FiatDepositMethodOption = {
  method: FiatPaymentMethod;
  index: number;
  total: number;
};

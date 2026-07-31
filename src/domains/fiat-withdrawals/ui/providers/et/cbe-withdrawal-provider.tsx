import { Building2 } from "lucide-react";
import type { FiatWithdrawalProvider } from "../../fiat-withdrawal-provider.js";

export const CBE_WITHDRAWAL_PROVIDER: FiatWithdrawalProvider = {
  countryCode: "et",
  method: "cbe",
  order: 0,
  displayName: "CBE",
  meta: {
    label: "Bank Transfer",
    title: "CBE Withdrawal",
    nameLabel: "CBE Account Name",
    numberLabel: "CBE Account Number",
    numberPlaceholder: "Enter CBE account number",
    submitLabel: "Submit CBE Withdrawal",
    icon: <Building2 size={16} />,
  },
};

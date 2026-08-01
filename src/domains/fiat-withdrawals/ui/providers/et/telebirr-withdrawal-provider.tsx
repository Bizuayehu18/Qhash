import { Smartphone } from "lucide-react";
import type { FiatWithdrawalProvider } from "../../fiat-withdrawal-provider.js";

export const TELEBIRR_WITHDRAWAL_PROVIDER: FiatWithdrawalProvider = {
  countryCode: "et",
  method: "telebirr",
  order: 1,
  displayName: "TeleBirr",
  meta: {
    label: "Wallet Transfer",
    title: "TeleBirr Withdrawal",
    nameLabel: "TeleBirr Account Name",
    numberLabel: "TeleBirr Phone Number",
    numberPlaceholder: "Enter TeleBirr phone number",
    submitLabel: "Submit TeleBirr Withdrawal",
    icon: <Smartphone size={16} />,
  },
};

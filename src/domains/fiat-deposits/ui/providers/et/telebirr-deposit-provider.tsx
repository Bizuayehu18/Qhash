import { Smartphone } from "lucide-react";
import type { FiatDepositProvider } from "../../fiat-deposit-provider.js";

export const TELEBIRR_DEPOSIT_PROVIDER: FiatDepositProvider = {
  method: "telebirr",
  order: 1,
  meta: {
    label: "TeleBirr",
    sublabel: "Wallet Transfer",
    pageSubtitle: "Wallet transfer",
    accountLabel: "Receiver's Name",
    numberLabel: "TeleBirr Number",
    refLabel: "TeleBirr Transaction ID",
    refPrefix: "D",
    refPlaceholder: "e.g. DXXXXXXXXX",
    refHint: 'Starts with "D" — from your TeleBirr receipt',
    refError: 'TeleBirr transaction IDs start with "D". Check your receipt and try again.',
    successToast: "TeleBirr deposit submitted successfully.",
    icon: <Smartphone size={15} />,
  },
};

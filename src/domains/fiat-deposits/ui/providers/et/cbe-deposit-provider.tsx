import { Building2 } from "lucide-react";
import type { FiatDepositProvider } from "../../fiat-deposit-provider.js";

export const CBE_DEPOSIT_PROVIDER: FiatDepositProvider = {
  method: "cbe",
  order: 0,
  meta: {
    label: "CBE",
    sublabel: "Bank Transfer",
    pageSubtitle: "Bank transfer",
    accountLabel: "Receiver's Name",
    numberLabel: "Account Number",
    refLabel: "CBE Transaction ID",
    refPrefix: "FT",
    refPlaceholder: "e.g. FT24XXXXXXX",
    refHint: 'Starts with "FT" — from your CBE receipt',
    refError: 'CBE transaction IDs start with "FT". Check your receipt and try again.',
    successToast: "CBE deposit submitted successfully.",
    icon: <Building2 size={15} />,
  },
};

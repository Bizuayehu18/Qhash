import type { PaymentMethodType } from "@/lib/database.types.js";
import type {
  AdminPaymentMethodsArchiveFilter,
} from "../../application/admin-payment-methods-auth-lifecycle.js";

export const ADMIN_PAYMENT_METHOD_LABELS: Record<PaymentMethodType, string> = {
  cbe: "CBE",
  telebirr: "TeleBirr",
};

export const ADMIN_PAYMENT_METHOD_TYPES = ["cbe", "telebirr"] as const;

export const ADMIN_PAYMENT_METHOD_ARCHIVE_FILTERS: ReadonlyArray<Readonly<{
  key: AdminPaymentMethodsArchiveFilter;
  label: string;
}>> = [
  { key: "visible", label: "Visible" },
  { key: "archived", label: "Archived" },
  { key: "all", label: "All" },
];

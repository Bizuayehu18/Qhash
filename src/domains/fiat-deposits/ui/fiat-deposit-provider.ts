import type { ReactNode } from "react";

export type FiatDepositMethod = "cbe" | "telebirr";

export type FiatDepositMethodMeta = {
  label: string;
  sublabel: string;
  pageSubtitle: string;
  accountLabel: string;
  numberLabel: string;
  refLabel: string;
  refPrefix: string;
  refPlaceholder: string;
  refHint: string;
  refError: string;
  successToast: string;
  icon: ReactNode;
};

export type FiatDepositProvider = {
  method: FiatDepositMethod;
  order: number;
  meta: FiatDepositMethodMeta;
};

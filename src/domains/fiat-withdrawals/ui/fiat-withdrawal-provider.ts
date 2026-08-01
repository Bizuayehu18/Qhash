import type { ReactNode } from "react";
import type { FiatWithdrawalMethod } from "../domain/fiat-withdrawal-method.js";

export type { FiatWithdrawalMethod } from "../domain/fiat-withdrawal-method.js";

export type FiatWithdrawalMethodMeta = {
  label: string;
  title: string;
  nameLabel: string;
  numberLabel: string;
  numberPlaceholder: string;
  submitLabel: string;
  icon: ReactNode;
};

export type FiatWithdrawalProvider = {
  countryCode: "et";
  method: FiatWithdrawalMethod;
  order: number;
  displayName: string;
  meta: FiatWithdrawalMethodMeta;
};

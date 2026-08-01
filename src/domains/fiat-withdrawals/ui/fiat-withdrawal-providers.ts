import { CBE_WITHDRAWAL_PROVIDER } from "./providers/et/cbe-withdrawal-provider.js";
import { TELEBIRR_WITHDRAWAL_PROVIDER } from "./providers/et/telebirr-withdrawal-provider.js";
import type {
  FiatWithdrawalMethod,
  FiatWithdrawalMethodMeta,
  FiatWithdrawalProvider,
} from "./fiat-withdrawal-provider.js";

const PROVIDERS: Record<FiatWithdrawalMethod, FiatWithdrawalProvider> = {
  cbe: CBE_WITHDRAWAL_PROVIDER,
  telebirr: TELEBIRR_WITHDRAWAL_PROVIDER,
};

export const FIAT_WITHDRAWAL_METHODS = Object.values(PROVIDERS).sort(
  (left, right) => left.order - right.order,
);

export function getFiatWithdrawalMethodLabel(method: string): string {
  if (method === TELEBIRR_WITHDRAWAL_PROVIDER.method) {
    return TELEBIRR_WITHDRAWAL_PROVIDER.displayName;
  }
  if (method === CBE_WITHDRAWAL_PROVIDER.method) {
    return CBE_WITHDRAWAL_PROVIDER.displayName;
  }
  return method;
}

export function getFiatWithdrawalMethodMeta(
  method: FiatWithdrawalMethod,
): FiatWithdrawalMethodMeta {
  return PROVIDERS[method].meta;
}

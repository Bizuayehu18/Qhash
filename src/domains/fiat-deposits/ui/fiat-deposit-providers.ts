import { CBE_DEPOSIT_PROVIDER } from "./providers/et/cbe-deposit-provider.js";
import { TELEBIRR_DEPOSIT_PROVIDER } from "./providers/et/telebirr-deposit-provider.js";
import type {
  FiatDepositMethod,
  FiatDepositMethodMeta,
  FiatDepositProvider,
} from "./fiat-deposit-provider.js";

const PROVIDERS: Record<FiatDepositMethod, FiatDepositProvider> = {
  cbe: CBE_DEPOSIT_PROVIDER,
  telebirr: TELEBIRR_DEPOSIT_PROVIDER,
};

export function getFiatDepositMethodOrder(type: string): number {
  if (type === CBE_DEPOSIT_PROVIDER.method) return CBE_DEPOSIT_PROVIDER.order;
  if (type === TELEBIRR_DEPOSIT_PROVIDER.method) return TELEBIRR_DEPOSIT_PROVIDER.order;
  return 99;
}

export function getFiatDepositMethodMeta(type: string): FiatDepositMethodMeta {
  if (type === TELEBIRR_DEPOSIT_PROVIDER.method) return PROVIDERS.telebirr.meta;
  return PROVIDERS.cbe.meta;
}

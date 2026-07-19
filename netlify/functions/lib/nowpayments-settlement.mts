import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../../src/lib/database.types.ts";
import type { NowpaymentsVerifiedPayment } from "./nowpayments-client.mts";

export type NowpaymentsSettlementResult = {
  status:
    | "credited"
    | "already_credited"
    | "preserved_credited"
    | "recorded_no_credit"
    | "preserved_newer_status";
};

export type NowpaymentsSettlementStore = {
  settle(payment: NowpaymentsVerifiedPayment): Promise<NowpaymentsSettlementResult>;
};

export class NowpaymentsSettlementStoreError extends Error {
  readonly safeToIgnore: boolean;

  constructor(message: string, safeToIgnore: boolean) {
    super(message);
    this.name = "NowpaymentsSettlementStoreError";
    this.safeToIgnore = safeToIgnore;
  }
}

function isSafeSettlementRejection(message: string): boolean {
  return [
    "invalid_nowpayments_settlement_input",
    "invalid_nowpayments_settlement_outcome",
    "unexpected_nowpayments_settlement_outcome",
    "nowpayments_settlement_ownership_mismatch",
    "nowpayments_settlement_record_mismatch",
  ].some((code) => message.includes(code));
}

export function createNowpaymentsSettlementStore(
  supabaseUrl: string,
  serviceRoleKey: string,
): NowpaymentsSettlementStore {
  const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return {
    async settle(payment) {
      const { data, error } = await admin.rpc(
        "settle_verified_nowpayments_usdt_payment",
        {
          p_provider_payment_id: payment.providerPaymentId,
          p_parent_provider_payment_id: payment.parentProviderPaymentId,
          p_qhash_order_id: payment.qhashOrderId,
          p_pay_address: payment.payAddress,
          p_pay_currency: payment.payCurrency,
          p_provider_payment_status: payment.providerPaymentStatus,
          p_outcome_amount: payment.outcomeAmountUsdt,
          p_outcome_currency: payment.outcomeCurrency,
        },
      );

      if (error) {
        throw new NowpaymentsSettlementStoreError(
          "settlement_rpc_failed",
          isSafeSettlementRejection(error.message),
        );
      }
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new NowpaymentsSettlementStoreError(
          "settlement_rpc_invalid_response",
          false,
        );
      }

      const status = (data as Record<string, unknown>).status;
      if (
        status !== "credited"
        && status !== "already_credited"
        && status !== "preserved_credited"
        && status !== "recorded_no_credit"
        && status !== "preserved_newer_status"
      ) {
        throw new NowpaymentsSettlementStoreError(
          "settlement_rpc_invalid_response",
          false,
        );
      }

      return { status };
    },
  };
}

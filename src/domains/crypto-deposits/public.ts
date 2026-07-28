/**
 * Client-safe crypto-deposit surface.
 *
 * The implementation remains at its legacy path during Phase 2. New routes
 * import this facade; the old path stays available until all consumers move
 * in a separately reviewed extraction.
 */
export {
  CryptoDepositMethodIcon,
  NowpaymentsUsdtDeposit,
} from "@/components/deposit/NowpaymentsUsdtDeposit.js";

export type {
  NowpaymentsDepositHistoryView,
  NowpaymentsDepositOverview,
  NowpaymentsDepositSessionView,
} from "@/lib/nowpayments-deposit-ui.js";

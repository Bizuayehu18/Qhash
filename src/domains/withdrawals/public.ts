/**
 * Client-safe withdrawal surface.
 *
 * The USDT implementation remains at its legacy path during Phase 2. New
 * routes import this facade; the old path stays available until all consumers
 * move in a separately reviewed extraction.
 */
export { NowpaymentsUsdtWithdrawal } from "@/components/withdrawal/NowpaymentsUsdtWithdrawal.js";

export type {
  NowpaymentsWithdrawalHistoryView,
  NowpaymentsWithdrawalOverview,
  NowpaymentsWithdrawalRequestResult,
  NowpaymentsWithdrawalStatus,
} from "@/lib/nowpayments-withdrawal-ui.js";

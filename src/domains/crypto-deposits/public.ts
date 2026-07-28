/**
 * Client-safe crypto-deposit surface.
 *
 * Provider, server, database, and migration internals are deliberately absent
 * from this browser-facing contract.
 */
export {
  CryptoDepositMethodIcon,
  UsdtBep20Deposit,
  UsdtBep20Deposit as NowpaymentsUsdtDeposit,
} from "./ui/UsdtBep20Deposit.js";

export type {
  NowpaymentsDepositHistoryView,
  NowpaymentsDepositOverview,
  NowpaymentsDepositSessionView,
} from "./ui/nowpayments-deposit-ui.js";

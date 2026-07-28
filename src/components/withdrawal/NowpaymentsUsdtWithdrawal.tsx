/**
 * @deprecated Import the client-safe withdrawal surface from
 * `@/domains/withdrawals/public.js`.
 *
 * This compatibility bridge remains until every legacy direct importer has
 * moved to the domain surface.
 */
export {
  UsdtBep20Withdrawal,
  UsdtBep20Withdrawal as NowpaymentsUsdtWithdrawal,
} from "@/domains/withdrawals/ui/UsdtBep20Withdrawal.js";

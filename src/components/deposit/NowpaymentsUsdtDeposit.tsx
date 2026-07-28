/**
 * @deprecated Import the client-safe crypto-deposit surface from
 * `@/domains/crypto-deposits/public.js`.
 *
 * This compatibility bridge remains until every legacy direct importer has
 * moved to the domain surface.
 */
export * from "@/domains/crypto-deposits/ui/UsdtBep20Deposit.js";
export {
  UsdtBep20Deposit as NowpaymentsUsdtDeposit,
} from "@/domains/crypto-deposits/ui/UsdtBep20Deposit.js";

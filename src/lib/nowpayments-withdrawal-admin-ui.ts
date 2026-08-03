/**
 * Temporary compatibility bridge for the pre-domain administrator transport
 * and lifecycle path. New code belongs to the withdrawals domain.
 */
export {
  NowpaymentsAdminWithdrawalError,
  NOWPAYMENTS_ADMIN_WITHDRAWAL_STATUSES,
  fetchNowpaymentsAdminWithdrawalOverview,
  parseNowpaymentsAdminWithdrawalOverview,
  submitNowpaymentsAdminWithdrawalAction,
} from "../domains/withdrawals/application/admin-usdt-withdrawal-browser-service.ts";
export type {
  NowpaymentsAdminActionInput,
  NowpaymentsAdminActionResult,
  NowpaymentsAdminWithdrawal,
  NowpaymentsAdminWithdrawalOverview,
  NowpaymentsAdminWithdrawalStatus,
} from "../domains/withdrawals/application/admin-usdt-withdrawal-browser-service.ts";
export {
  createAdminWithdrawalActionKeyManager,
  createAdminWithdrawalActionLifecycle,
  createLatestAdminWithdrawalRequestGuard,
  runAdminWithdrawalSingleFlight,
} from "../domains/withdrawals/application/admin-usdt-withdrawal-action-lifecycle.ts";
export {
  formatAdminUsdtSix,
} from "../domains/withdrawals/ui/admin/admin-usdt-withdrawal-presentation.ts";

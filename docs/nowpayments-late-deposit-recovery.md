# NOWPayments late-deposit recovery

QHash cannot automatically discover a late NOWPayments child payment ID that
NOWPayments has never sent. NOWPayments does not provide a supported API for
searching an expired address or blockchain transaction hash to discover that
unknown child payment ID, and callbacks normally stop after the original
payment expires.

QHash therefore does not poll, scan the blockchain, guess payment IDs, or
credit from a transaction hash. A transaction hash supplied by a user is only
support evidence for an administrator to investigate with NOWPayments.

## Recovery procedure

1. The user reports a transfer sent to an expired QHash deposit address and
   supplies its blockchain transaction hash.
2. A QHash administrator contacts NOWPayments support with the stored original
   payment/address evidence and the transaction hash.
3. NOWPayments either resends the signed IPN or supplies and confirms the late
   child `payment_id` and its relationship to the original payment.
4. A resent signed IPN follows the normal production webhook path.
5. If a resend is unavailable, an authenticated, active QHash administrator
   may submit only the confirmed provider payment ID to:

   `POST /api/admin/crypto/nowpayments/reconcile-payment`

   ```json
   { "payment_id": "123456789" }
   ```

The recovery endpoint is production-only and requires the administrator's
QHash bearer session. It never accepts an amount, address, user ID, order ID,
parent ID, currency, status, or transaction hash from the administrator. It
independently calls NOWPayments Get Payment Status and then uses the same
service-role-only atomic settlement function as the signed IPN path.

Only a positive, independently verified `finished` USDTBSC payment whose
provider ID or parent ID, address, order/session, and QHash user ownership match
stored records can credit. Repeated attempts are safe and return an
already-credited result. Unknown, mismatched, non-finished, wrong-currency, or
invalid payments never credit.

This is manual reconciliation, not automatic discovery. It requires a
provider-confirmed payment ID before QHash can perform independent verification.

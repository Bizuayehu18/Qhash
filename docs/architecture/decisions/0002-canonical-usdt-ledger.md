# ADR 0002: Canonical USDT ledger

Status: Accepted
Date: 2026-07-27

## Context

QHash currently contains legacy ETB balances and transactions alongside a
provider-named NOWPayments USDT wallet and ledger. The accepted product
direction is international rather than country-focused:

- USDT is the default account currency;
- plan prices, earnings, and referral rewards are denominated in USDT;
- crypto and country-specific fiat rails fund or withdraw the same account
  value;
- fiat availability depends on the user's registered country and rail
  configuration.

Using a payment provider's table or an ETB wallet as the long-term account
model would couple product accounting to one rail.

## Decision

QHash will have one provider-neutral canonical USDT account ledger as the
authoritative source for user balances, plan purchases, earnings, referral
rewards, deposits, and withdrawals.

External rails are adapters:

- a crypto provider supplies payment and settlement evidence;
- a fiat provider supplies local-currency receipt or payout evidence;
- a quote converts local fiat to or from canonical USDT;
- provider/local amounts, rates, fees, and references remain immutable audit
  evidence;
- only a verified, idempotent settlement posts to the canonical ledger.

Provider outcome amounts do not redefine the user's canonical amount. Existing
accepted crypto-deposit behavior credits verified gross `actually_paid` while
recording provider outcome separately. Fiat-provider fees are not covered by
QHash; their treatment must be explicit in the accepted quote and audit record.

## Accepted product rules

- All account-facing plan, earning, referral, deposit, and withdrawal values
  become USDT.
- Country-specific fiat deposit and withdrawal sections are independently
  visible only when available for the registered country.
- Countries without a fiat rail remain eligible for crypto-only use.
- Phone-derived country is not user-editable.
- Withdrawal rules and Fund PIN apply across rails at the authoritative
  boundary.
- Current test financial data may be archived and reset at final cutover while
  Auth accounts, profiles, account codes, and referral relationships are
  preserved.

## Required properties

The eventual ledger must:

- use fixed decimal precision, never binary floating point;
- identify asset and network independently of provider;
- maintain immutable entries and a verifiable balance chain;
- use stable idempotency keys for every posting;
- preserve gross, fee, net, rate, source currency, and provider evidence;
- support reservations and releases without losing history;
- serialize conflicting mutations;
- prevent client roles from invoking privileged posting functions;
- reconcile all adapters without using UI state as evidence;
- define rounding at every conversion boundary.

The exact schema, precision, quote lifetime, and posting API require separate
design review. Acceptance of this ADR does not authorize a direct production
conversion.

## Consequences

Positive:

- product behavior is consistent across countries and providers;
- plan and referral logic no longer depends on ETB;
- providers can be replaced without migrating user balances;
- reconciliation has one accounting authority;
- local fiat remains useful evidence without becoming a second wallet.

Costs and risks:

- legacy ETB and provider-specific records require an explicit archive/mapping;
- rate, spread, fee, and rounding policies must be defined;
- a dual-write transition would be dangerous without formal reconciliation;
- current test balances and plans cannot simply be renamed to USDT;
- reporting must distinguish canonical amounts from local/provider amounts.

## Alternatives considered

### Keep separate ETB and USDT wallets

Rejected as the international target because plans and rewards would require
ambiguous cross-wallet conversion and country-specific product logic.

### Make the NOWPayments wallet canonical

Rejected because NOWPayments is a rail, not the QHash accounting authority.

### Display USDT while retaining ETB accounting

Rejected because display conversion hides currency and rounding risk instead
of removing it.

## Follow-up decisions

Separate ADRs or specifications are required for:

- canonical ledger schema and precision;
- quote source, lifetime, spread, and rounding;
- fee treatment per rail;
- archive/reset and cutover procedure;
- reconciliation and operational monitoring.

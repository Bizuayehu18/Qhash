# Crypto Deposit Foundation Checkpoint

This checkpoint documents the confirmed-safe state after the merged crypto deposit foundation work:

- PR #214: database and generated type foundation
- PR #215: read-only user-facing crypto deposit overview UI/server helper

Use this file as a guardrail before starting any future crypto watcher, admin address assignment, wallet crediting, sweeping, or private-key-related work.

## Current merged state

### Database foundation

The database foundation exists for USDT deposits on:

- TRON / TRC20
- BSC / BEP20

Foundation tables added by PR #214:

- `crypto_deposit_addresses`
- `crypto_deposits`
- `crypto_sweep_jobs`
- `crypto_watcher_state`

Seeded app settings added by PR #214:

- `usdt_etb_rate` = `160`
- `crypto_tron_min_usdt` = `10`
- `crypto_bsc_min_usdt` = `5`
- `crypto_auto_credit_enabled` = `false`

### User-facing overview

PR #215 added the read-only deposit overview layer:

- `src/lib/server/crypto-deposits.ts`
- crypto section inside `src/routes/_app/deposit.tsx`

The overview can read:

- crypto settings
- assigned public deposit addresses
- read-only crypto deposit history

It must not write deposits, credit wallets, generate addresses, sweep funds, or sign transactions.

## Confirmed safety properties

### Existing fiat deposits remain the source of live funding

The existing CBE/TeleBirr deposit flow remains separate and must not be coupled to crypto work:

- `getPaymentMethodsFn`
- `submitDepositFn`
- `getUserDepositsFn`
- existing transaction-reference validation
- existing wallet refresh after fiat deposit submission

Future crypto work must not change those paths unless a PR is explicitly scoped to fiat deposits.

### Crypto addresses are hidden while auto-credit is disabled

The current server helper returns no crypto deposit addresses unless:

- `crypto_auto_credit_enabled` parses to `true`
- address `status` is `active`
- address network is supported
- TRON address `activation_status` is `active`
- BSC address `activation_status` is `not_required`

The current UI also treats crypto as paused while `autoCreditEnabled` is false and refuses to copy or display a live address.

This is important because assigned addresses must not be exposed to users before QHash has a working detection and crediting path.

### Read-only boundary

The merged crypto UI/server layer is intentionally read-only.

Allowed in current state:

- read app settings
- read assigned public addresses
- read deposit history rows
- show paused/not-ready UI
- show historical deposits after future watcher support exists

Not allowed in current state:

- blockchain watcher
- address generation
- private key or seed phrase handling
- wallet crediting
- user balance updates
- transaction inserts for crypto crediting
- sweep job execution
- signing transactions
- RPC provider/package additions

## Private-key and treasury rules

Future crypto work must preserve these rules:

- never store seed phrases in code
- never store private keys in frontend code
- never generate private keys in the frontend
- never expose treasury/private operational keys through `app_settings`
- never require a treasury private key in Netlify frontend environment variables
- public deposit addresses are allowed; private signing material is not

Any future signing or sweeping design must be reviewed separately and should use a server-only or external custody model.

## `amount_raw` guardrail

`crypto_deposits.amount_raw` is `numeric(78,0)` and represents token base units.

Future watcher/ingestion work must treat this value as a string or BigInt-safe value. Do not parse it with JavaScript `Number`.

The current user UI only displays:

- `amount_usdt`
- `credited_amount_etb`

Those are smaller decimal values and are safe for display formatting.

## Recommended next PR sequence

Prefer small PRs in this order:

1. Admin/public crypto settings management, with no address generation and no wallet crediting.
2. Admin address assignment tooling for public addresses only, with no private keys.
3. Watcher design document or dry-run watcher that detects deposits but does not credit wallets.
4. Crediting implementation with strict idempotency, audit trail, and manual review path.
5. Sweeping/signing architecture only after a separate security review.

## Review checklist for future crypto PRs

Before merging any future crypto PR, verify:

- CBE/TeleBirr deposit flow is unchanged unless explicitly scoped.
- `plan_purchase` remains untouched; no `investment` enum/type is introduced.
- No private key, seed phrase, or signing material is introduced into frontend code.
- No watcher credits wallets until idempotency and audit behavior is reviewed.
- No deposit address is shown while `crypto_auto_credit_enabled` is false.
- TRON/BSC network and activation-state rules are enforced server-side.
- `amount_raw` is never coerced to JavaScript `Number`.
- Any wallet-crediting PR has a clear duplicate-protection strategy.
- Any admin PR derives admin identity from the access token server-side.

## Current checkpoint status

As of this checkpoint:

- crypto deposit schema exists
- crypto deposit overview UI exists
- Netlify deployed PR #215 successfully
- crypto deposits are still not live for users unless explicitly enabled later
- no watcher, crediting, sweeping, signing, or private-key handling exists

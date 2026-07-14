# Crypto Deposit Confirmation and Crediting Guardrails

Status: design-only checkpoint after the admin audit view.

This document defines the safety rules for the next crypto-deposit phases. It does not implement confirmation, wallet crediting, balance changes, sweeping, signing, key management, user-facing address exposure, or `crypto_auto_credit_enabled` changes.

## Current state

The current crypto-deposit foundation is intentionally paused at observe, store, and admin audit:

1. The database foundation exists for assigned crypto addresses, detected deposits, sweep jobs, and watcher state.
2. User-facing crypto addresses and crypto deposit history remain gated while `crypto_auto_credit_enabled` is false.
3. Admins can manage numeric crypto settings only. The address-exposure switch is intentionally not editable.
4. Admins can manually assign public TRON/BSC USDT deposit addresses.
5. Admins can dry-run BSC USDT Transfer detection over a manual block range.
6. Admins can store BSC USDT matches as `crypto_deposits.status = 'detected'` rows.
7. Admins can inspect stored crypto deposit rows in a read-only audit panel.

The system can currently observe and record deposits, but it must not move ETB or expose deposit addresses to users.

## Non-negotiable boundaries

Future confirmation and crediting work must preserve these boundaries until explicitly reviewed and tested:

- no wallet crediting until an idempotent crediting transaction/RPC is reviewed
- no wallet balance updates outside the crediting transaction/RPC
- no wallet transaction inserts outside the crediting transaction/RPC
- no `crypto_deposits.status = 'credited'` without setting `exchange_rate_etb`, `credited_amount_etb`, and `credited_at` in the same atomic operation
- no `crypto_auto_credit_enabled` UI or setting change until detection, confirmation, crediting, audit, rollback, and support behavior are reviewed
- no user-facing address exposure while `crypto_auto_credit_enabled` is false
- no user-facing deposit history while `crypto_auto_credit_enabled` is false
- no private keys, seed phrases, mnemonics, signing, or sweeping in frontend code
- no treasury private keys in environment variables
- no renaming `plan_purchase` to `investment`
- no CBE or TeleBirr behavior changes as part of crypto work

## Confirmation phase design

Confirmation should be implemented before crediting. Confirmation is a blockchain finality/audit step, not a money movement step.

### Confirmation inputs

A future BSC confirmation helper should use:

- existing `crypto_deposits` rows with `network = 'BSC'`, `asset = 'USDT'`, and `status IN ('detected', 'confirmed')`
- each row's stored `block_number`
- the latest BSC block number from the configured BSC RPC provider
- a reviewed confirmation threshold, for example a hardcoded reviewed value or a new admin setting added in a separate reviewed PR

### Confirmation calculation

For a detected deposit with a valid `block_number`:

```text
confirmations = max(0, latest_block_number - deposit.block_number + 1)
```

The stored confirmation count should be monotonic. A later run must not reduce `confirmations` if an RPC provider reports a lower block height.

### Confirmation writes

A future confirmation write helper may update only these fields:

- `confirmations`
- `status`, from `detected` to `confirmed` only after the threshold is reached
- `confirmed_at`, set once when the deposit first becomes confirmed
- `updated_at`, if the schema or trigger uses it

It must not update:

- `exchange_rate_etb`
- `credited_amount_etb`
- `credited_at`
- `swept_at`
- wallet balances
- wallet transactions
- `crypto_watcher_state`, unless a separate watcher-state PR is explicitly scoped and reviewed

### Confirmation idempotency

A confirmation helper must be safe to rerun over the same rows. Re-running must not create duplicate side effects because confirmation should only update the same deposit rows in place.

The helper must never change `credited`, `swept`, or `failed` rows back to `detected` or `confirmed`.

### Confirmation UI

The first confirmation UI should be admin-only and explicit. It should show:

- selected network and status scope
- latest block used for the calculation
- confirmation threshold
- rows scanned
- rows updated
- rows newly marked confirmed
- rows skipped because already credited, swept, failed, malformed, or missing block numbers

The UI must make clear that confirmation does not credit wallets.

## Crediting phase design

Crediting is the first phase that moves ETB. It must be implemented with stronger guarantees than the detection and audit helpers.

### Crediting prerequisites

Before any crediting PR:

1. BSC detected-row storage must be merged and deployed.
2. The admin audit view must be merged and deployed.
3. Confirmation behavior must be implemented or deliberately documented as manual-only for the first crediting test.
4. A crediting transaction/RPC must be designed and reviewed.
5. Duplicate-credit prevention must be enforced at the database layer or by row locking inside the crediting transaction/RPC.
6. The test plan must include rerunning the same credit action and proving it does not double-credit.

### Crediting must be atomic

A future crediting operation must run inside one database transaction or SQL RPC. It must atomically:

1. Lock the target `crypto_deposits` row.
2. Confirm the row is eligible, for example `status = 'confirmed'` and not already credited/swept/failed.
3. Read the fixed `usdt_etb_rate` that applies at credit time.
4. Calculate `credited_amount_etb = amount_usdt * usdt_etb_rate` using database numeric arithmetic or exact string/decimal handling, not JavaScript floating point for authoritative accounting.
5. Update the deposit row to `status = 'credited'`.
6. Set `exchange_rate_etb`, `credited_amount_etb`, and `credited_at` in the same operation.
7. Update the user's wallet balance.
8. Insert a wallet transaction record that is uniquely tied to the crypto deposit.
9. Return a clear result showing whether the row was newly credited or already credited.

If any step fails, none of the state changes should commit.

### Duplicate-credit prevention

Crediting must be idempotent. The same deposit must never be credited twice, even if an admin clicks twice, a request retries, or a worker reruns.

Acceptable protections include:

- a database transaction that locks the deposit row and only credits when `status = 'confirmed'`
- a unique wallet transaction reference such as `crypto_deposit:<deposit_id>`
- a unique database constraint or equivalent RPC guard that prevents multiple completed wallet transactions for the same crypto deposit
- a return shape that reports `already_credited` instead of throwing after a safe duplicate attempt

If the current wallet transaction schema cannot enforce uniqueness on `reference_id`, a future migration should add the required uniqueness or the RPC must provide equivalent protection under lock.

### Crediting status transition

The only allowed money-moving transition should be:

```text
confirmed -> credited
```

The crediting operation must not support:

- `detected -> credited` without confirmation, unless a separate manual-review exception is explicitly designed and reviewed
- `credited -> credited`
- `credited -> detected`
- `credited -> confirmed`
- `swept -> credited`
- `failed -> credited`

### Exchange-rate capture

The crediting operation must store the exact rate used for the credit in `exchange_rate_etb`. Future rate changes must not alter already credited deposits.

The credited ETB amount must be stored in `credited_amount_etb` on the deposit row and reflected in the wallet transaction amount.

### Manual review first

The first crediting release should be manual/admin-triggered, not automatic.

The admin should see enough information before crediting:

- user identity
- assigned public address
- transaction hash
- event index
- sender address
- recipient address
- amount USDT
- confirmation count
- exchange rate to be used
- ETB amount to be credited

The admin action should require an explicit confirmation prompt.

## Numeric precision requirements

BSC USDT uses 18 token decimals. The detection helper preserves exact raw token amounts as strings and uses `bigint` for parsing and formatting.

Future crediting and reconciliation must not depend on JavaScript `number` for authoritative crypto amount math.

Rules:

- `amount_raw` must be treated as exact integer data.
- `amount_usdt` should be handled as database numeric text or exact decimal data when used for accounting.
- `credited_amount_etb` should be calculated with database numeric arithmetic or an exact decimal library, not binary floating point.
- Audit display can show stored values, but reconciliation should verify against chain data or exact database text values.
- If a frontend or server helper reads PostgreSQL numeric values through JSON, it must assume large numeric values may be unsafe unless returned as text.

A future hardening PR should consider returning audit amounts through a SQL RPC or view that casts `amount_raw`, `amount_usdt`, `exchange_rate_etb`, and `credited_amount_etb` to text for display and reconciliation.

## Audit and support requirements

Every phase should be explainable from stored data.

For each deposit, admins should be able to answer:

- Which user was assigned the recipient address?
- Which on-chain transfer was detected?
- Which block contained it?
- How many confirmations were used?
- When was it marked confirmed?
- Which rate was used for crediting?
- Which wallet transaction credited the user?
- Who or what triggered the crediting action?
- Was any retry a no-op or a new state change?

If the current schema does not capture the actor or source of a future crediting action, add audit fields or an audit table before enabling live crediting.

## Suggested implementation sequence

The safest next implementation sequence is:

1. Add an audit-display hardening PR if needed, especially exact numeric text display and an explicit truncation indicator.
2. Add a BSC confirmation design or admin-only confirmation dry-run helper.
3. Add an admin-only BSC confirmation write helper that updates only confirmation fields and status `detected -> confirmed`.
4. Add an admin audit view update showing confirmation transition details.
5. Add a database/RPC crediting design checkpoint.
6. Add the idempotent crediting RPC and tests.
7. Add an admin-only manual credit button for confirmed rows.
8. Review real test deposits end to end.
9. Only after the full flow is proven, consider user-facing address exposure and `crypto_auto_credit_enabled` changes in a separate PR.

## Out of scope for this checkpoint

This document does not add code, database migrations, RPCs, settings, UI actions, wallet updates, transaction inserts, status changes, sweeping, signing, key handling, or user exposure.

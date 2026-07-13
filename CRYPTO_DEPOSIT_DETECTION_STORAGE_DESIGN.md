# Crypto Deposit Detection Storage Design

This document defines the next safe step after the BSC dry-run detector helper and admin dry-run UI.

It is a design/checkpoint only. It does not add implementation code, database writes, watcher state updates, wallet crediting, user-facing address exposure, sweeping, signing, private keys, seed phrases, packages, route changes, CBE/TeleBirr changes, or `plan_purchase` changes.

## Current state before storage

The current merged crypto sequence has:

- crypto deposit database foundation
- read-only user crypto overview gated by `crypto_auto_credit_enabled`
- admin numeric crypto settings
- admin read-only address inventory
- admin-only manual public-address assignment
- watcher/detection design guardrails
- idempotency schema verification
- backend-only BSC dry-run detector helper
- admin-only BSC dry-run detector UI

The current system can preview BSC USDT transfer matches for assigned active BSC addresses. It still does not persist detected deposits.

## Purpose of the next implementation PR

The next implementation PR may add persistent storage for detected BSC USDT deposits only if it stays within this design.

Allowed future scope:

- reuse the existing BSC dry-run detector parsing/matching rules
- insert matched BSC USDT transfer events into `crypto_deposits`
- store rows with `status = 'detected'` only
- keep `confirmations = 0` unless that PR explicitly includes a reviewed confirmation calculation
- keep `exchange_rate_etb`, `credited_amount_etb`, `confirmed_at`, `credited_at`, and `swept_at` null
- surface duplicate events as already-seen/idempotent, not fatal
- return admin-only summary counters

Not allowed in the storage PR:

- wallet crediting
- user balance changes
- wallet transaction inserts
- `status = 'credited'`
- `status = 'swept'`
- sweep jobs
- signing
- private keys, seed phrases, mnemonics, or signing material
- user-facing crypto address exposure
- enabling or editing `crypto_auto_credit_enabled`
- address generation
- automatic watcher state advancement unless separately scoped and reviewed
- CBE/TeleBirr changes
- `plan_purchase` changes
- `investment` terminology

Detection storage is still not a live crypto deposit product. It is an admin/audit foundation.

## Existing storage schema

The foundation migration already created `crypto_deposits` with fields needed for detected events:

- `user_id`
- `address_id`
- `network`
- `asset`
- `tx_hash`
- `event_index`
- `from_address`
- `to_address`
- `amount_raw`
- `amount_usdt`
- `block_number`
- `confirmations`
- `status`
- `detected_at`
- credit/sweep fields for later phases

The schema also enforces:

```text
unique (network, tx_hash, event_index)
```

Future ingestion must rely on this database-level uniqueness. Application checks may reduce noise, but they must not be the only idempotency control.

## Required inserted values for BSC detected rows

For a BSC dry-run matched event, a future storage PR should insert one `crypto_deposits` row with:

```text
network = 'BSC'
asset = 'USDT'
status = 'detected'
confirmations = 0, unless confirmation handling is explicitly scoped
user_id = matched assigned address user_id
address_id = matched assigned address id
tx_hash = event transaction hash
event_index = event log index
from_address = event sender address
to_address = event recipient address
amount_raw = exact base-unit integer string
amount_usdt = decimal-safe USDT amount for BSC 18-decimal token
block_number = event block number
exchange_rate_etb = null
credited_amount_etb = null
confirmed_at = null
credited_at = null
swept_at = null
```

The inserted row must not calculate or snapshot ETB credit values. Exchange-rate snapshots belong to a later crediting PR.

## Amount handling requirement

BSC USDT / Binance-Peg BSC-USD is currently represented by:

```text
0x55d398326f99059ff775485246999027b3197955
```

and uses `18` decimals for the selected BSC token contract.

Future storage code must:

- keep raw token amount as a string or BigInt-safe value until database insertion
- never use JavaScript `Number` for token base units
- preserve `amount_raw` exactly
- derive `amount_usdt` using the verified BSC 18-decimal conversion
- not copy TRON/Ethereum decimal assumptions into BSC

Important schema note: `crypto_deposits.amount_usdt` currently uses `numeric(36, 6)`. A future storage implementation must verify that storing BSC 18-decimal amounts into a 6-decimal decimal column is acceptable for QHash accounting/audit needs. If 18-decimal precision must be preserved at the human-readable level, that requires a separate migration review before ingestion.

## Idempotency behavior

The event identity is:

```text
network + tx_hash + event_index
```

Required behavior:

- retrying the same block range must not create duplicate rows
- re-running after timeout must not create duplicate rows
- two admins manually running the same range must not create duplicate rows
- duplicate conflicts on `(network, tx_hash, event_index)` should be treated as already-seen
- duplicate conflicts should be counted in the returned admin summary
- unexpected database errors should fail safely and must not advance any watcher state

A future PR should prefer insert with conflict handling rather than pre-check-only logic.

## Address matching boundary

Only active assigned BSC USDT addresses may be stored:

```text
crypto_deposit_addresses.network = 'BSC'
crypto_deposit_addresses.asset = 'USDT'
crypto_deposit_addresses.status = 'active'
crypto_deposit_addresses.activation_status = 'not_required'
```

The stored `user_id`, `address_id`, and `to_address` must come from the matched assigned-address row/event match, not from client input.

The client/UI must never submit user IDs or address IDs for storage. The server must derive those from the assigned address inventory.

## Confirmation boundary

The first storage PR may store `status = 'detected'` with `confirmations = 0`.

It must not mark rows as `confirmed` unless confirmation policy is explicitly included and reviewed.

A future confirmation PR should define:

- latest-block lookup
- minimum BSC confirmations
- reorg behavior
- when `status` moves from `detected` to `confirmed`
- how `confirmed_at` is set
- how stale/reorged/failed events are handled

## Admin UI boundary

If the storage PR adds UI, it should remain admin-only and manual.

Allowed admin UI behavior:

- run detection storage over a small BSC block range
- show inserted count
- show duplicate/already-seen count
- show malformed/unassigned/skipped counts
- show inserted detected rows for audit

Not allowed admin UI behavior:

- approve crediting
- credit wallets
- edit balances
- expose deposit addresses to users
- enable auto-credit
- sweep or sign funds

## Error handling and audit counters

The future storage action should return admin-only counters such as:

- assigned address count
- RPC batch count
- returned log count
- matched event count
- inserted detected count
- duplicate/already-seen count
- malformed skipped count
- unassigned skipped count
- zero-amount skipped count
- invalid assigned-address count
- database error count or fail-safe error message

A storage run should be honest about partial failure. If any batch fails after prior inserts, the response must make that clear and must not pretend the entire range was safely processed.

## Watcher state boundary

This design does not approve automatic `crypto_watcher_state` advancement.

Manual storage can insert detected rows for a requested range without updating watcher state.

If a future PR updates `crypto_watcher_state`, it must be separately reviewed for:

- per-network state
- safe block cursor movement
- provider failures
- retries
- idempotency
- partial range processing
- reorg/confirmation behavior

## Security boundary

The storage implementation must remain backend-only.

Rules:

- no provider/RPC keys in frontend code
- no private keys in code
- no seed phrases in code
- no frontend signing
- no treasury private keys in frontend or client-readable env
- no automatic sweeping
- no custody/signing work in the detection-storage PR

## Required tests or manual verification for the future storage PR

Before merging any implementation that inserts detected rows, verify:

- a valid BSC USDT transfer to an assigned active address inserts one `detected` row
- re-running the same range does not insert a duplicate
- duplicate conflict is counted as already-seen
- transfer to unknown address is ignored
- malformed log does not crash the whole run
- zero-amount log is skipped
- raw amount is preserved exactly
- BSC 18-decimal conversion is correct for displayed/stored `amount_usdt`
- no wallet balance changes occur
- no wallet transaction rows are inserted
- `crypto_auto_credit_enabled` remains unchanged
- normal users still cannot see assigned crypto addresses while auto-credit is disabled

## Recommended next sequence after this design

1. Implement admin-only BSC detected-row storage, status `detected`, no crediting, no watcher-state update.
2. Add admin-only detected-deposit audit view.
3. Add confirmation policy and `detected` to `confirmed` transition.
4. Add manual review/approval crediting design.
5. Implement crediting only after separate review.
6. Consider user-facing address exposure only after detection, confirmation, audit, and crediting are reviewed.
7. Design sweeping/signing separately.

## Current conclusion

The next code step may store BSC detections as pending/detected audit rows only. It must not credit wallets, update balances, expose addresses to users, sweep, sign, generate addresses, or enable crypto deposits.

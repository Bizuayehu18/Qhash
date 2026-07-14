# Crypto Audit Display Hardening Checklist

Status: docs-only checkpoint after the admin crypto deposit audit view and confirmation/crediting guardrails.

This document defines the small audit-display hardening items that should be completed before confirmation writes, crediting, or audit-dependent reconciliation rely on the admin audit screen. It does not add code, database migrations, RPCs, UI actions, confirmation writes, wallet crediting, balance changes, transaction inserts, sweeping, signing, key handling, user-facing address exposure, or `crypto_auto_credit_enabled` changes.

## Current audit state

The admin audit view is read-only and admin-gated. It lets admins inspect stored `crypto_deposits` rows after BSC detection storage runs.

Current safety posture:

- detected BSC USDT rows can be stored as `status = 'detected'`
- rows are inserted idempotently by `(network, tx_hash, event_index)`
- duplicate detection reruns do not overwrite existing deposit rows
- admins can inspect rows in a read-only audit panel
- user-facing crypto addresses and deposit history remain hidden while `crypto_auto_credit_enabled` is false
- no confirmation, crediting, sweeping, signing, or balance movement exists in the crypto path

## Hardening goals

Before the audit panel is used as part of confirmation writes, crediting, or audit-dependent reconciliation, it should make display limitations explicit and preserve exact crypto amount semantics.

The goals are:

1. make result caps visible to admins
2. avoid implying that a capped result set is complete
3. treat raw token amounts as exact string data
4. keep reconciliation wording tied to canonical chain verification, not just stored UI values
5. avoid introducing any money-moving behavior

## Result-cap visibility

The audit server currently returns a limited set of rows. A future UI hardening PR should make this visible when the panel is at the display cap.

Recommended behavior:

- show `100+ shown` or equivalent when the audit panel reaches the display cap
- show a warning such as: `Showing the first 100 matching rows. Narrow filters before using this view for reconciliation.`
- keep network, status, and search filters available
- avoid claiming that all matching rows are displayed unless a count query or exact total is implemented

If exact total counts are added later, they must be admin-only and read-only.

## Exact amount display

BSC USDT uses 18 token decimals. Detected storage preserves `amount_raw` as an exact string and parses chain data with `bigint`.

The audit display should preserve that rule:

- `amount_raw` should be treated as exact integer text
- the audit helper should not coerce `amount_raw` through JavaScript `number`
- `amount_usdt`, `exchange_rate_etb`, and `credited_amount_etb` should be displayed as database numeric text or exact decimal text when used for reconciliation
- if a driver returns large numeric values as numbers, the helper should either reject those rows for exact audit display or fetch them through a SQL view/RPC that casts numeric values to text

Recommended future hardening options:

1. add a read-only SQL view or RPC that casts audit amount columns to text
2. update the admin audit helper to consume those text fields
3. make malformed or non-exact numeric rows visible in admin counters rather than silently trusting them

## Reconciliation wording

The audit panel should not imply that stored values alone prove a deposit is safe to credit.

Before confirmation writes or crediting, admins and future code must still rely on canonical-chain revalidation:

- transaction receipt exists
- log is canonical and not removed/reorged
- contract is the BSC USDT contract
- Transfer topic matches
- event/log index matches
- sender matches stored `from_address` when present
- recipient matches stored `to_address`
- raw amount matches stored `amount_raw` exactly

Audit display values are useful for review, but canonical receipt/log verification remains the source of truth before confirmation writes and crediting.

## Scope clarification

This checklist should not block a read-only confirmation dry-run helper that independently revalidates canonical receipts/logs and does not rely on the audit panel as its source of truth.

It should block later confirmation writes, wallet crediting, or admin reconciliation flows that depend on audit display completeness or exact displayed amount values.

## Out of scope

This checklist does not implement:

- server helper changes
- UI changes
- database migrations
- SQL views or RPCs
- confirmation writes
- wallet crediting
- balance updates
- wallet transaction inserts
- status transitions
- sweeping or signing
- private keys, seed phrases, or mnemonics
- user-facing address exposure
- `crypto_auto_credit_enabled` changes
- CBE/TeleBirr changes
- `plan_purchase` changes

## Suggested next implementation sequence

1. A read-only admin BSC confirmation dry-run helper may proceed first if it performs its own canonical receipt/log revalidation and does not rely on audit display completeness.
2. Add UI-only display-cap warning for the admin audit panel before confirmation writes or crediting rely on the audit view.
3. Add exact numeric text source for audit rows, preferably through a read-only SQL view or RPC.
4. Update the audit helper to reject or count non-exact amount values rather than coercing them through JavaScript `number`.
5. Add admin audit counters for malformed or skipped audit rows.
6. Proceed to an admin-only BSC confirmation write helper only after canonical receipt/log revalidation is implemented and reviewed.
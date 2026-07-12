# Crypto Deposit Idempotency Schema Check

This checkpoint verifies the database duplicate-protection requirement from `CRYPTO_DEPOSIT_WATCHER_DESIGN.md` before any watcher implementation work begins.

This document is intentionally docs-only. It adds no migration, no watcher code, no blockchain RPC calls, no packages, no database writes, no wallet crediting, no user-facing address exposure, no sweeping, no signing, no address generation, and no private-key handling.

## Source inspected

Current source of truth inspected on `main`:

- `netlify/database/migrations/20260710120000_crypto_deposit_foundation/migration.sql`

The crypto foundation migration creates `public.crypto_deposits` with the expected blockchain event identity fields:

- `network text not null`
- `tx_hash text not null`
- `event_index integer not null default 0`

The same migration already defines the required database-level unique constraint:

```sql
constraint crypto_deposits_network_tx_event_key
  unique (network, tx_hash, event_index)
```

## Conclusion

No new migration is needed for the watcher idempotency key.

The existing schema already enforces the proposed event identity:

```text
network + tx_hash + event_index
```

Future watcher ingestion must rely on this database-level uniqueness to prevent duplicate crypto deposit rows when:

- the watcher re-runs the same block range
- the watcher restarts after a crash
- multiple watcher attempts process the same event
- provider results are replayed
- a transaction contains multiple token transfer events

## Required future watcher behavior

A future watcher implementation must preserve these rules:

- treat `(network, tx_hash, event_index)` as the immutable event identity
- never rely only on application memory for duplicate prevention
- use database conflict handling when inserting detected deposits
- treat duplicate conflicts as already-seen events, not as creditable new deposits
- never insert wallet transactions or update balances in a detection-only PR
- never advance watcher state before the scanned block range is safely handled
- never parse `amount_raw` or token base units with JavaScript `Number`

## Current safety boundary

As of this checkpoint:

- idempotency constraint exists
- no watcher has been implemented
- no blockchain provider has been added
- no deposit ingestion code has been added
- no wallet crediting has been added
- no user-facing crypto address exposure has been added
- no sweeping/signing/private-key handling exists

## Next recommended implementation step

The next implementation PR can begin with admin-only dry-run detection scaffolding, still with no wallet crediting and no user-facing address exposure.

That PR must remain narrow and should explicitly state whether it only previews detected events or writes pending `crypto_deposits` rows.

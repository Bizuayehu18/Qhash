# Crypto Deposit Watcher Detection Design

This document proposes the next crypto-deposit phase for QHash after the merged manual public-address assignment checkpoint.

This is a design document only. It intentionally adds no watcher code, no blockchain RPC calls, no packages, no database writes, no wallet crediting, no user-facing address exposure, no sweeping, no signing, and no private-key handling.

## Current prerequisite state

The current merged crypto state is:

- crypto deposit database foundation exists
- fixed USDT/ETB app settings exist
- admin numeric crypto settings exist
- admin read-only crypto address inventory exists
- admin-only manual public-address assignment exists
- user-facing address exposure remains gated by `crypto_auto_credit_enabled`
- no watcher, automatic detection, wallet crediting, sweeping, signing, address generation, or private-key handling exists

The watcher phase must preserve the existing CBE/TeleBirr deposit flow and must not change `plan_purchase` or introduce `investment` terminology.

## Supported scope

Supported asset:

- USDT only

Supported networks:

- TRON / TRC20
- BNB Smart Chain / BEP20

Supported detection model:

- detect USDT token `Transfer` events
- match event recipient address to assigned `crypto_deposit_addresses.address`
- store detected deposits in `crypto_deposits`
- do not credit user wallets in the first watcher implementation
- do not expose deposit addresses to users until detection and crediting are reviewed separately

## Explicit non-goals for the next implementation PR

The next implementation after this design must not do any of the following unless a later PR is explicitly scoped and reviewed for it:

- enable `crypto_auto_credit_enabled`
- expose crypto addresses to normal users
- credit wallets or user balances
- insert wallet transactions for crypto crediting
- sweep funds
- sign transactions
- generate deposit addresses
- store private keys, seed phrases, mnemonics, or signing material
- add frontend private-key handling
- change CBE/TeleBirr deposit behavior
- change `plan_purchase`
- rename deposit concepts to `investment`

## Watcher architecture

The watcher should be a backend-only process.

Possible deployment choices should be reviewed before implementation:

1. scheduled server function / cron-like backend job
2. server-only worker outside the frontend runtime
3. external watcher service that writes through a restricted backend API or service role

The first implementation should prefer a conservative dry-run mode:

- read configured assigned addresses
- scan relevant token transfer events
- normalize and match recipient addresses
- write or preview detected deposits depending on PR scope
- do not credit wallets
- do not mark deposits as credited
- expose results to admins only for audit

## Network contracts

The production USDT token contract addresses must be documented and verified before implementation.

The implementation PR should define constants for each supported network only after verification:

- TRON USDT TRC20 contract address
- BSC USDT BEP20 contract address

The watcher must ignore:

- native TRX transfers
- native BNB transfers
- non-USDT token transfers
- unsupported networks
- transfers to addresses not assigned in `crypto_deposit_addresses`

## Address matching rules

The watcher must only match active assigned addresses.

Required address states:

- `status = 'active'`
- `asset = 'USDT'`
- network must be `TRON` or `BSC`
- TRON `activation_status = 'active'`
- BSC `activation_status = 'not_required'`

Matching rules:

- TRON addresses must match normalized base58 public addresses exactly after validation/normalization.
- BSC addresses must be normalized to lowercase before comparison.
- Any address not found in `crypto_deposit_addresses` must be ignored.
- Any duplicate-match condition must fail closed and be surfaced to admins.

The database uniqueness rules are a key safety control:

- one address cannot be assigned to multiple users for the same network/asset
- one user cannot have multiple active deposit addresses for the same network/asset

## Event identity and idempotency

The watcher must treat blockchain events as immutable inputs and must be idempotent.

A crypto deposit event identity should be:

```text
network + tx_hash + event_index
```

`event_index` should be the deterministic event/log index inside the transaction receipt or event list.

The ingestion implementation must protect against duplicate processing with a database-level unique constraint or an already-existing unique key if present.

Required behavior:

- re-running the watcher over the same block range must not create duplicate deposits
- reprocessing after a crash must not create duplicate deposits
- multiple watcher instances must not create duplicate deposits
- duplicate events should be treated as already-seen, not as fatal failures

If the current schema does not already enforce uniqueness on `(network, tx_hash, event_index)`, add that as a separate reviewed migration before or with the ingestion PR. Do not rely on application code only for idempotency.

## Amount handling

USDT token amounts are emitted in base units.

The watcher must never parse `crypto_deposits.amount_raw` or token base-unit values with JavaScript `Number`.

Rules:

- keep raw token amounts as strings or BigInt-safe values
- store `amount_raw` as the exact base-unit integer string
- derive `amount_usdt` using USDT decimals only with decimal-safe logic
- keep USDT decimals explicit per token/network, expected to be 6 for USDT on TRON and BSC, but still verify before implementation

Required stored values for credited deposits later:

- `amount_usdt`
- `exchange_rate_etb` used at credit time
- `credited_amount_etb`

A dry-run watcher may store detected `amount_usdt` while leaving credit fields null/pending if the schema supports that. If the schema requires credit fields, use a separate design review before writing detected deposits.

## Confirmation policy

Watcher implementation must not treat a transaction as final immediately.

Suggested minimum confirmation policy, to be reviewed before implementation:

- TRON: wait for enough confirmed blocks/finality from the selected TRON provider
- BSC: wait for a conservative number of block confirmations due to reorg risk

The implementation must document exact values before merge.

The watcher should store or track:

- detected block number
- confirmed block number or confirmation count
- status such as `detected`, `confirming`, `confirmed`, `ignored`, `failed`, or equivalent existing schema values

If the existing schema status values are different, the implementation must follow the existing database constraints and document the mapping.

## Block range tracking

`crypto_watcher_state` should be used to track scan progress per network.

The watcher must preserve these principles:

- scan from a known safe starting block
- process bounded block ranges
- update watcher state only after the range is processed safely
- tolerate retries without duplicate deposit writes
- avoid skipping blocks if a provider request fails
- record provider errors for admin diagnosis

Recommended state keys:

- network
- last_scanned_block
- last_confirmed_block
- updated_at
- status or error metadata if supported

The implementation should avoid scanning from genesis or huge unbounded ranges in production.

## Provider and RPC policy

This design does not choose a provider or add any package.

Before implementation, choose providers deliberately:

- TRON provider for TRC20 events
- BSC provider for BEP20 logs

Provider secrets must be backend-only.

Do not expose provider API keys in frontend code. Do not add provider keys to client-readable settings. Do not place signing keys in provider configuration.

If new packages are required, package additions must be in the implementation PR and reviewed separately.

## Deposit statuses and admin audit

The first implementation should prefer admin-only audit over automatic crediting.

Recommended flow:

1. watcher detects transfer
2. watcher stores or surfaces pending detection
3. admin can inspect network, tx hash, event index, address, user, amount, block, and confirmation state
4. a later PR adds manual review or crediting rules
5. only after that should user-facing address exposure be considered

Admin audit view should show enough information to verify deposits without needing private keys:

- network
- tx hash
- event index
- assigned user
- recipient address
- amount USDT
- raw amount
- detected block
- confirmation count/status
- matched address row id
- current deposit status
- error reason if ignored/failed

## Crediting boundary

The watcher/detection PR must not credit wallets.

Crediting requires a separate reviewed PR with:

- strict idempotency
- exchange-rate snapshot at credit time
- wallet transaction insert strategy
- audit trail
- manual review or admin approval path
- rollback/error handling plan
- clear handling for partial failures

Credit formula remains:

```text
credited_amount_etb = amount_usdt * usdt_etb_rate
```

At credit time, store:

- `amount_usdt`
- `exchange_rate_etb`
- `credited_amount_etb`

Do not calculate credited values from a later changed rate.

## User-facing exposure boundary

Do not expose deposit addresses to users until all of these are true:

- watcher detection has been implemented and tested
- duplicate protection has been verified at the database level
- confirmation policy has been reviewed
- admin audit path exists
- crediting path has been reviewed and tested
- `crypto_auto_credit_enabled` is intentionally enabled through a separately reviewed change

Until then, assigned public addresses remain admin inventory only.

## Sweeping and signing boundary

Sweeping is out of scope for watcher detection.

Future sweeping/signing work must be separately designed and reviewed.

Rules that must remain true:

- no private keys in frontend
- no seed phrases in code
- no treasury private keys in environment variables exposed to frontend
- no frontend signing
- no automatic sweep without custody/signing design review

Admin treasury/resource/gas wallets should be represented by public addresses only until a separate signer/custody model is approved.

## Failure cases to handle before implementation

Implementation must define behavior for:

- provider outage
- rate limiting
- partial block-range failure
- chain reorg
- duplicate event replay
- token transfer with malformed fields
- transfer to unassigned address
- transfer to inactive address
- transfer below minimum amount
- assigned address collision, even though DB should prevent it
- profile/user lookup failure after address match
- decimal conversion failure
- database insert conflict
- watcher state update failure

Fail closed. Do not credit funds on ambiguous data.

## Minimum manual test plan for future implementation

A future watcher/detection PR should include tests or manual verification for:

- valid TRON USDT transfer to assigned active address is detected
- valid BSC USDT transfer to assigned active address is detected
- transfer to unknown address is ignored
- transfer to inactive TRON address is ignored
- duplicate event replay does not create duplicate deposit rows
- amount_raw is preserved exactly as string/base-unit integer
- amount_usdt conversion is correct
- watcher restart resumes without skipping or duplicating blocks
- provider failure does not advance watcher state incorrectly
- no wallet balance changes occur in detection-only mode
- normal user deposit page still hides addresses while auto-credit is disabled

## Required PR checklist for watcher implementation

Before merging any implementation PR based on this design, verify:

- PR scope is explicit: design, dry-run detection, ingestion, audit, crediting, or exposure
- CBE/TeleBirr remains unchanged unless explicitly scoped
- `plan_purchase` remains unchanged
- no `investment` terminology is introduced
- no private keys, seed phrases, or signing material are introduced
- no frontend provider keys are introduced
- no wallet crediting occurs in dry-run/detection-only PRs
- idempotency is enforced by the database, not only by application logic
- `amount_raw` is never converted with JavaScript `Number`
- user-facing addresses remain hidden while `crypto_auto_credit_enabled` is false
- any package additions are necessary and reviewed
- any RPC/provider configuration is backend-only

## Recommended next implementation sequence

After this design is reviewed and merged, prefer this sequence:

1. verify schema constraints for deposit idempotency and add a migration only if needed
2. add admin-only dry-run detection scaffolding for one network, no crediting
3. add storage of detected deposits with strict idempotency, no wallet crediting
4. add admin audit view for detected deposits
5. add manual review/approval crediting path
6. only then consider user-facing address exposure behind `crypto_auto_credit_enabled`
7. design sweeping/signing separately

## Current design status

This document is only a design guardrail. It does not make crypto deposits live.

As of this design:

- users still should not see crypto addresses
- `crypto_auto_credit_enabled` should remain false/hidden
- no watcher has been implemented
- no blockchain RPC provider has been added
- no crypto deposit can be automatically detected or credited
- no funds can be swept or signed by QHash

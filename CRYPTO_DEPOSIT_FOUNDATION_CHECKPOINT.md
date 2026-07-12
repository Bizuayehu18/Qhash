# Crypto Deposit Foundation Checkpoint

This checkpoint documents the confirmed-safe state after the merged QHash crypto deposit foundation, admin settings, admin address inventory, and manual public-address assignment work.

Merged crypto sequence covered by this checkpoint:

- PR #214: crypto deposit database foundation and app settings
- PR #215: read-only user-facing crypto deposit overview UI/server helper
- PR #216: initial crypto foundation checkpoint documentation
- PR #217: admin crypto settings server helpers for safe numeric settings only
- PR #218: admin crypto settings UI
- PR #219: admin-only read-only crypto address inventory
- PR #220: admin-only manual public crypto address assignment

Use this file as a guardrail before starting any future crypto watcher, user address exposure, wallet crediting, sweeping, signing, address generation, or private-key-related work.

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

The overview can read crypto settings, assigned public deposit addresses, and read-only crypto deposit history.

It must not write deposits, credit wallets, generate addresses, sweep funds, or sign transactions.

### Admin crypto settings

PR #217 and PR #218 added admin crypto settings helpers and UI for safe numeric settings only.

Admin-editable settings are limited to:

- `usdt_etb_rate`
- `crypto_tron_min_usdt`
- `crypto_bsc_min_usdt`

`crypto_auto_credit_enabled` is intentionally not exposed in the admin UI and is intentionally not editable by these helpers.

### Admin address inventory

PR #219 added admin-only read-only crypto address inventory:

- `src/lib/server/crypto-admin-addresses.ts`
- `src/components/admin/AdminCryptoAddressInventoryPanel.tsx`

The inventory can show public USDT deposit addresses to admins only.

It must not expose addresses to normal users, enable crypto deposits, assign addresses, generate addresses, credit wallets, detect blockchain deposits, sweep funds, sign transactions, or handle private keys or seed phrases.

### Admin manual public-address assignment

PR #220 added admin-only manual public crypto address assignment:

- `src/lib/server/crypto-admin-address-assignment.ts`
- assignment form inside `src/components/admin/AdminCryptoAddressInventoryPanel.tsx`

This is the first crypto write path in the QHash sequence.

It is intentionally narrow:

- admins manually enter public TRON/BSC USDT deposit addresses
- the server resolves the target profile by exact match
- the server inserts one public address row into `crypto_deposit_addresses`
- the server does not expose the address to normal users
- the server does not enable auto-credit
- the server does not create watcher rows
- the server does not credit wallets
- the server does not sweep funds
- the server does not sign transactions
- the server does not handle private keys or seed phrases

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

The current user-facing server helper returns no crypto deposit addresses unless:

- `crypto_auto_credit_enabled` parses to `true`
- address `status` is `active`
- address network is supported
- TRON address `activation_status` is `active`
- BSC address `activation_status` is `not_required`

The current user UI also treats crypto as paused while `autoCreditEnabled` is false and refuses to copy or display a live address.

This is important because assigned addresses must not be exposed to users before QHash has a working detection, audit, and crediting path.

### Address assignment is not address exposure

After PR #220, admins can assign public deposit addresses, but users still should not see those addresses while `crypto_auto_credit_enabled` remains false.

This separation is intentional:

- assignment lets admins prepare and audit address inventory
- exposure to users must wait until watcher/detection/crediting safety is reviewed
- auto-credit must remain disabled until a separate reviewed PR explicitly changes that

### Manual assignment write boundary

The PR #220 write path is limited to one insert into `crypto_deposit_addresses`.

The assignment helper must preserve these properties:

- derive admin identity from the Supabase access token server-side
- reject non-admin or frozen admin access
- resolve target users through a server-side profile lookup
- force `asset = 'USDT'`
- force `status = 'active'`
- force BSC `activation_status = 'not_required'`
- allow TRON `activation_status` only as `inactive` or `active`
- never accept a target `user_id` directly without server-side resolution
- never write to balances, transactions, crypto deposits, sweep jobs, or watcher state

### Duplicate and collision protection

The database schema prevents critical address assignment collisions:

- one user cannot receive two addresses for the same `(user_id, network, asset)`
- one public address cannot be assigned to two users for the same `(network, asset)`

This protects against ambiguous deposit attribution and future miscrediting.

### TRON validation

TRON addresses assigned through the admin helper must be validated server-side with Base58Check, not regex alone.

The required properties are:

- base58 decode succeeds
- decoded address length is 25 bytes
- payload length is 21 bytes
- version byte is `0x41`
- checksum is the first 4 bytes of double SHA-256 over the payload

This protects against mistyped TRON addresses that would otherwise match a simple `T...` regex but fail checksum validation.

### BSC address operational control

BSC addresses are currently validated as `0x` plus 40 hexadecimal characters and normalized to lowercase.

Because proper EIP-55 checksum validation requires Keccak-256 and no new dependency was added in PR #220, admins must treat BSC assignment as an operationally controlled action:

- copy-paste BSC addresses from the source of truth
- do not manually type BSC addresses
- use second-admin verification before assigning production addresses
- perform a small test deposit and confirm detection before any future user exposure or auto-credit

This does not block the current manual-assignment checkpoint because user exposure and auto-credit remain disabled.

### Read-only and write boundaries after PR #220

Allowed in current state:

- read app settings
- admin update safe numeric crypto settings
- admin read assigned public addresses
- admin manually assign public TRON/BSC USDT addresses
- read deposit history rows
- show paused/not-ready user UI
- show historical deposits after future watcher support exists

Not allowed in current state:

- user-facing address exposure while `crypto_auto_credit_enabled` is false
- blockchain watcher
- automatic deposit detection
- auto-credit
- wallet crediting
- user balance updates
- transaction inserts for crypto crediting
- address generation
- private key or seed phrase handling
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

## Required sequence before going live

Do not treat assigned addresses as live user deposit instructions yet.

Before user-facing crypto deposits can go live, QHash still needs separate reviewed work for:

1. watcher/detection design
2. dry-run detection or admin-only detection audit, with no wallet crediting
3. strict deposit idempotency using `(network, tx_hash, event_index)`
4. confirmation thresholds per network
5. exchange-rate snapshot at credit time
6. manual review/audit path
7. safe wallet-crediting implementation
8. user-facing address exposure only after detection and crediting are ready
9. sweeping/signing architecture only after separate private-key/custody review

## Recommended next PR sequence

Prefer small PRs in this order:

1. Update this checkpoint after manual assignment. This PR is documentation only.
2. Watcher design document, no code that detects or credits deposits.
3. Admin-only dry-run deposit detection/audit view, no wallet crediting.
4. Deposit ingestion storage with strict idempotency, no wallet crediting.
5. Manual-review crediting path with audit trail.
6. User-facing address exposure only after watcher and crediting are reviewed.
7. Sweeping/signing architecture only after a separate security review.

## Review checklist for future crypto PRs

Before merging any future crypto PR, verify:

- CBE/TeleBirr deposit flow is unchanged unless explicitly scoped.
- `plan_purchase` remains untouched; no `investment` enum/type is introduced.
- No private key, seed phrase, or signing material is introduced into frontend code.
- No watcher credits wallets until idempotency and audit behavior is reviewed.
- No deposit address is shown while `crypto_auto_credit_enabled` is false.
- TRON/BSC network and activation-state rules are enforced server-side.
- TRON manual assignments validate Base58Check server-side.
- BSC manual assignments follow copy-paste and second-admin verification controls.
- `amount_raw` is never coerced to JavaScript `Number`.
- Any wallet-crediting PR has a clear duplicate-protection strategy.
- Any admin PR derives admin identity from the access token server-side.
- Any new write path is narrowly scoped, audited, and reviewed more strictly than read-only UI.

## Current checkpoint status

As of this checkpoint:

- crypto deposit schema exists
- fixed USDT/ETB app settings exist
- crypto deposit overview UI exists
- admin numeric crypto settings exist
- admin crypto address inventory exists
- admin manual public-address assignment exists
- crypto deposits are still not live for users unless explicitly enabled later
- user-facing address exposure is still gated by `crypto_auto_credit_enabled`
- no watcher, automatic detection, wallet crediting, sweeping, signing, address generation, or private-key handling exists

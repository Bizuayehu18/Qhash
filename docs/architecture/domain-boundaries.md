# QHash domain boundaries

**Status:** Current boundary map with target recommendations
**Scope:** Repository revision `ebca234bd7bb40fbddcfce29e13bd6612f2f9aae` plus the first Phase 2 crypto-deposit compatibility scaffold
**Purpose:** Define ownership before files are moved. Current facts and target recommendations are intentionally separated.

See also:

- [Current-state architecture](./current-state.md)
- [Data, security, and deployment](./data-security-and-deployment.md)
- [Approved target architecture](./target-state.md)

## Current domain map

| Domain | Current UI/application surface | Current authoritative data or external system | Boundary notes |
|---|---|---|---|
| Identity and access | auth routes, `authStore`, `src/lib/server/auth.ts` | Supabase Auth and `profiles` | username and Ethiopian phone are currently coupled to Auth and referrals |
| Profile and security | profile/security routes, `src/lib/server/security.ts` | `profiles`, `user_security_settings`, Supabase Auth | Fund PIN is a protected server/database workflow |
| Fiat deposits | `/deposit`, `src/lib/server/deposits.ts`, CBE/TeleBirr verifiers | Supabase `deposits`, `payment_methods`, ETB wallet/transactions | verification and approval code is distributed across large modules and Functions |
| Crypto deposits | `/deposit`, `/deposit/crypto/usdt/bep20`, `src/domains/crypto-deposits/public.ts`, `NowpaymentsUsdtDeposit`, NOWPayments deposit Functions | NOWPayments plus `nowpayments_usdt_*` deposit tables | the Phase 2 client facade delegates to the legacy implementation; provider communication and financial settlement remain distinct responsibilities |
| Fiat withdrawals | `/withdraw`, `src/lib/server/withdrawals.ts` | Supabase `withdrawals`, ETB wallet/transactions | shares Fund PIN and cross-rail policy with USDT |
| USDT withdrawals | `/withdraw`, NOWPayments withdrawal user/admin components and Functions | `nowpayments_usdt_withdrawals`, events, wallet, ledger | manual Complete/Reject workflow; no automatic payout/signing |
| Plans and investments | `/plans`, investment server functions | `plans`, `investments`, ETB wallet/transactions | values are currently part of the legacy ETB model |
| Earnings and referrals | dashboard/referrals/admin-earnings, scheduled Functions | referrals, reward logs, earning logs, investments, ETB wallet/transactions | current visible identity and referral lookup use username |
| Administration | `/admin`, `/admin-earnings` | profile role plus domain data | UI is concentrated; authorization must remain inside each server action |
| Notifications | notification route and server module | Supabase `notifications` | financial notifications are secondary to authoritative ledger/state transitions |
| Support and settings | public support route and admin settings | Supabase `app_settings` | current visible support is Telegram |
| Legacy support tickets | no active visible product flow | separate Netlify Database through Drizzle | quarantined until authentication and database ownership are redesigned |
| Deployment and schema | build scripts and migrations | Git, Netlify, Supabase migration ledger | operational boundary, not a product domain |

## Current coupling that must not become the target structure

- Route components fetch, transform, coordinate, and render multiple subdomains.
- The admin route contains unrelated domain panels in one file.
- `src/lib/server` is a flat collection; neighboring files do not imply a shared authorization or transaction boundary.
- Fiat and crypto presentation share broad routes but use different accounting stores.
- provider name, asset, and network are embedded in NOWPayments filenames and database object names.
- public identity and referrals depend on username.
- navigation labels and destinations are hard-coded in the layout.

## Target repository boundary

The recommended target is domain-first. This is a direction for staged
reorganization, not a statement that proposed folders already exist. The
single illustrative physical tree lives in
[Repository standards](../engineering/repository-standards.md); ADR 0001
remains Proposed.

The dependency direction must be:

```text
route/composition
  -> domain UI and application use cases
      -> domain contracts
          <- server/database/provider adapters

shared code must not import a business domain
```

## Target ownership rules

### Identity and country

- Supabase Auth remains the credential/session authority.
- QHash owns an immutable public account code and a separate random referral code.
- Real email and E.164 phone are private identity attributes, never public identifiers.
- registered country is derived from the phone at registration and cannot be self-edited.
- all approved countries may register even if their fiat rails are unavailable.
- email changes, phone/country support changes, and withdrawal holds belong to the identity/security domain, not page components.

### Wallet and accounting

- The future canonical customer balance is provider-neutral USDT.
- Fiat and crypto rails produce evidence and request accounting operations; they do not own balances.
- provider-specific outcome values, fiat source amounts, rates, and fees remain immutable evidence alongside the canonical USDT ledger.
- plans, earnings, referrals, deposits, and withdrawals must use one documented amount/rounding contract after cutover.
- country and payment-provider availability are configuration data, not route conditionals scattered through UI files.

### Deposit rails

The deposit domain owns shared availability, history, and navigation. Each rail adapter owns only its rail-specific collection and verification:

```text
deposit policy
  +-- fiat country registry
  |     +-- ET / CBE adapter
  |     +-- ET / TeleBirr adapter
  |     +-- future country/provider adapters
  +-- crypto registry
        +-- USDT / BEP20 / NOWPayments adapter
```

Global pause must block new deposits across all rails. Rail disablement is additional and independent. Already admitted settlement and recovery remain available through protected operations.

### Withdrawal rails

The withdrawal domain owns the shared Fund PIN, accepted-request cooldown, active-request rule, balances, history, and administrator state transition contract. Rail adapters own destination validation and payout instructions.

The shared policy is:

- one accepted withdrawal in a rolling 24-hour window across all rails;
- the window begins at successful submission;
- invalid attempts do not consume it;
- a still-pending request blocks another request even after the window;
- administrators can complete or reject admitted requests while new requests are paused.

No individual rail may reimplement or weaken this policy.

### Administration

The current single administrator capability remains, but UI and authorization contracts should be grouped by domain:

```text
Admin
  +-- Users
  +-- Deposits
  |     +-- Fiat
  |     +-- Crypto
  +-- Withdrawals
  |     +-- Fiat
  |     +-- Crypto
  +-- Plans
  +-- Earnings
  +-- Referrals
  +-- Support
  +-- Settings
  +-- Audit
```

Future Super Admin, Finance, and Support roles should be added through explicit permissions. Hiding a tab is never authorization; each server action must enforce its own capability.

## Target route ownership

Routes should become thin composition points. Approved route direction includes:

- `/deposit/fiat/:country/:provider`
- `/deposit/crypto/usdt/bep20`
- `/withdraw/fiat/:country/:provider`
- `/withdraw/crypto/usdt/bep20`
- grouped `/admin/...` routes aligned with domain ownership.

Legacy `/deposit`, `/withdraw`, `/admin`, and bookmarked subflows need deliberate compatibility redirects or index routes. Country-unsupported fiat routes must fail closed even when entered directly; hiding navigation alone is insufficient.

The first implemented route scaffold is `/deposit/crypto/usdt/bep20`.
`/deposit` remains the stable hub, and its Crypto Deposit option navigates to
the canonical route. Fiat country/provider routes remain deferred until an
authoritative registered-country rail policy exists at the server boundary.

## Import and mutation rules

1. Domain UI may import domain contracts and shared UI; it must not import service-role clients.
2. Routes compose domains and navigation; they must not implement ledger math or provider verification.
3. Provider adapters may translate provider payloads but must not directly decide customer credit.
4. Financial mutations go through one protected transactional operation for each use case.
5. Cross-domain reads use documented query contracts; cross-domain writes use the owning domain's command/RPC.
6. `shared` is for stable, domain-neutral code only. It must not become a new miscellaneous folder.
7. Applied migrations remain in place even when runtime code moves.
8. Dormant Netlify Database support-ticket code remains quarantined until it has authenticated ownership checks and an explicit database strategy.

## Reorganization sequence

**Target recommendation:**

1. Establish documentation, naming, route-generation, and import-boundary checks.
2. Extract pure UI and contracts without behavior or URL changes.
3. Introduce structured routes with compatibility redirects.
4. Split admin composition by domain.
5. Isolate provider and database adapters behind domain commands.
6. Implement the identity/country foundation.
7. Build provider-neutral canonical USDT accounting and perform the separately reviewed test-data cutover.

Each stage must be independently deployable and must preserve the financial invariants in [Data, security, and deployment](./data-security-and-deployment.md).

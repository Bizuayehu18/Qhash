# QHash domain boundaries

**Status:** Current boundary map with target recommendations
**Scope:** Repository base `3b89c0a74bcdf44d4cbd210e00c8c49784d4499c` plus this behavior-preserving public Support redirect extraction
**Purpose:** Define ownership before files are moved. Current facts and target recommendations are intentionally separated.

The exact current assignment of repository, Netlify, Supabase, test, and
documentation assets is maintained in
[Cross-system domain ownership](./system-ownership.md) and enforced from
[domain-ownership.json](./domain-ownership.json). This document explains
boundary meaning; the registry supplies exhaustive accountable ownership.

See also:

- [Current-state architecture](./current-state.md)
- [Data, security, and deployment](./data-security-and-deployment.md)
- [Approved target architecture](./target-state.md)

## Current domain map

| Domain | Current UI/application surface | Current authoritative data or external system | Boundary notes |
|---|---|---|---|
| Identity and access | auth routes, `authStore`, `src/lib/server/auth.ts` | Supabase Auth and `profiles` | username and Ethiopian phone are currently coupled to Auth and referrals |
| Profile and security | profile/security routes, `src/lib/server/security.ts` | `profiles`, `user_security_settings`, Supabase Auth | Fund PIN is a protected server/database workflow |
| Accounts | `/dashboard`, `/transactions`, `src/domains/accounts/public.ts`, accounts UI/application/domain modules, wallet store and server readers | ETB wallet/transactions plus the separately owned USDT ledger | dashboard snapshots are user/token scoped; transaction snapshots and retries are user/token/filter scoped; wallet cache, in-flight work, polling, and writes are scoped to the active user ID; accounting writes remain server-owned |
| Shared deposits | `/deposit`, `src/domains/deposits/public.ts`, `src/domains/deposits/ui/DepositHub.tsx`, `src/domains/deposits/server.ts` | `app_settings.deposits_paused` plus rail-owned history sources | the provider-neutral admission boundary and cross-rail browser composition are implemented; shared composition imports rail public surfaces rather than rail internals |
| Fiat deposits | `src/domains/fiat-deposits/public.ts`, `src/domains/fiat-deposits/ui`, `src/lib/server/deposits.ts`, CBE/TeleBirr verifiers | Supabase `deposits`, `payment_methods`, ETB wallet/transactions | the Ethiopia CBE/TeleBirr browser flow is domain-owned and provider-specific presentation is split under `ui/providers/et`; verification and approval code remains distributed across large server modules and Functions |
| Crypto deposits | `/deposit/crypto/usdt/bep20`, `src/domains/crypto-deposits/public.ts`, `src/domains/crypto-deposits/ui`, NOWPayments deposit Functions | NOWPayments plus `nowpayments_usdt_*` deposit tables | the USDT-BEP20 browser component is decomposed into domain-owned state, orchestration, address-presentation, and view modules; old source paths are compatibility bridges, while provider communication and financial settlement remain distinct responsibilities |
| Fiat withdrawals | `/withdraw`, `src/domains/fiat-withdrawals/public.ts`, `src/domains/fiat-withdrawals/ui`, `src/lib/server/withdrawals.ts` | Supabase `withdrawals`, ETB wallet/transactions | Ethiopia CBE/TeleBirr browser presentation and orchestration are domain-owned; the financial boundary, Fund PIN, and cross-rail policy remain shared with USDT |
| USDT withdrawals | `/withdraw`, `/withdraw/crypto/usdt/bep20`, `src/domains/withdrawals/public.ts`, `src/domains/withdrawals/ui`, NOWPayments withdrawal admin component and Functions | `nowpayments_usdt_withdrawals`, events, wallet, ledger | the ordinary-user USDT-BEP20 component is decomposed into domain-owned request orchestration, view, form, and history modules; the old component path is a compatibility bridge, while the legacy browser transport and manual administrator Complete/Reject flow remain unchanged with no automatic payout/signing |
| Plans and investments | `/plans`, `src/domains/plans/public.ts`, plans UI/application modules, existing plan and investment server functions | `plans`, `investments`, ETB wallet/transactions | browser presentation and authentication-scoped orchestration are domain-owned; values and financial execution remain part of the legacy ETB model |
| Earnings | dashboard/admin-earnings and scheduled Functions | earning logs, investments, ETB wallet/transactions | processing and administrator presentation remain in legacy modules |
| Referrals | `/referrals`, `src/domains/referrals/public.ts`, referral UI/application/domain modules, existing referral server functions | referrals, reward logs, investments, profiles, ETB transactions | browser reads are authentication-generation scoped; current visible identity and referral lookup still use username |
| Administration | `/admin`, `/admin-earnings` | profile role plus domain data | UI is concentrated; authorization must remain inside each server action |
| Notifications | notification route and server module | Supabase `notifications` | financial notifications are secondary to authoritative ledger/state transitions |
| Support and settings | `/support`, `src/domains/support/public.ts`, Support UI/application modules, and admin settings | Supabase `app_settings` | the public redirect and dashboard navigation consume one client-safe facade and application bridge; current visible support is Telegram |
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

### Accounts

The `/dashboard` route composes only the client-safe accounts public surface.
Accounts owns account-summary, plan-progress, recent-transaction, completed-plan,
and legacy ETB presentation modules. Its existing application bridge remains
the only dashboard dependency on the dashboard and plans server functions.
The dashboard imports support only through the client-safe support public
surface; Support owns the browser bridge to its existing read-only setting.
No financial query, mutation, amount, route URL, or server behavior changes in
this mechanical extraction.

The `/transactions` route composes only the client-safe accounts public surface.
One accounts application bridge owns the browser dependency on the existing
read-only `getTransactionsFn`; filter policy, list presentation, status and
amount formatting, and authenticated remote-state coordination remain inside
`src/domains/accounts`. Snapshot visibility, retries, timers, and request
finalizers require the exact user, access-token generation, and selected
filter. A replacement identity or filter can start its own request while older
work is unresolved, and late work cannot update the replacement view.

The existing server query, 50-row limit, legacy ETB values, shared transaction
presentation helpers, wallet and ledger ownership, and all accounting writes
remain unchanged. International USDT conversion is not part of this mechanical
extraction.

### Support

The `/support` route composes only the client-safe Support public surface. The
Support domain owns its redirect presentation, and one application bridge owns
the extracted Dashboard and public `/support` dependencies on the existing
read-only support-settings server function. The public route retains its
one-shot Telegram `window.location.replace`, unavailable message, error
handling, and unmount
guard. Dashboard Support keeps its separate preload, timeout, passive refresh,
click-navigation, and `/support` fallback contract through the same facade.

Administrator Support settings and the Profile route's existing navigation
remain legacy direct consumers. Those routes, dormant Netlify Database support
tickets, and the stored setting remain at their current boundaries. This
extraction changes no setting value, server function, database,
authentication, route URL, or visible behavior.

### Plans and investments

The `/plans` route composes only the client-safe plans public surface. The
domain application bridge is the sole browser dependency on the existing
`getPlansWithEligibilityFn` and `purchasePlanFn` server functions; cards,
details, eligibility policy, formatting, and authenticated remote-state
coordination remain inside `src/domains/plans`. Catalog and purchase effects are
scoped to the exact user and access-token generation so late work cannot affect
a replacement session. The unresolved purchase-command lock is user-scoped and
survives access-token refreshes until the underlying command settles, preventing
a refreshed session from starting a concurrent duplicate.

The current server boundary remains deliberately unchanged. Eligibility reads
referral and investment state, the purchase function uses the existing atomic
`purchase_plan_tx` RPC, and referral reward processing remains a best-effort
post-purchase dependency owned by the referral domain. Current plan and wallet
amounts are legacy ETB `number` values. This extraction does not convert their
currency or rounding model, and it does not claim purchase-command idempotency;
that financial guarantee remains deferred to a separately reviewed server and
database design before the international-USDT cutover.

### Referrals

The `/referrals` route composes only the client-safe referrals public surface.
One application bridge owns the browser dependency on the existing read-only
`loadReferralStatsFn`; team policy, level filtering, link presentation, reward
copy, and authenticated remote-state coordination remain inside
`src/domains/referrals`. Snapshot visibility and retry ownership require the
exact user and access-token generation. A replacement session can start its own
request while an older request is unresolved, and the older success, failure,
retry timer, or finalizer cannot update the replacement session.

The existing server and financial boundaries remain unchanged. Referral graph
queries, active-plan detection, the 21:00 UTC reward-day window, username-based
links, reward posting, reward percentages, and legacy ETB presentation retain
their current behavior. Public account codes, random referral codes, USDT
rewards, and international identity migration remain later phases.

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

The implemented TypeScript boundary is
`src/domains/deposits/server.ts`. It reads and strictly decodes the singleton
global pause setting once through a provider-neutral contract. Fiat submission
and crypto address provisioning consume that boundary and translate its
decision into their existing rail-specific responses; neither adapter owns or
reimplements the setting semantics. Rail-specific database functions and
triggers remain authoritative defense-in-depth at their own write boundary.

The implemented browser composition boundary is
`src/domains/deposits/public.ts` and
`src/domains/deposits/ui/DepositHub.tsx`. The hub owns page layout, rail
selection, and navigation to the canonical crypto route. It consumes the
client-safe `src/domains/fiat-deposits/public.ts` surface rather than importing
fiat provider internals. The fiat domain owns its request controller,
validation, provider ordering, form, history, and ET/CBE and ET/TeleBirr
presentation. It does not own crypto navigation. Country/provider fiat URLs
remain target routes until server-owned registered-country authorization is
available.

Global pause must block new deposits across all rails. Rail disablement is additional and independent. Already admitted settlement and recovery remain available through protected operations.

### Withdrawal rails

The withdrawal domain owns the shared Fund PIN, accepted-request cooldown, active-request rule, balances, history, and administrator state transition contract. Rail adapters own destination validation and payout instructions.

The implemented browser composition boundary is
`src/domains/withdrawals/public.ts` and
`src/domains/withdrawals/ui/WithdrawalHub.tsx`. The hub owns page layout,
rail selection, and navigation to the canonical USDT-BEP20 route. It consumes
the client-safe `src/domains/fiat-withdrawals/public.ts` surface rather than
fiat provider internals. The fiat-withdrawal domain owns Ethiopia provider
ordering, fields, presentation, browser validation, confirmation, remote-state
coordination, and history rendering. Its application service is the sole
browser-to-existing-server bridge. It does not own the shared financial or
cross-rail policy, and no country/provider fiat URL becomes live through this
extraction.

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

The first implemented route scaffolds are `/deposit/crypto/usdt/bep20` and
`/withdraw/crypto/usdt/bep20`. `/deposit` and `/withdraw` remain stable hubs,
and their USDT options navigate to the matching canonical route. Fiat
country/provider routes remain deferred until an authoritative
registered-country rail policy exists at the server boundary.

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

# QHash current-state architecture

**Status:** Observed baseline
**Scope:** Runtime baseline through repository base `0090dd41443568f9fbf9b846f9f4be3bbf963c63`, plus this behavior-preserving transaction-history UI extraction and authentication-generation isolation
**Purpose:** Record what exists before the repository reorganization and international USDT conversion. This document is descriptive unless a section is explicitly labelled **Target recommendation**.

See also:

- [Domain boundaries](./domain-boundaries.md)
- [Cross-system domain ownership](./system-ownership.md)
- [Data, security, and deployment](./data-security-and-deployment.md)
- [Approved target architecture](./target-state.md)

## System summary

QHash is a TanStack Start and React application deployed on Netlify. It currently uses:

- TanStack Router file routes under `src/routes`;
- TanStack server functions under `src/lib/server`;
- dedicated Netlify Functions under `netlify/functions`;
- Supabase Auth and Supabase Postgres for identity and the active product and financial data;
- a separate Netlify Database/Drizzle integration whose only application source consumer found in this revision is the legacy support-ticket module;
- Zustand for browser authentication and UI state.

The production financial architecture is not one unified wallet. It has a legacy ETB model and a separate NOWPayments USDT-BEP20 model. The international conversion must therefore be a controlled financial migration, not a display-label replacement.

## Runtime topology

```text
Browser
  |
  +-- TanStack routes and React components
  |     |
  |     +-- Supabase browser client (anon key, Auth session, RLS reads)
  |     |
  |     +-- TanStack server functions
  |             |
  |             +-- Supabase service-role client
  |             +-- Netlify Database/Drizzle (legacy support tickets only)
  |
  +-- Netlify Functions
          |
          +-- Supabase Auth validation and profile authorization
          +-- protected Supabase RPCs for critical financial transitions
          +-- NOWPayments API/IPN at the provider boundary

Netlify production build
  |
  +-- Supabase migration runner
  +-- application build
```

The browser's protected layout is a usability guard, not a security boundary. Sensitive server paths independently validate the bearer token and, where applicable, `profiles.is_admin` and `profiles.is_frozen`.

## Repository shape

The repository is organized mainly by technical layer, with several business domains mixed inside large route and server files.

| Area | Current role | Observed concentration |
|---|---|---|
| `src/routes` | TanStack route entry points and substantial page logic | 8 route files remain over the 150-nonblank-line warning; `deposit.tsx`, `withdraw.tsx`, `plans.tsx`, `referrals.tsx`, and `transactions.tsx` are now thin composition entries while `admin.tsx` remains concentrated |
| `src/domains` | Accountable business-domain public surfaces, UI composition, and compatibility boundaries | Account transaction history, deposit, withdrawal, plans, referrals, crypto-rail, and Ethiopia fiat-rail UI slices are now physically domain-owned; the remaining legacy layers are still being extracted incrementally |
| `src/components` | Shared UI plus extracted crypto compatibility bridges | Only the administrator NOWPayments withdrawal component remains over the 300-nonblank-line warning after the user deposit and withdrawal UI decompositions |
| `src/lib/server` | TanStack server functions for many domains in one flat folder | Large deposit, verification, withdrawal, earning, security, and admin modules |
| `netlify/functions` | provider-facing, scheduled, verification, and admin Functions | NOWPayments handlers are partly decomposed through `netlify/functions/lib` |
| `supabase/migrations` | forward-only Supabase schema history | authoritative production schema history; large applied files are immutable |
| `netlify/database/migrations` | Netlify Database migration history | a different database; it is not the Supabase financial migration source |
| `tests` | portable source tests and native PostgreSQL fixtures | several files exceed 1,500 lines; critical financial behavior has strong regression coverage |

The exact report-only file measurements are machine recorded in
`scripts/engineering-baseline.json`; they are orientation measurements, not
permanent limits.

The repository remains physically layer-oriented, but every covered source,
Netlify, Supabase, test, documentation, governance, and quarantined database
artifact now has one accountable domain in
`docs/architecture/domain-ownership.json`. This is a governance map, not a
claim that mixed legacy adapters have already been decomposed.

### Route concentration

Most current user URLs remain broad pages such as `/deposit`, `/withdraw`, and
`/admin`. Phase 2 adds the canonical `/deposit/crypto/usdt/bep20` and
`/withdraw/crypto/usdt/bep20` routes while preserving `/deposit` and
`/withdraw` as their hubs. Fiat country/provider and administrator subflows
are still selected inside their broad pages.

`/deposit` is now a thin route through `src/domains/deposits/public.ts`.
`src/domains/deposits/ui/DepositHub.tsx` owns only cross-rail composition and
crypto navigation. The Ethiopia fiat browser flow is exposed through
`src/domains/fiat-deposits/public.ts`; its CBE and TeleBirr presentation is
split into provider-specific `ui/providers/et` modules while shared fiat
request orchestration, validation, form, method list, and history remain in
the fiat-deposit domain. This extraction preserves the existing in-page fiat
flows, server functions, submission behavior, history, and visual design.
Country/provider fiat routes remain deferred until the registered-country rail
policy is authoritative at the server boundary.

`/withdraw` is likewise a thin route through
`src/domains/withdrawals/public.ts`. The shared
`src/domains/withdrawals/ui/WithdrawalHub.tsx` owns only cross-rail
composition and USDT-BEP20 navigation. Ethiopia CBE and TeleBirr withdrawal
presentation and browser orchestration are exposed through
`src/domains/fiat-withdrawals/public.ts`, with provider-specific definitions
under `ui/providers/et`. The extraction preserves the established in-page
flow, 200 ETB minimum, 5% fee, four-digit Fund PIN, history, server calls,
cross-rail policy, and visual behavior. Fiat withdrawal country/provider URLs
remain deferred until the same server-authoritative country-rail boundary is
available.

The `/dashboard` route is now a thin adapter over the client-safe accounts
facade at `src/domains/accounts/public.ts`. Accounts-owned UI modules compose
the account summary, plan progress, recent transactions, completed plans, and
legacy two-decimal ETB presentation. Complete dashboard snapshots and retries
remain bound to the exact authenticated user and access-token generation.
Shared wallet cache entries, in-flight requests, polling, and direct balance
updates remain bound to the active user ID, and late cross-user results are
rejected. This prevents a previous user from supplying wallet presentation to
a replacement user and prevents a previous authentication generation from
supplying a dashboard snapshot; it changes no server or accounting behavior.

Dashboard support navigation consumes only the client-safe support facade.
One support application bridge owns the new dashboard dependency on the
existing read-only support-settings server function. Preload, ten-second
timeout, visibility/online refresh, Telegram navigation, and `/support`
fallback behavior remain unchanged; stale or unmounted requests cannot publish
a replacement destination. The public `/support` route remains a documented
legacy direct bridge for a later support-specific extraction.

`/transactions` is now a thin route through the same client-safe accounts
facade. The accounts domain owns transaction filters, list presentation, and
browser remote-state coordination, while one application bridge is the sole
transaction-history dependency on the existing read-only server function.
Snapshots, retries, timers, and finalizers require the exact authenticated
user, access-token generation, and selected filter, so late work cannot expose
or overwrite another session or filter. This extraction preserves the six
filters, legacy ETB amount presentation, status labels, formatting, timeout,
retry behavior, and existing server query without changing accounting or
financial behavior.

`/plans` is now a thin route through `src/domains/plans/public.ts`. The plans
domain owns the browser-facing catalog, plan cards, details dialog, eligibility
presentation, formatting, and purchase orchestration. Its application bridge is
the only plans-browser dependency on the existing plan and investment server
functions. Catalog reads, purchase UI effects, and errors are bound to the
exact authenticated user and access-token generation, so late work cannot
populate or notify a replacement session. One unresolved purchase command
remains locked per user across access-token refreshes until the underlying
command settles. This extraction preserves the
existing plan ordering, legacy ETB amounts, contract duration, daily and total
returns, active-plan limits, referral requirements, wallet presentation,
timeout/retry behavior, atomic purchase RPC, and best-effort referral reward
call. Durable purchase-command idempotency is not added by this slice and remains a
separate server/financial design requirement before international cutover.

`/referrals` is now a thin route through
`src/domains/referrals/public.ts`. The referrals domain owns the browser-facing
team composition, referral-link presentation, level filtering, reward copy,
legacy ETB formatting, and remote-state coordination. Its application bridge
is the sole browser dependency on the existing read-only referral server
function. Team snapshots, retries, and referral identity presentation are
bound to the exact authenticated user and access-token generation, so late
successes, failures, timers, and finalizers cannot affect a replacement
session. This extraction preserves the existing username-based referral link,
5%/3%/2% reward copy, six-member preview, transaction-history link, timeout,
retry, server queries, reward accounting, and legacy ETB behavior. Immutable
account and referral codes remain part of the later international identity
cutover, not this mechanical slice.

The canonical crypto routes are non-nested TanStack routes beneath the
protected `_app` layout. They import the client-safe
`src/domains/crypto-deposits/public.ts` and
`src/domains/withdrawals/public.ts` facades. The USDT-BEP20 deposit UI now
separates its public component, request controller, address presentation,
state transitions, view shell, active-address card, and history inside
`src/domains/crypto-deposits/ui`. Its browser transport/view model remains in
the same domain, and the previous component and library paths remain small
compatibility re-exports. The USDT-BEP20 withdrawal UI likewise separates its
thin public component, authenticated request controller, state-selecting view,
request form, and history inside `src/domains/withdrawals/ui`; its prior
component path is now a compatibility re-export, while the browser transport
remains at its existing client-library path. No provider, database, accounting,
Fund PIN, cross-rail policy, authorization logic, endpoint, or route URL moved
in these slices.

`src/components/layout/AppLayout.tsx` also hard-codes the navigation and route labels. The admin experience is a single large route rather than grouped Users, Deposits, Withdrawals, Plans, and Settings sections.

### Generated route tree

`src/routeTree.gen.ts` is generated and must not be hand-edited. Phase 1
regenerated the previously stale artifact from the route filesystem and added
an exact temporary-output comparison. The production build now fails its
prebuild check if the committed route tree is stale. Generated artifacts are
excluded from ordinary complexity warnings but not from reproducibility
checks.

### Type coverage

`src/lib/database.types.ts` remains the application-facing compatibility
surface. Phase 1 also commits `src/lib/database.generated.ts`, the exact
authorized read-only live Supabase type snapshot captured on 2026-07-27.
Offline provenance checks pin both files, all migration paths/checksums, and
the known compatibility gap: three tables and seven functions exist in the
live snapshot but not yet in the compatibility surface.

The dependency and TypeScript baselines are now deterministic:

- Node `22.23.1` and npm `11.9.0` are pinned across local, CI, and Netlify
  declarations;
- the repaired lockfile supports a clean
  `npm ci --include=dev --no-audit --no-fund`;
- complete application TypeScript passes; and
- `tsconfig.netlify.json` covers every supported JavaScript/TypeScript source
  under `netlify/functions` instead of a manual extension-specific allowlist.

The compatibility type debt is deliberately frozen for later migration. Phase
1 does not replace application types wholesale.

## Current identity model

The current registration and login model is Ethiopia-specific:

- registration asks for `username`, Ethiopian phone, and password; an optional
  referring username arrives through the `?ref=` registration link rather than
  a fourth visible form field;
- phone input is normalized to Ethiopian E.164 form;
- the server derives a synthetic `<digits>@qhash.app` address for Supabase Auth;
- the synthetic address is created as already confirmed;
- `profiles` stores `username`, `phone`, `referred_by`, `is_admin`, and `is_frozen`;
- referral lookup and visible identity depend on username;
- administrator authority comes from `profiles.is_admin`, not Auth user metadata.

This is the observed model only. It is not the approved international target.

**Target recommendation:** replace public usernames with an immutable non-PII account code and a separate random referral code. Add real email, phone-derived immutable country, and email-or-phone login through a staged, backward-compatible identity migration.

## Current money and product model

### Legacy ETB rail

The general `wallets`, `transactions`, `plans`, `investments`, `deposits`, `withdrawals`, and referral/earning tables represent the original ETB product. CBE and TeleBirr use this rail. Much of the legacy TypeScript surface represents money as JavaScript `number`, so it cannot become the canonical USDT accounting boundary merely by changing labels.

### NOWPayments USDT-BEP20 rail

The crypto rail uses dedicated `nowpayments_usdt_*` tables and protected functions for:

- deposit configuration, sessions, provider-payment evidence, wallets, and ledger entries;
- permanent-address activation and repeated payments;
- gross deposit crediting;
- withdrawal reservation, administrator completion/rejection, events, and optional administrator-only broadcast data.

Critical database functions provide the atomic financial boundary. Netlify Functions authenticate, validate, and call those functions rather than reproducing balance transitions in the UI.

### Shared controls

At the pinned revision:

- fiat and USDT withdrawals share a rolling 24-hour accepted-request policy and a single-nonterminal-request rule;
- invalid attempts do not consume the cooldown;
- `app_settings.withdrawals_paused` currently gates fiat admission, while
  `nowpayments_usdt_config.withdrawals_enabled` independently gates USDT
  admission; the approved shared global withdrawal pause is target behavior,
  not live behavior at this revision;
- Fund PIN is four numeric digits and is verified through a server-owned boundary;
- `src/domains/deposits/server.ts` owns the provider-neutral global deposit
  admission decision and is the only TypeScript boundary that reads and
  strictly decodes `app_settings.deposits_paused`;
- `app_settings.deposits_paused` gates new CBE and TeleBirr deposits at both
  the server admission boundary and the authoritative `public.deposits`
  insert boundary;
- the same global deposit pause and the NOWPayments rail flag jointly govern
  crypto address disclosure and provisioning, with the fiat and crypto
  adapters translating the shared decision rather than reimplementing it; and
- settlement and recovery of already admitted provider payments remain
  operational during a deposit pause.

## Active and quarantined paths

| Path | Classification | Rule |
|---|---|---|
| Supabase financial tables and protected RPCs | Active and authoritative | Preserve invariants and migrate only through forward migrations |
| NOWPayments Functions and libraries | Active provider boundary | Keep secrets and provider payloads server-only |
| `app_settings` Telegram support setting | Active | Stored in Supabase; service-role mutation only |
| `src/lib/server/support.ts` plus Drizzle `support_tickets` | Dormant/quarantined | The visible support experience uses Telegram; do not treat caller-supplied `userId` in this dormant module as an approved authorization pattern |
| Non-support tables mirrored in `db/schema.ts` | Stale/ambiguous | Do not use as the financial schema source without a separate consolidation decision |
| retired native-crypto tables and retired functions | Historical/audit-only | Preserve evidence and revoked access; do not reactivate |
| applied migration files | Historical executable record | Never edit, rename, split, or delete |

## Current architectural risks

1. Broad pages and flat server folders mix presentation, orchestration, authorization, provider integration, and data mapping.
2. The legacy ETB and provider-named USDT accounting models are not a provider-neutral international ledger.
3. Authentication, public identity, country, and referral identity are coupled to username and Ethiopian phone assumptions.
4. Two database systems exist, while their ownership boundary is not prominent in the main documentation.
5. Twenty-seven existing route/component-to-server bridge imports remain as
   frozen legacy coupling; Phase 1 blocks growth but does not misclassify them
   as a completed domain architecture.
6. Thirty-one existing file-size warnings identify decomposition debt; they
   remain report-only at or below the recorded baseline.
7. The compatibility Supabase type surface lacks three live tables and seven
   live functions, although the authoritative generated snapshot and
   migration provenance are now pinned.
8. The production command migrates before it builds, creating a strict compatibility requirement between old application code, new schema, and the new application build.

## Non-negotiable rule for the reorganization

The file reorganization must be behavior-preserving. Moving code is not authorization to redesign accounting, rewrite an applied migration, replace an RPC with client writes, expose secrets, alter fees, change financial statuses, reset production data, or bypass existing cross-rail policies.

The international USDT conversion is a later staged migration with its own archival, reconciliation, test-data reset, and rollback evidence. It must not be hidden inside mechanical file moves.

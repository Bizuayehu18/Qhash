# Reorganization roadmap

Status: Proposed implementation roadmap

## Objective

Reorganize QHash into understandable domain modules before the international
USDT conversion, while preserving current production behavior and financial
evidence. The reorganization is not a rewrite and is not the currency cutover.

## Invariants throughout the roadmap

- GitHub, deployed application, migration ledger, and live schema are compared
  before high-risk work.
- Applied migrations are never changed.
- Existing financial states, balances, precision, idempotency, lock order,
  Fund PIN behavior, and admin Complete/Reject behavior remain unchanged during
  mechanical phases.
- Existing public URLs continue to work through redirects or compatibility
  entries.
- Deposits, withdrawals, IPN settlement, recovery, and scheduled earnings keep
  operating according to their deployed flags.
- No behavior is considered removed because a file moved.
- Each phase can be reviewed, deployed, and recovered independently.

## Phase 0 — Architecture foundation

Deliver:

- authoritative architecture and product-document indexes;
- current-state and target-state descriptions;
- ADR process and initial decisions;
- repository and change standards;
- route, database, and domain ownership maps;
- this roadmap.

Exit criteria:

- documents distinguish current facts, accepted product decisions, and
  proposed mechanisms;
- outdated root documents are classified as historical evidence;
- no application, schema, configuration, or runtime behavior changes.

## Phase 1 — Deterministic engineering baseline

Add report-only or drift checks for:

- dependency-manifest and lockfile parity;
- a reproducible clean `npm ci` installation;
- portable tests;
- native PostgreSQL tests;
- Netlify handler tests;
- application and Netlify TypeScript;
- route-tree generation;
- Supabase type generation;
- import boundaries;
- file/function complexity;
- documentation links and ADR index.

First capture the current baseline. Complexity and legacy-boundary findings are
warnings, not arbitrary blockers. New client/server leaks, generated drift,
and undocumented architecture decisions may block once the checks are proven
stable. Reproduce the reported `package.json`/`package-lock.json` mismatch from
a clean checkout and repair it only if confirmed; if the report is stale,
record the actual clean-install baseline instead of manufacturing a lockfile
change. Record, then resolve, the existing broad-application TypeScript
diagnostics before treating either clean installation or full-app
type-checking as a merge gate.

Exit criteria:

- one documented aggregate verification entry point;
- `npm ci` succeeds from a clean checkout without changing dependency files;
- full-application and Netlify/server TypeScript checks have explicit, passing
  scopes;
- clean-checkout commands are reproducible;
- native fixtures do not depend on production;
- generated files do not change silently during build.

## Phase 2 — Compatibility scaffolding

Introduce, without moving major implementations yet:

- domain public surfaces;
- explicit server-only and client-safe entry points;
- compatibility re-export conventions;
- structured route shells and old-route redirects;
- characterization tests for current responses and financial behavior.

Target visible route families include:

```text
/deposit/fiat/:country/:provider
/deposit/crypto/usdt-bep20
/withdraw/fiat/:country/:provider
/withdraw/crypto/usdt-bep20
/admin/users
/admin/deposits/fiat
/admin/deposits/crypto
/admin/withdrawals/fiat
/admin/withdrawals/crypto
/admin/plans
/admin/earnings
/admin/referrals
/admin/support
/admin/settings
/admin/audit
```

Country and rail availability still comes from authenticated server-owned
policy. A structured URL must not make an unavailable rail accessible.

Exit criteria:

- old bookmarked URLs remain safe;
- compatibility behavior is tested;
- no financial or authorization change.

## Phase 3 — Extract shared primitives

Move only proven cross-domain primitives:

- currency amount parsing/formatting;
- date/time formatting;
- error envelopes;
- identifiers;
- request generation and abort guards;
- common UI primitives.

Do not move domain policy into `shared`. Create temporary re-exports and migrate
consumers in bounded batches.

Exit criteria:

- new paths have deliberate public APIs;
- client bundles contain no server-only dependencies;
- old imports are either migrated or tracked for removal.

## Phase 4 — Extract domains one at a time

Recommended order:

1. identity, profiles, and Fund PIN;
2. countries and rail availability;
3. crypto deposits;
4. fiat deposits;
5. unified withdrawal policy and crypto withdrawal;
6. fiat withdrawal;
7. plans, earnings, and referrals;
8. notifications and support.

For each domain:

1. freeze current behavior with characterization tests;
2. identify domain, application, infrastructure, server, and UI ownership;
3. extract pure policy;
4. make routes and Netlify handlers thin;
5. retain compatibility exports;
6. compare focused and canonical validation;
7. update documentation.

Do not combine extraction with new international behavior.

## Phase 5 — Decompose administration

Replace the monolithic admin route/component with an admin shell that composes
domain-owned panels:

- Users
- Deposits
  - Fiat
  - Crypto
- Withdrawals
  - Fiat
  - Crypto
- Plans
- Earnings
- Referrals
- Settings
- Support
- Audit

Retain the single existing administrator role initially. Introduce a permission
vocabulary and server-owned capability checks so future Super Admin, Finance,
and Support roles can be added without replacing the UI structure.

Exit criteria:

- no admin panel owns another domain's financial rules;
- existing actions and sanitized data remain unchanged;
- auth-generation and stale-response protections remain covered.

## Phase 6 — Quarantine data adapters

Make database ownership explicit:

- Supabase remains the authoritative financial and identity store.
- Netlify Database/Drizzle remains isolated to its documented support boundary
  until an ADR decides consolidation or retirement.
- Provider adapters live behind domain ports.
- Provider-specific tables remain evidence/integration records, not the
  canonical product wallet.

This phase may reorganize adapter code, but it must not move live tables or
migrations between databases.

Exit criteria:

- every runtime database import names its owning store;
- cross-database financial invariants do not exist;
- migration paths and deployment ownership are documented.

## Phase 7 — International identity and country registry

Implement the separately accepted product requirements:

- compact registration with email, phone, and password;
- country inferred from normalized phone;
- 28 unique launch countries allowed even when crypto-only;
- immutable non-public phone/country for users;
- generated immutable public account code;
- separate random referral code;
- referral attribution that preserves the compact three-field registration form;
- login by email or phone;
- no phone verification;
- verified email required before withdrawal;
- controlled verified-email change with a withdrawal hold.

This requires explicit migration, collision, referral-link/session attribution,
legacy-link compatibility, account recovery, and synthetic-email retirement
plans. It is not a file-organization task.

Exit criteria:

- legacy profiles are migrated deterministically;
- no email or phone becomes a public identifier;
- old referral links have a defined compatibility period;
- country inference is tested for shared calling codes.

## Phase 8 — Canonical USDT model

Build the provider-neutral USDT ledger described in
[ADR 0002](decisions/0002-canonical-usdt-ledger.md):

- plans, earnings, referral rewards, balances, deposits, and withdrawals use
  canonical USDT amounts;
- fiat rails quote and settle into USDT;
- external/provider fees remain explicit;
- local fiat and provider outcome amounts remain immutable evidence;
- high precision, rounding, idempotency, and reconciliation rules are defined
  before data conversion.

No direct rename of provider-specific NOWPayments wallet tables should be used
as the international account model.

Exit criteria:

- one authoritative account ledger;
- provider and fiat conversions reconcile to it;
- old and new applications can coexist for the migration window;
- production feature flags default safe.

## Phase 9 — Test-data archive and cutover

All current users are test users, but auditability still matters.

Preserve:

- Supabase Auth accounts;
- profiles;
- immutable public account codes;
- referral codes and relationships.

Archive and reset, under a separately reviewed plan:

- financial balances and ledgers;
- plans and investments;
- earnings and referral rewards;
- fiat and crypto deposits;
- fiat and crypto withdrawals;
- test transactions and provider evidence as required by the archive policy.

The archive must be immutable, access controlled, checksum/fingerprint
verified, and excluded from live balance calculations. Reset and launch are
separately authorized operations.

## Phase 10 — Premium international presentation

After behavior and data boundaries are stable, redesign one domain at a time.
Launch English first while keeping all new copy translation-ready. Do not mix
the full visual redesign with route and file migration.

## Sequencing rules

- A later phase may begin in a small domain only when its prerequisites are
  satisfied.
- Schema and financial changes use separate PRs from broad moves.
- Temporary compatibility layers are preferable to a risky flag day.
- Each phase publishes an inventory of remaining debt and explicit next
  actions.

## Completion definition

The reorganization is complete when:

- ownership is obvious from paths and imports;
- routes and adapters are thin;
- admin is composed by domain;
- generation and validation are deterministic;
- current documentation matches the repository;
- compatibility bridges have removal plans;
- international USDT work can proceed without depending on legacy flat files.

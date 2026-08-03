# Reorganization roadmap

Status: Proposed implementation roadmap

## Objective

Reorganize QHash into understandable domain modules before the international
USDT conversion, while preserving current production behavior and financial
evidence. The reorganization is not a rewrite and is not the currency cutover.

## Phase status

| Phase | Status |
|---|---|
| Phase 0 — Architecture foundation | Complete |
| Phase 1 — Deterministic engineering baseline | Complete |
| Phase 2 — Compatibility scaffolding | In progress: client-safe route/facade slices and cross-system ownership enforcement implemented; server-only entry points remain |
| Phase 3 — Extract shared primitives | In progress: authenticated request lifecycle, exact cross-domain date/time presentation, shared UUID syntax, shared timestamp parseability, and the loose non-null/non-array object guard extracted |
| Phase 4 — Extract domains one at a time | In progress: accounts transaction history/dashboard, public Support redirect, Notifications, crypto-deposit, ordinary-user USDT-withdrawal, Ethiopia fiat-deposit, Ethiopia fiat-withdrawal, legacy ETB plans, and referrals UI decompositions implemented |
| Phase 5 — Decompose administration | In progress: read-only Admin Overview, Fiat Deposit Verification Audit, Admin Support Settings, Admin Fiat Payment Methods, Admin Fiat Deposit Operations, and Admin Fiat Withdrawal Operations slices implemented |
| Phase 6 and later | Not started |

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

Delivered:

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

Implemented:

- exact Node `22.23.1` and npm `11.9.0` pins across local, CI, and Netlify
  declarations;
- dependency-manifest/lock parity and optional native-package closure;
- a reproducible clean `npm ci --include=dev --no-audit --no-fund`;
- explicit portable, native PostgreSQL, and Netlify handler test manifests;
- complete application and all-Netlify-Function TypeScript scopes;
- deterministic TanStack route generation and drift detection;
- an authorized live Supabase type snapshot with offline hash, compatibility,
  and migration-provenance checks;
- import-boundary no-growth enforcement;
- 35 report-only complexity warnings with no-growth enforcement;
- documentation link, code-fence, required-document, ADR status, and ADR index
  checks; and
- Windows/Linux portable CI plus isolated PostgreSQL 17 native CI.

The confirmed failure was a platform-pruned lockfile with 83 missing optional
dependency targets; it was regenerated with the pinned toolchain. Thirteen
application TypeScript diagnostics were corrected at type boundaries without
changing runtime or financial behavior.

Complexity and the 27 existing TanStack server bridges remain recorded debt,
not the target architecture. The generated live Supabase snapshot also records
three table and seven function gaps in the existing compatibility types rather
than hiding them behind casts.

Exit criteria:

- one documented aggregate verification entry point;
- `npm ci` succeeds from a clean checkout without changing dependency files;
- full-application and Netlify/server TypeScript checks have explicit, passing
  scopes;
- clean-checkout commands are reproducible;
- native fixtures do not depend on production;
- generated files do not change silently during build.

Phase 2 begins only after these controls pass clean-checkout CI and this Phase
1 change is merged.

## Phase 2 — Compatibility scaffolding

Introduce, without moving major implementations yet:

- domain public surfaces;
- explicit server-only and client-safe entry points;
- compatibility re-export conventions;
- structured route shells and old-route redirects;
- characterization tests for current responses and financial behavior.

First bounded slice:

- adds the client-safe `src/domains/crypto-deposits/public.ts` facade;
- adds `/deposit/crypto/usdt/bep20` as a thin authenticated route;
- keeps `/deposit` as the hub and all existing external deposit links valid;
- preserves the existing crypto component, handler endpoints, response
  contracts, pause behavior, and financial boundaries; and
- deliberately defers fiat country/provider routes until country-aware rail
  authorization exists.

Second bounded slice:

- adds the client-safe `src/domains/withdrawals/public.ts` facade;
- adds `/withdraw/crypto/usdt/bep20` as a thin authenticated route;
- keeps `/withdraw` as the CBE, TeleBirr, and USDT withdrawal hub;
- preserves the existing withdrawal component, handlers, four-digit Fund PIN,
  rolling 24-hour cross-rail policy, accounting, and administrator
  Complete/Reject behavior; and
- deliberately defers fiat country/provider routes until country-aware rail
  authorization exists.

Governance slice:

- assigns one accountable domain to every covered application source file,
  authored Netlify Function and support module, generated Supabase table and
  Data API function, immutable Supabase migration, test, document, governance
  artifact, and quarantined Netlify Database artifact;
- records current Function trust boundaries, direct handler coverage gaps, and
  mixed-adapter remediation without claiming legacy files are already thin; and
- makes missing, duplicate, stale, invented, unsafe, or unsorted ownership a
  verification failure.

Target visible route families include:

```text
/deposit/fiat/:country/:provider
/deposit/crypto/usdt/bep20
/withdraw/fiat/:country/:provider
/withdraw/crypto/usdt/bep20
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

The first bounded Phase 3 slice centralizes the exact authenticated-request
identity, latest-generation guard, scoped-request guard, and bounded retry
admission already proven in five domains. Existing domain import paths remain
compatibility adapters. Plans purchase-flight/reconciliation policy and Fiat
Withdrawals form-ownership semantics remain domain-owned.

The second bounded Phase 3 slice moves the exact established cross-domain
`formatDateTime(string | Date)` presentation contract into
`src/shared/formatting/date-time.ts`. Its 10 current consumers import the
shared path directly, while `src/lib/format.ts` remains a compatibility
re-export. The slice preserves `en-US`, device-local timezone, short month,
numeric day/hour, two-digit minute, and existing invalid-date behavior.
Nullable, date-only, explicit-UTC financial-policy, and provider receipt
timestamp formatters remain domain-owned because their contracts differ.

The third bounded Phase 3 slice moves the exact case-insensitive UUID syntax
contracts into `src/shared/identifiers/uuid.ts`. The dependency-free
`isUuidV1ToV5` and `isUuidV4` predicates replace seven duplicated validators
without trimming, lowercasing, coercing, generating, authorizing, or persisting
identifiers. Existing caller normalization remains local. Three deliberately
lowercase-only withdrawal validators and PostgreSQL
`public.is_canonical_uuid_v4` remain outside the shared module because they
enforce distinct financial/database contracts.

The fourth bounded Phase 3 slice moves the exact timestamp-string
parseability predicate into
`src/shared/validation/parseable-timestamp.ts`. Six crypto-deposit and USDT-
withdrawal browser/server transport readers consume the shared
`isParseableTimestampString` predicate. It preserves permissive JavaScript
`Date` parsing without trimming, normalization, ISO/RFC enforcement,
formatting, current-time comparison, or returning a `Date` to callers.
Nullable wrappers, provider normalization, canonical financial-policy
timestamps, receipt parsing, and errors remain caller- or domain-owned.

The fifth bounded Phase 3 slice moves the exact loose non-null, non-array object
predicate into `src/shared/validation/non-null-non-array-object.ts`. Seven
crypto-deposit, deposit-admission, and USDT-withdrawal readers consume
`isNonNullNonArrayObject`. It intentionally accepts built-in objects, class
instances, boxed primitives, and null-prototype objects and therefore does not
claim plain-record, schema, normalization, cloning, or authorization semantics.
The deposit-audit plain-object sanitizer, NOWPayments IPN canonicalizer, and
other parse/error-coupled object readers remain separately owned and
characterized.

Phase 3 remains in progress. Remaining amount, error, single-flight, and
validation lookalikes have different precision, trust, provider, or lifecycle
contracts. They remain with their owners until a later domain or
canonical-USDT phase proves an exact shared contract; avoiding a premature
generic helper remains part of this phase.

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

First crypto-deposit extraction slice:

- moves the USDT-BEP20 React component and its browser-safe NOWPayments
  transport/view model into `src/domains/crypto-deposits/ui`;
- gives the canonical route a provider-neutral `UsdtBep20Deposit` component
  name while retaining `NowpaymentsUsdtDeposit` as a compatibility export;
- leaves the old component and client-library paths as documented re-export
  bridges;
- extends complexity governance to domain UI and layered domain modules so
  moved debt cannot disappear from the baseline; and
- deliberately leaves Netlify entrypoints, provider helpers, Supabase
  functions/tables, applied migrations, endpoints, and fiat behavior in place
  for separately characterized extraction slices.

Second crypto-deposit extraction slice:

- decomposes the canonical USDT-BEP20 UI into a thin public component,
  request controller, address-presentation hook, pure state module, view
  shell, active-address card, and deposit history;
- preserves the public exports, compatibility bridges, canonical route,
  response contracts, polling, copy and QR behavior, and provider boundary;
- removes the resolved 852-nonblank-line component warning without raising a
  new complexity warning; and
- makes no schema, migration, Netlify Function, authorization, provider,
  accounting, flag, or financial behavior change.

First ordinary-user USDT-withdrawal UI extraction slice:

- moves the canonical USDT-BEP20 component into
  `src/domains/withdrawals/ui` and decomposes it into a thin public entry,
  authenticated request controller, state-selecting view, request form, and
  withdrawal history;
- preserves the client facade, legacy component import through a compatibility
  bridge, canonical route, exact six-decimal calculation, four-digit Fund PIN,
  stable idempotency keys, rolling 24-hour cross-rail policy, balances, fees,
  and Pending/Completed/Rejected history;
- removes the resolved 466-nonblank-line component warning without raising a
  new complexity warning; and
- deliberately leaves the browser transport, Netlify Functions, Supabase
  functions and tables, administrator workflow, provider boundary, accounting,
  flags, and financial behavior unchanged.

First fiat-deposit UI extraction slice:

- makes `/deposit` a thin route through the shared deposits public facade and
  keeps cross-rail layout and crypto navigation in
  `src/domains/deposits/ui/DepositHub.tsx`;
- moves the existing Ethiopia fiat browser flow behind
  `src/domains/fiat-deposits/public.ts`, with shared fiat orchestration, form,
  method-list, and history modules plus provider-specific ET/CBE and
  ET/TeleBirr presentation modules;
- preserves the current server functions, validation, submission, history,
  payment-method ordering, visual design, route URL, database boundaries, and
  accounting behavior;
- removes the resolved deposit-route complexity warning without raising a new
  warning; and
- deliberately defers `/deposit/fiat/et/cbe` and
  `/deposit/fiat/et/telebirr` until registered-country rail authorization is
  implemented and independently verified.

First fiat-withdrawal UI extraction slice:

- makes `/withdraw` a thin route through the shared withdrawals public facade
  and keeps cross-rail layout and USDT-BEP20 navigation in
  `src/domains/withdrawals/ui/WithdrawalHub.tsx`;
- moves the existing Ethiopia fiat browser flow behind
  `src/domains/fiat-withdrawals/public.ts`, with an application service,
  controller, remote-state coordination, method list, details, confirmation,
  history, and provider-specific ET/CBE and ET/TeleBirr modules;
- preserves the 200 ETB minimum, 5% fee, four-digit Fund PIN, server functions,
  accepted-request policy, history, retry behavior, visual design, route URL,
  database boundaries, and accounting behavior;
- removes the resolved withdrawal-route complexity warning without raising a
  new warning; and
- deliberately defers `/withdraw/fiat/et/cbe` and
  `/withdraw/fiat/et/telebirr` until registered-country rail authorization is
  implemented and independently verified.

First plans UI extraction slice:

- makes `/plans` a thin route through `src/domains/plans/public.ts`;
- moves catalog composition, plan cards, details, eligibility presentation,
  formatting, and purchase state into plans-owned domain, application, and UI
  modules;
- confines legacy plan and investment server-function imports to one
  application bridge and scopes catalog reads, purchase effects, and notices to
  the exact authenticated user and access-token generation, while retaining one
  unresolved purchase-command lock per user across token refreshes;
- preserves plan ordering, legacy ETB amounts and formatting, durations, daily
  and total returns, active-plan limits, referral requirements, wallet
  presentation, timeout/retry behavior, the existing atomic purchase RPC, and
  best-effort referral reward processing;
- removes the resolved plans-route complexity warning without raising a new
  warning; and
- changes no schema, migration, RPC, accounting, plan, earning, referral, or
  currency behavior. Purchase-command idempotency remains explicitly deferred
  to a separately reviewed financial/server design before international
  cutover.

First referrals UI extraction slice:

- makes `/referrals` a thin route through
  `src/domains/referrals/public.ts`;
- moves team composition, referral-link presentation, stats, filtering, reward
  copy, formatting, and remote-state coordination into referral-owned domain,
  application, and UI modules;
- confines the existing read-only referral server-function import to one
  application bridge and scopes snapshots, retries, timers, and request
  finalizers to the exact authenticated user and access-token generation;
- preserves the username-based referral link, legacy ETB presentation,
  5%/3%/2% reward copy, server queries, six-member preview, timeout/retry
  behavior, reward history link, and current reward accounting;
- removes the resolved referrals-route complexity warning without raising a
  new warning; and
- changes no schema, migration, RPC, reward posting, earning, referral graph,
  plan, financial, or international identity behavior.

First accounts transaction-history UI extraction slice:

- makes `/transactions` a thin route through
  `src/domains/accounts/public.ts`;
- moves the six-filter contract, list and status presentation, and remote-state
  coordination into accounts-owned domain, application, and UI modules;
- confines the existing read-only transaction server-function import to one
  application bridge and scopes snapshots, retries, timers, and request
  finalizers to the exact authenticated user, access-token generation, and
  selected filter;
- preserves the 50-row server query, legacy ETB amount and sign presentation,
  status labels, transaction titles and subtitles, date formatting, loading
  and empty states, timeout, retry, and visible/online refresh behavior;
- removes the resolved transactions-route complexity warning without raising a
  new warning; and
- changes no schema, migration, RPC, server query, wallet, ledger, accounting,
  financial, or international-currency behavior.

Accounts dashboard UI extraction slice:

- makes `/dashboard` a thin route through `src/domains/accounts/public.ts`;
- moves account summary, plan progress, recent transactions, completed plans,
  formatting, and composition into accounts-owned UI modules;
- introduces a client-safe support facade and one support application bridge
  for the dashboard's existing read-only support-settings dependency;
- preserves the legacy two-decimal ETB balance and income presentation, plan
  timing, five-transaction and three-completed-plan previews, links, copy,
  loading and empty states, ten-second support timeout, Telegram destination,
  `/support` fallback, and authenticated dashboard isolation;
- removes the resolved dashboard-route complexity warning without raising a
  new warning; and
- changes no schema, migration, Netlify Function, RPC, server query, wallet,
  ledger, plan, transaction, support setting, accounting, financial, or
  international-currency behavior.

Public Support redirect extraction slice:

- makes `/support` a thin route through `src/domains/support/public.ts`;
- moves the existing redirect presentation behind the Support public facade
  and reuses the single Support application bridge introduced by the dashboard
  extraction;
- preserves the one-shot Telegram `window.location.replace`, unavailable
  message, error logging, and unmount guard without adopting dashboard polling
  or fallback behavior;
- ratchets the frozen TanStack server-bridge baseline from 27 to 26 without
  introducing a new complexity warning; and
- changes no support setting, server function, schema, migration, Supabase or
  Netlify data, authentication, route URL, visible copy, or financial behavior.

Notifications UI extraction slice:

- makes `/notifications` a thin route through
  `src/domains/notifications/public.ts` and moves list presentation,
  normalization, page coordination, and the application-shell unread hook into
  Notifications-owned domain, application, and UI modules;
- confines all browser list/count/mark-read server imports to one application
  bridge and binds snapshots, retries, finalizers, mark-all effects and notices,
  and badge polling to the exact authenticated user/access-token generation;
- preserves the route, copy, icons, query order and 30-row limit, loading and
  empty states, timeout/retry behavior, visible/online refresh, badge polling,
  silent badge failures, and mark-all interaction;
- ratchets the frozen TanStack server-bridge baseline from 26 to 25 and removes
  the resolved Notifications route warning without adding a new complexity
  warning; and
- changes no schema, migration, notification producer, server function,
  Supabase or Netlify data, route URL, financial state, or international
  behavior. Producer consolidation and mark-read server hardening remain
  separately reviewed work.

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

The first bounded Admin Overview slice:

- exposes read-only overview composition through the client-safe
  `src/domains/admin/public.ts` surface;
- confines its legacy administrator-statistics server dependency to one
  application bridge;
- preserves the `/admin` URL, flat tab order, visible statistics, legacy ETB
  presentation, timeout, bounded retry, and visible/online refresh behavior;
- binds snapshot publication, retries, active-flight cleanup, and finalizers to
  the exact administrator and access-token generation; and
- changes no schema, migration, server query, administrator action, financial
  rule, provider boundary, feature flag, or production state.

The second bounded Fiat Deposit Verification Audit slice:

- exposes read-only audit composition through the client-safe
  `src/domains/fiat-deposits/public.ts` surface;
- confines its existing administrator audit server dependency to one
  fiat-deposit application bridge;
- preserves the `/admin` URL, flat tab order, All/CBE/TeleBirr filters,
  latest-100 query, sanitized fields, masking, legacy ETB presentation,
  timeout, bounded retry, and visible/online refresh behavior;
- binds snapshot publication, retries, active-flight cleanup, and finalizers to
  the exact administrator, access-token generation, and selected filter; and
- changes no schema, migration, server query, audit write, deposit approval,
  payment-method action, provider boundary, financial rule, feature flag, or
  production state.

The third bounded Admin Support Settings slice:

- exposes support-setting composition through the client-safe
  `src/domains/support/public.ts` surface;
- confines its existing administrator read/update server dependencies to one
  support application bridge;
- preserves the `/admin` URL, Settings tab, Support/Payment order and default,
  Telegram copy, open-link behavior, validation, save result, and public
  `/support` behavior;
- binds load and save publication, notices, single-flight state, cleanup, and
  finalizers to the exact administrator and access-token generation; and
- changes no setting value, Payment Methods behavior, server authorization,
  schema, migration, provider boundary, financial rule, feature flag, or
  production state.

The fourth bounded Admin Fiat Payment Methods slice:

- exposes CBE/TeleBirr payment-method configuration through the client-safe
  `src/domains/fiat-deposits/public.ts` surface;
- confines its existing list, create, update, archive, and restore server
  dependencies to one fiat-deposit application bridge;
- preserves the `/admin` URL, Settings default, Support/Payment order, Payment
  conditional remount, Visible/Archived/All filters, fields, copy, loading and
  empty states, CBE last-eight derivation, and archive/restore semantics;
- scopes catalog publication, retry admission, refreshes, and cleanup to the
  exact administrator, access-token generation, and selected archive filter;
  scopes editor and mutation effects to the exact identity; clears edit
  selection when the filter changes; and
- changes no server function, authorization rule, schema, migration, database
  row, provider boundary, financial rule, feature flag, or production state.

The fifth bounded Admin Fiat Deposit Operations slice:

- exposes administrator CBE/TeleBirr deposit listing and review composition
  through the client-safe `src/domains/fiat-deposits/public.ts` surface;
- confines its existing administrator deposit-list server dependency and
  approval HTTP dependency to one fiat-deposit application bridge;
- preserves the `/admin` URL, flat tab order, All/Pending/Approved/Rejected
  filters, latest-100 catalog, current-filter pending count, loading and empty
  states, detail fields, receipt link, verified ETB amount, review note, copy,
  and approval/rejection request contract;
- scopes catalog publication, retry admission, selection, drafts, and catalog
  cleanup to the exact administrator, access-token generation, and selected
  filter; clears selection and drafts when the filter changes; scopes review
  single-flight state, notices, cleanup, and finalizers to the exact
  administrator and access-token generation; refreshes the currently
  selected catalog after an accepted review; and
- changes no list server function, approval Function or RPC, authorization
  rule, notification behavior, schema, migration, database row, provider
  boundary, financial rule, feature flag, or production state. The approval
  adapter retains its documented mixed ownership and focused handler-test
  waiver.

The sixth bounded Admin Fiat Withdrawal Operations slice:

- exposes administrator CBE/TeleBirr withdrawal listing and review composition
  through the client-safe `src/domains/fiat-withdrawals/public.ts` surface;
- confines its existing administrator withdrawal-list, approval, and rejection
  server dependencies to one fiat-withdrawal application bridge;
- preserves the `/admin` URL, flat tab order, default Pending filter,
  All/Pending/Approved/Rejected filters, latest-100 catalog, current-filter
  pending count, loading and empty states, detail fields, ETB amount, fee and
  net payout, account copy, review note, confirmations, and
  approval/rejection request contracts;
- scopes catalog publication, retry admission, selection, notes, and catalog
  cleanup to the exact administrator, access-token generation, and selected
  filter; clears selection and notes when the filter changes; scopes review
  single-flight state, notices, cleanup, and finalizers to the exact
  administrator and access-token generation; refreshes the currently selected
  catalog after an accepted review; and
- changes no list, approval, or rejection server function; RPC; authorization
  rule; schema; migration; database row; provider boundary; financial rule;
  feature flag; notification behavior; or production state. Shared Fund PIN,
  cooldown, active-request, and financial authority remain in `withdrawals`.

The remaining panels stay in the compatibility route until they are extracted
by their accountable product domains in separately reviewed slices.

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

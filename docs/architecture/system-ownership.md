# Cross-system domain ownership

Status: current governance contract
Scope: source-controlled application, Netlify, Supabase, tests, and documentation
Machine source: [domain-ownership.json](domain-ownership.json)

QHash is organized by accountable business domains, even while much of the
current implementation is still physically arranged by technical layer. An
owner is the single domain responsible for the correctness and evolution of an
asset. Other domains may consume that asset without becoming co-owners.

This registry does not claim that the existing files are already ideally
factored. It makes current ownership, mixed responsibilities, quarantined
history, and remediation debt explicit before files are moved or split.

## Covered systems

The ownership check derives one canonical inventory from
`git ls-files --cached --others --exclude-standard`. Every tracked or
unignored repository file belongs to exactly one disjoint asset category and
one domain. The registry cannot weaken the check by narrowing a glob, and a
Git-inventory failure stops verification rather than falling back to local
filesystem state.

- every tracked or unignored repository file, including root configuration,
  Android/tooling history, and checkpoints not covered by a specialized
  category;
- all files under `src`, separated into route modules, domain public surfaces,
  and other source modules;
- every authored Netlify Function for all supported JavaScript/TypeScript
  extensions and every direct or nested Function support module;
- every source-controlled Netlify Database artifact, which is quarantined and
  is not Supabase migration authority;
- every `tests/*.test.mjs` contract;
- every Markdown document under `docs`;
- repository verification, build, migration-runner, and deployment
  configuration files;
- every generated public Supabase table and Data API function in the pinned
  database snapshot;
- 11 non-Data-API trigger or event-trigger functions pinned from the
  2026-07-28 read-only live Supabase catalog audit;
- nine known live-only or incomplete-provenance resources pinned independently
  from that same audit;
- every immutable Supabase migration path in the database provenance baseline;
- public static assets.

Netlify's generated TanStack Start SSR Function is deployment output, not an
authored Function entrypoint. Its source is owned through the application shell,
router, build configuration, and Netlify configuration.

## Domain map

| Domain | Accountable boundary |
|---|---|
| `accounts` | Dashboard remote state, wallet and ledger views, balances, transactions, and authentication-scoped accounting presentation |
| `admin` | Administrator shell and composition; financial commands remain owned by their financial domain |
| `app-shell` | Router, layouts, shared UI primitives, global UI state, and generated route integration |
| `crypto-deposits` | USDT rail enablement, addresses, provider evidence, settlement, and retired crypto evidence |
| `deposits` | Provider-neutral cross-rail deposit admission, shared availability, history composition, and deposit navigation |
| `earnings` | Investment earning execution and earning-run audit |
| `fiat-deposits` | Country fiat rail enablement, CBE/TeleBirr collection and verification, deposit approval, and fiat-table enforcement |
| `fiat-withdrawals` | Ethiopia CBE/TeleBirr browser presentation and legacy ETB request orchestration; shared financial policy remains in `withdrawals` |
| `identity` | Registration, login, immutable profile identity, account security, and Fund PIN |
| `legacy-netlify-database` | Quarantined Netlify Database history; never production Supabase authority |
| `notifications` | User notification records and presentation |
| `plans` | Plan catalog presentation, eligibility, authentication-scoped purchase orchestration, investment records, and contract rules; financial execution remains server-owned |
| `platform` | Repository governance, generated database contracts, migration runner, shared settings, domain-neutral application primitives, and architecture docs |
| `referrals` | Referral graph, authentication-scoped team presentation, reward posting, and reward audit |
| `support` | User support presentation and server-owned support configuration |
| `withdrawals` | Fiat and USDT requests, reservation, cross-rail policy, and manual administrator resolution |

## Netlify Function contract

Each authored Function records:

- its single owner and capability;
- HTTP path, effective methods and enforcement layer, or schedule, checked
  against source;
- its closed-enum production, authentication, and authorization trust
  boundary, checked against both source anchors and an independent
  source-reviewed baseline;
- its exact directly imported Function support modules;
- direct handler coverage or an explicit temporary coverage waiver;
- mixed ownership and a named remediation when the adapter is not thin.

The registry deliberately records current weaknesses. For example, the
scheduled earnings adapter has no in-handler published-production gate and can
be invoked through Netlify's manual scheduler controls; its remediation names
that risk rather than claiming the schedule itself is a gate. The legacy
deposit-approval and TeleBirr verifier adapters also require further extraction
or direct handler tests. The registry must not describe a missing production
gate as present.

The browser deposit hub now composes the shared `deposits` public surface.
Ethiopia CBE and TeleBirr collection and presentation are owned by the
`fiat-deposits` public surface and provider-specific modules; crypto navigation
remains owned by shared deposit composition. This physical extraction does not
change the recorded trust debt in the legacy approval or TeleBirr verifier
Functions.

The browser withdrawal hub now composes the shared `withdrawals` public
surface. Ethiopia CBE and TeleBirr withdrawal presentation and browser
orchestration are owned by the `fiat-withdrawals` public surface and
provider-specific modules. The shared Fund PIN, cooldown, active-request,
financial, database, and administrator boundaries remain owned by
`withdrawals`; the extraction creates no new live fiat route or server trust
boundary.

The `accounts` public facade owns the browser dashboard page and remote-state
hook. Its application bridge is the only accounts-domain dashboard dependency
on legacy server functions. Dashboard snapshots and retries are keyed to the
exact authenticated user/token generation, while the shared wallet cache,
in-flight work, polling, and writes are keyed to the active user ID. The thin
route and other consumers cannot render a balance owned by a previous user or
a dashboard snapshot owned by a previous authentication generation.

Dashboard support navigation crosses domains only through the client-safe
`support` public facade. One support application bridge owns the extracted
Dashboard and public `/support` dependencies on the existing read-only settings
server function. The public Support route consumes that facade and renders a
domain-owned redirect page while preserving its one-shot redirect and
unavailable-state behavior.
The dashboard's preload, timeout, passive refresh, interactive navigation, and
fallback contract remain separate from the public redirect presentation.
Profile and Admin remain documented legacy direct consumers for later
domain-specific extractions.

The transactions route also consumes only the accounts public facade. One
accounts application bridge owns the browser dependency on the existing
read-only transaction server function; filter policy, list presentation, and
remote-state coordination are accounts-owned. Snapshot visibility, retries,
timers, and request finalizers require the exact authenticated user,
access-token generation, and selected filter. The existing server query,
legacy ETB presentation, shared transaction helpers, wallet and ledger
boundaries, and accounting behavior remain unchanged.

The `plans` public facade owns the browser catalog and purchase experience. Its
application bridge is the sole plans-browser dependency on the legacy plan and
investment server functions. Plan cards, details, formatting, eligibility, and
remote-state coordination are plans-owned, and asynchronous catalog or purchase
effects are scoped to the exact authenticated user/token generation. The
unresolved purchase-command lock is keyed by user rather than token and remains
active through a token refresh until the underlying command settles. The
existing atomic purchase RPC, legacy ETB accounting, investment persistence,
and best-effort referral reward call stay at their current server and domain
boundaries. This extraction does not add purchase-command idempotency or move
earnings and referrals into the plans domain.

The referrals route consumes only `src/domains/referrals/public.ts`. One
referrals application bridge owns the browser dependency on the existing
read-only team server function; filtering, link presentation, reward copy, and
remote-state coordination are referrals-owned. Snapshot visibility, retries,
timers, and request finalizers require the exact authenticated user/access-token
generation. The existing referral graph, username-based links, legacy ETB
presentation, reward percentages, posting functions, scheduled earnings, and
database assets remain at their current boundaries.

The Notifications public surface owns the `/notifications` page and the
application shell's unread-count hook. One Notifications application bridge is
the sole browser dependency on the existing notification list, unread-count,
and mark-read server functions. Page snapshots, retries, timers, mark-all
effects, notices, and badge results are scoped to the exact authenticated user
and access-token generation. The existing server module remains responsible
for deriving the caller identity from that token. Notification producer writes
remain owned by the deposit, withdrawal, earning, and referral workflows that
emit them; consuming a notification does not transfer ownership of the
underlying financial transition.

The platform domain owns the shared authenticated-request lifecycle primitive.
Accounts, Plans, Referrals, Notifications, and Fiat Withdrawals retain their
established import paths as compatibility adapters, while new consumers may use
the shared path directly. The shared module compares exact user/token
generations and coordinates only in-memory request ownership, optional scopes,
and retry admission. Plans purchase locking and reconciliation, Fiat
Withdrawals null-state matching, abort-controller ownership, server
authentication, and every business policy remain with their existing owners.

## Supabase contract

Generated table and Data API function inventories come from
`scripts/database-types-baseline.json`. Migration checksums remain owned by the
database provenance check; the ownership registry assigns exactly one domain to
each immutable path without duplicating its checksum.

The 11 internal trigger/event-trigger functions and nine known live-only
resources come from the 2026-07-28 read-only live audit and are pinned
independently in `scripts/engineering-baseline.json`. The checker requires
exact membership and one owner for all of them, plus required remediation for
each live-only resource; editing the registry cannot delete or invent
live-catalog coverage.

Known live-only or incomplete provenance is recorded with a required
forward-only remediation. A registry entry does not authorize a live edit. Any
catalog correction must:

1. inspect the exact live definition and dependents;
2. add a reviewed forward migration;
3. fail closed if production differs from the expected preflight;
4. update generated types, provenance, ownership, tests, and documentation
   together.

Applied migrations are never renamed, moved, rewritten, or cosmetically
reorganized. The separate `netlify/database` history remains quarantined until
each artifact is reconciled or retired through an explicit decision.

## Change rules

- A new covered asset must have one owner in the same pull request.
- Duplicate, missing, stale, invented, unsorted, absolute, traversal, glob, or
  Windows-only ownership entries fail verification.
- Cross-domain consumption is documented through imports and contracts, not
  duplicate ownership.
- A moved file must update ownership, imports, tests, and relevant architecture
  documentation atomically.
- Generated artifacts remain generated and are not manually redesigned.
- A mixed adapter may remain temporarily only when its current trust boundary,
  test gap, and remediation are explicit.
- Reorganization must preserve behavior first. Premium international design and
  USDT conversion proceed domain by domain after the relevant boundary is
  isolated and verified.

Run the contract with:

```text
npm run check:ownership
```

The full `npm run verify` chain runs the pinned toolchain, dependency, test,
type, route-generation, database-provenance, ownership, boundary, complexity,
documentation, and build checks in the order declared in `package.json`.
Database provenance immediately precedes ownership.

# Repository standards

Status: Adopted incrementally; Phase 1 checks and cross-system ownership active
Applies to: application code, server code, Netlify Functions, tests, documentation, and future generated artifacts

## Purpose

QHash is moving from a flat, Ethiopia-focused application toward a modular
international platform. The repository must become easier to understand and
change without altering proven financial behavior during the reorganization.

This document describes the target shape. It does not claim that the current
repository already follows it. Adoption is phased in
[the reorganization roadmap](../architecture/reorganization-roadmap.md).

## Core principles

1. A business capability has one obvious home.
2. Routes and deployment adapters translate protocols; they do not own
   business rules.
3. Financial invariants are enforced at an authoritative server/database
   boundary and are tested independently of the UI.
4. Shared code is genuinely cross-domain. A convenient dumping ground is not a
   shared module.
5. Applied migrations and financial audit records are immutable.
6. File moves are separated from behavior changes whenever practical.
7. Generated artifacts are reproducible and checked for drift.
8. Documentation changes with the architecture it describes.
9. Every runtime, deployment, data-contract, test, and documentation asset has
   exactly one accountable domain owner.

## Target repository shape

The exact paths remain subject to ADR review, but new work should converge on
this domain-oriented shape:

```text
src/
  app/                         # application composition and providers
  domains/
    identity/
    accounts/
    countries/
    fiat-rails/
    crypto-deposits/
    withdrawals/
    plans/
    earnings/
    referrals/
    notifications/
    support/
    admin/                     # admin shell and admin-only coordination
  shared/
    ui/
    formatting/
    validation/
    errors/
    types/
  routes/                      # thin TanStack Router entry points
netlify/
  functions/                   # thin HTTP/Netlify adapters
  database/                    # quarantined Netlify Database migrations
supabase/
  migrations/                  # authoritative Supabase migrations
tests/
  portable/
  native/
  handlers/
  fixtures/
docs/
  architecture/
  engineering/
  operations/
  product/
```

Each domain may contain only the layers it needs:

```text
domains/<domain>/
  domain/                      # entities, value objects, policy
  application/                 # use cases and ports
  infrastructure/             # Supabase/provider implementations
  server/                      # server-owned orchestration
  ui/                          # domain UI, hooks, view models
  public.ts                    # deliberately exported surface
```

This is a destination, not permission for a repository-wide move in one PR.

## Module responsibilities

### Routes

Route files should:

- declare the route;
- validate route/search parameters;
- invoke a domain page or loader;
- translate navigation and redirect behavior;
- contain route-level loading and error boundaries when necessary.

Route files should not implement financial calculations, provider calls,
database transactions, large forms, admin tables, or reusable business rules.

### UI

Domain UI owns presentation and interaction state. It consumes typed
application services and view models. It must not read service-role secrets,
construct privileged database clients, or determine authoritative financial
outcomes.

### Application and domain

Application modules coordinate use cases. Domain modules contain business
language, states, and pure policy. Examples include withdrawal eligibility,
gross/fee/net relationships, deposit address lifecycle states, and country
rail visibility.

Database constraints and protected functions remain authoritative for
concurrent financial mutations. TypeScript policy is still valuable for early
feedback and consistent UI, but it must not become a competing source of
truth.

### Infrastructure and adapters

Infrastructure modules implement ports for Supabase, Netlify Database, and
external providers. Netlify Functions are HTTP adapters: authenticate, parse,
call one application use case, and serialize a sanitized response.

Provider-specific terminology must not leak into canonical account, plan,
earning, or referral modules.

### Admin

The admin domain is a composition surface, not a replacement for domain boundaries.
Users, fiat deposits, crypto deposits, fiat withdrawals, crypto withdrawals,
plans, settings, and support should expose focused admin capabilities that the
admin shell groups. This keeps future Finance and Support roles possible
without another monolithic rewrite.

### Shared

Code belongs in `shared` only when:

- at least two independent domains use it;
- it contains no domain-specific language or branching;
- it has a stable, small public API; and
- moving it does not reverse the dependency direction.

If only one domain uses a helper, keep it in that domain. Generic filenames
such as `utils.ts`, `helpers.ts`, and `common.ts` are discouraged; name modules
after their responsibility.

## Import boundaries

The target dependency direction is:

```text
routes/adapters -> application -> domain
       |                |
       v                v
     domain UI        declared ports
                           ^
                           |
                    infrastructure

all layers -> shared primitives
```

Rules:

- A domain must not import another domain's internal files. Import its
  documented `public.ts` surface.
- Domain policy must not import React, TanStack Router, Netlify, Supabase, or a
  provider SDK.
- UI must not import service-role clients or migration/runtime internals.
- Browser/client modules must not import server-only modules.
- `shared` must not import a domain.
- `src/routes` and `netlify/functions` may depend inward; domains must never
  depend on them.
- Cross-domain orchestration belongs in an application service with explicit
  ports, not in a route or component.

Import-boundary automation is a target check. It starts in report-only mode
while the current baseline is reduced.

## Naming

- Directories and non-component modules: `kebab-case`.
- React components and component files: `PascalCase`.
- Hooks: `useThing`.
- Pure policies: `<subject>-policy.ts`.
- Protocol adapters: `<provider>-<operation>-adapter.ts`.
- Server use cases: verbs that state the action, such as
  `request-withdrawal.ts`.
- Tests mirror the module or capability they verify.
- Migration directories retain the established timestamp/name convention and
  contain `migration.sql`.

Avoid encoding temporary implementation details in public names. For example,
the canonical wallet should not be named after NOWPayments.

## File size and complexity

Large files are a signal to review ownership, not proof of a defect. During the
initial reorganization, size and complexity checks are warnings rather than
arbitrary merge blockers.

Suggested warning baselines:

| Category | Review warning |
|---|---:|
| Route entry | over 150 logical lines |
| React component or hook | over 300 logical lines |
| HTTP/provider adapter | over 250 logical lines |
| Domain/application module | over 400 logical lines |
| Test file | over 800 logical lines |
| Function | over 80 logical lines or deeply nested branching |

Warnings should include trends and the largest offenders. A warning becomes a
blocking threshold only after:

1. the existing category baseline is recorded;
2. reasonable exemptions are defined;
3. the team has reduced existing violations; and
4. the threshold is accepted in an ADR or engineering-policy change.

Generated files, forward migrations, catalog fingerprints, and data-driven
fixtures may need exemptions. Exemptions must be explicit and must not hide
hand-written product logic.

The active complexity check applies the React component/hook threshold to
`src/domains/<domain>/ui` TSX files and `use*.ts` hooks, and the 400-line
domain/application threshold to the remaining layered domain modules. Moving a
legacy file into `src/domains` therefore transfers its recorded warning rather
than making the debt disappear.

## Generated files

Generated files have a declared generator, source, command, and drift check.
They are never edited by hand.

### TanStack route tree

`src/routeTree.gen.ts` is generated from route files. The target verification
must:

1. generate it from a clean checkout using the pinned toolchain;
2. fail if generation changes the committed artifact;
3. run before the production build; and
4. report a clear regeneration command.

A build that silently repairs a stale route tree is not a successful
determinism check.

### Supabase database types

The database type artifact must have one documented generation workflow and a
stable source schema. The target verification must generate into a temporary
file, normalize only known nondeterminism, and compare it with the committed
artifact.

Until production type generation is reproducible in CI, schema-changing PRs
must update the type file deliberately and document how it was verified.
Placeholder project IDs and ad hoc shell redirection are not an acceptable
long-term workflow.

## Validation commands

Phase 1 established one supported interface with Node `22.23.1`, npm `11.9.0`,
a complete lockfile, and explicit test/typecheck scopes. The commands below are
available in `package.json` and are documented in
[Verification and generated artifacts](./verification.md).

| Script | Responsibility |
|---|---|
| `test:portable` | deterministic tests requiring no live database or network |
| `test:native` | PostgreSQL-specific schema, concurrency, drift, and security tests |
| `test:handlers` | Netlify handler authentication, validation, and response contracts |
| `typecheck` | application TypeScript |
| `typecheck:netlify` | Netlify/server TypeScript |
| `check:routes-generated` | deterministic route-tree generation |
| `check:database-types` | committed Supabase type snapshot and migration-provenance drift |
| `check:ownership` | exhaustive source, Netlify, Supabase, test, documentation, and quarantined-artifact ownership |
| `check:boundaries` | import direction and client/server boundaries |
| `check:complexity` | initially report-only file/function warnings |
| `check:docs` | links, required documents, ADR index, and formatting |
| `verify` | the supported aggregate local/CI verification |

Native tests must use isolated disposable PostgreSQL, separate connections
where concurrency matters, serialized file-level schema setup, and explicit
readiness/teardown. Production databases and provider APIs are not test
fixtures.

Existing complexity and server-bridge debt is recorded rather than
grandfathered invisibly. A recorded warning may remain at or below its
baseline; a new warning or an increase fails the check.

## Compatibility during reorganization

Reorganization PRs preserve:

- current route URLs through redirects or compatibility route entries;
- public imports through temporary re-export modules;
- serialized request and response contracts;
- database names, function signatures, and state transitions;
- authentication and authorization rules;
- financial calculations, idempotency, and lock order;
- analytics/audit identifiers where consumers depend on them.

Every compatibility layer has an owner, a removal condition, and preferably a
target release. New code imports the new path; only existing consumers use the
bridge.

During Phase 2, a domain `public.ts` may be a client-safe facade over an
existing implementation when moving that implementation would combine too
much risk. Such a facade:

- exports only reviewed browser-safe names;
- must not export server adapters, privileged clients, provider secrets, or
  migration internals;
- is the import path for new routes and new cross-domain consumers;
- documents the legacy implementation it delegates to; and
- remains until direct-import scans, characterization tests, and a separately
  reviewed extraction allow the old path to become a compatibility bridge.

The first facades are `src/domains/crypto-deposits/public.ts` and
`src/domains/withdrawals/public.ts`. The crypto-deposit facade now points to
its canonical domain-owned UI implementation. That implementation separates
state, request orchestration, address presentation, and focused views while
the old component and client-library paths remain compatibility bridges. The
withdrawal facade now points to its canonical domain-owned ordinary-user UI,
which separates request orchestration, state selection, the request form, and
history. Its old component path is a compatibility bridge; its existing
browser transport remains at the legacy client-library path for a later
bounded extraction. Server-only domain entry points remain a later bounded
slice; client code must not infer a server boundary from these browser-safe
surfaces.

## Documentation ownership

Every architectural PR updates the documents affected by its change. At
minimum:

- new or changed decisions update the ADR index;
- domain moves update the repository map and boundaries;
- route changes update the route map and redirects;
- schema changes update data ownership and migration notes;
- security changes update the trust-boundary documentation;
- operational changes update the relevant runbook.

The authoritative current assignment is
[Cross-system domain ownership](../architecture/system-ownership.md), backed by
the machine-readable
[domain ownership registry](../architecture/domain-ownership.json). Ownership
means single accountability, not exclusive consumption. New covered files,
Functions, Supabase objects, migrations, tests, or documents must be registered
in the same PR. Legacy or mixed ownership must be recorded with a named
remediation instead of being silently exempted.

Historical checkpoint documents are evidence, not current architecture. They
must not override the indexed architecture documentation.

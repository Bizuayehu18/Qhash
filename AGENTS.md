# QHash contributor and agent guide

This file defines repository-wide rules for developers and automated agents.
Detailed architecture lives under [`docs/`](docs/README.md).

## Required reading

Before changing QHash:

1. Read [Current architecture](docs/architecture/current-state.md).
2. Read the relevant domain boundary in
   [Domain boundaries](docs/architecture/domain-boundaries.md).
3. Read [Repository standards](docs/engineering/repository-standards.md) and
   [Change policy](docs/engineering/change-policy.md).
4. For financial or schema work, read
   [Data, security, and deployment](docs/architecture/data-security-and-deployment.md).
5. For internationalization or currency work, read
   [International USDT requirements](docs/product/international-usdt-requirements.md).

Current-state documentation describes deployed behavior. Target-state
documentation describes approved direction, not live functionality. Never
silently treat a target requirement as already implemented.

## Current system facts

- QHash uses TanStack Start, React, TanStack Router, Tailwind CSS, Zustand,
  Supabase, Netlify Functions, and Netlify deployment.
- Supabase Auth and PostgreSQL are the source of truth for active identity and
  financial data.
- Current registration and login are Ethiopia-oriented and phone-first. The
  international email-and-phone model is a target, not current behavior.
- Protected layouts currently use client session state and redirects. They do
  not implement the previously documented server `beforeLoad` authorization.
- Current admin route visibility checks `profiles.is_admin` for navigation and
  presentation. That client/UI gate is not authoritative. Privileged
  administrator handlers independently require the authenticated,
  active/non-frozen profile and `profiles.is_admin`; authority is not granted
  by client-editable user metadata.
- User- or administrator-initiated privileged handlers authenticate the caller
  before service-role access and bind own-data queries to the Auth-derived user
  ID. Handlers whose eligibility, freeze state, role, or capability depends on
  profile data also resolve and enforce the authoritative profile. Scheduled
  jobs, migration tooling, registration, and provider callbacks have separate
  explicit trust contracts.
- Financial atomicity belongs in restricted PostgreSQL functions, not in
  browser code or a sequence of independent table writes.

## Non-negotiable financial invariants

- Never expose service-role credentials, provider secrets, Fund PIN hashes,
  tokens, private keys, seed phrases, raw provider responses, or internal
  financial evidence to the client or logs. Authenticated users may receive
  only their validated, sanitized financial projections.
- Preserve immutable ledgers, audit events, provider evidence, ownership
  relationships, idempotency, each deployed rail's precision contract, and
  available versus reserved balances. New canonical money uses exact
  fixed-point accounting.
- Preserve the database-authoritative cross-rail withdrawal policy: one
  accepted CBE, TeleBirr, or USDT request per rolling 24 hours; failed
  validation does not consume the allowance; a nonterminal request blocks
  another request even after the window; a later rejection still consumes the
  original window.
- Fund PIN verification remains server-owned and immediately precedes an
  authoritative withdrawal request.
- Admission flags may block new work, but they must not strand settlement,
  reconciliation, rejection, or completion of already admitted financial work.
- NOWPayments deposits credit verified gross `actually_paid`; provider outcome
  remains audit evidence.
- Manual USDT withdrawals remain administrator Complete/Reject operations.
  Do not introduce provider payout, automated signing, or blockchain sending
  without a separately approved architecture.

## Database and migration rules

- Never edit an applied migration.
- Add a forward-only corrective migration for every schema or financial
  behavior change.
- Preserve the production migration runner's path/checksum ledger,
  advisory-lock, CA, production-context, and runner-owned-transaction rules.
- The current ledger-managed range begins at `20260622165000`; earlier
  pre-runner/manual migration files are also immutable even though the runner
  does not record them.
- A migration must be compatible with the application version currently
  published because production migration presently runs before the new build.
- Schema preflight must reject unexpected catalog drift before its first
  mutation. Postflight must prove the complete intended catalog and privilege
  state.
- Supabase migrations belong only in `supabase/migrations`.
  `netlify/database/migrations` is a separate database boundary.
- Do not delete or reinterpret retired crypto tables or historical checkpoint
  evidence.

## Code organization

The current repository is route-heavy and partially flat. Do not deepen that
coupling. New or extracted work should follow the domain ownership and
dependency direction in
[ADR 0001](docs/architecture/decisions/0001-domain-oriented-modules.md).
The exact physical tree remains proposed; its single illustrative definition
is in [Repository standards](docs/engineering/repository-standards.md).

- Routes and transport handlers should become thin adapters as domains are
  extracted.
- Domain modules own use cases, policies, validated DTOs, and presentation
  models.
- Infrastructure modules own Supabase, NOWPayments, and secondary-database
  clients.
- Shared modules may contain genuinely cross-domain primitives; they must not
  become a miscellaneous dumping ground.
- Keep fiat and crypto accounting implementations separate even when they
  share admission policy or UI primitives.
- During mechanical extraction, preserve old import paths with temporary
  re-exports where tests or consumers require them.

## Routing

- Existing URLs must remain compatible throughout reorganization.
- `/security` continues to redirect to `/profile/security`.
- `/deposit`, `/withdraw`, `/admin`, and `/admin-earnings` must not disappear
  when structured domain routes are introduced.
- Approved target routes are documented in
  [Routing and country rails](docs/architecture/routing-and-country-rails.md).
- Route selection should eventually be URL-addressable rather than hidden in
  large component-local tab state.

`src/routeTree.gen.ts` is tracked but currently known to drift from source
routes until the build regenerates it. Do not manually edit it. Any route PR
must regenerate it and verify a clean diff once the deterministic route check
in the roadmap is implemented.

## Generated types

`src/lib/database.types.ts` is currently incomplete and lacks a repository
generation command. Do not treat it as proof that a live field, table, or RPC
does not exist. Until deterministic generation is implemented:

- verify the relevant migration and live/read-only catalog;
- keep generated database types separate from hand-written domain DTOs;
- validate untrusted database and HTTP results at the boundary;
- do not add ad hoc type overlays without documenting the drift.

## Change discipline

- Keep PRs small and single-purpose.
- Inspect the complete diff and stage only intended files.
- Update relevant architecture documentation in the same PR.
- Preserve compatibility before cleanup; remove compatibility layers only
  after their consumers and redirects are proven unused.
- Add tests proportional to risk. Financial changes require native PostgreSQL
  catalog, privilege, concurrency, idempotency, and accounting coverage.
- Generated files are exempt from human complexity limits but not from
  deterministic generation and drift checks.
- Never merge, deploy, toggle a live flag, call a financial endpoint, or mutate
  production data without explicit authorization for that action.

## Historical documents

Root-level `*_CHECKPOINT.md`, design, and runbook files are historical evidence.
They may explain why a control exists, but they do not override current code,
applied migrations, the live catalog, or the architecture documentation.

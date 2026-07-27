# ADR 0001: Domain-oriented modules

Status: Proposed
Date: 2026-07-27

## Context

QHash currently groups much of its application by technical location:
routes, a flat server library, flat Netlify Functions, and several large page
components. Important behavior for deposits, withdrawals, administration, and
authentication is therefore spread across files with broad responsibilities.
The largest route and test files are difficult to review and change safely.

The product direction is confirmed: structured deposit/withdrawal URLs,
country-aware fiat visibility, grouped administration, and a careful
international USDT conversion. A scalable code ownership model is needed
before those behavior changes.

## Decision under consideration

Organize application code primarily by business domain. Keep framework entry
points as thin adapters and expose deliberate public surfaces between domains.

Candidate domains include:

- identity, profiles, and account security;
- accounts and canonical wallet/ledger;
- countries and rail availability;
- fiat rails, including country/provider deposit and withdrawal adapters;
- crypto deposits;
- withdrawals, including shared cross-rail admission and crypto/manual
  orchestration;
- plans;
- earnings;
- referrals;
- notifications;
- support.

Administration composes these capabilities rather than owning duplicate
financial logic.

In this vocabulary, Wallet/Ledger belongs to `accounts`. The visible Deposits
experience composes `fiat-rails` and `crypto-deposits`; it is not a separate
top-level persistence domain. This mapping keeps the candidate names aligned
with the one proposed physical tree in
[Repository standards](../../engineering/repository-standards.md).

The intended dependency direction is:

```text
route or HTTP adapter -> application use case -> domain policy
                                  ^
                                  |
                         infrastructure adapter
```

Cross-domain imports use the owning domain's public surface. Shared modules are
limited to stable primitives with at least two independent consumers.

## Why the status is Proposed

The product requirement for professional, domain-specific organization is
accepted. The exact folder names, layer granularity, public-entry convention,
and automated boundary tool are implementation mechanisms. They must be
validated through incremental extraction before this ADR becomes Accepted.

## Consequences

Positive:

- ownership and change impact become easier to discover;
- routes, handlers, and admin pages become smaller;
- provider-specific code is isolated from product accounting;
- future roles and country rails can reuse domain capabilities;
- boundary checks can prevent new coupling.

Costs and risks:

- transitional re-exports and redirects add temporary indirection;
- moving files can create large diffs without product value;
- premature shared abstractions can make coupling worse;
- generated route-tree changes can obscure mechanical reviews;
- a broad move can hide behavior changes.

## Guardrails

- Extract one bounded domain at a time.
- Add characterization tests before moving behavior.
- Preserve public contracts with explicit compatibility layers.
- Keep mechanical and behavior changes in separate PRs.
- Start import and complexity checks in report-only mode.
- Never move applied migrations.
- Do not move tables between Supabase and Netlify Database as a file cleanup.

## Alternatives considered

### Continue grouping only by technical type

Rejected as the target because a growing feature requires coordinated changes
across many flat directories and encourages large route/server files.

### One repository-wide clean rewrite

Rejected because it is difficult to compare with deployed financial behavior
and unsafe to roll out incrementally.

### Microservices now

Rejected. Service boundaries would add operational complexity before in-process
domain ownership is understood. This ADR concerns module boundaries, not
deployment topology.

## Acceptance criteria

Promote this ADR to Accepted only after at least one representative financial
domain is extracted with:

- no observable behavior change;
- tested compatibility imports/routes;
- thin route and HTTP adapters;
- clean client/server boundaries;
- reproducible generated artifacts;
- focused and canonical validation.

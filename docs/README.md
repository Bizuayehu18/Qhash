# QHash documentation

Status: authoritative navigation
Scope: current architecture, approved target, engineering rules, and historical evidence

QHash documentation separates deployed facts from approved future direction.
Every document must state which category it belongs to.

## Source-of-truth order

For **currently deployed facts**, use this order:

1. Verified live catalog/data invariants and known applied production history
2. Exact deployed application source
3. Current-state architecture documentation

For **future product and architecture direction**, use this order:

1. Confirmed owner decisions and approved product requirements
2. Accepted architecture decision records
3. Approved target architecture
4. Proposed engineering standards and roadmaps

Historical checkpoint and design files provide evidence but do not override
either hierarchy. If an accepted ADR conflicts with a later confirmed product
decision, record a superseding ADR instead of silently reinterpreting either.

This order does not authorize production inspection or mutation. Use only the
access and actions explicitly allowed for the task.

## Current system

- [Current architecture](architecture/current-state.md)
- [Domain boundaries](architecture/domain-boundaries.md)
- [Data, security, and deployment](architecture/data-security-and-deployment.md)
- [NOWPayments late-deposit recovery](nowpayments-late-deposit-recovery.md)

## Approved target

- [Target architecture](architecture/target-state.md)
- [Routing and country rails](architecture/routing-and-country-rails.md)
- [International USDT requirements](product/international-usdt-requirements.md)
- [Reorganization roadmap](architecture/reorganization-roadmap.md)

## Architecture decisions

- [Decision index](architecture/decisions/README.md)
- [ADR 0001: Domain-oriented modules](architecture/decisions/0001-domain-oriented-modules.md)
- [ADR 0002: Canonical USDT ledger](architecture/decisions/0002-canonical-usdt-ledger.md)
- [ADR 0003: Forward-only database evolution](architecture/decisions/0003-forward-only-database-evolution.md)

## Engineering

- [Repository standards](engineering/repository-standards.md)
- [Change policy](engineering/change-policy.md)

## Historical evidence

- [Historical documentation policy](archive/README.md)

## Documentation maintenance

- Current-state docs change when deployed architecture changes.
- Target docs change when an approved product or architecture decision changes.
- Accepted ADRs are not rewritten to hide a superseded decision. Add a new ADR
  and link both.
- Applied migration paths and checksums are immutable.
- A PR that changes architecture, security, financial behavior, routes, or
  domain ownership must update the relevant documentation.
- Never include credentials, secret values, Fund PIN data, unmasked sensitive
  identifiers, or private production evidence.

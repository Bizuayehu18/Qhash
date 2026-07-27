# Architecture decision records

Architecture decision records (ADRs) capture durable choices and their
consequences. They do not replace implementation plans, product requirements,
or operational runbooks.

## Status meanings

- **Proposed** — under review; do not treat the specific mechanism as
  implemented or mandatory.
- **Accepted** — approved direction; implementation may still be phased.
- **Superseded** — replaced by a later ADR, which must be linked.
- **Deprecated** — retained for history but should not guide new work.

Confirmed product decisions are recorded as Accepted. Directory layouts,
pipeline mechanics, and other implementation details remain Proposed until
explicitly adopted and proven in the repository.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-domain-oriented-modules.md) | Domain-oriented modules | Proposed |
| [0002](0002-canonical-usdt-ledger.md) | Canonical USDT ledger | Accepted |
| [0003](0003-forward-only-database-evolution.md) | Forward-only database evolution | Accepted |

## Creating an ADR

1. Copy the structure of an existing ADR.
2. Use the next four-digit number; never renumber accepted ADRs.
3. State current facts separately from the decision.
4. Include alternatives and consequences.
5. Link affected product, engineering, and operational documents.
6. Update this index in the same PR.

Changing an accepted decision requires a new ADR that explicitly supersedes
the old one. Do not rewrite historical rationale to make it appear that the
new decision always existed.

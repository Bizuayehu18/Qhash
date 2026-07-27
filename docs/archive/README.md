# Historical documentation policy

Status: current policy
Scope: root-level checkpoint, design, audit, and runbook files

QHash has accumulated root-level checkpoint and design documents from earlier
implementation phases. They are valuable evidence, but their names and content
do not consistently describe the current system.

## Rules

- Treat these files as immutable historical evidence unless a dedicated
  archival PR proves that a move preserves links and history.
- Do not use a historical file as the sole authority for current behavior.
- Reconcile historical claims against exact deployed source, applied
  migrations, and read-only production evidence.
- If a historical document contains a still-active operational procedure,
  create or update a current runbook under `docs/` and link the historical
  source.
- Do not delete financial, security, migration, or production-verification
  evidence merely to make the repository cleaner.

## Planned organization

A later mechanical PR may move root documents into dated, indexed folders such
as:

```text
docs/archive/
  checkpoints/
  designs/
  audits/
  runbooks-superseded/
```

That move is intentionally outside the architecture-foundation scope. It must
preserve Git history, repair links, and make no runtime or financial change.

# Change policy

Status: Proposed engineering standard

## Goal

This policy keeps QHash deployable while the repository is reorganized and the
product moves to international, USDT-denominated accounting. It favors small,
reviewable, forward-compatible changes over repository-wide rewrites.

## Change classes

Label each PR by its primary class:

| Class | Typical scope |
|---|---|
| Documentation | architecture, ADR, product requirement, or runbook only |
| Mechanical reorganization | moves, renames, re-exports, redirects; no behavior change |
| Behavior | user-visible or server behavior without schema evolution |
| Database | forward migration and its generated/type/test consequences |
| Security | authentication, authorization, secrets, protected functions, or policies |
| Financial | balances, ledgers, fees, plans, earnings, referrals, deposits, or withdrawals |
| Operations | deployment, migration runner, monitoring, or recovery |

If a PR spans several high-risk classes, split it unless atomicity is essential
and explained.

## Required PR record

Every PR should state:

- exact base and head revisions;
- intended behavior and explicit non-goals;
- complete file scope;
- affected domains and trust boundaries;
- compatibility behavior and removal plan;
- tests and generation checks run;
- schema or migration checksum when applicable;
- rollout, feature flag, and recovery plan;
- documentation updated;
- production actions explicitly not performed.

Documentation is part of the change, not a follow-up promise.

## Reorganization rule

A mechanical reorganization PR must preserve observable behavior. It may add:

- domain directories;
- thin route/adapter wrappers;
- compatibility re-exports;
- old-to-new URL redirects;
- characterization tests;
- import-boundary reporting;
- current-state documentation.

It must not silently change:

- authentication or authorization;
- account eligibility;
- financial calculations or precision;
- lock ordering or idempotency;
- response bodies/statuses;
- database schema or data;
- provider behavior;
- feature flags;
- admin workflow.

If a necessary behavior fix is discovered, record it and make it a separate
reviewed PR.

## Database evolution

### Forward only

Never edit, rename, move, or delete an applied migration. For the
runner-managed range, the relative path and checksum in
`public._qhash_migrations` are immutable evidence. Earlier pre-runner/manual
migrations are also immutable historical evidence even though the current
runner does not record them. Corrections use a new, later migration.

Before changing a pending migration, verify it has not executed in any deployed
environment in scope. Once any environment executes it, treat it as applied
regardless of whether that environment uses the current ledger.

### Transaction ownership

The migration runner owns the transaction boundary. Migration files must not
add incompatible transaction-control statements unless the runner contract is
deliberately changed and verified first.

### Fail-closed preflight

High-risk migrations should verify the exact inherited catalog and required
row fingerprints before the first mutation, then verify the intended catalog
afterward. Checks must be semantic and deterministic across supported
PostgreSQL versions and collations. Catalog checks are not a substitute for
behavior, concurrency, and security tests.

### Migration-before-build risk

The current Netlify production command is:

```text
npm run db:migrate && npm run build
```

Therefore a migration may commit even if the subsequent application build or
publication fails. A database PR must assume that the old published
application can continue running against the new schema.

Until the pipeline is redesigned, database changes must:

- be backward compatible with the currently published application;
- add before removing and default risky capabilities to disabled;
- avoid requiring the new client immediately after migration;
- preserve old function signatures through a transition when needed;
- define a forward corrective migration, not a rollback edit;
- pass the application build before merge in an isolated checkout; and
- separate destructive cutovers from ordinary deployments.

Changing deployment sequencing is a future operational decision and requires
its own ADR and recovery design.

## Two database systems

QHash currently has two migration roots:

- `supabase/migrations` for Supabase auth and primary application/financial
  data;
- `netlify/database/migrations` for the separate Netlify Database used through
  Drizzle.

They are quarantined boundaries:

- never copy migrations between them;
- never assume they share a transaction, role, backup, or deployment lifecycle;
- name the owning database in code and documentation;
- do not create cross-database financial invariants;
- new financial state belongs in Supabase unless an accepted ADR says
  otherwise;
- expansion of Netlify Database beyond its documented owner requires an ADR.

Consolidation or retirement is a future decision. A file reorganization must
not disguise it as a move.

## Financial and security changes

A financial or security PR requires:

- tests for success, rejection, idempotent replay, concurrency, and malformed
  input;
- exact precision and rounding cases;
- authorization and unexpected-privilege negative controls;
- evidence that failure occurs before mutation;
- before/after balance and ledger chains;
- sanitized logs and responses;
- no client access to service-role operations;
- explicit feature-flag state and rollout scope.

Production writes, endpoint calls, provider calls, merges, migrations, and
enablement are separate authorizations. One does not imply another.

## Compatibility policy

### Imports

When moving a public module:

1. create the target module;
2. keep a small re-export at the old path;
3. migrate consumers in bounded batches;
4. prevent new imports from the old path;
5. remove the bridge only when repository and external-consumer checks are
   clean.

### Routes

When changing a visible URL:

1. add the new structured route;
2. retain the old route as a redirect or compatibility entry;
3. preserve required query parameters safely;
4. update navigation and canonical links;
5. test authenticated, unauthenticated, and unavailable-rail outcomes;
6. document the redirect removal condition.

Redirects must not bypass authorization or expose a country/rail unavailable
to the authenticated user.

### API and database contracts

Additive transitions are preferred. Retired protected functions must have all
client and service execution removed as intended, and their replacement must
be independently verified before callers move.

## Generated artifacts

A PR that changes route inputs or schema inputs must run the corresponding
generation drift check. Generated output is committed only when the repository
contract requires it.

Generated artifacts:

- are not manually edited;
- are reviewed by their input change, not by cosmetic generated noise;
- have a documented pinned command;
- are restored if a build unexpectedly rewrites them outside the PR scope.

## Validation policy

Use the smallest relevant focused suite during iteration, followed by the
supported aggregate suite before handoff. Report:

- passed, failed, and skipped counts;
- why any skip is legitimate;
- PostgreSQL version and whether native connections were distinct when
  concurrency is claimed;
- build warnings separately from failures;
- deviations from the documented command.

Do not turn initial complexity baselines into blockers. The first automation
should report existing debt and block only new boundary violations or
unexplained regressions.

## Production and release policy

Before a production merge or deployment:

1. pin the reviewed head and expected base;
2. verify the full diff and migration checksums;
3. require successful checks with no pending or requested-change state;
4. record live feature flags and financial baselines read-only;
5. deploy the exact merge commit;
6. verify migration ledger and published commit;
7. perform proportional postflight checks;
8. leave risky capabilities disabled until separately accepted.

Acceptance tests use the smallest possible mutation and a predefined recovery
path. They must not infer permission to make unrelated payments, provider
requests, SQL changes, or data corrections.

## Documentation matrix

| Change | Required documentation |
|---|---|
| Domain ownership or imports | repository standards, domain map, ADR if a new rule |
| User-visible route | route map and compatibility redirect |
| Product rule | product requirements and relevant ADR |
| Schema/financial ownership | data architecture, migration note, ADR |
| Authentication/authorization | security architecture and recovery behavior |
| Deployment/migration runner | operations runbook and ADR |
| New provider/country rail | provider/country registry and operational runbook |

## Exemptions

An exemption must be narrow, documented in the PR, and time-bound where
possible. “Existing code does this” is context, not a permanent exemption.

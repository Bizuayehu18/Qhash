# ADR 0003: Forward-only database evolution

Status: Accepted
Date: 2026-07-27

## Context

QHash production deployments apply the runner-managed migration range through
`scripts/apply-migrations.mjs` and record relative paths, checksums, deployment
context, and commit references in `public._qhash_migrations`. That automated
range currently begins at `20260622165000`. Earlier SQL files are
pre-runner/manual history and are not represented in the current ledger.
Financial migrations also use catalog preflight/postflight checks to detect
unexpected live drift.

The repository has two distinct migration systems:

- Supabase migrations under `supabase/migrations`;
- Netlify Database migrations under `netlify/database/migrations`.

The current Netlify build command runs database migration before application
build. A committed migration can therefore be live even if the new application
fails to build or publish.

## Decision

Database evolution is forward only.

1. An applied migration's path and bytes are immutable.
2. Never edit, rename, move, reorder, or delete an applied migration.
3. Correct defects with a new later migration.
4. The runner owns transaction boundaries.
5. High-risk changes fail closed before mutation when the inherited catalog
   differs from the reviewed baseline.
6. Migrations must be backward compatible with the currently published
   application because migration precedes build/publication.
7. Supabase and Netlify Database remain explicitly separate and quarantined.
8. Financial authority remains in Supabase unless a future accepted ADR
   changes it.

## Applied versus pending

A migration is considered applied if it has executed in any in-scope
environment, whether it belongs to the older manual history or the newer
ledger-managed range. A pending migration may be corrected only after
verifying it is absent from every environment in scope.

Checksums are evidence, not a convenience to update after editing. A checksum
mismatch stops deployment and is resolved by restoring the original bytes or
adding a forward corrective migration.

The current collection of migration files is not yet proven to bootstrap a
new Supabase environment from zero. Establishing an explicit baseline or
clean-room replay contract requires separate review and must not rewrite the
historical files.

## Migration design

New migrations should:

- be safe under the runner-owned transaction;
- use deterministic comparisons independent of locale and generated names;
- validate inherited owner, security mode, search path, ACL/grant-option state,
  RLS, policies, constraints, triggers, indexes, and relevant rows in proportion
  to risk;
- test that drift rejection occurs before the first mutation;
- use semantic catalog relationships rather than expected OIDs;
- preserve old callers during the deployment window;
- default new financial capabilities to disabled;
- include an independently reviewed postflight;
- state the forward recovery path.

Catalog fingerprints supplement rather than replace behavioral, security,
precision, idempotency, and concurrency tests.

## Migration-before-build consequence

Every schema change must tolerate this state:

```text
new database schema + previously published application
```

Accordingly:

- add before removing;
- do not make new columns immediately mandatory for old code without a safe
  default/backfill;
- retain old function contracts until all callers are deployed;
- do not couple publication success to a required destructive cleanup;
- build and test the exact commit before merge;
- recover with another forward migration if publication fails after migration.

A future pipeline may separate schema promotion from application deployment,
but that mechanism requires a new operational ADR.

## Dual database quarantine

The two migration roots must never be treated as interchangeable folders.

Supabase:

- owns authentication-linked profiles and primary financial/product data;
- uses the custom migration ledger and production catalog checks.

Netlify Database:

- is a separate database and deployment lifecycle;
- currently supports the documented Drizzle boundary;
- must not gain canonical balances or cross-rail financial invariants without
  an accepted ADR.

Code, docs, and migrations must name which database owns a record. There is no
cross-database transaction. Moving a TypeScript file does not move data
ownership.

## Consequences

Positive:

- production history is reproducible and auditable;
- drift fails closed;
- recovery does not rewrite evidence;
- application and schema compatibility is considered explicitly;
- accidental mixing of the two databases is less likely.

Costs:

- corrective migrations accumulate;
- migrations need more preflight and test work;
- removing obsolete surfaces requires staged compatibility;
- a failed publication may leave an additive migration live.

## Alternatives considered

### Edit an applied migration and update its checksum

Rejected because it destroys the relationship between deployed history and
reviewed source.

### Roll back by running destructive reverse SQL

Rejected as the default. Financial recovery is forward and evidence-preserving.
A separately reviewed emergency operation may be necessary, but it is not a
normal migration strategy.

### Merge both migration roots

Rejected because they target separate databases and runtimes. Consolidation
requires a data migration and an accepted architecture decision, not a folder
move.

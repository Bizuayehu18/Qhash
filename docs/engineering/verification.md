# Verification and generated artifacts

Status: Active engineering contract

## Purpose

This document defines the reproducible Phase 1 baseline that must remain green
before broad file reorganization or international-USDT behavior work begins.
These checks validate source and isolated fixtures. They do not authorize or
perform production database, endpoint, provider, deployment, or financial
actions.

## Pinned toolchain and clean install

QHash uses exactly:

- Node `22.23.1`;
- npm `11.9.0`; and
- the committed `package-lock.json` lockfile version 3 graph.

The versions are declared consistently in `.nvmrc`, `.node-version`,
`package.json`, `netlify.toml`, and the GitHub Actions workflow. Install from a
clean checkout with:

```bash
npm ci --include=dev --no-audit --no-fund
```

Do not repair a failed clean install with an uncommitted `npm install`.
Regenerate the lockfile only as a deliberate dependency change using the
pinned toolchain.

## Supported commands

| Command | Contract |
|---|---|
| `npm run verify` | Clean-install-independent aggregate: toolchain and lock checks, portable and handler tests, both TypeScript scopes, generated/provenance checks, architecture checks, and production build |
| `npm run test:portable` | Explicit manifest of every `tests/*.test.mjs` file with live-database access removed, including route-compatibility characterization; native-only sections may skip |
| `npm run test:handlers` | Focused Netlify handler authentication, validation, and response-contract tests |
| `npm run typecheck` | Complete application TypeScript scope |
| `npm run typecheck:netlify` | Every supported JavaScript/TypeScript source under `netlify/functions`, including nested entries and support modules |
| `npm run check:routes-generated` | Regenerates the TanStack route tree into a temporary sibling and compares exact bytes |
| `npm run check:database-types` | Verifies the committed live-schema snapshot, compatibility debt, and exact Supabase migration inventory against the recorded provenance baseline |
| `npm run check:ownership` | Requires one accountable domain for every covered source, Netlify, Supabase, migration, test, documentation, governance, and quarantined database artifact |
| `npm run check:boundaries` | Blocks new client/server leaks, reverse route dependencies, uncovered Function entrypoints, and growth in recorded server bridges |
| `npm run check:complexity` | Reports existing size debt and blocks new or increased warnings |
| `npm run check:docs` | Verifies required documents, relative links, code fences, ADR status, and ADR index coverage |
| `npm run verify:native` | Runs the PostgreSQL-specific manifest against an explicitly local disposable database |

The test manifest deliberately excludes `scripts/test-referral-chain.mts`.
That file is a destructive live diagnostic helper, not a repository
verification test.

`tests/deposit-route-compatibility.test.mjs` freezes the deposit composition
contract: `/deposit` remains a thin hub through the shared deposits facade,
`/deposit/crypto/usdt/bep20` is a non-nested child of the protected application
layout, Back returns to the hub, and shared composition consumes rail public
surfaces without server-only or sensitive URL state. It also pins the canonical
crypto domain UI paths, both temporary legacy crypto import bridges, and the
intentional absence of fiat country/provider routes until authorization exists.

`tests/fiat-deposit-ui.test.mjs` freezes the behavior-preserving Ethiopia fiat
UI extraction: CBE and TeleBirr retain their exact reference-prefix contracts,
provider copy, ordering, server-function boundaries, validation, submission,
and history behavior while remaining client-safe and independent of crypto
navigation.

The complexity check covers extracted domain layers as well as legacy
technical folders. Domain UI TSX files and hooks retain the 300-line warning;
other domain, application, infrastructure, server, and UI modules use the
400-line warning unless a more specific rule applies.

`tests/withdrawal-route-compatibility.test.mjs` freezes the matching withdrawal
route contract: `/withdraw` remains a thin CBE, TeleBirr, and USDT hub,
`/withdraw/crypto/usdt/bep20` is a non-nested child of the protected
application layout, Back returns to the hub, and the thin route/client facade
contain no server-only or sensitive URL state. It also pins the canonical
domain component, focused view composition, and temporary legacy component
bridge. Source-characterization tests aggregate the extracted controller,
view, form, and history so the established Fund PIN, auth isolation,
idempotency, rolling 24-hour cross-rail policy, fixed-point calculations, and
accounting boundary remain unchanged.

`tests/fiat-withdrawal-ui.test.mjs` freezes the behavior-preserving Ethiopia
fiat-withdrawal extraction: CBE and TeleBirr retain their exact labels, field
order, account validation, 200 ETB minimum, 5% fee, four-digit Fund PIN,
server-owned submission and history boundaries, wallet/security refresh, and
shared cross-rail policy. It also requires the domain public facade and
application bridge to remain client-safe and independent of crypto navigation.
The same suite deterministically rejects late history, security, and submission
effects after a user or access-token generation changes.

`tests/wallet-auth-isolation.test.mjs` pins the shared wallet cache to one active
authenticated user. It rejects fresh-cache reuse across users, stale in-flight
commits and finalizers, unscoped balance writes, and consumer rendering of a
balance owned by another session. It also binds the complete dashboard snapshot
and its retry lifecycle to the exact user and access-token generation so a late
response cannot populate a replacement session.

## Native PostgreSQL safety

Native tests require `TEST_DATABASE_URL`. The runner refuses the URL unless:

- the host is `localhost`, `127.0.0.1`, or `::1`; and
- the database name begins with `qhash_test_`; and
- the server is PostgreSQL `17.10` with UTF-8 encoding and the deterministic
  libc `C` collation for both `LC_COLLATE` and `LC_CTYPE`.

Example:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/qhash_test_local \
  npm run verify:native
```

Concurrency fixtures use separate connections where the invariant requires
real cross-connection behavior. The runner serializes native test files so
their schema setup cannot collide; concurrency inside each file remains real.
Production Supabase is never a test fixture.

The exact CI image is digest-pinned and initialized with
`--encoding=UTF8 --locale=C`. This binary ordering is required because some
already-applied historical migration preflights contain text aggregates whose
ordering predates the repository rule that all new catalog fingerprints must
use explicit UTF-8 byte ordering. Applied migration files and checksums remain
immutable; the deterministic disposable fixture makes historical replay
stable without rewriting migration history.

## TanStack route tree

`src/routeTree.gen.ts` is generated from `src/routes` with the pinned
`@tanstack/router-generator`. The standalone generator configuration appends
the same TanStack Start module-augmentation footer as the production Vite
plugin, so both paths produce identical bytes:

```bash
npm run generate:routes
npm run check:routes-generated
```

The file is committed because the application imports it. It must never be
edited by hand. A build that silently changes it indicates repository drift.

## Supabase database types and provenance

Two files have different Phase 1 responsibilities:

- `src/lib/database.generated.ts` is the exact read-only type snapshot
  generated from live Supabase project `wsgxmvmkibliccsktiqj` on
  2026-07-27; and
- `src/lib/database.types.ts` is the existing application compatibility
  surface and remains in use until a separately reviewed typed-client
  migration.

`scripts/database-types-baseline.json` records:

- the generated snapshot hash and public table/function inventory;
- the compatibility snapshot hash and known missing table/function types; and
- every legacy `supabase/migrations/*.sql` and directory-based
  `supabase/migrations/*/migration.sql` path and checksum.

The default CI check is intentionally offline. It proves that neither the
schema snapshot, compatibility surface, nor migration history changed without
an explicit baseline update. It does not claim to query production on every
build.

When a reviewed schema change is made:

1. apply it only to the authorized environment through the normal migration
   workflow;
2. regenerate `src/lib/database.generated.ts` from the intended Supabase
   schema using official Supabase type generation or the read-only connector;
3. review the generated diff and compatibility impact;
4. run `npm run update:database-types-baseline`;
5. run `npm run check:database-types`; and
6. document the source environment and migration checksum in the PR.

Do not replace `database.types.ts` wholesale during an unrelated schema PR.
Its recorded gaps are migration debt, not permission for untyped casts.

## Architecture baselines

`docs/architecture/domain-ownership.json` is the machine-readable
cross-system ownership contract. Discovery lives in the checker, so editing the
registry cannot narrow coverage. Git supplies the exact tracked/unignored file
inventory; files form one disjoint ownership partition, and ignored local
state is excluded. The check composes with database provenance:
`check:database-types` proves exact migration paths and checksums, while
`check:ownership` proves that every immutable path and generated Supabase object
has exactly one accountable domain. Eleven live internal Supabase functions
and nine incomplete-provenance resources are separately pinned from the
2026-07-28 read-only catalog audit. The check also validates authored Netlify
Function paths, methods or schedules, source-backed trust classifications,
direct support imports, handler coverage or named waivers, and the quarantined
Netlify Database inventory.

The boundary and complexity checks start from observed legacy debt:

- 27 existing TanStack server-bridge imports; and
- 35 current file-size warnings.

Those findings are report-only at their recorded values. New boundary leaks,
new warning files, or growth in an existing warning fail verification. This
lets QHash reorganize incrementally without pretending the current flat
repository is already the target architecture.

## CI

`.github/workflows/verify.yml` runs:

- the portable aggregate on current Ubuntu and Windows runners with the exact
  Node/npm versions; and
- native database tests against the digest-pinned PostgreSQL `17.10`,
  UTF-8/libc-`C` service verified by the test runner before schema setup.

CI also verifies that validation did not rewrite dependency or generated
artifacts.

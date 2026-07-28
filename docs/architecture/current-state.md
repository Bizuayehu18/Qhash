# QHash current-state architecture

**Status:** Observed baseline
**Scope:** Runtime baseline at repository revision `ebca234bd7bb40fbddcfce29e13bd6612f2f9aae`, plus the Phase 1 engineering controls and first Phase 2 compatibility scaffold documented below
**Purpose:** Record what exists before the repository reorganization and international USDT conversion. This document is descriptive unless a section is explicitly labelled **Target recommendation**.

See also:

- [Domain boundaries](./domain-boundaries.md)
- [Data, security, and deployment](./data-security-and-deployment.md)
- [Approved target architecture](./target-state.md)

## System summary

QHash is a TanStack Start and React application deployed on Netlify. It currently uses:

- TanStack Router file routes under `src/routes`;
- TanStack server functions under `src/lib/server`;
- dedicated Netlify Functions under `netlify/functions`;
- Supabase Auth and Supabase Postgres for identity and the active product and financial data;
- a separate Netlify Database/Drizzle integration whose only application source consumer found in this revision is the legacy support-ticket module;
- Zustand for browser authentication and UI state.

The production financial architecture is not one unified wallet. It has a legacy ETB model and a separate NOWPayments USDT-BEP20 model. The international conversion must therefore be a controlled financial migration, not a display-label replacement.

## Runtime topology

```text
Browser
  |
  +-- TanStack routes and React components
  |     |
  |     +-- Supabase browser client (anon key, Auth session, RLS reads)
  |     |
  |     +-- TanStack server functions
  |             |
  |             +-- Supabase service-role client
  |             +-- Netlify Database/Drizzle (legacy support tickets only)
  |
  +-- Netlify Functions
          |
          +-- Supabase Auth validation and profile authorization
          +-- protected Supabase RPCs for critical financial transitions
          +-- NOWPayments API/IPN at the provider boundary

Netlify production build
  |
  +-- Supabase migration runner
  +-- application build
```

The browser's protected layout is a usability guard, not a security boundary. Sensitive server paths independently validate the bearer token and, where applicable, `profiles.is_admin` and `profiles.is_frozen`.

## Repository shape

The repository is organized mainly by technical layer, with several business domains mixed inside large route and server files.

| Area | Current role | Observed concentration |
|---|---|---|
| `src/routes` | TanStack route entry points and substantial page logic | Phase 1 records 13 route files over the 150-nonblank-line warning, including `admin.tsx`, `withdraw.tsx`, and `deposit.tsx` |
| `src/components` | Shared UI plus a few extracted crypto flows | Phase 1 records three NOWPayments components over the 300-nonblank-line warning |
| `src/lib/server` | TanStack server functions for many domains in one flat folder | Large deposit, verification, withdrawal, earning, security, and admin modules |
| `netlify/functions` | provider-facing, scheduled, verification, and admin Functions | NOWPayments handlers are partly decomposed through `netlify/functions/lib` |
| `supabase/migrations` | forward-only Supabase schema history | authoritative production schema history; large applied files are immutable |
| `netlify/database/migrations` | Netlify Database migration history | a different database; it is not the Supabase financial migration source |
| `tests` | portable source tests and native PostgreSQL fixtures | several files exceed 1,500 lines; critical financial behavior has strong regression coverage |

The exact report-only file measurements are machine recorded in
`scripts/engineering-baseline.json`; they are orientation measurements, not
permanent limits.

### Route concentration

Most current user URLs remain broad pages such as `/deposit`, `/withdraw`, and
`/admin`. The first Phase 2 compatibility slice adds the canonical
`/deposit/crypto/usdt/bep20` route while preserving `/deposit` as the hub.
Fiat deposit, withdrawal, and administrator subflows are still selected inside
their broad pages.

The canonical crypto route is a non-nested TanStack route beneath the protected
`_app` layout. It imports the client-safe
`src/domains/crypto-deposits/public.ts` facade, which temporarily re-exports the
existing implementation. No provider, database, accounting, or authorization
logic moved in this slice.

`src/components/layout/AppLayout.tsx` also hard-codes the navigation and route labels. The admin experience is a single large route rather than grouped Users, Deposits, Withdrawals, Plans, and Settings sections.

### Generated route tree

`src/routeTree.gen.ts` is generated and must not be hand-edited. Phase 1
regenerated the previously stale artifact from the route filesystem and added
an exact temporary-output comparison. The production build now fails its
prebuild check if the committed route tree is stale. Generated artifacts are
excluded from ordinary complexity warnings but not from reproducibility
checks.

### Type coverage

`src/lib/database.types.ts` remains the application-facing compatibility
surface. Phase 1 also commits `src/lib/database.generated.ts`, the exact
authorized read-only live Supabase type snapshot captured on 2026-07-27.
Offline provenance checks pin both files, all migration paths/checksums, and
the known compatibility gap: three tables and seven functions exist in the
live snapshot but not yet in the compatibility surface.

The dependency and TypeScript baselines are now deterministic:

- Node `22.23.1` and npm `11.9.0` are pinned across local, CI, and Netlify
  declarations;
- the repaired lockfile supports a clean
  `npm ci --include=dev --no-audit --no-fund`;
- complete application TypeScript passes; and
- `tsconfig.netlify.json` covers every `netlify/functions/**/*.mts` file
  instead of a manual allowlist.

The compatibility type debt is deliberately frozen for later migration. Phase
1 does not replace application types wholesale.

## Current identity model

The current registration and login model is Ethiopia-specific:

- registration asks for `username`, Ethiopian phone, and password; an optional
  referring username arrives through the `?ref=` registration link rather than
  a fourth visible form field;
- phone input is normalized to Ethiopian E.164 form;
- the server derives a synthetic `<digits>@qhash.app` address for Supabase Auth;
- the synthetic address is created as already confirmed;
- `profiles` stores `username`, `phone`, `referred_by`, `is_admin`, and `is_frozen`;
- referral lookup and visible identity depend on username;
- administrator authority comes from `profiles.is_admin`, not Auth user metadata.

This is the observed model only. It is not the approved international target.

**Target recommendation:** replace public usernames with an immutable non-PII account code and a separate random referral code. Add real email, phone-derived immutable country, and email-or-phone login through a staged, backward-compatible identity migration.

## Current money and product model

### Legacy ETB rail

The general `wallets`, `transactions`, `plans`, `investments`, `deposits`, `withdrawals`, and referral/earning tables represent the original ETB product. CBE and TeleBirr use this rail. Much of the legacy TypeScript surface represents money as JavaScript `number`, so it cannot become the canonical USDT accounting boundary merely by changing labels.

### NOWPayments USDT-BEP20 rail

The crypto rail uses dedicated `nowpayments_usdt_*` tables and protected functions for:

- deposit configuration, sessions, provider-payment evidence, wallets, and ledger entries;
- permanent-address activation and repeated payments;
- gross deposit crediting;
- withdrawal reservation, administrator completion/rejection, events, and optional administrator-only broadcast data.

Critical database functions provide the atomic financial boundary. Netlify Functions authenticate, validate, and call those functions rather than reproducing balance transitions in the UI.

### Shared controls

At the pinned revision:

- fiat and USDT withdrawals share a rolling 24-hour accepted-request policy and a single-nonterminal-request rule;
- invalid attempts do not consume the cooldown;
- `app_settings.withdrawals_paused` currently gates fiat admission, while
  `nowpayments_usdt_config.withdrawals_enabled` independently gates USDT
  admission; the approved shared global withdrawal pause is target behavior,
  not live behavior at this revision;
- Fund PIN is four numeric digits and is verified through a server-owned boundary;
- global deposit pause and the NOWPayments rail flag jointly govern crypto address disclosure and provisioning;
- settlement of already admitted provider payments remains operational during a deposit pause.

## Active and quarantined paths

| Path | Classification | Rule |
|---|---|---|
| Supabase financial tables and protected RPCs | Active and authoritative | Preserve invariants and migrate only through forward migrations |
| NOWPayments Functions and libraries | Active provider boundary | Keep secrets and provider payloads server-only |
| `app_settings` Telegram support setting | Active | Stored in Supabase; service-role mutation only |
| `src/lib/server/support.ts` plus Drizzle `support_tickets` | Dormant/quarantined | The visible support experience uses Telegram; do not treat caller-supplied `userId` in this dormant module as an approved authorization pattern |
| Non-support tables mirrored in `db/schema.ts` | Stale/ambiguous | Do not use as the financial schema source without a separate consolidation decision |
| retired native-crypto tables and retired functions | Historical/audit-only | Preserve evidence and revoked access; do not reactivate |
| applied migration files | Historical executable record | Never edit, rename, split, or delete |

## Current architectural risks

1. Broad pages and flat server folders mix presentation, orchestration, authorization, provider integration, and data mapping.
2. The legacy ETB and provider-named USDT accounting models are not a provider-neutral international ledger.
3. Authentication, public identity, country, and referral identity are coupled to username and Ethiopian phone assumptions.
4. Two database systems exist, while their ownership boundary is not prominent in the main documentation.
5. Twenty-seven existing route/component-to-server bridge imports remain as
   frozen legacy coupling; Phase 1 blocks growth but does not misclassify them
   as a completed domain architecture.
6. Thirty-eight existing file-size warnings identify decomposition debt; they
   remain report-only at or below the recorded baseline.
7. The compatibility Supabase type surface lacks three live tables and seven
   live functions, although the authoritative generated snapshot and
   migration provenance are now pinned.
8. The production command migrates before it builds, creating a strict compatibility requirement between old application code, new schema, and the new application build.

## Non-negotiable rule for the reorganization

The file reorganization must be behavior-preserving. Moving code is not authorization to redesign accounting, rewrite an applied migration, replace an RPC with client writes, expose secrets, alter fees, change financial statuses, reset production data, or bypass existing cross-rail policies.

The international USDT conversion is a later staged migration with its own archival, reconciliation, test-data reset, and rollback evidence. It must not be hidden inside mechanical file moves.

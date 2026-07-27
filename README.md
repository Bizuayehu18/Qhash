# QHash

QHash is a cloud-mining fintech application with plans, earnings, referrals,
deposits, withdrawals, administrative operations, authoritative financial
state, and immutable ledger/audit evidence.

The deployed application is currently an Ethiopia-oriented ETB platform with
USDT-BEP20 deposit and manual withdrawal rails. The approved target is an
international, USDT-denominated platform. That target is documented but is not
yet deployed.

## Start here

- [Documentation index](docs/README.md)
- [Current architecture](docs/architecture/current-state.md)
- [Approved target architecture](docs/architecture/target-state.md)
- [International USDT requirements](docs/product/international-usdt-requirements.md)
- [Repository standards](docs/engineering/repository-standards.md)
- [Reorganization roadmap](docs/architecture/reorganization-roadmap.md)

Historical checkpoint files at the repository root are evidence from earlier
work. They are not the current architecture specification. See
[Historical documentation](docs/archive/README.md).

## Technology

| Layer | Current implementation |
|---|---|
| Application | TanStack Start, React 19, TanStack Router |
| Build and styling | Vite 7, Tailwind CSS 4 |
| Authentication and primary data | Supabase Auth and PostgreSQL |
| Provider/API adapters | TanStack server functions and Netlify Functions |
| Client state | Zustand |
| Deployment | Netlify |
| Secondary data boundary | Netlify Database with Drizzle, currently quarantined pending a support-domain decision |

Supabase is the source of truth for current identity and financial data.
Financial mutations are server-owned and, where atomicity matters, implemented
as restricted PostgreSQL functions. NOWPayments secrets and service-role
credentials must never enter the browser bundle.

## Local development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and provide only the values needed for
   the local task. Never commit local environment files or secret values.

3. Start the application:

   ```bash
   npm run dev
   ```

4. Run the checks currently exposed by the repository:

   ```bash
   npm run typecheck:netlify
   npm run build
   ```

The current script surface is incomplete. The architecture roadmap defines
the required route-generation, application-typecheck, portable-test, native
PostgreSQL-test, and documentation checks that must be added before large
mechanical reorganization. A reproducible clean `npm ci` baseline is not yet
established; recent task validation reported a package manifest/lockfile
mismatch that Phase 1 must reproduce and resolve. The broad application command
`tsc -p tsconfig.json` also reports known pre-existing diagnostics; the
narrower `typecheck:netlify` command is the currently passing scoped TypeScript
check. Repairing both baselines is Phase 1 work, not evidence that this
documentation-only change altered runtime code.

## Current user-facing routes

The current application's primary routes include `/deposit`, `/withdraw`, and
`/admin`. Approved target routes are structured by domain and rail, for example
`/deposit/fiat/et/cbe` and `/deposit/crypto/usdt-bep20`. The current routes
become compatibility entry points or redirects only as those structured routes
are introduced, and they must continue to work throughout the migration.

## Database changes

Supabase migrations are forward-only. Never edit a migration that has been
applied to any environment. For its configured migration range, the production
runner records path and checksum, uses a runner-owned transaction, and applies
migrations before the application build. Earlier migration files are
pre-runner/manual history and remain immutable. Read
[Data, security, and deployment](docs/architecture/data-security-and-deployment.md)
before changing schema or financial behavior.

# QHash data, security, and deployment

**Status:** Current controls and non-negotiable invariants, with target recommendations
**Scope:** Repository revision `a1d1371fc35620dba9de911ae0f9c8561a98f5bb`
**Purpose:** Prevent file reorganization and the international USDT conversion from weakening financial, security, or deployment guarantees.

See also:

- [Current-state architecture](./current-state.md)
- [Domain boundaries](./domain-boundaries.md)
- [Approved target architecture](./target-state.md)

## Data-system ownership

### Supabase

Supabase is the active authority for:

- Auth users and sessions;
- profiles, roles, freeze state, and Fund PIN security data;
- legacy ETB wallets, transactions, plans, investments, earnings, referrals, fiat deposits, and fiat withdrawals;
- NOWPayments deposit sessions, provider evidence, USDT wallets and ledger, USDT withdrawals, events, broadcasts, and verification evidence;
- application settings and notifications;
- retired crypto evidence retained for audit.

`supabase/migrations` is the production schema history. `src/lib/database.types.ts` is an application type snapshot, not an independent schema authority.

### Netlify Database

`netlify/database/migrations`, `db/schema.ts`, and `db/index.ts` belong to a separate Netlify Database managed through Drizzle. In the inspected runtime source, only `src/lib/server/support.ts` consumes it, and the visible support product currently uses the Supabase-backed Telegram setting instead.

This database must not be used for financial data or treated as a mirror of Supabase. Its support-ticket path remains quarantined until a later decision either hardens and owns it or retires it.

### External providers

NOWPayments is a payment-evidence/provider boundary, not QHash's customer ledger. CBE and TeleBirr are fiat evidence/transfer rails. Provider responses and receipts do not directly authorize a browser-side balance change.

## Trust boundaries

| Boundary | Current requirement |
|---|---|
| Browser to Supabase | anon client plus Auth session and RLS; no service-role secret |
| Browser to TanStack/Netlify server | validate input and access token, derive caller identity from Auth, bind own-data access to that identity, and load/enforce the authoritative profile where eligibility, freeze state, role, or capability applies |
| Administrator action | require active, non-frozen profile with `is_admin = TRUE`; UI visibility is insufficient |
| Server to Supabase | service-role client exists only in server runtime |
| Financial transition | protected database RPC with explicit locks and atomic mutation; stable action IDs and exact replay where the command contract supports them |
| Server to NOWPayments | production-only Function context, server-only credentials, sanitized errors/logs |
| NOWPayments to IPN | signature verification, canonical payload validation, idempotent settlement |
| Deployment to database | production-only migration runner with verified TLS and checksummed ledger |

The client-provided user ID, amount, role, status, balance, provider result, or route selection is never authoritative.

### Verified live security qualification

The trust-boundary table states the required design. It must not be read as a
claim that every legacy database function already satisfies that design.

At the scoped revision:

- `public.approve_deposit_tx(uuid, uuid, text, text, numeric)` is verified as
  postgres-owned, `SECURITY DEFINER`, locked to
  `search_path=pg_catalog, public, pg_temp`, and executable only by `postgres`
  and `service_role` through non-grantable ACLs;
- Supabase's live security advisors still report mutable-search-path findings
  for `update_updated_at_column`, `is_admin`, and
  `create_wallet_for_new_user`;
- the advisors still report client-role execution findings for
  `create_wallet_for_new_user`, `is_admin`, and `rls_auto_enable`; and
- leaked-password protection is not enabled in the current Auth
  configuration.

These remaining findings are documented security debt, not permission for
ad hoc production edits and not, by themselves, proof that each function is
exploitable. Its trigger use, intended callers, source, owner, ACL inheritance,
and dependent application paths must be inspected before a separately reviewed
forward correction. Likewise, an advisor's RLS-enabled-without-policy
informational finding can describe an intentionally closed service-owned table;
table ownership and grants must be checked before classifying it as a defect.

## Financial invariants

These rules are non-negotiable during mechanical reorganization and remain the baseline for later conversion unless a separately reviewed product decision explicitly replaces one.

### Common

1. Customer balance changes are atomic with their immutable ledger/audit evidence.
2. Monetary values use the database precision defined by the owning rail; UI floating-point math is presentation only.
3. Financial command contracts with a stable idempotency key return or preserve
   the original result and cannot duplicate a credit, reservation, release,
   settlement, earning, or reward. New canonical financial commands must
   provide this contract; current legacy commands must not be described as
   having exact replay unless their deployed boundary implements it.
4. Locks use one documented order across competing operations.
5. A failure before commit leaves balances, state, evidence, and idempotency records unchanged.
6. New or migrated sensitive RPCs must be server/service-role only and use
   locked search paths. Known legacy exceptions remain explicit security debt
   until their callers and catalog are reviewed and hardened.
7. Notifications and UI history are projections. They never substitute for the authoritative financial record.
8. Existing audit rows and applied migration evidence are preserved.

### Deposits

- A fiat approval must credit once and remain linked to its deposit evidence.
- A verified NOWPayments deposit credits the verified gross `actually_paid` amount; the provider outcome remains separate audit evidence.
- Historical gross-credit correction entries remain immutable.
- One provider payment can create at most one customer credit.
- Original and repeated payments remain linked to the correct user, session, order, address, and parent relationship.
- Only a qualifying original payment completed and credited before its provider deadline can permanently activate an address.
- Repeated child payments cannot activate an address.
- Pending addresses may be replaced only through the protected lifecycle after their deadline; permanent addresses are reused without provider access.
- A global deposit pause or rail disablement blocks new address disclosure/provisioning and fiat submission, but does not strand admitted settlement, IPN, or controlled recovery work.
- Paused responses must not leak a usable address or unfinished payment details.

### Withdrawals

- Fund PIN remains exactly four numeric digits and is verified through the server-owned protected path.
- One accepted withdrawal per rolling 24 hours applies across fiat and USDT rails.
- The cooldown starts only when QHash successfully accepts the request; invalid attempts consume nothing.
- A nonterminal withdrawal blocks another request across all rails, including after the cooldown.
- The current USDT withdrawal request action has a stable request/action ID;
  its exact idempotent retry returns the original result before reapplying
  policy or money movement. The legacy ETB request function has no equivalent
  replay key: repeat attempts are blocked by the active/cooldown policy, not
  returned as an exact replay.
- USDT reserves the full gross amount once; completion consumes the reservation once; rejection releases it once.
- The current USDT fee calculation and stored gross/fee/net equation must remain exact.
- Users see only Pending, Completed, or Rejected for the simplified USDT workflow.
- Administrators have only Complete and Reject for a pending USDT request.
- An administrator-only transaction hash is optional; users do not see it, and current completion does not require an on-chain verifier.
- Current fiat pause and USDT enablement controls block new requests in their
  respective rails but do not prevent administrators from resolving admitted
  requests. A single global withdrawal pause is approved target behavior, not
  deployed behavior at the pinned revision.

### Plans, earnings, and referrals

- Plan purchase, earnings, and referral rewards must preserve their existing transactional and idempotency protections during reorganization.
- The later USDT conversion must define one canonical precision, rounding, and balance contract before any ETB label or amount is converted.
- Referral ancestry and earned audit evidence must not be reconstructed from mutable display identity.

## Server and RPC responsibilities

The preferred current pattern for critical operations is:

```text
request
  -> validate shape and normalized values
  -> authenticate token
  -> authorize active profile/capability
  -> call one protected RPC
       -> acquire locks in canonical order
       -> revalidate feature and policy state
       -> mutate state, wallet, ledger, and event atomically
  -> return a sanitized projection
```

Some legacy ETB modules still contain direct service-role mutations and multi-step orchestration. Their existence is not permission to copy that pattern into new domains.

**Target recommendation:** place all new balance-affecting use cases behind one owning transactional command. Refactor legacy paths only with native PostgreSQL concurrency tests, pre/post fingerprints, and a forward migration where the database contract changes.

## Migration contract

The current runner, `scripts/apply-migrations.mjs`, provides:

- production-only execution when `APPLY_DB_MIGRATIONS=true` and `CONTEXT=production`;
- a direct PostgreSQL connection or the session pooler on port 5432; the
  transaction pooler on port 6543 is rejected;
- committed CA verification;
- one stable advisory lock across deploys;
- ordered migration discovery from the configured start ID in
  `supabase/migrations`;
- SHA-256 comparison with `public._qhash_migrations` for that runner-managed
  migration range;
- one runner-owned transaction per migration;
- rejection of file-level `BEGIN`, `COMMIT`, or `ROLLBACK`;
- deploy-context and commit-reference provenance.

Rules:

1. Never edit, rename, move, split, or delete an applied migration.
2. Correct schema or function behavior with a new forward migration.
3. Never place Supabase migrations in `netlify/database/migrations`.
4. Preflight catalog assumptions before the first mutation and postflight the intended result for sensitive changes.
5. Preserve exact owner, security mode, search path, ACL/grant-option, RLS, policy, trigger, constraint, and index expectations where they protect money or credentials.
6. Test lock ordering and race behavior with independent PostgreSQL connections.
7. Migration fixtures must prove a rejected preflight occurred before mutation, not merely that a surrounding test transaction rolled it back.

The automated ledger-managed range currently begins at
`20260622165000`. Earlier SQL files represent pre-runner/manual history and are
not recorded by the current runner. They remain historical evidence and must
not be edited, but the repository is not yet a proven clean-room bootstrap
chain for a new Supabase environment.

## Deployment ordering constraint

Netlify currently runs:

```text
npm run db:migrate && npm run build
```

The database can therefore advance before the new application build succeeds and publishes. A failed build may leave the previous production application running against the new schema.

Every production migration must consequently be:

- backward compatible with the currently published application;
- safe if publication is delayed or fails;
- additive or staged when removing/renaming behavior;
- fail-closed before mutation when its expected live catalog has drifted;
- paired with explicit post-deployment verification.

**Target recommendation:** retain the conservative migration compatibility contract even if deployment tooling later changes. Do not make a successful application build the rollback mechanism for an already committed schema change.

## Deployment contexts and secrets

- Standard Netlify Functions must use invocation context for production gating; build-time `CONTEXT` environment access is not the runtime authority.
- previews must not mutate production or call live financial/provider paths.
- Supabase service-role, provider API, IPN, and database migration credentials remain server-only.
- logs use allowlisted diagnostic fields and must exclude authorization headers, secrets, addresses, user/payment identifiers, bodies, raw errors, and stacks where the logging contract forbids them.
- public client bundles must be scanned for server-only markers.

No secret value belongs in documentation, fixtures, screenshots, example commands, or PR descriptions.

## International-USDT cutover guardrails

The approved direction is to preserve Auth accounts, profiles, immutable account/referral identities, and referral relationships while archiving and resetting test financial state. All current users are test users, but that does not remove the need for an auditable cutover.

Before the cutover:

1. define the canonical provider-neutral USDT wallet and ledger contract;
2. define precision, rounding, fiat quote, fee, and rate-evidence rules;
3. inventory every ETB balance and balance-producing path;
4. freeze or gate conflicting writes;
5. archive test financial tables with row counts and deterministic fingerprints;
6. reset through reviewed forward operations, never ad hoc destructive edits;
7. verify zero orphaned balances, plans, earnings, deposits, withdrawals, or referrals;
8. validate old and new application compatibility around each migration;
9. keep a separately authorized rollback or compensating plan.

The reorganization PRs that precede this cutover must remain behavior-preserving and must not perform the reset.

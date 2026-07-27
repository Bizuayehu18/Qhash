# QHash Target Architecture

Status: approved target architecture; not a description of all currently deployed behavior.

This document defines the architecture QHash will move toward during the repository reorganization and international USDT conversion. It is a decision boundary for future work, not authorization to change production data, apply migrations, or enable a feature.

## Goals

QHash will become an international, USDT-denominated fintech application with:

- one provider-neutral USDT accounting model;
- country-aware fiat rails that are optional and independently configurable;
- a simple email-and-phone identity experience;
- explicit domain boundaries that can be changed and tested independently;
- stable, structured URLs;
- English-first, translation-ready interfaces;
- one administrator role initially, with capability boundaries that can later support specialized roles;
- forward-only, auditable database evolution; and
- preserved financial, security, and operational safeguards during every migration stage.

## Architecture principles

### One canonical unit of account

USDT is the canonical user-facing and accounting currency.

All of the following will be denominated and settled in USDT:

- wallet balances;
- plan prices;
- plan purchases;
- mining earnings;
- referral rewards;
- deposit credits;
- withdrawal debits;
- QHash account-facing fees; and
- financial history and reporting.

Local fiat currencies are rail inputs and outputs, not wallet currencies. A fiat deposit is converted into USDT before credit. A fiat withdrawal converts a USDT-denominated withdrawal into the relevant local currency for delivery. Fiat-provider fees are borne by the user and must not be silently subsidized by QHash. This does not change the separately accepted crypto-deposit rule: a verified NOWPayments deposit credits gross `actually_paid`, while provider outcome remains audit evidence.

External rail fees and local-currency amounts remain evidence in their native
unit where required; they are not relabelled as USDT.

Provider names such as NOWPayments, CBE, and TeleBirr must not define the core wallet or ledger model. Providers are adapters around canonical QHash financial operations.

### Domain ownership

Each domain owns its application services, validation, UI, tests, and provider adapters. Route files and Netlify entrypoints should remain thin composition boundaries.

Target domains include:

| Domain | Responsibilities |
|---|---|
| Identity | registration, login, account codes, referral codes, email verification, country derivation, login password, four-digit Fund PIN, recovery, email-change hold, and session protection |
| Accounts | canonical USDT available/reserved balances and immutable ledger |
| Countries | supported-country registry, country derivation, and country-specific rail availability |
| Fiat rails | country/provider adapters for fiat deposit and withdrawal intake, quotes, evidence, and delivery |
| Crypto deposits | crypto-address lifecycle, provider events, verified credit, and recovery |
| Withdrawals | shared cross-rail admission policy, reservation, history, and crypto/manual withdrawal orchestration; consumes fiat-rail adapters rather than duplicating them |
| Plans | USDT plan catalog, eligibility, purchase, lifecycle |
| Earnings | USDT mining earnings and scheduling |
| Referrals | immutable referral relationships and USDT rewards |
| Administration | capability-gated operational views and actions |
| Notifications | user-safe financial and security events |
| Support | customer-support workflows and audit linkage |
| Platform | configuration, feature pauses, observability, migrations, deployment checks |

Shared financial rules belong in domain policy and authoritative database boundaries, not duplicated in individual screens or provider handlers.

These names align with the single proposed physical tree in
[Repository standards](../engineering/repository-standards.md). “Wallet” and
“ledger” are capabilities owned by `accounts`, not additional top-level
modules. “Deposits” is a product/navigation composition over `fiat-rails` and
`crypto-deposits`, not a third competing storage domain. Exact folder adoption
remains Proposed under [ADR 0001](decisions/0001-domain-oriented-modules.md);
implementation must not invent parallel `wallet` or `deposits` roots without
updating that decision.

### Thin delivery layers

The target flow is:

```text
route or Function entrypoint
  -> authenticated application service
    -> domain policy
      -> authoritative transaction/RPC boundary
        -> authoritative financial state plus immutable ledger/audit evidence
```

UI components may format and preview amounts, but they are never authoritative for eligibility, fees, exchange rates, balance mutation, cooldowns, or settlement.

### Fail closed and preserve evidence

Malformed, missing, duplicated, stale, or cross-user identity and financial relationships must fail closed. Financial mutations must be:

- authenticated and authorized;
- idempotent;
- serialized where concurrent actions can conflict;
- exact about currency and precision;
- represented in an immutable ledger or event record;
- auditable without exposing secrets or personal data; and
- covered by native transaction and concurrency tests where the database is authoritative.

Applied migrations are immutable. Schema evolution uses new forward-only migrations with exact preflight and postflight checks proportionate to the financial risk.

## Identity target

### Registration

The registration form remains compact and asks for only:

- email;
- phone number; and
- password.

There is no user-chosen username and no separate country question.

The phone control derives and displays the country as part of normal phone entry. The normalized international phone number and numbering metadata determine the authoritative registered country. Registration must reject unsupported or ambiguous numbers rather than silently assigning the wrong country.

QHash automatically assigns:

- an immutable, non-personally-identifying public account code, for example `QH-8F4K2M7P`; and
- a separate, random referral code.

Neither email nor phone is a public identifier. Account and referral codes must not encode personal data, country, registration order, or database identifiers.

### Login and verification

Users can log in with either their email or phone number plus password.

Phone verification is not required. Email verification is completed from
Profile and establishes persistent account-level withdrawal eligibility until
the email changes or verification is otherwise invalidated. It is not repeated
for each withdrawal. Email verification is not required merely to register, log
in, browse, deposit, or purchase a plan unless a later approved compliance rule
explicitly changes that behavior.

The existing four-digit numeric Fund PIN remains the transaction credential for
each withdrawal. It is separate from the login password and remains required
after the account's email has been verified.

### Identity changes

Users cannot change their registered phone or country themselves. Those changes are support-only, explicitly audited operations.

A future verified-email change flow must require:

1. the current login password;
2. the four-digit Fund PIN;
3. verification of the new email; and
4. a 24-hour withdrawal hold after the change completes.

The implementation must define safe recovery paths without exposing whether another person owns a phone or email.

## Country and rail target

The supported-country registry and the rail registry are separate:

- registration support determines who may create an account;
- deposit rail availability determines which deposit methods the user sees;
- withdrawal rail availability determines which withdrawal methods the user sees.

All 28 approved countries initially support registration. A country may be crypto-only. Fiat deposit and fiat withdrawal availability are enabled independently for each country and provider.

The registered country is authoritative for fiat-rail visibility. Users cannot select another country to reveal or use its rail. Crypto USDT-BEP20 remains the common international rail when it is globally and operationally enabled.

Detailed routing and country rules are defined in [routing-and-country-rails.md](./routing-and-country-rails.md).

## Deposit target

Deposit policy has a shared boundary across fiat and crypto:

- a global deposit pause blocks new deposit admission on every rail;
- a rail-specific flag can independently disable one rail or provider;
- authentication and active/non-frozen profile checks happen before private financial data is disclosed;
- blocked views do not expose actionable deposit credentials;
- already-admitted provider events and settlement may continue safely while new deposits are paused; and
- credits are idempotent and ledger-backed.

### Crypto deposits

USDT on BNB Smart Chain (BEP20) is the initial crypto deposit rail. Its permanent-address lifecycle, repeated-payment support, gross `actually_paid` crediting, provider outcome auditing, pause behavior, and recovery protections remain authoritative until deliberately superseded.

The shared architecture must not weaken provider-independent rules merely because the first crypto adapter is NOWPayments.

### Fiat deposits

The user submits or completes the applicable local provider flow. QHash records the local amount, provider fee treatment, exchange-rate evidence, and resulting USDT credit. The canonical wallet receives USDT only.

The exact rate source, quote lifetime, rounding, and ordering of provider fees versus conversion are deferred decisions and must be approved before fiat-to-USDT implementation.

## Withdrawal target

All fiat and USDT withdrawal rails share these admission rules:

- the request is accepted only after server-side validation, email-verification eligibility, Fund PIN verification, balance checks, rail checks, and destination checks;
- an accepted request starts one rolling 24-hour limit immediately at its submission time;
- invalid or rejected-before-acceptance attempts do not consume the allowance;
- the limit is shared across CBE, TeleBirr, USDT-BEP20, and future rails;
- a nonterminal request blocks another request even after its 24-hour window has elapsed; and
- after the previous request is terminal, a new request is allowed only when 24 hours have elapsed since the previous accepted submission.

The target unified withdrawal request command must carry a stable idempotency
key. An exact replay of the same accepted action returns the original result
rather than creating another request or consuming another allowance. This is
already true for the current USDT request boundary; it is not a claim that the
legacy ETB request function currently has exact-result replay.

A global withdrawal pause blocks new requests across every rail.
Administrators may continue to resolve requests that were accepted before the
pause through each rail's existing terminal action contract.

The current simplified manual USDT model remains:

- user-visible statuses: Pending, Completed, and Rejected;
- administrators act through Complete or Reject;
- an administrator may optionally store a public transaction hash;
- the transaction hash is administrator-only and not shown in user history; and
- QHash does not perform or claim on-chain verification for the manual workflow.

Current fiat terminology and actions remain behavior-preserving during the
reorganization. Unifying fiat labels or actions with the USDT model requires a
separate accepted product decision.

## Administration and authorization

QHash retains one administrator role initially, but code must authorize named capabilities rather than scatter raw role checks through pages.

The target capability groups include:

- users;
- fiat deposits;
- crypto deposits;
- fiat withdrawals;
- crypto withdrawals;
- plans and earnings;
- referrals;
- support;
- platform settings; and
- audit and recovery.

This structure must allow later introduction of roles such as Super Admin, Finance, and Support without rewriting every route or handler. No future role exists merely because this target is documented.

Administrator navigation is grouped by domain, with Fiat and Crypto subsections under Deposits and Withdrawals.

## Internationalization

The initial international launch is English only. New user-facing text must nevertheless be translation-ready:

- stable message keys instead of business logic depending on English sentences;
- locale-aware date, time, number, and currency formatting;
- no concatenated sentence fragments that prevent translation;
- country and provider display names separated from internal codes; and
- accessible labels that do not rely on icon meaning alone.

Translation infrastructure should be introduced deliberately; documentation does not imply that multiple languages are currently available.

## Repository target

The repository will move incrementally toward domain-oriented modules. Domain
ownership and dependency direction are approved; the exact physical tree is
still proposed in
[Repository standards](../engineering/repository-standards.md) and
[ADR 0001](./decisions/0001-domain-oriented-modules.md). Do not create a
repository-wide move merely to match an illustrative tree.

## Migration approach

The reorganization and financial conversion are separate, reviewable stages:

1. Establish authoritative documentation and architecture checks.
2. Create compatibility boundaries and characterize current behavior.
3. Move files mechanically by domain while preserving behavior and visual design.
4. Introduce the international identity and country registry.
5. Introduce provider-neutral USDT accounting and approved conversion policy.
6. Migrate plans, earnings, referrals, deposits, and withdrawals domain by domain.
7. Perform an explicitly authorized test-data cutover.
8. Redesign each domain toward the premium international experience after behavioral equivalence is proven.

Large route files must be decomposed through tested seams, not rewritten wholesale. Old URLs retain compatibility redirects during the transition.

## Test-data cutover

All current users are test users. At the final USDT cutover, QHash may:

- preserve Supabase Auth accounts;
- preserve profiles;
- preserve immutable public account codes;
- preserve referral codes and referral relationships;
- archive the complete pre-cutover financial audit record; and
- reset test balances, plans, earnings, deposits, withdrawals, and transactions.

The cutover must be a separately reviewed and authorized operation with a deterministic manifest, pre/post fingerprints, rollback or recovery strategy, and explicit treatment of provider artifacts. This document does not authorize the reset.

## Deferred decisions

The following are intentionally unresolved and must not be invented by implementation PRs:

- exchange-rate provider and fallback hierarchy;
- quote-lock duration and expiry behavior;
- deposit and withdrawal conversion formulas, including the exact ordering of provider fees;
- rounding and display precision beyond the requirement for exact ledger arithmetic;
- USDT plan prices, durations, earning rates, and referral economics;
- country-by-country regulatory, KYC, sanctions, tax, and provider requirements;
- production launch sequence for individual countries and fiat providers; and
- exact handling of provider sessions and addresses during the test-data cutover.

Until approved, these items must remain configuration or roadmap concerns rather than hard-coded assumptions.
